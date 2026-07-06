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
node scripts/final-delivery-gate.mjs --run-dir /abs/run [--out-dir /abs/run/qa] [--allow-missing-gates]

Aggregates QA gate reports and blocks final delivery when any upstream gate
failed, scene generation is blocked, or draft assets are present in final-images.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const finalImageDir = path.join(runDir, "final-images");
fs.mkdirSync(qaDir, { recursive: true });

const reports = loadGateReports(qaDir);
const findings = [];
const allowMissingGates = Boolean(args["allow-missing-gates"]);

if (!allowMissingGates) {
  if (!reports.length) {
    findings.push({
      severity: "fail",
      type: "missing-gate-reports",
      gate_id: "final-delivery-gate",
      message: "No qa/*-report.json files were found. Final delivery requires upstream gate evidence.",
    });
  }
  for (const requiredName of ["marketing-quality-gate-report.json", "copy-strategy-gate-report.json", "image-set-export-gate-report.json"]) {
    if (!reports.some((item) => item.name === requiredName)) {
      findings.push({
        severity: "fail",
        type: "missing-required-gate-report",
        gate_id: "final-delivery-gate",
        source_report: requiredName,
        message: `${requiredName} is required before final ecommerce image delivery can pass.`,
      });
    }
  }
}

const sourceGeometryPath = path.join(runDir, "geometry", "source-geometry.json");
if (fs.existsSync(sourceGeometryPath) && requiresGeometryGate(sourceGeometryPath)) {
  if (!reports.some((item) => item.name === "identity-geometry-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "identity-geometry-gate-report.json",
      message: "identity-geometry-gate-report.json is required for apparel or proportion-sensitive products before final delivery can pass.",
    });
  }
}

const physicalTruthPath = path.join(runDir, "blueprint", "02b-product-physical-truth.json");
if (fs.existsSync(physicalTruthPath) && requiresPhysicalTruthGate(physicalTruthPath)) {
  if (!reports.some((item) => item.name === "product-physics-fact-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "product-physics-fact-gate-report.json",
      message: "product-physics-fact-gate-report.json is required when physical function/use/scale truth is locked before final delivery can pass.",
    });
  }
}

for (const item of reports) {
  const status = normalizeStatus(item.report.status);
  if (["fail", "blocked", "needs_visual_review"].includes(status)) {
    findings.push({
      severity: status === "needs_visual_review" ? "warn" : "fail",
      type: "upstream-gate-not-passed",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported status ${item.report.status}. Final delivery cannot be marked passed while upstream gates are unresolved.`,
    });
  } else if (status === "warn") {
    findings.push({
      severity: "warn",
      type: "upstream-gate-warning",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported warnings. Review before publishing.`,
    });
  }

  for (const raw of Array.isArray(item.report.findings) ? item.report.findings : []) {
    const severity = normalizeSeverity(raw.severity);
    if (["fail", "critical"].includes(severity)) {
      findings.push({
        severity: "fail",
        type: normalizeType(raw.type || "upstream-finding"),
        gate_id: item.gate_id,
        source_report: item.name,
        image_index: raw.image_index || raw.index || null,
        file: raw.file || null,
        message: raw.message || `${item.gate_id} has unresolved fail finding.`,
      });
    }
  }
}

const requestPackPath = [
  path.join(runDir, "prompt-pack", "10-generation-request-pack.yaml"),
].find((file) => fs.existsSync(file));
if (requestPackPath) {
  const requestPack = fs.readFileSync(requestPackPath, "utf8");
  if (/generation_status:\s*blocked_runtime_unavailable/i.test(requestPack)) {
    findings.push({
      severity: "fail",
      type: "blocked-runtime-unavailable",
      gate_id: "final-delivery-gate",
      source_report: path.relative(runDir, requestPackPath),
      message: "Request pack is blocked because the runtime cannot execute GPT built-in image generation with source image references.",
    });
  }
}

if (fs.existsSync(finalImageDir)) {
  for (const name of fs.readdirSync(finalImageDir).filter((item) => /\.(png|jpe?g|webp)$/i.test(item))) {
    if (/\b(?:layout-)?draft\b|placeholder|wireframe|blocked/i.test(name)) {
      findings.push({
        severity: "fail",
        type: "draft-exported-as-final",
        gate_id: "final-delivery-gate",
        file: path.join(finalImageDir, name),
        message: `Draft, placeholder, wireframe, or blocked asset is present in final-images: ${name}.`,
      });
    }
  }
}

const qaLoopPath = path.join(qaDir, "qa-loop-routing-decision.json");
if (fs.existsSync(qaLoopPath)) {
  try {
    const routing = JSON.parse(fs.readFileSync(qaLoopPath, "utf8"));
    const decision = routing.loop_decision || {};
    if (decision.status && decision.status !== "continue") {
      findings.push({
        severity: "fail",
        type: "qa-loop-not-closed",
        gate_id: "qa-loop-router",
        source_report: "qa-loop-routing-decision.json",
        message: `QA loop decision is ${decision.status}; return node ${decision.return_node || "unknown"} must be resolved before final delivery.`,
      });
    }
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-qa-loop-routing-decision",
      gate_id: "final-delivery-gate",
      source_report: "qa-loop-routing-decision.json",
      message: error.message,
    });
  }
}

const status = findings.some((item) => item.severity === "fail" || item.severity === "critical")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  reports_seen: reports.map((item) => item.name),
  findings,
};

fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir: qaDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function loadGateReports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /-report\.json$/.test(name))
    .filter((name) => name !== "final-delivery-gate-report.json")
    .map((name) => {
      const file = path.join(dir, name);
      try {
        const report = JSON.parse(fs.readFileSync(file, "utf8"));
        return { file, name, gate_id: gateIdFromName(name), report };
      } catch (error) {
        return {
          file,
          name,
          gate_id: gateIdFromName(name),
          report: {
            status: "fail",
            findings: [{
              severity: "fail",
              type: "unreadable-gate-report",
              message: error.message,
            }],
          },
        };
      }
    });
}

function requiresGeometryGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const text = JSON.stringify(parsed).toLowerCase();
    if (/"status"\s*:\s*"pending_annotation"/.test(JSON.stringify(parsed))) return false;
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  }
}

function requiresPhysicalTruthGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const root = parsed.product_physical_truth || parsed;
    if (/pending|unknown|not_run/i.test(String(root.status || ""))) return false;
    const text = JSON.stringify(root).toLowerCase();
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  }
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "ready", "ok", "continue"].includes(value)) return "pass";
  if (["pass_with_warnings", "ready_with_warnings", "warn"].includes(value)) return "warn";
  if (["fail", "failed"].includes(value)) return "fail";
  if (["blocked"].includes(value)) return "blocked";
  if (["needs_visual_review"].includes(value)) return "needs_visual_review";
  return value || "unknown";
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

function toMarkdown(report) {
  const lines = [
    "# Final Delivery Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Run dir: ${report.run_dir}`,
    "",
    "## Reports Seen",
    "",
    ...(report.reports_seen.length ? report.reports_seen.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const image = finding.image_index ? ` image ${finding.image_index}` : "";
    const file = finding.file ? ` (${path.basename(finding.file)})` : "";
    lines.push(`- [${finding.severity}] ${finding.gate_id}/${finding.type}${image}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
