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

function usage() {
  console.error(`Usage:
node scripts/prompt-layer-gate.mjs --stack /abs/prompt-layer-stack.json --out-dir /abs/run/qa

The stack may be JSON, or simple YAML that is also valid JSON-compatible after
conversion by the producing runtime. This gate checks mandatory layers,
conditional layer requirements, conflicts, and generic prompt risk.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.stack || !args["out-dir"]) usage();

const stackPath = path.resolve(args.stack);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const stack = readStructured(stackPath);
const root = stack.prompt_layer_stack || stack;
const architect = root.prompt_layer_architect || {};
const layers = root.layers || {};
const findings = [];

const mandatory = architect.mandatory_layers || [
  "execution_contract_layer",
  "product_identity_layer",
  "fact_boundary_layer",
  "commerce_goal_layer",
  "context_layer",
  "creative_concept_layer",
  "photography_treatment_layer",
  "layout_copy_layer",
  "negative_qa_layer",
];

for (const layerName of mandatory) {
  if (!layers[layerName]) {
    findings.push({
      severity: "fail",
      type: "missing-mandatory-layer",
      layer: layerName,
      return_node: "personalized-prompt-delivery",
      message: `${layerName} is required before final generation prompt delivery.`,
    });
    continue;
  }
  if (isThin(layers[layerName])) {
    findings.push({
      severity: "warn",
      type: "thin-layer",
      layer: layerName,
      return_node: returnNodeForLayer(layerName),
      message: `${layerName} exists but appears thin or mostly empty.`,
    });
  }
}

const basisText = JSON.stringify(architect.decision_basis || root, null, 2).toLowerCase();
const conditionalRequired = [];
if (/scene|lifestyle|wear|outfit|commute|cafe|street|date|场景|上身|穿搭|通勤|咖啡|逛街|约会/.test(basisText)) {
  conditionalRequired.push("scene_asset_layer");
}
if (/detail|macro|hardware|texture|material|close|细节|特写|五金|纹理|材质/.test(basisText)) {
  conditionalRequired.push("detail_evidence_layer");
}
if (/capacity|storage|interior|容量|收纳|内里/.test(basisText)) {
  conditionalRequired.push("capacity_truth_layer");
}
if (/install|installation|mount|mounted|screw|route|cable|wire|clip|clamp|hold|press|lock|adhesive|magnetic|load-bearing|waterproof|drill|安装|螺丝|固定|走线|线缆|夹|卡扣|按压|承重|防水|免打孔/.test(basisText)) {
  conditionalRequired.push("physical_function_layer");
}
if (/competitor|bestseller|爆品|竞品/.test(basisText)) {
  conditionalRequired.push("comparison_layer");
}
if (/season|holiday|gift|christmas|valentine|spring|summer|winter|autumn|节日|季节|礼赠|春节|情人节|开学/.test(basisText)) {
  conditionalRequired.push("season_event_layer");
}
if (/medical|safety|certification|waterproof|fireproof|children|pet|认证|安全|防水|防火|儿童|宠物|医疗/.test(basisText)) {
  conditionalRequired.push("compliance_layer");
}

const conditionalPayloads = root.conditional_layer_payloads || {};
for (const layerName of [...new Set(conditionalRequired)]) {
  const payload = conditionalPayloads[layerName] || layers[layerName];
  if (!payload) {
    findings.push({
      severity: "fail",
      type: "missing-conditional-layer",
      layer: layerName,
      return_node: returnNodeForLayer(layerName),
      message: `${layerName} is required by the layer architect decision basis but is missing.`,
    });
  } else if (isThin(payload)) {
    findings.push({
      severity: layerName === "physical_function_layer" ? "fail" : "warn",
      type: "thin-conditional-layer",
      layer: layerName,
      return_node: returnNodeForLayer(layerName),
      message: `${layerName} is required but does not contain enough source-backed detail.`,
    });
  }
}

const conflictNotes = architect.conflict_notes || root.layer_review?.conflict_notes || [];
if (Array.isArray(conflictNotes) && conflictNotes.some((note) => /unresolved|conflict|矛盾|冲突/i.test(String(note)))) {
  findings.push({
    severity: "fail",
    type: "unresolved-layer-conflict",
    return_node: "prompt-layer-stack",
    message: "Layer stack contains unresolved conflict notes.",
  });
}

const genericRisk = String(root.layer_review?.generic_prompt_risk || "").toLowerCase();
if (!genericRisk || /high|yes|true|generic|通用|泛化/.test(genericRisk)) {
  findings.push({
    severity: genericRisk ? "fail" : "warn",
    type: "generic-prompt-risk",
    return_node: "personalized-prompt-delivery",
    message: "Prompt layer stack does not prove that the final request is product/platform/audience-specific.",
  });
}

const status = findings.some((item) => item.severity === "fail")
  ? "blocked"
  : findings.some((item) => item.severity === "warn")
    ? "ready_with_warnings"
    : "ready";

const report = {
  status,
  checked_at: new Date().toISOString(),
  stack_path: stackPath,
  findings,
  layer_architect_summary: {
    mandatory_layers: mandatory,
    conditional_layers_required: [...new Set(conditionalRequired)],
    layer_order: architect.layer_order || [],
    locked_layers: architect.locked_layers || [],
  },
};

fs.writeFileSync(path.join(outDir, "prompt-layer-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "prompt-layer-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "blocked") process.exitCode = 1;

function readStructured(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    return parseSimpleYaml(text);
  }
}

function parseSimpleYaml(text) {
  // Minimal parser for scaffold/selftest YAML. Prefer JSON for complex stacks.
  const root = {};
  const stack = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    const pair = line.match(/^([^:]+):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].trim();
    const rawValue = pair[2].trim();
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].value : root;
    const value = rawValue ? parseScalar(rawValue) : {};
    parent[key] = value;
    if (!rawValue) stack.push({ indent, value });
  }
  return root;
}

function parseScalar(value) {
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\[.*\]$/.test(value)) {
    return value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}

function isThin(value) {
  const flattened = flatten(value).filter((item) => {
    if (item === null || item === undefined) return false;
    if (Array.isArray(item) && !item.length) return false;
    if (typeof item === "object" && !Object.keys(item).length) return false;
    return String(item).trim() !== "";
  });
  return flattened.length < 2;
}

function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [value];
}

function returnNodeForLayer(layerName) {
  const map = {
    execution_contract_layer: "personalized-prompt-delivery",
    product_identity_layer: "product-identity-lock",
    fact_boundary_layer: "product-fact-sheet",
    commerce_goal_layer: "commerce-strategy-brief",
    context_layer: "platform-category-profile-overlay",
    creative_concept_layer: "creative-direction-brief",
    photography_treatment_layer: "commercial-photography-treatment",
    layout_copy_layer: "layout-wireframes",
    negative_qa_layer: "prompt-layer-stack",
    scene_asset_layer: "scene-asset-production",
    detail_evidence_layer: "product-feature-analysis",
    capacity_truth_layer: "product-fact-sheet",
    physical_function_layer: "product-physical-truth-lock",
    comparison_layer: "bestseller-design-mining",
    season_event_layer: "commerce-strategy-brief",
    compliance_layer: "risk-boundaries",
    localization_layer: "localized-copy-pack",
    brand_vi_layer: "creative-direction-brief",
  };
  return map[layerName] || "prompt-layer-stack";
}

function toMarkdown(report) {
  const lines = [
    "# Prompt Layer Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Stack path: ${report.stack_path}`,
    "",
    "## Layer Architect Summary",
    "",
    `- Mandatory layers: ${report.layer_architect_summary.mandatory_layers.join(", ")}`,
    `- Conditional layers required: ${report.layer_architect_summary.conditional_layers_required.join(", ") || "none"}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const item of report.findings) {
    const layer = item.layer ? ` (${item.layer})` : "";
    lines.push(`- [${item.severity}] ${item.type}${layer}: ${item.message} Return node: ${item.return_node}.`);
  }
  lines.push("");
  return lines.join("\n");
}
