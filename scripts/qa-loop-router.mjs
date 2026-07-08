#!/usr/bin/env node
import crypto from "node:crypto";
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

function usage() {
  console.error(`Usage:
node scripts/qa-loop-router.mjs --run-dir /abs/run [--out-dir /abs/run/qa]

Reads known qa/*-report.json files and writes:
qa/qa-loop-routing-decision.json
qa/qa-loop-routing-decision.yaml
qa/qa-loop-routing-decision.md`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
fs.mkdirSync(qaDir, { recursive: true });

const reports = loadReports(qaDir);
const findings = collectFindings(reports);
const actionable = findings.filter((item) => ["critical", "fail", "warn"].includes(item.severity));
const ranked = actionable.sort(compareFindings);
const primary = ranked[0] || null;
const decision = applyRetryGuard(buildDecision({ runDir, reports, findings, primary }), qaDir, reports);

fs.writeFileSync(path.join(qaDir, "qa-loop-routing-decision.json"), JSON.stringify(decision, null, 2));
fs.writeFileSync(path.join(qaDir, "qa-loop-routing-decision.yaml"), toYaml(decision));
fs.writeFileSync(path.join(qaDir, "qa-loop-routing-decision.md"), toMarkdown(decision));
console.log(JSON.stringify({ status: decision.loop_decision.status, findings: findings.length, outDir: qaDir }, null, 2));
if (decision.loop_decision.status.startsWith("blocked")) process.exitCode = 1;

function loadReports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /-report\.json$/.test(name))
    .filter((name) => !/^qa-loop-routing-decision\.json$/.test(name))
    .filter((name) => name !== "final-delivery-gate-report.json")
    .map((name) => {
      const file = path.join(dir, name);
      try {
        const report = JSON.parse(fs.readFileSync(file, "utf8"));
        return { file, name, report };
      } catch (error) {
        return {
          file,
          name,
          report: {
            status: "blocked",
            findings: [{
              severity: "fail",
              type: "unreadable-gate-report",
              message: `Could not parse ${name}: ${error.message}`,
            }],
          },
        };
      }
    });
}

