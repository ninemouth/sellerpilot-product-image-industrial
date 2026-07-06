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
node scripts/identity-geometry-gate.mjs \\
  --source-geometry /abs/source-geometry.json \\
  --generated-geometry /abs/generated-geometry.json \\
  --out-dir /abs/run/qa [--tolerance 0.12]

Compares source-vs-generated annotated product geometry. Use it for apparel,
bags, footwear, furniture, tools, and any product where proportions matter.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["source-geometry"] || !args["generated-geometry"] || !args["out-dir"]) usage();

const sourcePath = path.resolve(args["source-geometry"]);
const generatedPath = path.resolve(args["generated-geometry"]);
const outDir = path.resolve(args["out-dir"]);
const tolerance = Number(args.tolerance || 0.12);
fs.mkdirSync(outDir, { recursive: true });

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const generated = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
const sourceGeometry = source.geometry_lock || source.critical_geometry || source;
const generatedImages = Array.isArray(generated.images) ? generated.images : [generated];
const findings = [];

for (const image of generatedImages) {
  const imageIndex = image.index || image.image_index || generatedImages.indexOf(image) + 1;
  const imageGeometry = image.geometry || image.critical_geometry || image.geometry_lock || image;
  compareNumeric(sourceGeometry, imageGeometry, imageIndex);
  compareCategorical(sourceGeometry, imageGeometry, imageIndex);
  compareForbidden(sourceGeometry, imageGeometry, imageIndex);
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  tolerance,
  source_geometry: sourcePath,
  generated_geometry: generatedPath,
  findings,
};

fs.writeFileSync(path.join(outDir, "identity-geometry-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "identity-geometry-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function compareNumeric(sourceGeometry, imageGeometry, imageIndex) {
  const fields = [
    "body_length_to_width_ratio",
    "collar_to_hem_ratio",
    "shoulder_width_to_body_length_ratio",
    "sleeve_length_to_body_length_ratio",
    "hem_width_to_chest_width_ratio",
    "product_height_to_width_ratio",
  ];
  for (const field of fields) {
    const expected = Number(sourceGeometry[field]);
    const actual = Number(imageGeometry[field]);
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
    const delta = Math.abs(actual - expected);
    const allowed = Math.max(tolerance, Math.abs(expected) * tolerance);
    if (delta > allowed) {
      findings.push({
        severity: "fail",
        type: "geometry-ratio-drift",
        image_index: imageIndex,
        field,
        expected,
        actual,
        message: `${field} drifted from ${expected} to ${actual}; allowed delta ${allowed.toFixed(3)}.`,
      });
    }
  }
}

function compareCategorical(sourceGeometry, imageGeometry, imageIndex) {
  const fields = [
    "garment_length_class",
    "hem_position",
    "neckline_shape",
    "sleeve_length_class",
    "fit_class",
    "silhouette_class",
    "product_length_class",
  ];
  for (const field of fields) {
    const expected = normalize(sourceGeometry[field]);
    const actual = normalize(imageGeometry[field]);
    if (!expected || !actual) continue;
    if (expected !== actual) {
      findings.push({
        severity: "fail",
        type: "geometry-class-drift",
        image_index: imageIndex,
        field,
        expected: sourceGeometry[field],
        actual: imageGeometry[field],
        message: `${field} changed from "${sourceGeometry[field]}" to "${imageGeometry[field]}".`,
      });
    }
  }
}

function compareForbidden(sourceGeometry, imageGeometry, imageIndex) {
  const expectedLength = normalize(sourceGeometry.garment_length_class || sourceGeometry.product_length_class);
  const actualLength = normalize(imageGeometry.garment_length_class || imageGeometry.product_length_class);
  const expectedHem = normalize(sourceGeometry.hem_position);
  const actualHem = normalize(imageGeometry.hem_position);
  const actualNotes = normalize(textify([imageGeometry.notes, imageGeometry.visual_description, imageGeometry.detected_changes]));

  if (!/(crop|cropped|short|短款|露腰|上腰|above waist)/.test(expectedLength + " " + expectedHem)
    && /(crop|cropped|short|短款|露腰|上腰|above waist|crop top)/.test(actualLength + " " + actualHem + " " + actualNotes)) {
    findings.push({
      severity: "fail",
      type: "apparel-length-shortened",
      image_index: imageIndex,
      message: "Generated apparel appears shortened/crop-top-like while source geometry is not cropped.",
    });
  }

  const forbidden = Array.isArray(sourceGeometry.forbidden_geometry_changes) ? sourceGeometry.forbidden_geometry_changes : [];
  for (const rule of forbidden) {
    const pattern = new RegExp(escapeRegex(String(rule)).replace(/\s+/g, ".*"), "i");
    if (pattern.test(actualNotes)) {
      findings.push({
        severity: "fail",
        type: "forbidden-geometry-change",
        image_index: imageIndex,
        message: `Generated geometry notes match forbidden change: ${rule}`,
      });
    }
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function textify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textify).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textify).filter(Boolean).join(" ");
  return String(value);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMarkdown(report) {
  const lines = [
    "# Identity Geometry Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Tolerance: ${report.tolerance}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  else {
    for (const item of report.findings) {
      const prefix = item.image_index ? `image ${item.image_index}, ` : "";
      lines.push(`- [${item.severity}] ${item.type}: ${prefix}${item.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
