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
node scripts/source-product-understanding-gate.mjs --understanding /abs/source-product-understanding.json --out-dir /abs/run/qa [--identity-lock /abs/run/blueprint/02-identity-lock.yaml] [--physical-truth /abs/run/blueprint/02b-product-physical-truth.json] [--source-geometry /abs/run/geometry/source-geometry.json]

Blocks generation when source-image product recognition, visible text/OCR facts,
or text-derived size/function facts have not been propagated into downstream locks.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.understanding || !args["out-dir"]) usage();

const understandingPath = path.resolve(args.understanding);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const findings = [];
const understanding = readJson(understandingPath);
const text = JSON.stringify(understanding).toLowerCase();

const visualRead = understanding.codex_visual_product_read || {};
if (!String(visualRead.status || "").match(/complete|locked|reviewed/i)) {
  findings.push({
    severity: "fail",
    type: "source-product-read-not-complete",
    message: "Codex visual product recognition is not complete. Record product type, structure, components, color/material, function/use, and uncertainty before generation.",
  });
}

for (const field of ["product_identity_summary", "observed_product_type"]) {
  if (!String(visualRead[field] || "").trim()) {
    findings.push({
      severity: "fail",
      type: "missing-source-product-field",
      field,
      message: `Source product understanding is missing ${field}.`,
    });
  }
}
if (!Array.isArray(visualRead.observed_components) || visualRead.observed_components.length < 1) {
  findings.push({
    severity: "fail",
    type: "missing-observed-components",
    message: "Source understanding must list observed product components/structure before generation.",
  });
}

const visibleItems = understanding.text_understanding?.visible_text_items || [];
const textFacts = understanding.text_understanding?.text_derived_facts || [];
const ocrRawText = understanding.vision_ocr_pass?.raw_text || "";
const ocrHasText = String(ocrRawText).trim().length > 0 || visibleItems.length > 0;
if (ocrHasText && !visibleItems.length) {
  findings.push({
    severity: "fail",
    type: "ocr-text-not-structured",
    message: "OCR/raw visible text exists but visible_text_items is empty. Transcribe and classify the visible text.",
  });
}

const dimensionFacts = textFacts.filter((item) => String(item.fact_type || "").toLowerCase() === "dimension");
const functionFacts = textFacts.filter((item) => /(installation|function|compatibility|safety|material|weight)/i.test(String(item.fact_type || "")));
if (ocrHasText && /(?:in|inch|cm|mm|length|width|height|diameter|weight|screw|mount|clip|route|press|install|compatible|warning|waterproof|certified)/i.test(String(ocrRawText) + JSON.stringify(visibleItems)) && !textFacts.length) {
  findings.push({
    severity: "fail",
    type: "missing-text-derived-facts",
    message: "Visible text appears to contain size/function/spec information but text_derived_facts is empty.",
  });
}

if (args["identity-lock"]) {
  const identityText = readText(path.resolve(args["identity-lock"]));
  if (!mentionsAny(identityText, [visualRead.observed_product_type, ...safeArray(visualRead.observed_components)])) {
    findings.push({
      severity: "fail",
      type: "source-understanding-not-propagated-to-identity-lock",
      message: "Identity lock does not appear to include source product type/components from source understanding.",
    });
  }
}

if (dimensionFacts.length && args["source-geometry"]) {
  const geometryText = readText(path.resolve(args["source-geometry"]));
  if (!mentionsAny(geometryText, dimensionFacts.map((item) => item.value))) {
    findings.push({
      severity: "fail",
      type: "text-dimensions-not-propagated-to-geometry-lock",
      message: "Text-derived dimensions from the source image are not present in source geometry lock.",
    });
  }
}

if ((dimensionFacts.length || functionFacts.length) && args["physical-truth"]) {
  const physicalText = readText(path.resolve(args["physical-truth"]));
  if (!mentionsAny(physicalText, [...dimensionFacts, ...functionFacts].map((item) => item.value))) {
    findings.push({
      severity: "fail",
      type: "text-facts-not-propagated-to-physical-truth",
      message: "Text-derived dimensions/functions/specs are not present in product physical truth lock.",
    });
  }
}

if (/starter_needs_codex_visual_review|pending/i.test(String(understanding.status || "")) || /"pending"/i.test(text)) {
  findings.push({
    severity: "warn",
    type: "source-understanding-has-pending-fields",
    message: "Source understanding still contains pending starter fields. Resolve before final generation whenever they affect product identity, text, size, or function.",
  });
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  understanding: understandingPath,
  findings,
};
fs.writeFileSync(path.join(outDir, "source-product-understanding-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "source-product-understanding-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read source understanding JSON ${file}: ${error.message}`);
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mentionsAny(haystack, values) {
  const normalizedHaystack = normalize(haystack);
  return values
    .map((item) => typeof item === "string" ? item : item?.value)
    .filter(Boolean)
    .some((value) => normalize(value).split(/\s+/).filter((token) => token.length > 2).some((token) => normalizedHaystack.includes(token)));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff.]+/g, " ");
}

function toMarkdown(report) {
  const lines = [
    "# Source Product Understanding Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Understanding: ${report.understanding}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const field = finding.field ? ` (${finding.field})` : "";
    lines.push(`- [${finding.severity}] ${finding.type}${field}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