function applyRetryGuard(decision, qaDirPath, reports) {
  const loop = decision.loop_decision || {};
  const retryableStatuses = new Set(["return_to_node", "regenerate_failed_assets_only", "rerender_layout_only"]);
  const statePath = path.join(qaDirPath, "qa-loop-state.json");
  const state = loadRetryState(statePath);

  state.schema_version = "sellerpilot.qa_loop_state.v1";
  state.updated_at = new Date().toISOString();
  state.signatures ||= {};
  state.history ||= [];

  if (loop.status === "continue") {
    state.last_decision = {
      status: loop.status,
      primary_failure_type: null,
      updated_at: state.updated_at,
    };
    writeRetryState(statePath, state);
    decision.loop_guard = {
      status: "not_counted",
      reason: "No actionable QA failure.",
      state_path: statePath,
    };
    return decision;
  }

  if (!retryableStatuses.has(loop.status) || !loop.primary_failure_type || !loop.return_node) {
    state.last_decision = {
      status: loop.status,
      primary_failure_type: loop.primary_failure_type || null,
      return_node: loop.return_node || null,
      counted: false,
      updated_at: state.updated_at,
    };
    writeRetryState(statePath, state);
    decision.loop_guard = {
      status: "not_counted",
      reason: `Status ${loop.status || "unknown"} is not a retryable generation/layout loop.`,
      state_path: statePath,
    };
    return decision;
  }

  const signature = retrySignature(loop);
  const evidenceFingerprint = retryEvidenceFingerprint(loop, decision, reports);
  const maxAttempts = Number.isFinite(Number(loop.retry_budget)) ? Number(loop.retry_budget) : retryBudget(loop.return_node);
  const existing = state.signatures[signature] || {
    signature,
    primary_failure_type: loop.primary_failure_type,
    failure_category: loop.failure_category || null,
    return_node: loop.return_node,
    failed_gate: loop.failed_gate || null,
    failed_images: loop.failed_images || [],
    first_seen_at: state.updated_at,
    attempt_count: 0,
    max_attempts: maxAttempts,
    status: "retryable",
    evidence_fingerprints: [],
  };

  const evidenceChanged = existing.last_evidence_fingerprint !== evidenceFingerprint;
  if (evidenceChanged) {
    existing.attempt_count = Number(existing.attempt_count || 0) + 1;
    existing.evidence_fingerprints = [
      ...(existing.evidence_fingerprints || []),
      {
        fingerprint: evidenceFingerprint,
        seen_at: state.updated_at,
        attempt_count: existing.attempt_count,
      },
    ].slice(-20);
  }
  existing.max_attempts = maxAttempts;
  existing.last_seen_at = state.updated_at;
  existing.last_evidence_fingerprint = evidenceFingerprint;
  existing.last_evidence_changed = evidenceChanged;
  existing.last_status = loop.status;
  existing.failed_images = loop.failed_images || [];
  existing.failed_gate = loop.failed_gate || existing.failed_gate || null;
  existing.remaining_attempts = Math.max(0, maxAttempts - existing.attempt_count);
  existing.status = existing.attempt_count > maxAttempts ? "exhausted" : "retryable";
  state.signatures[signature] = existing;
  state.last_decision = {
    status: existing.status,
    primary_failure_type: loop.primary_failure_type,
    return_node: loop.return_node,
    signature,
    attempt_count: existing.attempt_count,
    max_attempts: maxAttempts,
    evidence_changed: evidenceChanged,
    evidence_fingerprint: evidenceFingerprint,
    updated_at: state.updated_at,
  };
  state.history.push({
    checked_at: state.updated_at,
    signature,
    status: existing.status,
    evidence_changed: evidenceChanged,
    evidence_fingerprint: evidenceFingerprint,
    primary_failure_type: loop.primary_failure_type,
    return_node: loop.return_node,
    failed_images: loop.failed_images || [],
    attempt_count: existing.attempt_count,
    max_attempts: maxAttempts,
  });
  if (state.history.length > 100) state.history = state.history.slice(-100);

  loop.retry_attempts_used = existing.attempt_count;
  loop.retry_attempts_remaining = existing.remaining_attempts;
  loop.retry_signature = signature;
  loop.retry_evidence_fingerprint = evidenceFingerprint;
  decision.loop_guard = {
    status: evidenceChanged ? existing.status : "same_evidence_not_counted",
    signature,
    attempt_count: existing.attempt_count,
    max_attempts: maxAttempts,
    remaining_attempts: existing.remaining_attempts,
    evidence_changed: evidenceChanged,
    evidence_fingerprint: evidenceFingerprint,
    state_path: statePath,
  };

  if (existing.status === "exhausted") {
    loop.status = "blocked_retry_budget_exhausted";
    loop.blocked_reason = `Retry budget exhausted for ${loop.primary_failure_type} at ${loop.return_node}: ${existing.attempt_count}/${maxAttempts} repeated QA-loop decisions. Stop regenerating and request better source evidence, user choice, or a changed production direction.`;
    loop.user_input_required = true;
    loop.smallest_next_action = `Stop the automatic generation loop for ${loop.primary_failure_type}. Ask for the missing source/product/context input or change the upstream strategy before any more generation.`;
    loop.do_not_rerun = unique([...(loop.do_not_rerun || []), "automatic-generation-loop", "full-image-set-generation"]);
    decision.findings.push({
      severity: "critical",
      type: "retry-budget-exhausted",
      gate_id: "qa-loop-router",
      source_report: "qa-loop-state.json",
      return_node: loop.return_node,
      failure_category: loop.failure_category,
      message: loop.blocked_reason,
      user_input_required: true,
    });
  }

  writeRetryState(statePath, state);
  return decision;
}

function retryEvidenceFingerprint(loop, decision, reports) {
  const relevantNames = new Set(
    (decision.findings || [])
      .filter((item) => item.type === loop.primary_failure_type || item.return_node === loop.return_node)
      .map((item) => item.source_report)
      .filter(Boolean),
  );
  const relevantReports = reports.filter((item) => !relevantNames.size || relevantNames.has(item.name));
  const payload = relevantReports.map((item) => {
    let stat = null;
    try {
      const fileStat = fs.statSync(item.file);
      stat = {
        size: fileStat.size,
        mtime_ms: Math.round(fileStat.mtimeMs),
      };
    } catch {
      stat = { size: null, mtime_ms: null };
    }
    return {
      name: item.name,
      stat,
      status: item.report?.status || null,
      findings: Array.isArray(item.report?.findings) ? item.report.findings : [],
    };
  });
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      primary_failure_type: loop.primary_failure_type,
      return_node: loop.return_node,
      failed_gate: loop.failed_gate,
      failed_images: loop.failed_images || [],
      reports: payload,
    }))
    .digest("hex");
}

