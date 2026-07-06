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
node scripts/production-efficiency-plan.mjs --run-dir /abs/run \\
  [--mode-report /abs/run/mode/production-mode-router-report.json] \\
  [--mode quality_production] [--image-count 8] [--user-text "..."] \\
  [--has-source-image true] [--scene-requested true] [--platform-research-needed true] \\
  [--physical-function-risk true]

Writes a run-scoped execution budget that keeps quality-critical image-set planning
and gates while skipping verbose audit artifacts and untriggered research.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const modeReport = args["mode-report"] ? readJson(path.resolve(args["mode-report"])) : null;
const mode = args.mode || modeReport?.selected_mode || "quality_production";
const userText = String(args["user-text"] || modeReport?.inputs?.user_text || "");
const imageCount = Number(args["image-count"] || modeReport?.inputs?.image_count || 0);
const signals = {
  has_source_image: asBool(args["has-source-image"]) || Boolean(modeReport?.signals?.has_source_image),
  scene_requested: asBool(args["scene-requested"]) || Boolean(modeReport?.signals?.scene_requested) || /(场景|上身|模特|lifestyle|outfit|commute|cafe|street)/i.test(userText),
  platform_research_needed: asBool(args["platform-research-needed"]) || Boolean(modeReport?.signals?.platform_research_needed) || /(趋势|热词|节日|气候|区域|season|holiday|trend|hotword)/i.test(userText),
  physical_function_risk: asBool(args["physical-function-risk"]) || Boolean(modeReport?.signals?.physical_function_risk) || /(安装|使用步骤|承重|防水|固定|尺寸|scale|function|installation)/i.test(userText),
  rough_or_open_request: /(随便|你看着|粗略|不知道|方案|方向|任选|open|rough)/i.test(userText),
  multi_image_set: imageCount > 1 || Boolean(modeReport?.signals?.multi_image_set),
};

const plan = buildPlan({ mode, imageCount, signals, userText });
const outDir = path.join(runDir, "planning");
const progressDir = path.join(runDir, "generated-assets");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(progressDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "production-efficiency-plan.json"), JSON.stringify(plan, null, 2));
fs.writeFileSync(path.join(outDir, "production-efficiency-plan.md"), toMarkdown(plan));

const progressPath = path.join(progressDir, "generation-progress.json");
if (!fs.existsSync(progressPath)) {
  fs.writeFileSync(progressPath, JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "planned",
    created_at: new Date().toISOString(),
    mode,
    image_count: imageCount || null,
    completed_images: [],
    pending_images: [],
    failed_images: [],
    next_action: "build compact image-set planning before anchor batch",
    progress_update_policy: plan.progress_update_policy,
  }, null, 2));
}

console.log(JSON.stringify({
  status: "ready",
  mode,
  outDir,
  compactPlanningRequired: plan.quality_contract.compact_image_set_planning_required,
  preGenerationBudgetSeconds: plan.budgets.pre_generation_max_seconds,
}, null, 2));

