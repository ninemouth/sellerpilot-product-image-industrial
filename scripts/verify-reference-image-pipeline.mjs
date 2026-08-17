#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const skillRoot = skillRootFrom(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sellerpilot-reference-pipeline-"));
const inputs = path.join(temp, "inputs");
const runDir = path.join(temp, "run");
fs.mkdirSync(inputs, { recursive: true });
let checks = 0;

const primary = path.join(inputs, "main-front.jpg");
const detail = path.join(inputs, "hardware-detail.png");
const side = path.join(inputs, "side-profile.jpg");
const competitor = path.join(inputs, "competitor-reference.png");
await sharp({ create: { width: 320, height: 420, channels: 3, background: "#9a6b45" } }).jpeg({ quality: 95 }).toFile(primary);
await sharp({ create: { width: 240, height: 240, channels: 3, background: "#d6b58d" } }).png().toFile(detail);
await sharp({ create: { width: 260, height: 400, channels: 3, background: "#82583b" } }).jpeg({ quality: 95 }).toFile(side);
await sharp({ create: { width: 260, height: 360, channels: 3, background: "#444444" } }).png().toFile(competitor);

const normalizeArgs = ["scripts/normalize-production-task.mjs", "--run-dir", runDir, "--platform", "Amazon", "--category", "bag", "--image-count", "2", ...[primary, detail, side, competitor].flatMap((file) => ["--source-image", file])];
run(normalizeArgs);
const smallHash = hashFile(primary);
run(["scripts/prepare-source-references.mjs", "--run-dir", runDir]);
const manifestPath = path.join(runDir, "source-preflight", "reference-assets-manifest.json");
const manifest = readJson(manifestPath);
const primaryRecord = sourceByRole(manifest, "primary_identity");
assert(primaryRecord.provider_variant.decision === "reuse_original", "small, provider-compatible references must not be recompressed");
assert(primaryRecord.original.sha256 === smallHash && hashFile(path.join(runDir, primaryRecord.analysis_path)) === smallHash, "analysis original must remain byte-identical");
assert(manifest.sources.length === 4 && manifest.sources.every((item) => item.analysis_path.startsWith("source-original/")), "preflight must create one run-local original per input");

const compressionRun = path.join(temp, "compression-run");
const padded = path.join(inputs, "oversized-main.png");
await sharp({ create: { width: 64, height: 64, channels: 3, background: "#b48361" } }).png().toFile(padded);
fs.appendFileSync(padded, Buffer.alloc(1024 * 1024, 7));
const paddedHash = hashFile(padded);
run(["scripts/normalize-production-task.mjs", "--run-dir", compressionRun, "--platform", "Amazon", "--category", "bag", "--image-count", "1", "--source-image", padded]);
run(["scripts/prepare-source-references.mjs", "--run-dir", compressionRun, "--max-bytes", "4096", "--target-bytes", "2048"]);
const compressedManifest = readJson(path.join(compressionRun, "source-preflight", "reference-assets-manifest.json"));
const compressed = compressedManifest.sources[0];
assert(compressed.provider_variant.decision === "prepared_derivative" && compressed.provider_variant.bytes <= 2048 && compressed.provider_variant.bytes < compressed.original.bytes, "oversized reference must receive a provider derivative within the requested target when feasible");
assert(hashFile(padded) === paddedHash && hashFile(path.join(compressionRun, compressed.analysis_path)) === paddedHash, "conditional compression must not mutate the user input or analysis original");
fs.appendFileSync(padded, Buffer.from("post-preflight-input-change"));
assert(hashFile(path.join(compressionRun, compressed.analysis_path)) === paddedHash, "run-local analysis originals must remain immutable when the later user-side file changes");