function retrySignature(loop) {
  return [
    loop.return_node || "unknown-node",
    loop.primary_failure_type || "unknown-failure",
    loop.failed_gate || "unknown-gate",
    ...(loop.failed_images || []).map((item) => `image-${item}`).sort(),
  ].join("|");
}

function loadRetryState(file) {
  if (!fs.existsSync(file)) {
    return {
      schema_version: "sellerpilot.qa_loop_state.v1",
      created_at: new Date().toISOString(),
      signatures: {},
      history: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("state is not an object");
    parsed.signatures ||= {};
    parsed.history ||= [];
    return parsed;
  } catch (error) {
    return {
      schema_version: "sellerpilot.qa_loop_state.v1",
      created_at: new Date().toISOString(),
      recovered_from_unreadable_state: error.message,
      signatures: {},
      history: [],
    };
  }
}

function writeRetryState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function collectFindings(reports) {
  const findings = [];
  for (const { name, report } of reports) {
    const gateId = gateIdFromName(name);
    const status = normalizeStatus(report.status);
    if (["fail", "blocked"].includes(status) && !Array.isArray(report.findings)) {
      findings.push({
        severity: "fail",
        type: `${gateId}-failed`,
        gate_id: gateId,
        message: `${gateId} reported status ${report.status}.`,
      });
    }
    for (const raw of Array.isArray(report.findings) ? report.findings : []) {
      const type = normalizeType(raw.type || raw.failure_type || raw.code || `${gateId}-finding`);
      findings.push({
        ...raw,
        type,
        severity: normalizeSeverity(raw.severity || statusToSeverity(report.status)),
        gate_id: gateId,
        source_report: name,
        image_index: raw.image_index || raw.index || imageIndexFromFile(raw.file),
        return_node: raw.return_node || returnNode(type),
        failure_category: failureCategory(type),
      });
    }
  }
  return findings;
}

function buildDecision({ runDir, reports, findings, primary }) {
  if (!reports.length) {
    return {
      loop_decision: {
        status: "blocked_user_input_required",
        primary_failure_type: "missing-gate-reports",
        return_node: "qa-compliance",
        failed_gate: "qa-loop-router",
        failed_images: [],
        smallest_next_action: "Run at least one gate before routing QA loop.",
        rerun_from: ["qa-compliance"],
        do_not_rerun: [],
        retry_budget: null,
        blocked_reason: "No qa/*-report.json files found.",
        user_input_required: false,
      },
      reports_seen: [],
      findings: [],
      run_dir: runDir,
      checked_at: new Date().toISOString(),
    };
  }

  if (!primary) {
    return {
      loop_decision: {
        status: "continue",
        primary_failure_type: null,
        return_node: null,
        failed_gate: null,
        failed_images: [],
        smallest_next_action: "Proceed to the next workflow node.",
        rerun_from: [],
        do_not_rerun: [],
        retry_budget: null,
        blocked_reason: null,
        user_input_required: false,
      },
      reports_seen: reports.map((item) => item.name),
      findings,
      run_dir: runDir,
      checked_at: new Date().toISOString(),
    };
  }

  const type = primary.type;
  const node = primary.return_node || returnNode(type);
  const failedImages = unique(findings
    .filter((item) => item.type === type || item.return_node === node)
    .map((item) => item.image_index)
    .filter(Boolean));
  const blocked = blockedStatus(primary, findings);
  const status = blocked || statusForNode(node, type);
  const userInputRequired = Boolean(primary.user_input_required) || status === "blocked_user_input_required";

  return {
    loop_decision: {
      status,
      primary_failure_type: type,
      failure_category: primary.failure_category,
      return_node: node,
      failed_gate: primary.gate_id,
      failed_images: failedImages,
      smallest_next_action: nextAction(type, node),
      rerun_from: rerunFrom(node),
      do_not_rerun: doNotRerun(node, type),
      retry_budget: retryBudget(node),
      blocked_reason: status.startsWith("blocked") ? primary.message || `${type} blocks progress.` : null,
      user_input_required: userInputRequired,
    },
    reports_seen: reports.map((item) => item.name),
    findings,
    run_dir: runDir,
    checked_at: new Date().toISOString(),
  };
}

function compareFindings(a, b) {
  const severityRank = { critical: 0, fail: 1, warn: 2, info: 3 };
  const categoryRank = {
    runtime: 0,
    source_quality: 1,
    product_truth: 2,
    identity: 3,
    identity_geometry: 3,
    prompt_layer: 4,
    prompt_readiness: 5,
    platform_market: 6,
    strategy: 7,
    layout_copy: 8,
    creative: 9,
    photography_scene: 10,
    micro_detail: 10,
    marketing_diversity: 10,
    export: 12,
    delivery: 13,
    unknown: 14,
  };
  return (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)
    || (categoryRank[a.failure_category] ?? 9) - (categoryRank[b.failure_category] ?? 9);
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "ready", "ok"].includes(value)) return "pass";
  if (["pass_with_warnings", "ready_with_warnings", "warn"].includes(value)) return "warn";
  if (["fail", "failed"].includes(value)) return "fail";
  if (["blocked", "needs_visual_review"].includes(value)) return "blocked";
  return value || "unknown";
}

