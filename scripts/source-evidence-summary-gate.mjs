#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"]) usage();
const runDir = path.resolve(args["run-dir"]);
const manifestPath = resolveRunPath(args.manifest || "source-preflight/reference-assets-manifest.json");
const annotationsPath = resolveRunPath(args.annotations || "source-understanding/source-reference-annotations.json");
const summaryPath = resolveRunPath(args.summary || "source-understanding/source-evidence-summary.json");
const understandingPath = resolveRunPath(args.understanding || "source-understanding/source-product-understanding.json");
const outDir = resolveRunPath(args["out-dir"] || "qa");
const maxBytes = positiveInteger(args["max-bytes"]) || 12 * 1024;
const findings = [];
const manifest = readJson(manifestPath, "reference assets manifest");
const annotations = readJson(annotationsPath, "source reference annotations");
const summary = readJson(summaryPath, "source evidence summary");
const understanding = readJson(understandingPath, "source product understanding");

checkSchema(manifest, "sellerpilot.reference_assets_manifest.v1", "reference-assets-manifest");
checkSchema(annotations, "sellerpilot.source_reference_annotations.v1", "source-reference-annotations");
checkSchema(summary, "sellerpilot.source_evidence_summary.v1", "source-evidence-summary");
checkSchema(understanding, "sellerpilot.source_product_understanding.v1", "source-product-understanding");
if (!complete(understanding.status) || !complete(understanding.codex_visual_product_read?.status)) add("fail", "full-understanding-not-complete", "Full source product understanding and its aggregate Codex visual read must be complete.");
for (const field of ["product_identity_summary", "observed_product_type"]) if (!String(understanding.codex_visual_product_read?.[field] || "").trim()) add("fail", "full-understanding-field-missing", `Full source understanding is missing ${field}.`);
if (!Array.isArray(understanding.codex_visual_product_read?.observed_components) || !understanding.codex_visual_product_read.observed_components.length) add("fail", "full-understanding-components-missing", "Full source understanding must list observed components.");
if (!complete(annotations.status)) add("fail", "annotations-not-complete", "All reference images must be visually interpreted before downstream prompt work.");
if (!complete(summary.status)) add("fail", "summary-not-complete", "Compact source evidence must be complete/reviewed before downstream prompt work.");

