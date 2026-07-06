#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { collectScopedImages, createFinalImagesManifest, imageScopeUsage } from "./lib/image-scope.mjs";

const require = createRequire(import.meta.url);

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
  console.error(imageScopeUsage(`Usage:
node scripts/image-set-export-gate.mjs --run-dir /abs/run --image-dir /abs/run/final-images --out-dir /abs/run/qa [--expected-count 8] [--require-square] [--allow-drafts]
node scripts/image-set-export-gate.mjs --manifest /abs/run/export/final-images-manifest.json --out-dir /abs/run/qa [--expected-count 8]

Checks exported image files for independent-file delivery, stable English filenames,
minimum resolution, and contact-sheet-like aspect ratios.`));
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"] || (!args["image-dir"] && !args.images && !args.manifest)) usage();

let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"));
}

const outDir = path.resolve(args["out-dir"]);
const expectedCount = args["expected-count"] ? Number(args["expected-count"]) : null;
const requireSquare = Boolean(args["require-square"]);
const allowDrafts = Boolean(args["allow-drafts"]);
fs.mkdirSync(outDir, { recursive: true });

const scope = collectScopedImages(args, { purpose: "image-set-export-gate" });
const files = scope.images;
const imageDir = scope.imageDir || path.dirname(files[0] || "");
const manifestResult = scope.runDir
  ? createFinalImagesManifest({
    runDir: scope.runDir,
    imageDir,
    images: files,
    purpose: "image_set_export_gate",
    existingManifest: scope.manifest ? { manifest_path: scope.manifestPath } : null,
  })
  : null;

const findings = [];
if (expectedCount && files.length !== expectedCount) {
  findings.push({
    severity: "fail",
    type: "wrong-image-count",
    message: `Expected ${expectedCount} exported images, found ${files.length}.`,
  });
}
if (files.length === 1) {
  findings.push({
    severity: "fail",
    type: "single-file-delivery",
    message: "Only one image file was exported. A contact sheet or preview cannot replace independent final images.",
  });
}

const fileReports = [];
for (const file of files) {
  const name = path.basename(file);
  const meta = await sharp(file).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const ratio = width && height ? width / height : 0;
  const report = { file, width, height, ratio: Number(ratio.toFixed(4)) };
  fileReports.push(report);

  if (!/^(IMG|POSTER|DETAIL)-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpe?g|webp)$/i.test(name)) {
    findings.push({
      severity: "fail",
      type: "bad-filename",
      file,
      message: `Filename must include stable ID plus English purpose slug, e.g. IMG-01-main-product.png. Got ${name}.`,
    });
  }
  if (!allowDrafts && /\b(?:layout-)?draft\b|placeholder|wireframe|blocked/i.test(name)) {
    findings.push({
      severity: "fail",
      type: "draft-exported-as-final",
      file,
      message: `Draft, placeholder, wireframe, or blocked asset cannot be packaged as a final ecommerce image. Got ${name}.`,
    });
  }
  if (width < 900 || height < 900) {
    findings.push({
      severity: "warn",
      type: "low-resolution",
      file,
      message: `Image is ${width}x${height}; use at least 1080x1080 or platform-specific higher resolution when possible.`,
    });
  }
  if (requireSquare && Math.abs(ratio - 1) > 0.02) {
    findings.push({
      severity: "fail",
      type: "not-square",
      file,
      message: `Image ratio is ${ratio.toFixed(3)}; expected independent 1:1 image.`,
    });
  }
  if (ratio > 1.6 || ratio < 0.62) {
    findings.push({
      severity: "fail",
      type: "contact-sheet-or-banner-ratio",
      file,
      message: `Image ratio ${ratio.toFixed(3)} looks like a contact sheet, banner, or long module, not an independent ecommerce listing image.`,
    });
  }
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  image_dir: imageDir,
  run_id: scope.runId || null,
  run_dir: scope.runDir || null,
  source: scope.source,
  image_manifest: manifestResult?.manifestPath || scope.manifestPath || null,
  expected_count: expectedCount,
  exported_count: files.length,
  files: fileReports,
  findings,
};

fs.writeFileSync(path.join(outDir, "image-set-export-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "image-set-export-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function toMarkdown(report) {
  const lines = [
    "# Image Set Export Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Image dir: ${report.image_dir}`,
    `- Exported count: ${report.exported_count}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const file = finding.file ? ` (${path.basename(finding.file)})` : "";
    lines.push(`- [${finding.severity}] ${finding.type}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