function statusToSeverity(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "blocked" || normalized === "fail") return "fail";
  if (normalized === "warn") return "warn";
  return "info";
}

function normalizeSeverity(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "error") return "fail";
  if (["critical", "fail", "warn", "info"].includes(value)) return value;
  return "warn";
}

function normalizeType(type) {
  return String(type || "unknown").trim().toLowerCase().replace(/_/g, "-");
}

function gateIdFromName(name) {
  return name.replace(/-report\.json$/, "").replace(/\.json$/, "");
}

function imageIndexFromFile(file) {
  const match = String(file || "").match(/(?:IMG|POSTER|DETAIL)-(\d{2})/i);
  return match ? Number(match[1]) : null;
}

function failureCategory(type) {
  if (/source-cutout-used-as-scene/.test(type)) return "identity";
  if (/product-background-card|product-asset-no-alpha|source-background-normalization|background-card/.test(type)) return "source_asset_normalization";
  if (/geometry|hem-position|garment-length|sleeve-length|neckline|silhouette|crop-top|apparel-length/.test(type)) return "identity_geometry";
  if (/scene|photography|cutout/.test(type)) return "photography_scene";
  if (/micro-detail|logo|trademark|engraving|readable-micro|brand-mark/.test(type)) return "micro_detail";
  if (/source|blur|clutter|color-cast|resolution-source/.test(type)) return "source_quality";
  if (/physical|function|scale-drift|unsupported-physical-action|invented-product-function/.test(type)) return "physical_truth";
  if (/claim|fact|capacity|invented|unsupported/.test(type)) return "product_truth";
  if (/identity|identity-lock|missing-identity-lock/.test(type)) return "identity";
  if (/prompt-readiness|final-prompt|generic-prompt/.test(type)) return "prompt_readiness";
  if (/mandatory-layer|conditional-layer|layer-conflict|thin-layer/.test(type)) return "prompt_layer";
  if (/hotword|buyer-benefit|buyer-facing-copy|copy-strategy|thin-copy|marketing-claim|dynamic-context/.test(type)) return "layout_copy";
  if (/copy|text|layout|readable|watermark|platform-pack/.test(type)) return "layout_copy";
  if (/platform|research-overlay|profile/.test(type)) return "platform_market";
  if (/commercial|buyer-question|architecture|strategy/.test(type)) return "strategy";
  if (/creative|audience-tone|generic-product-look|graphic-design|template-card/.test(type)) return "creative";
  if (/camera|crop|primary-image|detail/.test(type)) return "marketing_diversity";
  if (/draft-exported-as-final/.test(type)) return "export";
  if (/filename|count|square|contact-sheet|banner|delivery|resolution/.test(type)) return "export";
  if (/upstream-gate-not-passed|qa-loop-not-closed/.test(type)) return "delivery";
  if (/runtime|image-reference|generation-execution/.test(type)) return "runtime";
  return "unknown";
}