const annotations = {
  schema_version: "sellerpilot.source_reference_annotations.v1", status: "complete",
  sources: manifest.sources.map((item) => ({
    source_id: item.source_id,
    product_membership: item.product_membership,
    confirmed_role: item.provisional_role,
    evidence_tags: item.evidence_tags,
    unique_contribution: `${item.provisional_role} evidence`,
    confidence: 0.98,
    visible_text_or_micro_detail_risk: item.provisional_role === "detail",
  })),
  conflicts: [],
};
const summary = {
  schema_version: "sellerpilot.source_evidence_summary.v1", status: "complete",
  product_identity: { one_sentence: "Brown structured shoulder bag with fixed silhouette and visible hardware.", must_preserve: ["brown color", "silhouette", "hardware placement"] },
  physical_truth: { confirmed: ["shoulder strap is visible"], forbidden: ["do not invent closures"] },
  visible_text: { verified: [], uncertain: ["micro engraving unreadable"] },
  per_source_contributions: Object.fromEntries(manifest.sources.filter((item) => item.product_membership === "user_owned_product").map((item) => [item.source_id, `${item.provisional_role} evidence`])),
  reference_routing: {
    hero: [primaryRecord.source_id],
    detail: [sourceByRole(manifest, "detail").source_id, primaryRecord.source_id],
    side: [sourceByRole(manifest, "side").source_id, primaryRecord.source_id],
    generic: [primaryRecord.source_id],
  },
  unknowns: ["interior not shown"], prompt_constraints: ["preserve identity"], qa_focus: ["hardware", "silhouette"],
};
writeJson(path.join(runDir, "source-understanding", "source-reference-annotations.json"), annotations);
writeJson(path.join(runDir, "source-understanding", "source-evidence-summary.json"), summary);
writeJson(path.join(runDir, "source-understanding", "source-product-understanding.json"), {
  schema_version: "sellerpilot.source_product_understanding.v1", status: "complete",
  codex_visual_product_read: { status: "complete", product_identity_summary: "Brown structured shoulder bag.", observed_product_type: "shoulder bag", observed_components: ["body", "strap", "hardware"] },
  source_reads: manifest.sources.map((item) => ({ source_id: item.source_id, status: "complete", visual_summary: `${item.provisional_role} visual evidence`, observed_facts: item.evidence_tags, visible_text: { status: "reviewed_none_or_uncertain", items: [] }, uncertainty_notes: item.provisional_role === "detail" ? ["engraving unreadable"] : [] })),
});
const gate = runJson(["scripts/source-evidence-summary-gate.mjs", "--run-dir", runDir]);
assert(gate.status === "pass" && gate.compact_summary_bytes < 12 * 1024, "deep multi-source evidence must pass only with compact, complete source-ID coverage");

const nativeResolution = { schema_version: "sellerpilot.image_provider_resolution.v2", status: "ready", selected_mode: "native_codex", provider: { id: "codex-native-imagegen", execution: "system_imagegen_or_image_gen" } };
writeJson(path.join(runDir, "runtime", "image-provider-resolution.json"), nativeResolution);
const detailSelection = runJson(["scripts/select-source-references.mjs", "--run-dir", runDir, "--role", "IMG-02", "--prompt", "macro hardware zipper texture detail"]);
assert(detailSelection.selected_source_ids.length === 2 && detailSelection.selected_source_ids.includes(sourceByRole(manifest, "detail").source_id) && detailSelection.selected_source_ids.includes(primaryRecord.source_id), "detail generation must select detail plus identity reference, not every input");
assert(!detailSelection.selected_source_ids.includes(sourceByRole(manifest, "side").source_id) && !detailSelection.selected_source_ids.includes(sourceByRole(manifest, "competitor_reference").source_id), "irrelevant and competitor references must be excluded");
const heroSelection = runJson(["scripts/select-source-references.mjs", "--run-dir", runDir, "--role", "IMG-01", "--prompt", "hero main image"]);
assert(heroSelection.selected_source_ids.length === 1 && heroSelection.selected_source_ids[0] === primaryRecord.source_id, "hero generation should carry only the strongest primary identity source");

writeJson(path.join(runDir, "runtime", "image-provider-resolution.json"), { schema_version: "sellerpilot.image_provider_resolution.v2", status: "ready", selected_mode: "third_party_proxy", provider: { id: "nvidia-nim-flux-image-runtime", runtime: "nvidia_nim_flux", capabilities: { reference_images: { max_count: 2, max_per_image_bytes: 12 * 1024 * 1024, max_total_bytes: 20 * 1024 * 1024 } } } });
const nvidiaSelection = runJson(["scripts/select-source-references.mjs", "--run-dir", runDir, "--role", "IMG-02", "--prompt", "macro detail"]);
assert(nvidiaSelection.selected_source_ids.length === 1 && nvidiaSelection.selected_source_ids[0] === sourceByRole(manifest, "detail").source_id, "single-reference provider runtimes must be reduced to the strongest role-specific source");

const badSummary = { ...summary, reference_routing: { ...summary.reference_routing, hero: [sourceByRole(manifest, "competitor_reference").source_id] } };
writeJson(path.join(runDir, "source-understanding", "bad-source-evidence-summary.json"), badSummary);
const badGate = spawn(["scripts/source-evidence-summary-gate.mjs", "--run-dir", runDir, "--summary", "source-understanding/bad-source-evidence-summary.json"]);
assert(badGate.status !== 0 && /non-owned-source-routed-to-provider/.test(fs.readFileSync(path.join(runDir, "qa", "source-evidence-summary-gate-report.json"), "utf8")), "competitor references must fail closed when routed as owned product inputs");
const bloatedSummary = { ...summary, unknowns: ["x".repeat(13000)] };
writeJson(path.join(runDir, "source-understanding", "bloated-source-evidence-summary.json"), bloatedSummary);
const bloatedGate = spawn(["scripts/source-evidence-summary-gate.mjs", "--run-dir", runDir, "--summary", "source-understanding/bloated-source-evidence-summary.json"]);
assert(bloatedGate.status !== 0 && /summary-over-token-budget/.test(fs.readFileSync(path.join(runDir, "qa", "source-evidence-summary-gate-report.json"), "utf8")), "semantic evidence summary must enforce its token-oriented size budget");