const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
if (!sources.length) add("fail", "reference-manifest-empty", "Reference manifest must contain at least one source-backed image.");
const sourceIds = new Set(sources.map((item) => String(item.source_id || "")).filter(Boolean));
if (sourceIds.size !== sources.length) add("fail", "duplicate-or-missing-source-id", "Every reference manifest row must have a unique source_id.");
const annotationRows = Array.isArray(annotations.sources) ? annotations.sources : [];
const sourceReads = Array.isArray(understanding.source_reads) ? understanding.source_reads : [];
const sourceReadsById = new Map(sourceReads.map((item) => [String(item.source_id || ""), item]));
if (sourceReadsById.size !== sourceReads.length) add("fail", "duplicate-or-missing-source-read-id", "Every full source_reads row must have a unique source_id.");
for (const id of sourceReadsById.keys()) if (id && !sourceIds.has(id)) add("fail", "unknown-deep-source-read", `Full understanding references unknown source ${id}.`, id);
const annotationsById = new Map(annotationRows.map((item) => [String(item.source_id || ""), item]));
for (const source of sources) {
  validateManifestAsset(source);
  const sourceRead = sourceReadsById.get(source.source_id);
  if (!sourceRead) add("fail", "deep-source-read-missing", `No full visual source_reads evidence exists for ${source.source_id}.`, source.source_id);
  else {
    if (!complete(sourceRead.status) || !String(sourceRead.visual_summary || "").trim()) add("fail", "deep-source-read-incomplete", `${source.source_id} needs a complete visual_summary.`, source.source_id);
    if (!Array.isArray(sourceRead.observed_facts) || !sourceRead.observed_facts.length) add("fail", "deep-source-facts-missing", `${source.source_id} needs observed_facts from visual inspection.`, source.source_id);
    if (!sourceRead.visible_text || !String(sourceRead.visible_text.status || "").trim() || !Array.isArray(sourceRead.visible_text.items)) add("fail", "deep-source-text-read-missing", `${source.source_id} needs an AI-first visible_text decision and items array.`, source.source_id);
    if (!Array.isArray(sourceRead.uncertainty_notes)) add("fail", "deep-source-uncertainty-missing", `${source.source_id} needs an uncertainty_notes array.`, source.source_id);
  }
  const row = annotationsById.get(source.source_id);
  if (!row) add("fail", "source-annotation-missing", `No deep visual annotation exists for ${source.source_id}.`, source.source_id);
  else {
    if (!String(row.confirmed_role || "").trim()) add("fail", "confirmed-role-missing", `confirmed_role is missing for ${source.source_id}.`, source.source_id);
    if (!String(row.product_membership || "").trim()) add("fail", "product-membership-missing", `product_membership is missing for ${source.source_id}.`, source.source_id);
    if (!String(row.unique_contribution || "").trim()) add("fail", "unique-contribution-missing", `unique_contribution is missing for ${source.source_id}.`, source.source_id);
  }
}
for (const id of annotationsById.keys()) if (id && !sourceIds.has(id)) add("fail", "unknown-annotation-source", `Annotation references unknown source ${id}.`, id);
for (const conflict of Array.isArray(annotations.conflicts) ? annotations.conflicts : []) {
  if (!/resolved|not_applicable|dismissed/i.test(String(conflict.status || ""))) add("fail", "unresolved-source-conflict", "A source-image conflict remains unresolved.");
}

const identity = summary.product_identity || {};
if (!String(identity.one_sentence || identity.summary || "").trim()) add("fail", "identity-summary-missing", "Compact evidence must include a one-sentence product identity.");
if (!Array.isArray(identity.must_preserve) || !identity.must_preserve.length) add("fail", "must-preserve-missing", "Compact evidence must list identity facts that generation must preserve.");
const contributions = summary.per_source_contributions || {};
for (const source of sources) {
  const membership = String(annotationsById.get(source.source_id)?.product_membership || source.product_membership || "");
  if (membership === "user_owned_product" && !meaningfulContribution(contributions[source.source_id])) add("fail", "source-contribution-missing", `Compact evidence omits the unique contribution of ${source.source_id}.`, source.source_id);
}

const routing = summary.reference_routing || {};
for (const [intent, values] of Object.entries(routing)) {
  for (const id of asArray(values)) {
    if (!sourceIds.has(id)) add("fail", "routing-source-unknown", `reference_routing.${intent} references unknown source ${id}.`, id);
    const membership = String(annotationsById.get(id)?.product_membership || sources.find((item) => item.source_id === id)?.product_membership || "");
    if (membership !== "user_owned_product") add("fail", "non-owned-source-routed-to-provider", `${id} is ${membership || "unclassified"} and cannot be routed as a product reference.`, id);
  }
}

const rawSummary = fs.readFileSync(summaryPath, "utf8");
if (Buffer.byteLength(rawSummary) > maxBytes) add("fail", "summary-over-token-budget", `Compact source evidence is ${Buffer.byteLength(rawSummary)} bytes; limit is ${maxBytes} bytes.`);
if (/(data:image\/|;base64,)/i.test(rawSummary)) add("fail", "binary-image-embedded-in-summary", "Compact source evidence must reference source IDs, not embed image bytes.");
if (/"(?:analysis_path|provider_path|original_path)"\s*:/i.test(rawSummary)) add("fail", "image-paths-embedded-in-summary", "Compact source evidence must route by source_id instead of repeating file paths.");