function returnNode(type) {
  const map = {
    "weak-source-image": "source-image-enhancement",
    "low-resolution-source": "source-image-enhancement",
    "product-background-card-mismatch": "source-asset-normalization",
    "missing-product-asset-background-evidence": "source-asset-normalization",
    "weak-source-background-normalization": "source-asset-normalization",
    "product-asset-no-alpha": "source-asset-normalization",
    "missing-product-truth": "product-fact-sheet",
    "unsupported-claim": "product-fact-sheet",
    "capacity-unsupported": "product-fact-sheet",
    "physical-truth-lock-missing": "product-physical-truth-lock",
    "unsupported-function-claim": "product-physical-truth-lock",
    "unsupported-physical-action": "product-physical-truth-lock",
    "invented-product-function": "product-physical-truth-lock",
    "product-scale-drift": "visual-director",
    "missing-identity-lock": "product-identity-lock",
    "identity-drift": "personalized-prompt-delivery",
    "geometry-ratio-drift": "identity-geometry-lock",
    "geometry-class-drift": "identity-geometry-lock",
    "apparel-length-shortened": "identity-geometry-lock",
    "forbidden-geometry-change": "identity-geometry-lock",
    "prompt-readiness-marker-missing": "prompt-readiness-gate",
    "final-prompt-not-written": "personalized-prompt-delivery",
    "generic-prompt-risk": "prompt-layer-stack",
    "missing-mandatory-layer": "prompt-layer-stack",
    "missing-conditional-layer": "prompt-layer-stack",
    "unresolved-layer-conflict": "prompt-layer-stack",
    "thin-layer": "prompt-layer-stack",
    "thin-conditional-layer": "prompt-layer-stack",
    "platform-fit-missing": "platform-category-web-research",
    "research-overlay-missing": "platform-category-profile-overlay",
    "no-commercial-task": "commerce-strategy-brief",
    "weak-image-architecture": "image-set-architecture",
    "weak-visual-concept": "creative-direction-brief",
    "weak-graphic-design-system": "graphic-design-direction",
    "repeated-template-card-layout": "graphic-design-direction",
    "wrong-audience-tone": "audience-positioning-analysis",
    "generic-photography-style": "commercial-photography-treatment",
    "fake-scene": "scene-asset-production",
    "missing-scene-asset": "scene-asset-production",
    "source-cutout-used-as-scene": "scene-asset-production",
    "scene-is-layout-placeholder": "scene-asset-production",
    "thin-scene-direction": "commercial-photography-treatment",
    "repeated-camera-angle": "visual-director",
    "repeated-crop-or-composition": "visual-director",
    "repeated-primary-image": "visual-director",
    "internal-copy": "localized-copy-pack",
    "missing-buyer-facing-copy": "localized-copy-pack",
    "thin-copy-strategy": "localized-copy-pack",
    "weak-buyer-benefit": "localized-copy-pack",
    "missing-translation-source-text": "localized-copy-pack",
    "missing-translation-review-notes": "localized-copy-pack",
    "missing-back-translation": "localized-copy-pack",
    "low-translation-confidence": "localized-copy-pack",
    "missing-localized-market-basis": "localized-copy-pack",
    "target-script-mismatch": "localized-copy-pack",
    "mixed-script-needs-review": "localized-copy-pack",
    "missing-rtl-layout-direction": "localized-copy-pack",
    "wrong-text-direction": "localized-copy-pack",
    "unsupported-marketing-claim": "product-fact-sheet",
    "unverified-hotword-use": "platform-category-web-research",
    "missing-current-research-basis": "platform-category-web-research",
    "dynamic-context-not-used": "localized-copy-pack",
    "watermark-or-platform-pack-label": "graphic-design-direction",
    "unauthorized-visible-watermark-mark": "graphic-design-direction",
    "unclear-micro-detail": "product-identity-lock",
    "invented-logo-or-trademark": "product-identity-lock",
    "invented-readable-micro-text": "product-identity-lock",
    "unreadable-text": "layout-wireframes",
    "layout-unreadable": "layout-wireframes",
    "wrong-image-count": "export-packaging",
    "single-file-delivery": "export-packaging",
    "bad-filename": "export-packaging",
    "draft-exported-as-final": "export-packaging",
    "not-square": "export-packaging",
    "contact-sheet-or-banner-ratio": "export-packaging",
    "upstream-gate-not-passed": "qa-loop-router",
    "qa-loop-not-closed": "qa-loop-router",
    "blocked-runtime-unavailable": "generation-runtime-execution-boundary",
  };
  return map[type] || fallbackReturnNode(type);
}

function fallbackReturnNode(type) {
  const category = failureCategory(type);
  const map = {
    source_quality: "source-image-enhancement",
    source_asset_normalization: "source-asset-normalization",
    product_truth: "product-fact-sheet",
    physical_truth: "product-physical-truth-lock",
    identity: "product-identity-lock",
    identity_geometry: "identity-geometry-lock",
    prompt_readiness: "prompt-readiness-gate",
    prompt_layer: "prompt-layer-stack",
    platform_market: "platform-category-web-research",
    strategy: "commerce-strategy-brief",
    creative: "creative-direction-brief",
    photography_scene: "scene-asset-production",
    micro_detail: "product-identity-lock",
    marketing_diversity: "visual-director",
    layout_copy: "layout-wireframes",
    export: "export-packaging",
    runtime: "generation-runtime-execution-boundary",
    delivery: "qa-loop-router",
  };
  return map[category] || "qa-compliance";
}

