#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function asBool(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|y)$/i.test(String(value || ""));
}

function usage() {
  console.error(`Usage:
node scripts/production-mode-router.mjs --out-dir /abs/run/mode \\
  [--user-text "..."] [--image-count 8] [--quality-target high|standard|draft] \\
  [--has-source-image true] [--scene-requested true] [--physical-function-risk true] \\
  [--revision-requested true] [--industrial-audit true] [--debug true] [--fast true]

Selects the lightest production mode that can still protect product image
quality. Normal multi-image ecommerce sets should route to quality_production,
not full industrial_audit.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"]) usage();

const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const userText = String(args["user-text"] || "");
const imageCount = Number(args["image-count"] || 0);
const qualityTarget = String(args["quality-target"] || "").toLowerCase();
const signals = {
  explicit_fast: asBool(args.fast) || /(快速|先快出|草稿|draft|quick|fast|rough)/i.test(userText),
  explicit_high_quality: qualityTarget === "high" || /(高质量|精修|商业级|成品|final|high quality|premium)/i.test(userText),
  explicit_industrial_audit: asBool(args["industrial-audit"]) || /(工业级|完整流程|审计|迁移|gate report|audit package|可迁移)/i.test(userText),
  debug_development: asBool(args.debug) || /(debug|selftest|回归测试|开发验证|脚本验证)/i.test(userText),
  revision_requested: asBool(args["revision-requested"]) || /(修改|修图|批注|标注|重做|继续优化|revision|revise|annotation)/i.test(userText),
  has_source_image: asBool(args["has-source-image"]),
  scene_requested: asBool(args["scene-requested"]) || /(场景|上身|模特|lifestyle|outfit|commute|cafe|street)/i.test(userText),
  physical_function_risk: asBool(args["physical-function-risk"]) || /(安装|使用步骤|承重|防水|固定|尺寸|scale|function|installation)/i.test(userText),
  platform_research_needed: asBool(args["platform-research-needed"]) || /(趋势|热词|节日|气候|区域|season|holiday|trend|hotword)/i.test(userText),
  multi_image_set: imageCount > 1 || /(套图|组图|8图|七图|多图|image set|listing images)/i.test(userText),
};

const decision = selectMode(signals, { imageCount, qualityTarget });
const report = {
  schema_version: "sellerpilot.production_mode_router.v1",
  status: "ready",
  selected_mode: decision.mode,
  reason: decision.reason,
  created_at: new Date().toISOString(),
  inputs: {
    image_count: imageCount || null,
    quality_target: qualityTarget || null,
    user_text: userText,
  },
  signals,
  execution_policy: modePolicy(decision.mode, signals),
};

fs.writeFileSync(path.join(outDir, "production-mode-router-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "production-mode-router-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status: report.status, selected_mode: report.selected_mode, outDir }, null, 2));

function selectMode(flags, ctx) {
  if (flags.debug_development) return { mode: "debug_development", reason: "debug_or_skill_validation_requested" };
  if (flags.explicit_industrial_audit) return { mode: "industrial_audit", reason: "full_audit_or_migration_evidence_requested" };
  if (flags.revision_requested) return { mode: "revision_repair", reason: "existing_outputs_or_annotations_need_targeted_revision" };
  if (flags.explicit_fast && !flags.explicit_high_quality && !flags.multi_image_set && !flags.scene_requested && !flags.physical_function_risk) {
    return { mode: "fast_generation", reason: "single_low_risk_fast_request" };
  }
  if (!flags.multi_image_set && !flags.explicit_fast && (ctx.imageCount || 1) <= 1) {
    return { mode: "single_image_quality_production", reason: "single_final_image_request_needs_manifest_final_gate_and_tldraw" };
  }
  if (flags.multi_image_set || flags.explicit_high_quality || flags.scene_requested || flags.physical_function_risk || flags.platform_research_needed) {
    return { mode: "quality_production", reason: "quality_or_multi_asset_request_needs_full_critical_path_without_audit_artifacts" };
  }
  if ((ctx.imageCount || 1) <= 1) {
    return { mode: "single_image_quality_production", reason: "single_standard_final_image_request" };
  }
  return { mode: "quality_production", reason: "default_for_ecommerce_final_assets" };
}

function modePolicy(mode, flags) {
  const singleImage = !flags.multi_image_set;
  const common = {
    update_check: "cache-first non-blocking",
    efficiency_plan: "write production-efficiency-plan before heavy planning or generation",
    tldraw: "for every generated final delivery, auto-start after export; multi-image sets start after overview and single-image finals do not require an overview",
    generation_pacing: "use anchor batch before full multi-image generation; single-image requests may generate one final image directly after identity/prompt checks",
    rerun_policy: "rerun only missing or failed assets",
  };
  if (mode === "fast_generation") {
    return {
      ...common,
      required_quality_path: ["brief-intake", "source-understanding-if-source-image", "identity-lock", "visual-director-mini-plan", "imagegen", "focused-qa", "export"],
      skipped_by_default: ["full-run-skeleton", "full-research-brief", "tldraw", "industrial-gate-pack"],
    };
  }
  if (mode === "single_image_quality_production") {
    return {
      ...common,
      required_quality_path: singleImageQualityPath(flags),
      skipped_by_default: [
        "anchor-batch-imagegen",
        "overview-contact-sheet",
        "verbose-industrial-reports",
        "pre-generation-always-on-tldraw",
        "untriggered-product-url-reader",
        "untriggered-live-web-research",
        "full-bestseller-mining-unless-requested",
      ],
    };
  }
  if (mode === "quality_production") {
    return {
      ...common,
      required_quality_path: singleImage ? singleImageQualityPath(flags) : [
        "brief-intake",
        "direction-options-if-rough",
        "source-understanding-ai-text-first-ocr-if-needed",
        "identity-lock",
        "compact-image-set-planning",
        flags.physical_function_risk ? "physical-truth-lock-and-gate" : "physical-truth-check-if-triggered",
        flags.platform_research_needed ? "targeted-platform-research" : "cached-platform-profile",
        "feature-audience-analysis",
        "visual-director-shot-matrix",
        "copy-strategy-gate",
        "localized-copy-qa-gate-if-locale-needs-review",
        "prompt-layer-gate",
        "anchor-batch-imagegen",
        "identity-marketing-export-final-gates",
        "overview-contact-sheet",
      ],
      skipped_by_default: [
        "verbose-industrial-reports",
        "pre-generation-always-on-tldraw",
        "untriggered-product-url-reader",
        "untriggered-live-web-research",
        "full-bestseller-mining-unless-requested",
        "separate-verbose-strategy-docs-when-compact-image-set-planning-covers-them",
      ],
    };
  }
  if (mode === "revision_repair") {
    return {
      ...common,
      required_quality_path: ["failed-output-review", "parse-annotations-if-present", "route-to-earliest-failed-node", "rerun-affected-assets-only", "focused-regression-qa"],
      skipped_by_default: ["new-full-set-generation", "unaffected-assets-regeneration"],
    };
  }
  if (mode === "industrial_audit") {
    return {
      ...common,
      required_quality_path: ["full-workflow-artifact-pack", "all-required-gates", "audit-reports", "review-workspace", "final-delivery-gate"],
      skipped_by_default: [],
    };
  }
  return {
    ...common,
    required_quality_path: ["selftests", "fixtures", "focused-debug-artifacts"],
    skipped_by_default: ["real-user-delivery-unless-explicit"],
  };
}

function singleImageQualityPath(flags) {
  return [
      "brief-intake",
      "direction-options-if-rough",
      "source-understanding-ai-text-first-ocr-if-needed",
      "identity-lock",
      flags.physical_function_risk ? "physical-truth-lock-and-gate" : "physical-truth-check-if-triggered",
      flags.platform_research_needed ? "targeted-platform-research" : "cached-platform-profile",
      "single-image-visual-plan",
      "copy-strategy-gate-if-visible-copy",
      "localized-copy-qa-gate-if-locale-needs-review",
      "prompt-layer-gate",
      "single-image-generation",
      "identity-marketing-export-final-gates",
      "final-image-manifest",
      "post-generation-tldraw-auto-start",
    ];
}

function toMarkdown(report) {
  const lines = [
    "# Production Mode Router Report",
    "",
    `- Status: ${report.status}`,
    `- Selected mode: ${report.selected_mode}`,
    `- Reason: ${report.reason}`,
    "",
    "## Required Quality Path",
    ...report.execution_policy.required_quality_path.map((item) => `- ${item}`),
    "",
    "## Skipped By Default",
    ...(report.execution_policy.skipped_by_default.length ? report.execution_policy.skipped_by_default.map((item) => `- ${item}`) : ["- None"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