const status = findings.some((item) => item.severity === "fail") ? "fail" : "pass";
const report = {
  schema_version: "sellerpilot.source_evidence_summary_gate_report.v1",
  status,
  checked_at: new Date().toISOString(),
  inputs: { manifest: relativeRunPath(manifestPath), understanding: relativeRunPath(understandingPath), annotations: relativeRunPath(annotationsPath), summary: relativeRunPath(summaryPath) },
  metrics: { source_count: sources.length, deeply_read_source_count: sourceReads.length, annotated_source_count: annotationRows.length, compact_summary_bytes: Buffer.byteLength(rawSummary), compact_summary_max_bytes: maxBytes },
  findings,
};
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, "source-evidence-summary-gate-report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status, report: reportPath, findings: findings.length, compact_summary_bytes: report.metrics.compact_summary_bytes }, null, 2));
if (status === "fail") process.exitCode = 1;

function checkSchema(value, expected, label) { if (value?.schema_version !== expected) add("fail", "schema-mismatch", `${label} must use ${expected}.`); }
function validateManifestAsset(source) {
  const analysis = resolveRunPath(source.analysis_path || "");
  const provider = resolveRunPath(source.provider_path || "");
  if (!insideRun(analysis) || !String(source.analysis_path || "").startsWith("source-original/")) add("fail", "analysis-original-boundary-invalid", `${source.source_id} analysis_path must be a run-local source-original asset.`, source.source_id);
  if (!insideRun(provider) || !/^(source-original|source-prepared)\//.test(String(source.provider_path || ""))) add("fail", "provider-variant-boundary-invalid", `${source.source_id} provider_path must be a run-local original or prepared asset.`, source.source_id);
  if (!fs.existsSync(analysis) || !fs.statSync(analysis).isFile()) add("fail", "analysis-original-missing", `${source.source_id} analysis original is missing.`, source.source_id);
  else {
    if (Number(source.original?.bytes) !== fs.statSync(analysis).size) add("fail", "analysis-original-byte-mismatch", `${source.source_id} analysis original byte count changed.`, source.source_id);
    if (source.original?.sha256 && source.original.sha256 !== hashFile(analysis)) add("fail", "analysis-original-hash-mismatch", `${source.source_id} analysis original hash changed.`, source.source_id);
  }
  if (!fs.existsSync(provider) || !fs.statSync(provider).isFile()) add("fail", "provider-variant-missing", `${source.source_id} provider upload asset is missing.`, source.source_id);
  else {
    if (Number(source.provider_variant?.bytes) !== fs.statSync(provider).size) add("fail", "provider-variant-byte-mismatch", `${source.source_id} provider upload byte count changed.`, source.source_id);
    if (source.provider_variant?.sha256 && source.provider_variant.sha256 !== hashFile(provider)) add("fail", "provider-variant-hash-mismatch", `${source.source_id} provider upload hash changed.`, source.source_id);
  }
}
function meaningfulContribution(value) { return typeof value === "string" ? Boolean(value.trim()) : Boolean(value && typeof value === "object" && Object.keys(value).length); }
function complete(value) { return /^(complete|completed|reviewed|pass|ready)$/i.test(String(value || "")); }
function add(severity, type, message, sourceId = null) { findings.push({ severity, type, message, ...(sourceId ? { source_id: sourceId } : {}) }); }
function asArray(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean); }
function resolveRunPath(value) { return path.isAbsolute(String(value)) ? String(value) : path.join(runDir, String(value)); }
function insideRun(file) { const relative = path.relative(runDir, file); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function hashFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function relativeRunPath(file) { return path.relative(runDir, file).split(path.sep).join("/"); }
function readJson(file, label) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { console.error(`Unable to read ${label} ${file}: ${error.message}`); process.exit(2); } }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function parseArgs(argv) { const value = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) value[key] = true; else { value[key] = next; i += 1; } } return value; }
function usage() { console.error("Usage: node scripts/source-evidence-summary-gate.mjs --run-dir /abs/run [--manifest file] [--understanding file] [--annotations file] [--summary file] [--out-dir qa] [--max-bytes 12288]"); process.exit(2); }