function blockedStatus(primary, findings) {
  if (/runtime/.test(primary.type)) return "blocked_runtime_unavailable";
  if (primary.user_input_required) return "blocked_user_input_required";
  if (/unsupported-claim|capacity-unsupported|missing-product-truth|physical-truth-lock-missing/.test(primary.type)) return "blocked_user_input_required";
  if (findings.some((item) => /retry-budget-exhausted/.test(item.type))) return "blocked_retry_budget_exhausted";
  return null;
}

function statusForNode(node, type) {
  if (/layout|copy|export/.test(node)) return /export/.test(node) ? "return_to_node" : "rerender_layout_only";
  if (/generation-request|scene-asset|identity-geometry/.test(node) || /identity-drift|geometry/.test(type)) return "regenerate_failed_assets_only";
  return "return_to_node";
}

function nextAction(type, node) {
  const actions = {
    "prompt-readiness-marker-missing": "Lock missing strategy/sketch/photography/layout/personalization markers, then rerun prompt readiness gate.",
    "final-prompt-not-written": "Write final personalized prompt requests from approved layer stack.",
    "missing-mandatory-layer": "Complete mandatory prompt layer stack before final request delivery.",
    "missing-conditional-layer": "Add the required conditional prompt layer selected by the Prompt Layer Architect Brain.",
    "thin-conditional-layer": "Fill the required conditional prompt layer with source-backed details before final prompt delivery.",
    "source-cutout-used-as-scene": "Create or execute a true scene asset request; do not use source cutout as final scene.",
    "product-background-card-mismatch": "Create or use a transparent/card-safe product asset, then rerender only the affected card/infographic image.",
    "missing-product-asset-background-evidence": "Record the transparent/card-safe product asset or normalization report before card/infographic layout.",
    "weak-source-background-normalization": "Inspect or improve source cutout normalization before final layout.",
    "product-asset-no-alpha": "Prefer a transparent product cutout; keep the no-alpha asset only when its edge background matches the card.",
    "missing-scene-asset": "Create panel-specific generated/photo scene asset, then rerun scene and marketing gates.",
    "scene-is-layout-placeholder": "Replace layout placeholder with true generated/photo scene asset.",
    "internal-copy": "Rewrite final image text into buyer-facing language.",
    "watermark-or-platform-pack-label": "Remove platform-pack/watermark/system marks, then revise graphic design direction and rerender affected layout only.",
    "unauthorized-visible-watermark-mark": "Remove unauthorized visible mark fields or record exact user authorization before design; rerender affected layout only.",
    "repeated-template-card-layout": "Revise graphic design direction with role-specific layouts and safe zones before rerendering affected panels.",
    "weak-graphic-design-system": "Create a stronger graphic design direction with hierarchy, safe zones, text density, and set-level variation.",
    "generic-photography-style": "Rewrite photography treatment with archetype, lens, light, color temperature, scene/body relationship, and product placement notes.",
    "unclear-micro-detail": "Update Product Identity Lock with micro-detail status and ask for closeup only if the detail must be readable.",
    "invented-logo-or-trademark": "Remove invented brand/logo direction and lock unclear marks as unreadable shape-only details.",
    "invented-readable-micro-text": "Remove invented readable micro text and preserve only source-backed exact text or unreadable marks.",
    "geometry-ratio-drift": "Tighten product geometry lock and regenerate only affected assets with source-reference proportions.",
    "geometry-class-drift": "Restore source geometry class such as garment length, hem position, sleeve length, neckline, or silhouette.",
    "apparel-length-shortened": "Regenerate the affected apparel image; preserve original garment length and hem position, avoiding crop-top drift.",
    "forbidden-geometry-change": "Remove the forbidden geometry change from the prompt and regenerate only the affected asset.",
    "physical-truth-lock-missing": "Create a source-backed product physical truth lock before showing function, installation, or scale-sensitive images.",
    "unsupported-function-claim": "Remove unsupported product function claims or add source evidence before prompt/layout work.",
    "unsupported-physical-action": "Remove unsupported physical actions such as press/lock/adhesive/magnet/waterproof/load-bearing unless source evidence confirms them.",
    "invented-product-function": "Return to product physical truth lock and delete invented use steps or product capabilities from affected panels.",
    "product-scale-drift": "Normalize product visual scale across affected images or record an explicit composition reason before rerendering layout.",
    "thin-copy-strategy": "Rewrite copy strategy with buyer question, conversion intent, objection, and research basis.",
    "missing-translation-source-text": "Attach the exact source text that the localized buyer-facing copy was derived from.",
    "missing-translation-review-notes": "Add explicit localization review notes covering meaning, tone, and market-fit before generation.",
    "missing-back-translation": "Add a back-translation or semantic paraphrase check for the localized visible copy.",
    "low-translation-confidence": "Revise the localized copy until translation review confidence reaches the required threshold.",
    "missing-localized-market-basis": "Attach locale-specific keyword or market-language basis, or simplify the localized claim.",
    "target-script-mismatch": "Fix the visible copy script for the target locale, or document locked brand/model exceptions.",
    "mixed-script-needs-review": "Explain and lock the mixed-script terms before continuing with generation.",
    "missing-rtl-layout-direction": "Mark the localized copy and layout as rtl before final prompt/layout work.",
    "wrong-text-direction": "Correct the copy direction metadata so it matches the target locale before generation.",
    "unverified-hotword-use": "Run current platform/category research or remove unverified hot/search terms.",
    "missing-current-research-basis": "Run platform context and category research before final copy.",
    "dynamic-context-not-used": "Either use the required season/climate/holiday/region context in buyer-facing copy or record why it is irrelevant.",
    "bad-filename": "Rename exports with stable ID plus English purpose slug.",
    "wrong-image-count": "Export the required independent image count.",
    "draft-exported-as-final": "Remove draft assets from final-images; generate or package only final approved assets.",
    "upstream-gate-not-passed": "Resolve upstream failed gates before final delivery.",
    "qa-loop-not-closed": "Return to the QA loop decision and close its return node before final delivery.",
  };
  return actions[type] || `Return to ${node} and fix the smallest upstream artifact responsible for ${type}.`;
}

