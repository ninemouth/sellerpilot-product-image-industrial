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
node scripts/strategy-direction-handoff-gate.mjs --run-dir /abs/run
node scripts/strategy-direction-handoff-gate.mjs --options /abs/run/strategy/direction-options.json --out-dir /abs/run/strategy

Creates the first user-visible direction choice message. Use it after
strategy-direction-gate and before formal production for rough/open requests.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"] && !args.options) usage();

const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
const optionsPath = args.options
  ? path.resolve(args.options)
  : path.join(runDir, "strategy", "direction-options.json");
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.dirname(optionsPath);
if (!fs.existsSync(optionsPath)) {
  throw new Error(`Direction options not found: ${optionsPath}. Run strategy-direction-gate.mjs first.`);
}

const report = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
const options = Array.isArray(report.options) ? report.options.slice(0, 3) : [];
const findings = [];
if (options.length < 2) {
  findings.push({
    severity: "fail",
    type: "too-few-direction-options",
    message: "Rough/open requests require at least two production direction options before formal production.",
  });
}
if (!report.selected_option_id) {
  findings.push({
    severity: "fail",
    type: "missing-harness-selected-direction",
    message: "The handoff must include the harness-selected fallback direction.",
  });
}

const userMessage = buildUserMessage(report, options);
if (!/我会先给你/.test(userMessage) || !/如果你不选/.test(userMessage)) {
  findings.push({
    severity: "fail",
    type: "handoff-message-not-user-visible",
    message: "Direction handoff message must be suitable as the first visible user-facing response.",
  });
}

const status = findings.some((item) => item.severity === "fail") ? "blocked" : "ready";
const output = {
  schema_version: "sellerpilot.strategy_direction_handoff.v1",
  status,
  created_at: new Date().toISOString(),
  source_options: optionsPath,
  selected_option_id: report.selected_option_id || "",
  selected_reason: report.selected_reason || "",
  must_surface_before_formal_production: true,
  first_user_visible_message: userMessage,
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "direction-user-handoff.json"), JSON.stringify(output, null, 2));
fs.writeFileSync(path.join(outDir, "direction-user-handoff.md"), toMarkdown(output));
console.log(JSON.stringify({ status, selected_option_id: output.selected_option_id, outDir }, null, 2));
if (status === "blocked") process.exitCode = 1;

function buildUserMessage(report, options) {
  const selected = report.selected_option_id || options[0]?.id || "";
  const lines = [
    "我会先给你 2-3 个商品图方向，避免直接开做后跑偏：",
    "",
  ];
  for (const option of options) {
    lines.push(`- \`${option.id}\`：${option.label || option.id}。${option.buyer_strategy || ""} 视觉上：${option.visual_direction || ""}`);
  }
  lines.push("");
  lines.push(`如果你不选，我会按 harness 自动选择的 \`${selected}\` 继续，原因：${report.selected_reason || "best available route"}。`);
  lines.push("正式生成前我会把这个选择写入 `strategy/direction-selection.yaml`。");
  return lines.join("\n");
}

function toMarkdown(output) {
  return [
    "# Direction User Handoff",
    "",
    `- Status: ${output.status}`,
    `- Selected: ${output.selected_option_id}`,
    `- Must surface before formal production: ${output.must_surface_before_formal_production}`,
    "",
    "## First User Visible Message",
    "",
    output.first_user_visible_message,
    "",
    "## Findings",
    "",
    ...(output.findings.length ? output.findings.map((item) => `- [${item.severity}] ${item.type}: ${item.message}`) : ["- None"]),
    "",
  ].join("\n");
}
