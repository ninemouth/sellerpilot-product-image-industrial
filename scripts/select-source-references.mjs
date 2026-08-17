#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_REFERENCE_LIMITS, inferGenerationIntent, normalizeReferenceLimits, providerReferenceLimits } from "./lib/source-reference-policy.mjs";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role) usage();
const runDir = path.resolve(args["run-dir"]);
const manifestPath = resolveRunPath(args.manifest || "source-preflight/reference-assets-manifest.json");
const annotationsPath = resolveRunPath(args.annotations || "source-understanding/source-reference-annotations.json");
const summaryPath = resolveRunPath(args.summary || "source-understanding/source-evidence-summary.json");
const resolutionPath = resolveRunPath(args["provider-resolution"] || "runtime/image-provider-resolution.json");
const gatePath = resolveRunPath(args["gate-report"] || "qa/source-evidence-summary-gate-report.json");
const manifest = readJson(manifestPath, "reference assets manifest");
const annotations = readJson(annotationsPath, "source reference annotations");
const summary = readJson(summaryPath, "source evidence summary");
const resolution = readJsonIfExists(resolutionPath) || {};
const gate = readJsonIfExists(gatePath);
if (manifest?.schema_version !== "sellerpilot.reference_assets_manifest.v1") fail("Reference assets manifest is missing or incompatible.");
if (annotations?.schema_version !== "sellerpilot.source_reference_annotations.v1") fail("Source reference annotations are missing or incompatible.");
if (summary?.schema_version !== "sellerpilot.source_evidence_summary.v1") fail("Compact source evidence is missing or incompatible.");
if (resolution?.status !== "ready") fail("A ready pinned provider resolution is required before reference selection.");
if (gate?.schema_version !== "sellerpilot.source_evidence_summary_gate_report.v1" || gate.status !== "pass") fail("Source evidence summary gate has not passed for this run.");
if (gate.inputs?.manifest !== relativeRunPath(manifestPath) || gate.inputs?.annotations !== relativeRunPath(annotationsPath) || gate.inputs?.summary !== relativeRunPath(summaryPath)) fail("Source evidence gate inputs do not match the requested reference-selection evidence.");

const intent = inferGenerationIntent({ prompt: args.prompt || "", role: args.role });
const providerLimits = providerReferenceLimits(resolution);
const requestedLimits = normalizeReferenceLimits({
  max_count: positiveInteger(args["max-count"]) || DEFAULT_REFERENCE_LIMITS.max_count,
  max_per_image_bytes: positiveInteger(args["max-per-image-bytes"]) || providerLimits.max_per_image_bytes,
  max_total_bytes: positiveInteger(args["max-total-bytes"]) || providerLimits.max_total_bytes,
});
const limits = {
  max_count: Math.min(requestedLimits.max_count, providerLimits.max_count),
  max_per_image_bytes: Math.min(requestedLimits.max_per_image_bytes, providerLimits.max_per_image_bytes),
  max_total_bytes: Math.min(requestedLimits.max_total_bytes, providerLimits.max_total_bytes),
};
const annotationsById = new Map((annotations.sources || []).map((item) => [String(item.source_id || ""), item]));
const routedIds = new Set(asArray(summary?.reference_routing?.[intent] || (intent === "hero" ? summary?.reference_routing?.hero : null)));
const candidates = [];
const excluded = [];
for (const source of manifest.sources || []) {
  const annotation = annotationsById.get(source.source_id) || {};
  const membership = String(annotation.product_membership || source.product_membership || "unknown");
  const confirmedRole = String(annotation.confirmed_role || source.provisional_role || "unknown");
  const providerFile = resolveRunPath(source.provider_path);
  if (membership !== "user_owned_product") {
    excluded.push({ source_id: source.source_id, reason: `membership_${membership}` });
    continue;
  }
  if (!insideRun(providerFile) || !fs.existsSync(providerFile)) {
    excluded.push({ source_id: source.source_id, reason: "provider_variant_missing_or_outside_run" });
    continue;
  }
  const bytes = fs.statSync(providerFile).size;
  if (bytes > limits.max_per_image_bytes) {
    excluded.push({ source_id: source.source_id, reason: "over_provider_per_image_byte_limit", bytes });
    continue;
  }
  const score = scoreCandidate({ intent, role: confirmedRole, routed: routedIds.has(source.source_id), index: candidates.length });
  candidates.push({ source_id: source.source_id, role: confirmedRole, provider_file: providerFile, provider_path: relativeRunPath(providerFile), bytes, score, routed: routedIds.has(source.source_id), unique_contribution: annotation.unique_contribution || summary?.per_source_contributions?.[source.source_id] || null });
}
if (!candidates.length) fail("No user-owned, prepared reference image is eligible for this generation role.");
candidates.sort((left, right) => right.score - left.score || left.source_id.localeCompare(right.source_id));
const selected = [];
let totalBytes = 0;
for (const candidate of candidates) {
  if (selected.length >= limits.max_count) { excluded.push({ source_id: candidate.source_id, reason: "role_reference_count_limit" }); continue; }
  if (totalBytes + candidate.bytes > limits.max_total_bytes) { excluded.push({ source_id: candidate.source_id, reason: "provider_total_byte_limit", bytes: candidate.bytes }); continue; }
  if (candidate.score <= 0 && selected.length) { excluded.push({ source_id: candidate.source_id, reason: "not_relevant_to_role" }); continue; }
  selected.push(candidate);
  totalBytes += candidate.bytes;
}
if (!selected.length) fail("Prepared references exist, but none fit the provider byte budget for this role.");