function rerunFrom(node) {
  const map = {
    "source-image-enhancement": ["source-image-enhancement-if-needed", "product-image-parser", "product-identity-lock", "prompt-layer-gate"],
    "product-fact-sheet": ["product-fact-sheet", "commerce-strategy-brief", "prompt-layer-gate"],
    "product-physical-truth-lock": ["product-physical-truth-lock", "product-feature-analysis", "prompt-layer-gate", "product-physics-fact-gate"],
    "product-identity-lock": ["product-identity-lock", "prompt-layer-gate", "identity-consistency-gate"],
    "identity-geometry-lock": ["identity-geometry-lock", "prompt-layer-gate", "personalized-prompt-delivery", "identity-geometry-gate"],
    "platform-category-web-research": ["platform-category-web-research", "platform-category-profile-overlay", "commerce-strategy-brief"],
    "commerce-strategy-brief": ["commerce-strategy-brief", "image-set-architecture", "prompt-layer-gate"],
    "creative-direction-brief": ["creative-direction-brief", "commercial-photography-treatment", "prompt-layer-gate"],
    "commercial-photography-treatment": ["commercial-photography-treatment", "scene-asset-production-if-scene-roles", "prompt-layer-gate"],
    "graphic-design-direction": ["graphic-design-direction", "layout-wireframes", "visual-director", "marketing-quality-gate"],
    "prompt-layer-stack": ["prompt-layer-stack", "prompt-layer-gate", "personalized-prompt-delivery"],
    "personalized-prompt-delivery": ["personalized-prompt-delivery", "prompt-readiness-gate"],
    "scene-asset-production": ["scene-asset-production-if-scene-roles", "prompt-layer-gate", "personalized-prompt-delivery", "identity-consistency-gate", "marketing-quality-gate"],
    "generation-request-pack": ["generation-request-pack-if-fallback-or-audit-needed", "generation-runtime-execution-boundary", "identity-consistency-gate"],
    "layout-wireframes": ["layout-wireframes", "layout-composition", "marketing-quality-gate"],
    "source-asset-normalization": ["source-asset-normalization", "layout-composition", "product-background-card-consistency-gate", "marketing-quality-gate"],
    "localized-copy-pack": ["localized-copy-pack", "copy-strategy-gate", "localized-copy-qa-gate", "layout-composition", "marketing-quality-gate"],
    "visual-director": ["visual-director", "image-set-blueprint", "prompt-layer-gate"],
    "export-packaging": ["export-packaging", "image-set-export-gate"],
  };
  return map[node] || [node];
}