function buildPlan(ctx) {
  const fastMode = ctx.mode === "fast_generation";
  const auditMode = ctx.mode === "industrial_audit";
  const planningSections = [
    "confirmed product facts, AI-read visible text, and conditional OCR facts",
    "identity, geometry, physical truth, and micro-detail locks",
    "platform/category baseline plus triggered current context",
    "buyer question and conversion task per image",
    "visual director shot matrix and scene asset needs",
    "buyer-facing copy intent and unsupported-claim exclusions",
    "prompt-layer mandatory and conditional layers",
    "QA criteria and rerun scope per image",
  ];

  return {
    schema_version: "sellerpilot.production_efficiency_plan.v1",
    status: "ready",
    created_at: new Date().toISOString(),
    mode: ctx.mode,
    image_count: ctx.imageCount || null,
    signals: ctx.signals,
    quality_contract: {
      compact_image_set_planning_required: !fastMode || ctx.signals.multi_image_set,
      compact_image_set_planning_path: "blueprint/quality-production-blueprint.json",
      compact_image_set_planning_sections: planningSections,
      delivery_overview_required_for_multi_image_sets: true,
      industrial_full_report_pack_only_when: "industrial_audit or repeated failure debug",
      do_not_skip: [
        "source product understanding when source images exist",
        "product identity lock",
        "physical/geometry locks when triggered",
        "visual director shot matrix",
        "prompt layer gate",
        "anchor batch QA before full multi-image generation",
        "export manifest and delivery overview for multi-image sets",
        "final delivery gate",
      ],
    },
    budgets: budgetsFor(ctx.mode, ctx.signals),
    run_shape: runShape(ctx.mode, ctx.signals),
    triggered_work: {
      source_understanding: ctx.signals.has_source_image ? "required" : "planning_only_no_identity_preservation",
      strategy_direction_handoff: ctx.signals.rough_or_open_request ? "required_first_handoff" : "skip",
      product_url_reader: /https?:\/\//i.test(ctx.userText) ? "required" : "skip",
      platform_web_research: ctx.signals.platform_research_needed ? "targeted_max_2_queries" : "skip_use_platform_yaml_baseline",
      market_research: ctx.signals.platform_research_needed ? "compact_pattern_scan_only_if_conversion_critical" : "skip",
      physical_truth_gate: ctx.signals.physical_function_risk ? "required" : "triggered_only_if_image_roles_show_function_or_scale",
      scene_asset_generation: ctx.signals.scene_requested ? "required_for_scene_roles" : "skip",
      tldraw_start: ctx.signals.multi_image_set ? "single_post_export_shared_service_launch" : "only_if_requested_or_gate_failed",
    },
    skip_by_default: auditMode ? [] : [
      "full industrial report pack",
      "untriggered product URL reading",
      "untriggered live web research",
      "full bestseller mining",
      "full market research brief",
      "separate verbose commerce/creative/photo documents when compact image-set planning already covers them",
      "pre-generation tldraw startup",
      "region review HTML unless precise A-H feedback is requested",
      "regeneration of approved assets",
    ],
    parallelizable_groups: [
      ["update awareness check", "mode routing", "run skeleton"],
      ["source image preflight and AI visual text read", "platform YAML baseline load", "brief intake assumptions"],
      ["compact feature/audience notes", "visual director shot matrix", "copy intent draft"],
      ["export gate", "delivery overview", "post-generation tldraw workspace file creation"],
    ],
    progress_update_policy: {
      write_progress_file: "generated-assets/generation-progress.json",
      update_after_each_generated_asset: true,
      user_visible_update_interval_seconds: 300,
      long_running_threshold_seconds: 900,
      if_generation_exceeds_threshold: "report completed/pending assets and continue only missing assets",
    },
  };
}

function budgetsFor(mode, signals) {
  if (mode === "industrial_audit") {
    return {
      pre_generation_max_seconds: 900,
      research_max_seconds: 300,
      planning_max_seconds: 300,
      qa_after_each_loop_max_seconds: 180,
      note: "Industrial audit mode is intentionally heavier because the user asked for evidence artifacts.",
    };
  }
  if (mode === "fast_generation") {
    return {
      pre_generation_max_seconds: 180,
      research_max_seconds: signals.platform_research_needed ? 60 : 0,
      planning_max_seconds: 60,
      qa_after_each_loop_max_seconds: 45,
      note: "Fast mode protects identity and QA but avoids full reports.",
    };
  }
  return {
    pre_generation_max_seconds: 420,
    research_max_seconds: signals.platform_research_needed ? 120 : 30,
    planning_max_seconds: 120,
    anchor_batch_decision_max_seconds: 180,
    qa_after_each_loop_max_seconds: 90,
    tldraw_start_max_seconds: 45,
    note: "Quality production keeps critical planning and gates but should not spend more time on artifacts than on generation.",
  };
}

function runShape(mode, signals) {
  if (mode === "revision_repair") {
    return ["parse feedback", "route to earliest failed node", "rerun affected assets only", "focused regression QA"];
  }
  if (mode === "industrial_audit") {
    return ["full artifact skeleton", "complete reports", "all triggered gates", "review workspace", "final delivery"];
  }
  const shape = [
    "brief intake with assumptions",
    "source understanding and identity lock",
    "compact image-set planning",
    "prompt layer gate",
    "anchor batch",
    "anchor QA",
    "continue missing assets only",
    "focused final gates",
    "export manifest",
    "overview",
  ];
  if (signals.multi_image_set) shape.push("post-generation tldraw auto-start");
  shape.push("final delivery gate");
  return shape;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function toMarkdown(plan) {
  const lines = [
    "# Production Efficiency Plan",
    "",
    `- Status: ${plan.status}`,
    `- Mode: ${plan.mode}`,
    `- Image count: ${plan.image_count ?? "unknown"}`,
    `- Compact image-set planning required: ${plan.quality_contract.compact_image_set_planning_required}`,
    `- Pre-generation budget: ${plan.budgets.pre_generation_max_seconds}s`,
    "",
    "## Run Shape",
    ...plan.run_shape.map((item) => `- ${item}`),
    "",
    "## Triggered Work",
    ...Object.entries(plan.triggered_work).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Skip By Default",
    ...(plan.skip_by_default.length ? plan.skip_by_default.map((item) => `- ${item}`) : ["- None"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
