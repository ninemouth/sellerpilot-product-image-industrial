#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv);
if (args.help || !args.input || !args.output || !args["run-dir"] || !args.role) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runDir = path.resolve(args["run-dir"]);
const input = path.resolve(args.input);
const output = path.resolve(args.output);
const qaDir = path.join(runDir, "qa");
const runtimeRoot = path.resolve(args["runtime-root"] || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sellerpilot-product-image-industrial", "natural-image-runtime"));
const role = normalize(args.role);
const approvedSource = boolArg(args["approved-source"]);
const visibleText = normalize(args["contains-visible-text"]);
const eligibleRole = /(scene|lifestyle|editorial|photo|photographic|hero|detail|environment)/.test(role)
  && !/(infographic|comparison|parameter|card|layout|copy|text|typography|cutout|transparent|logo|packaging)/.test(role);

const blocked = [];
if (!fs.existsSync(input)) blocked.push("input_missing");
if (!isInside(input, runDir)) blocked.push("input_not_run_local");
if (!isInside(output, runDir)) blocked.push("output_not_run_local");
if (!approvedSource) blocked.push("approved_source_required");
if (!eligibleRole) blocked.push("role_not_eligible_for_photographic_finish");
if (visibleText !== "false" && visibleText !== "no") blocked.push("visible_text_must_be_explicitly_false");
if (input === output) blocked.push("source_must_remain_immutable");

if (blocked.length) {
  const report = writeAttemptReport(blocked);
  console.error(JSON.stringify({ status: report.status, findings: report.findings }, null, 2));
  process.exit(1);
}

const preparation = runJson(process.execPath, [
  path.join(skillRoot, "scripts", "prepare-natural-image-runtime.mjs"),
  "--check",
  "--runtime-root", runtimeRoot,
  "--skill-root", skillRoot,
  "--include-diagnostics",
], { allowFailure: true });

if (!preparation?.ready) {
  const report = writeAttemptReport(["natural_image_runtime_not_prepared"]);
  console.error(JSON.stringify({ status: report.status, findings: report.findings }, null, 2));
  process.exit(1);
}

const runtimePython = preparation.diagnostics?.runtime_python;
const ffmpeg = preparation.diagnostics?.ffmpeg;
if (!runtimePython || !ffmpeg) throw new Error("Prepared runtime diagnostics are incomplete.");

fs.mkdirSync(path.dirname(output), { recursive: true });
const assetReportPath = path.join(qaDir, `natural-image-finish-${safeSlug(path.basename(output, path.extname(output)))}.json`);
const commandArgs = [
  path.join(skillRoot, "scripts", "natural-image-finish.py"),
  input,
  "--output", output,
  "--preset", String(args.preset || "light"),
  "--ffmpeg", ffmpeg,
  "--report", assetReportPath,
];
if (args.noise != null) commandArgs.push("--noise", String(args.noise));
if (args.blur != null) commandArgs.push("--blur", String(args.blur));
if (args.seed != null) commandArgs.push("--seed", String(args.seed));

const result = spawnSync(runtimePython, commandArgs, {
  cwd: skillRoot,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (result.status !== 0) {
  const report = writeAttemptReport(["natural_image_finish_execution_failed"]);
  console.error(JSON.stringify({ status: report.status, findings: report.findings }, null, 2));
  process.exit(1);
}

const assetReport = JSON.parse(fs.readFileSync(assetReportPath, "utf8"));
const asset = {
  file: path.basename(output),
  role: args.role,
  status: "pass",
  input: relativeRunPath(input),
  output: relativeRunPath(output),
  input_sha256: assetReport.input_sha256,
  output_sha256: assetReport.output_sha256,
  preset: assetReport.preset,
  seed: assetReport.seed,
  contains_visible_text: false,
  approved_source: true,
  proof: relativeRunPath(assetReportPath),
};
const gateReport = writeGateReport({ status: "pass", findings: [], asset });
writeLineage(asset);

console.log(JSON.stringify({
  status: gateReport.status,
  output,
  output_sha256: asset.output_sha256,
  proof: assetReportPath,
  lineage: path.join(runDir, "export", "final-image-lineage.json"),
}, null, 2));

function writeGateReport({ status, findings, asset }) {
  fs.mkdirSync(qaDir, { recursive: true });
  const reportPath = path.join(qaDir, "natural-image-finish-gate-report.json");
  const existing = readJson(reportPath) || {};
  const assets = Array.isArray(existing.assets) ? existing.assets : [];
  if (asset) {
    const index = assets.findIndex((item) => item.file === asset.file);
    if (index >= 0) assets[index] = asset;
    else assets.push(asset);
  }
  const combinedFindings = findings;
  const finalStatus = status === "blocked" || combinedFindings.some((item) => item.severity === "fail") ? "blocked" : "pass";
  const report = {
    schema_version: "sellerpilot.natural_image_finish_gate.v1",
    gate_id: "natural-image-finish-gate",
    status: finalStatus,
    checked_at: new Date().toISOString(),
    policy: {
      approved_generated_or_photo_source_required: true,
      visible_text_allowed: false,
      alpha_allowed: false,
      eligible_assets: "text-free photographic plates and scenes only",
      placement: "after source approval and before local typography or final visible-text review",
    },
    assets,
    findings: combinedFindings,
  };
  writeJson(reportPath, report);
  return report;
}

function writeAttemptReport(types) {
  fs.mkdirSync(qaDir, { recursive: true });
  const report = {
    schema_version: "sellerpilot.natural_image_finish_attempt.v1",
    status: "blocked",
    checked_at: new Date().toISOString(),
    input: relativeRunPath(input),
    requested_output: relativeRunPath(output),
    role: args.role,
    findings: types.map((type) => ({ severity: "fail", type })),
    preserved_source: fs.existsSync(input),
    output_written: fs.existsSync(output),
    next_action: "Keep the approved source unchanged. Prepare dependencies during skill install/update or skip this optional finish for ineligible assets.",
  };
  writeJson(path.join(qaDir, "natural-image-finish-attempt.json"), report);
  return report;
}

function writeLineage(asset) {
  const lineagePath = path.join(runDir, "export", "final-image-lineage.json");
  const existing = readJson(lineagePath) || {};
  const images = Array.isArray(existing.images) ? existing.images : [];
  const record = {
    file: asset.file,
    source_type: "derived_from_approved_generated_asset",
    derived_from: asset.input,
    approved_source_path: asset.input,
    transformation_type: "natural_image_finish",
    render_method: "local_photographic_finish",
    natural_finish_proof: asset.proof,
    output_sha256: asset.output_sha256,
    claims_new_scene_asset: false,
    requires_identity_review: true,
    note: "Restrained local grain, micro-contrast, and encode finish applied to an approved text-free photographic asset.",
  };
  const index = images.findIndex((item) => path.basename(item.file || "") === asset.file);
  if (index >= 0) images[index] = record;
  else images.push(record);
  writeJson(lineagePath, {
    schema_version: "sellerpilot.final_image_lineage.v1",
    updated_at: new Date().toISOString(),
    images,
  });
}

function runJson(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: skillRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 && !options.allowFailure) throw new Error("Runtime readiness check failed.");
  try { return JSON.parse(result.stdout.trim()); } catch { return null; }
}

function relativeRunPath(file) {
  return isInside(file, runDir) ? path.relative(runDir, file) : path.resolve(file);
}

function isInside(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function boolArg(value) {
  return ["1", "true", "yes"].includes(normalize(value));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function safeSlug(value) {
  return String(value || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; i += 1; }
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
node scripts/natural-image-finish.mjs \\
  --run-dir /abs/run \\
  --input /abs/run/generated-assets/approved.png \\
  --output /abs/run/final-images/IMG-01-lifestyle-scene.png \\
  --role lifestyle_scene \\
  --approved-source true \\
  --contains-visible-text false \\
  [--preset light|medium|strong] [--noise 0..4] [--blur 0..1.5] [--seed number]`);
  process.exit(2);
}