function doNotRerun(node, type) {
  if (node === "source-asset-normalization" || /product-background-card|product-asset-no-alpha|source-background-normalization/.test(type)) {
    return ["product-fact-sheet", "platform-category-web-research", "commerce-design-research", "full-image-set-generation"];
  }
  if (/copy|layout|export/.test(node) || /internal-copy|bad-filename|wrong-image-count/.test(type)) {
    return ["source-image-enhancement", "product-fact-sheet", "platform-category-web-research", "scene-asset-generation-loop"];
  }
  if (/scene-asset|generation-request|personalized-prompt-delivery/.test(node)) {
    return ["product-fact-sheet", "platform-category-web-research", "approved-assets", "full-image-set-generation"];
  }
  return ["approved-assets", "unaffected-images"];
}

function retryBudget(node) {
  const map = {
    "source-image-enhancement": 1,
    "product-fact-sheet": 2,
    "product-physical-truth-lock": 2,
    "product-identity-lock": 2,
    "identity-geometry-lock": 2,
    "platform-category-web-research": 1,
    "platform-category-profile-overlay": 1,
    "commerce-strategy-brief": 2,
    "image-set-architecture": 2,
    "creative-direction-brief": 2,
    "audience-positioning-analysis": 2,
    "commercial-photography-treatment": 2,
    "graphic-design-direction": 2,
    "prompt-readiness-gate": 2,
    "prompt-layer-stack": 3,
    "personalized-prompt-delivery": 3,
    "scene-asset-production": 2,
    "generation-request-pack": 2,
    "layout-wireframes": 3,
    "localized-copy-pack": 2,
    "visual-director": 2,
    "export-packaging": 2,
    "generation-runtime-execution-boundary": 0,
  };
  return map[node] ?? 1;
}

function unique(items) {
  return [...new Set(items)];
}

function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]\n";
    return value.map((item) => {
      if (item && typeof item === "object") {
        return `${pad}- ${toYaml(item, indent + 2).trimStart()}`;
      }
      return `${pad}- ${formatScalar(item)}\n`;
    }).join("");
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === "object") {
        const rendered = toYaml(item, indent + 2);
        if (rendered.trim() === "[]") return `${pad}${key}: []\n`;
        return `${pad}${key}:\n${rendered}`;
      }
      return `${pad}${key}: ${formatScalar(item)}\n`;
    }).join("");
  }
  return `${pad}${formatScalar(value)}\n`;
}

function formatScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (!text || /[:#\n\[\]{}]/.test(text)) return JSON.stringify(text);
  return text;
}

function toMarkdown(decision) {
  const d = decision.loop_decision;
  const lines = [
    "# QA Loop Routing Decision",
    "",
    `- Status: ${d.status}`,
    `- Primary failure type: ${d.primary_failure_type || "none"}`,
    `- Return node: ${d.return_node || "none"}`,
    `- Failed gate: ${d.failed_gate || "none"}`,
    `- Failed images: ${d.failed_images.length ? d.failed_images.join(", ") : "none"}`,
    `- Smallest next action: ${d.smallest_next_action}`,
    `- Retry budget: ${d.retry_budget ?? "n/a"}`,
    `- Retry attempts used: ${d.retry_attempts_used ?? "n/a"}`,
    `- Retry attempts remaining: ${d.retry_attempts_remaining ?? "n/a"}`,
    `- User input required: ${d.user_input_required}`,
  ];
  if (decision.loop_guard) {
    lines.push(
      "",
      "## Loop Guard",
      "",
      `- Status: ${decision.loop_guard.status}`,
      `- Signature: ${decision.loop_guard.signature || "n/a"}`,
      `- Attempts: ${decision.loop_guard.attempt_count ?? "n/a"} / ${decision.loop_guard.max_attempts ?? "n/a"}`,
      `- Evidence changed: ${decision.loop_guard.evidence_changed ?? "n/a"}`,
      `- State path: ${decision.loop_guard.state_path || "n/a"}`,
    );
  }
  lines.push(
    "",
    "## Rerun From",
    "",
    ...(d.rerun_from.length ? d.rerun_from.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Do Not Rerun",
    "",
    ...(d.do_not_rerun.length ? d.do_not_rerun.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Findings",
    "",
  );
  if (!decision.findings.length) lines.push("- None");
  for (const item of decision.findings) {
    lines.push(`- [${item.severity}] ${item.gate_id}/${item.type}: ${item.message || ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