const report = {
  schema_version: "sellerpilot.reference_selection.v1",
  status: "ready",
  selected_at: new Date().toISOString(),
  role: String(args.role),
  intent,
  strategy: "role_specific_deep_evidence",
  limits,
  selected: selected.map((item) => ({ source_id: item.source_id, confirmed_role: item.role, provider_path: item.provider_path, bytes: item.bytes, reason: selectionReason(item, intent), unique_contribution: item.unique_contribution })),
  excluded: uniqueExcluded(excluded, new Set(selected.map((item) => item.source_id))),
  selected_count: selected.length,
  selected_total_bytes: totalBytes,
  compact_evidence: relativeRunPath(summaryPath),
};
const out = resolveRunPath(args.out || `generated-assets/reference-selection-${String(args.role).toLowerCase()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: "ready", role: args.role, intent, selection_report: out, selected_source_ids: selected.map((item) => item.source_id), selected_images: selected.map((item) => item.provider_file), selected_total_bytes: totalBytes }, null, 2));

function scoreCandidate({ intent: target, role, routed, index }) {
  let score = routed ? 120 : 0;
  const primary = ["primary_identity", "front"].includes(role);
  const desired = {
    hero: ["primary_identity", "front"], generic: ["primary_identity", "front"],
    detail: ["detail", "logo", "surface_material", "primary_identity", "front"],
    side: ["side", "primary_identity", "front"], back: ["back", "primary_identity", "front"],
    interior: ["interior", "top", "primary_identity", "front"], packaging: ["packaging", "logo", "primary_identity", "front"],
    surface_material: ["surface_material", "detail", "primary_identity", "front"], scene: ["primary_identity", "front", "scene", "side"],
    top: ["top", "primary_identity", "front"], bottom: ["bottom", "side", "primary_identity", "front"],
  }[target] || ["primary_identity", "front"];
  const position = desired.indexOf(role);
  if (position >= 0) score += 80 - position * 12;
  if (primary) score += target === "hero" || target === "generic" ? 50 : 12;
  if (role === "unknown") score -= 20;
  return score - index * 0.001;
}
function selectionReason(item, target) { return item.routed ? `compact_evidence_routes_${target}` : `${item.role}_supports_${target}`; }
function uniqueExcluded(rows, selectedIds) { const seen = new Set(); return rows.filter((item) => !selectedIds.has(item.source_id) && !seen.has(item.source_id) && seen.add(item.source_id)); }
function insideRun(file) { const relative = path.relative(runDir, file); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function asArray(value) { return (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean); }
function resolveRunPath(value) { return path.isAbsolute(String(value || "")) ? String(value) : path.join(runDir, String(value || "")); }
function relativeRunPath(file) { return path.relative(runDir, file).split(path.sep).join("/"); }
function readJson(file, label) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`Unable to read ${label} ${file}: ${error.message}`); } }
function readJsonIfExists(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function parseArgs(argv) { const value = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) value[key] = true; else { value[key] = next; i += 1; } } return value; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/select-source-references.mjs --run-dir /abs/run --role IMG-01 [--prompt text] [--manifest file] [--annotations file] [--summary file] [--provider-resolution file] [--max-count 2]"); process.exit(2); }
