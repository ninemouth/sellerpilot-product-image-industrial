#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const contractPath = args.contract ? path.resolve(args.contract) : path.join(runDir, "copy", "personalized-text-compositor-contract.json");
const visibleReviewPath = args["final-visible-text-review"] ? path.resolve(args["final-visible-text-review"]) : path.join(runDir, "qa", "final-visible-text-review.json");
const contract = fs.existsSync(contractPath)
  ? readJson(contractPath)
  : buildContractFromArgs();
const findings = [];
const items = Array.isArray(contract.personalized_text_items) ? contract.personalized_text_items : [];

if (!items.length) {
  findings.push({
    severity: "fail",
    type: "missing-personalized-text-items",
    message: "Personalized text production needs exact personalized_text_items such as name/date before final export.",
  });
}

if (normalize(contract.render_method) !== "local_overlay") {
  findings.push({
    severity: "fail",
    type: "provider-text-rendering-not-allowed-by-default",
    message: "Personalized Etsy-style exact names/dates must default to local_overlay; provider text rendering is allowed only with explicit user acceptance of inaccuracy risk.",
  });
}

for (const item of items) {
  if (!String(item.exact_text || "").trim()) {
    findings.push({
      severity: "fail",
      type: "missing-exact-personalized-text",
      message: "Every personalized text item must carry exact_text.",
    });
  }
}

if (!contract.font_family && !contract.font_path) {
  findings.push({
    severity: "warn",
    type: "missing-font-evidence",
    message: "Record font_family or font_path so exact text can be reproduced during revision.",
  });
}

const finalVisibleReview = fs.existsSync(visibleReviewPath) ? readJson(visibleReviewPath) : null;
const visibleStatus = normalize(finalVisibleReview?.status || contract.final_visible_text_review?.status);
if (!["pass", "not_required"].includes(visibleStatus)) {
  findings.push({
    severity: "fail",
    type: "missing-final-visible-text-review",
    message: "Personalized text overlays require final raster visible-text review status pass/not_required.",
  });
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.personalized_text_compositor_contract.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  contract_path: fs.existsSync(contractPath) ? contractPath : null,
  render_method: contract.render_method || null,
  font_family: contract.font_family || null,
  font_path: contract.font_path || null,
  personalized_text_items: items,
  final_visible_text_review: finalVisibleReview || contract.final_visible_text_review || null,
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "personalized-text-compositor-contract-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "personalized-text-compositor-contract-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function buildContractFromArgs() {
  const items = [];
  if (args.name) items.push({ role: "name", exact_text: String(args.name) });
  if (args.date) items.push({ role: "date", exact_text: String(args.date) });
  return {
    render_method: args["render-method"] || "local_overlay",
    font_family: args["font-family"] || "",
    font_path: args["font-path"] || "",
    personalized_text_items: items,
    final_visible_text_review: {
      status: args["visible-text-status"] || "missing",
    },
  };
}

function toMarkdown(report) {
  const lines = [
    "# Personalized Text Compositor Contract",
    "",
    `- Status: ${report.status}`,
    `- Render method: ${report.render_method || ""}`,
    `- Text items: ${report.personalized_text_items.length}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.type}: ${finding.message}`);
  lines.push("");
  return lines.join("\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function usage() {
  console.error("Usage: node scripts/personalized-text-compositor-contract.mjs --run-dir /abs/run [--contract /abs/run/copy/personalized-text-compositor-contract.json] [--name Olivia] [--date 06.16.2026] [--visible-text-status pass]");
  process.exit(2);
}