const compiledRun = path.join(temp, "compiled-run");
run(["scripts/compile-production-plan.mjs", "--run-dir", compiledRun, "--platform", "Amazon", "--category", "bag", "--image-count", "2", ...[primary, detail, side].flatMap((file) => ["--source-image", file])]);
const compiled = readJson(path.join(compiledRun, "planning", "compiled-production-plan.json"));
const jobs = readJson(path.join(compiledRun, "orchestration", "generation-jobs.json"));
assert(jobs.jobs.every((job) => !Object.hasOwn(job, "source_images") && job.source_manifest && job.reference_policy.max_images === 2), "compiled generation jobs must reference selection evidence instead of duplicating every source path");
assert(isAncestor(compiled.tasks, "source-reference-preflight", "anchor-generation") && isAncestor(compiled.tasks, "source-evidence-summary-gate", "role-generation"), "reference preflight and compact-evidence gate must be provider-generation ancestors");
run(["scripts/resolve-image-provider.mjs", "--run-dir", compiledRun, "--provider", "native_codex"]);
run(["scripts/prepare-source-references.mjs", "--run-dir", compiledRun]);
const compiledManifest = readJson(path.join(compiledRun, "source-preflight", "reference-assets-manifest.json"));
const preparedFiles = compiledManifest.sources.slice(0, 2).map((item) => path.join(compiledRun, item.provider_path));
run(["scripts/create-native-imagegen-handoff.mjs", "--run-dir", compiledRun, "--role", "IMG-01", "--prompt", "two selected references", ...preparedFiles.flatMap((file) => ["--image", file])]);
const nativeHandoff = readJson(path.join(compiledRun, "generated-assets", "native-imagegen-handoff-img-01.json"));
assert(nativeHandoff.source_images.length === 2 && nativeHandoff.source_image === nativeHandoff.source_images[0], "native handoff must retain all selected references while preserving the first-image compatibility field");
const tooMany = spawn(["scripts/create-image-generation-dispatch.mjs", "--run-dir", compiledRun, "--role", "IMG-02", "--prompt", "must reject three references", ...compiledManifest.sources.slice(0, 3).flatMap((item) => ["--image", path.join(compiledRun, item.provider_path)])]);
assert(tooMany.status !== 0 && /allows at most 2/.test(tooMany.stderr), "dispatch must reject a reference set that bypasses the role-specific count limit");

const digestRun = path.join(temp, "digest-run");
const mutable = path.join(inputs, "mutable-source.jpg");
fs.copyFileSync(primary, mutable);
run(["scripts/normalize-production-task.mjs", "--run-dir", digestRun, "--platform", "Amazon", "--category", "bag", "--source-image", mutable]);
const firstDigest = readJson(path.join(digestRun, "planning", "normalized-task.json")).content_digest;
fs.appendFileSync(mutable, Buffer.from("content-change"));
run(["scripts/normalize-production-task.mjs", "--run-dir", digestRun, "--platform", "Amazon", "--category", "bag", "--source-image", mutable]);
const secondNormalized = readJson(path.join(digestRun, "planning", "normalized-task.json"));
assert(firstDigest !== secondNormalized.content_digest && secondNormalized.facts.source_image_fingerprints[0].sha256 === hashFile(mutable), "normalized task cache identity must change when image bytes change at the same path");

console.log(JSON.stringify({ status: "pass", checks, run_dir: runDir }, null, 2));

function sourceByRole(value, role) { const record = value.sources.find((item) => item.provisional_role === role); if (!record) throw new Error(`Missing fixture role ${role}`); return record; }
function isAncestor(tasks, ancestor, target, seen = new Set()) { if (ancestor === target) return true; if (seen.has(target)) return false; seen.add(target); const task = tasks.find((item) => item.id === target); return Boolean(task?.depends_on?.some((id) => id === ancestor || isAncestor(tasks, ancestor, id, new Set(seen)))); }
function run(argv) { const result = spawn(argv); if (result.status !== 0) throw new Error(result.stderr || result.stdout || `command failed: ${argv.join(" ")}`); return result; }
function runJson(argv) { const result = run(argv); return JSON.parse(result.stdout); }
function spawn(argv) { return spawnSync(process.execPath, argv.map((item) => path.isAbsolute(String(item)) || !String(item).startsWith("scripts/") ? String(item) : path.join(skillRoot, String(item))), { cwd: skillRoot, encoding: "utf8" }); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function hashFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function assert(condition, message) { checks += 1; if (!condition) throw new Error(message); }
