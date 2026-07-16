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
node scripts/production-artifact-integrity-gate.mjs --run-dir /abs/run [--out-dir /abs/run/qa]

Checks run-local machine artifacts such as generation progress, anchor QA
decisions, final manifests, overview reports, and QA reports for JSON parse
errors, patch-marker contamination, and stale progress after final export.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const finalImagesDir = path.join(runDir, "final-images");
const findings = [];
fs.mkdirSync(qaDir, { recursive: true });

const jsonFiles = collectJsonArtifacts(runDir);
const parsedByRel = new Map();
for (const file of jsonFiles) {
  const rel = path.relative(runDir, file);
  const raw = readText(file);
  if (hasPatchContamination(raw)) {
    findings.push({
      severity: "fail",
      type: artifactType(rel, "patch-marker-contamination"),
      file: rel,
      return_node: "artifact-integrity-repair",
      message: `${rel} contains patch/conflict/markdown marker text. Regenerate this machine artifact from the owning script; do not patch it by hand.`,
    });
    continue;
  }
  try {
    parsedByRel.set(rel, JSON.parse(raw));
  } catch (error) {
    findings.push({
      severity: "fail",
      type: artifactType(rel, "corrupt-json-artifact"),
      file: rel,
      return_node: "artifact-integrity-repair",
      message: `${rel} is not valid JSON: ${error.message}`,
    });
  }
}

validateProgressVsFinals();

const status = findings.some((item) => item.severity === "fail" || item.severity === "critical")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.production_artifact_integrity_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  checked_artifacts: jsonFiles.map((file) => path.relative(runDir, file)),
  findings,
};

fs.writeFileSync(path.join(qaDir, "production-artifact-integrity-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(qaDir, "production-artifact-integrity-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir: qaDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function collectJsonArtifacts(root) {
  const candidates = [
    "generated-assets/generation-progress.json",
    "generated-assets/anchor-batch-qa-decision.json",
    "qa/anchor-batch-qa-decision.json",
    "qa/anchor-batch-qa-report.json",
    "export/final-images-manifest.json",
    "overview/delivery-overview-report.json",
    "qa/qa-loop-routing-decision.json",
    "qa/qa-loop-state.json",
  ];
  const found = candidates.map((rel) => path.join(root, rel)).filter((file) => fs.existsSync(file));
  const qaRoot = path.join(root, "qa");
  if (fs.existsSync(qaRoot)) {
    for (const entry of fs.readdirSync(qaRoot, { withFileTypes: true })) {
      if (entry.isFile() && /-report\.json$/.test(entry.name)) {
        found.push(path.join(qaRoot, entry.name));
      }
    }
  }
  return unique(found).sort();
}

function validateProgressVsFinals() {
  const progress = parsedByRel.get("generated-assets/generation-progress.json");
  if (!progress) return;
  const finalCount = fs.existsSync(finalImagesDir)
    ? fs.readdirSync(finalImagesDir).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).length
    : 0;
  if (!finalCount) return;
  const statusText = normalize(progress.status);
  const completed = Array.isArray(progress.completed_images) ? progress.completed_images.length : 0;
  const externalImport = Boolean(progress.external_final_import || progress.anchor_batch_required === false);
  if (["planned", "not_started", "pending", "initialized"].includes(statusText) && !completed && !externalImport) {
    findings.push({
      severity: "fail",
      type: "stale-generation-progress-artifact",
      file: "generated-assets/generation-progress.json",
      return_node: "artifact-integrity-repair",
      message: `Final images exist (${finalCount}), but generation-progress is ${progress.status || "unknown"} with no completed_images. Reconcile progress from current-run evidence; do not regenerate images to hide stale state.`,
    });
  }
}

function artifactType(rel, fallback) {
  if (/anchor-batch-qa-decision\.json$/.test(rel)) return "corrupt-anchor-batch-decision-json";
  if (/generation-progress\.json$/.test(rel)) return "corrupt-generation-progress-json";
  if (/final-images-manifest\.json$/.test(rel)) return "corrupt-final-images-manifest-json";
  return fallback;
}

function hasPatchContamination(text) {
  return /<<<<<<<|>>>>>>>|\*\*\* Begin Patch|\*\*\* End Patch|^@@\s/m.test(text || "");
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-artifact",
      file: path.relative(runDir, file),
      return_node: "artifact-integrity-repair",
      message: error.message,
    });
    return "";
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(items) {
  return [...new Set(items)];
}

function toMarkdown(report) {
  const lines = [
    "# Production Artifact Integrity Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Checked artifacts: ${report.checked_artifacts.length}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const file = finding.file ? ` (${finding.file})` : "";
    lines.push(`- [${finding.severity}] ${finding.type}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
