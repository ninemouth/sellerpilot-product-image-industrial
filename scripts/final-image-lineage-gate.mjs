#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const manifest = readJson(manifestPath);
const images = Array.isArray(manifest.images) ? manifest.images : [];
const findings = [];
const lineageRecords = images.map((image) => ({
  file: image.file,
  id: image.id,
  lineage: image.lineage || null,
}));

for (const image of images) {
  const lineage = image.lineage || {};
  const sourceType = normalize(lineage.source_type);
  if (!sourceType || sourceType === "unknown") {
    findings.push({
      severity: "warn",
      type: "missing-final-image-lineage",
      file: image.file,
      message: `${image.file} has no explicit source_type lineage. Add provider_generated, derived_from_approved_generated_asset, local_text_overlay, or imported_final_asset.`,
    });
    continue;
  }
  if (/derived|repair|repaired/.test(sourceType)) {
    const source = lineage.derived_from || lineage.approved_source_path || lineage.generated_asset_path;
    if (!source || !existsRunPath(source)) {
      findings.push({
        severity: "fail",
        type: "derived-asset-missing-approved-source",
        file: image.file,
        message: `${image.file} is ${lineage.source_type} but does not point to an existing approved generated source asset.`,
      });
    }
    if (!lineage.transformation_type) {
      findings.push({
        severity: "fail",
        type: "derived-asset-missing-transformation",
        file: image.file,
        message: `${image.file} is derived/repaired but missing transformation_type such as crop, tone_adjust, layout_composite, or local_text_overlay.`,
      });
    }
    if (lineage.claims_new_scene_asset === true || String(lineage.claims_new_scene_asset).toLowerCase() === "true") {
      findings.push({
        severity: "fail",
        type: "derived-asset-claims-new-scene",
        file: image.file,
        message: `${image.file} is derived from an approved asset and must not be claimed as a fresh provider scene generation.`,
      });
    }
  }
  if (normalize(lineage.transformation_type) === "natural_image_finish") {
    const proof = lineage.natural_finish_proof;
    const proofPath = proof ? (path.isAbsolute(proof) ? proof : path.join(runDir, proof)) : "";
    const imagePath = path.resolve(image.path || path.join(manifest.image_dir || path.join(runDir, "final-images"), image.file || ""));
    const proofReport = proofPath && fs.existsSync(proofPath) ? readJson(proofPath) : null;
    const source = lineage.derived_from || lineage.approved_source_path || lineage.generated_asset_path;
    const sourcePath = source ? (path.isAbsolute(source) ? source : path.join(runDir, source)) : "";
    const finishGatePath = path.join(runDir, "qa", "natural-image-finish-gate-report.json");
    const finishGate = fs.existsSync(finishGatePath) ? readJson(finishGatePath) : null;
    const gateAsset = Array.isArray(finishGate?.assets)
      ? finishGate.assets.find((item) => path.basename(item.file || item.output || "") === path.basename(image.file || ""))
      : null;
    if (!proofReport || proofReport.status !== "pass") {
      findings.push({
        severity: "fail",
        type: "natural-image-finish-missing-proof",
        file: image.file,
        message: `${image.file} declares natural_image_finish but has no passing asset proof.`,
      });
    } else if (!fs.existsSync(imagePath) || proofReport.output_sha256 !== sha256File(imagePath)) {
      findings.push({
        severity: "fail",
        type: "natural-image-finish-output-hash-mismatch",
        file: image.file,
        message: `${image.file} does not match the output hash in its natural image finish proof.`,
      });
    }
    if (proofReport && (!sourcePath || !fs.existsSync(sourcePath) || proofReport.input_sha256 !== sha256File(sourcePath))) {
      findings.push({
        severity: "fail",
        type: "natural-image-finish-input-hash-mismatch",
        file: image.file,
        message: `${image.file} does not match the approved input hash in its natural image finish proof.`,
      });
    }
    if (!Array.isArray(proofReport?.operations) || !proofReport.operations.includes("ffmpeg_temporal_uniform_grain_and_output_encode")) {
      findings.push({
        severity: "fail",
        type: "natural-image-finish-incomplete-operation-chain",
        file: image.file,
        message: `${image.file} natural image finish proof is missing the FFmpeg finish operation.`,
      });
    }
    if (finishGate?.status !== "pass" || !gateAsset || gateAsset.approved_source !== true || gateAsset.contains_visible_text !== false) {
      findings.push({
        severity: "fail",
        type: "natural-image-finish-eligibility-gate-missing",
        file: image.file,
        message: `${image.file} is missing a passing natural image finish eligibility record for approved source and no visible text.`,
      });
    }
  }
  if (/text_overlay|personalized/.test(sourceType) || lineage.render_method === "local_overlay" || Array.isArray(lineage.personalized_text_items)) {
    if (!lineage.text_overlay_proof && !existsRunPath("qa/personalized-text-compositor-contract-report.json")) {
      findings.push({
        severity: "fail",
        type: "text-overlay-missing-proof",
        file: image.file,
        message: `${image.file} includes local/personalized text overlay lineage but no text overlay proof or personalized text compositor contract report exists.`,
      });
    }
  }
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.final_image_lineage_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  manifest: manifestPath,
  image_count: images.length,
  lineage_records: lineageRecords,
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "final-image-lineage-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "final-image-lineage-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function existsRunPath(value) {
  const file = path.isAbsolute(value) ? value : path.join(runDir, value);
  return fs.existsSync(file);
}

function toMarkdown(report) {
  const lines = [
    "# Final Image Lineage Gate",
    "",
    `- Status: ${report.status}`,
    `- Image count: ${report.image_count}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.type} (${finding.file || "run"}): ${finding.message}`);
  lines.push("");
  return lines.join("\n");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
  console.error("Usage: node scripts/final-image-lineage-gate.mjs --run-dir /abs/run [--manifest /abs/run/export/final-images-manifest.json] [--out-dir /abs/run/qa]");
  process.exit(2);
}
