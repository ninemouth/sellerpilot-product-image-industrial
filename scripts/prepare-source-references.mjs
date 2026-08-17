#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { inferReferenceRole, evidenceTagsForRole, useTagsForRole } from "./lib/source-reference-policy.mjs";

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv);
if (args.help || !args["run-dir"]) usage();
const runDir = path.resolve(args["run-dir"]);
const normalizedPath = path.resolve(args["normalized-task"] || path.join(runDir, "planning", "normalized-task.json"));
const normalized = readJson(normalizedPath);
if (normalized?.schema_version !== "sellerpilot.normalized_production_task.v1") fail("normalized-task.json is missing or incompatible.");
const inputImages = Array.isArray(normalized?.facts?.source_images) ? normalized.facts.source_images.map((item) => path.resolve(item)) : [];
if (!inputImages.length) fail("No source images are recorded in normalized-task.json.");

const originalDir = path.join(runDir, "source-original");
const preparedDir = path.join(runDir, "source-prepared");
const reportDir = path.join(runDir, "source-preflight");
for (const dir of [originalDir, preparedDir, reportDir]) fs.mkdirSync(dir, { recursive: true });
const sharp = loadSharp();
const records = [];

for (let index = 0; index < inputImages.length; index += 1) {
  const input = inputImages[index];
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) fail(`Source image is missing or not a file: ${input}`);
  const sourceId = `SRC-${String(index + 1).padStart(2, "0")}`;
  const inputHash = hashFile(input);
  const inputBytes = fs.statSync(input).size;
  const ext = safeExtension(input);
  const original = path.join(originalDir, `${sourceId}-original${ext}`);
  materializeOriginal(input, original, inputHash);
  const role = inferReferenceRole(input);
  const membership = role === "competitor_reference" ? "competitor_reference" : "user_owned_product";
  const metadata = await inspectImage(original, sharp);
  const policy = compressionPolicy(role, args);
  const supported = ["jpeg", "jpg", "png", "webp"].includes(String(metadata.format || ext.slice(1)).toLowerCase());
  const maxSide = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
  const reasons = [];
  if (inputBytes > policy.maxBytes) reasons.push("file_size_over_limit");
  if (maxSide > policy.maxSide) reasons.push("dimensions_over_limit");
  if (!supported) reasons.push("provider_format_normalization");
  let provider = original;
  let decision = "reuse_original";
  let outputMetadata = metadata;
  if (reasons.length) {
    if (!sharp) fail(`Source ${sourceId} needs preparation (${reasons.join(", ")}) but the image preparation runtime is unavailable.`);
    const format = metadata.hasAlpha ? "png" : "jpg";
    provider = path.join(preparedDir, `${sourceId}-provider.${format}`);
    outputMetadata = await prepareForUpload({ sharp, input: original, output: provider, metadata, policy, format });
    decision = "prepared_derivative";
    if (fs.statSync(provider).size > policy.maxBytes) fail(`Source ${sourceId} could not be prepared below its safe upload limit without excessive quality loss.`);
  }
  const providerBytes = fs.statSync(provider).size;
  records.push({
    source_id: sourceId,
    product_membership: membership,
    provisional_role: role,
    evidence_tags: evidenceTagsForRole(role),
    use_for: useTagsForRole(role),
    original: {
      path: relativeRunPath(original), sha256: inputHash, bytes: inputBytes,
      width: metadata.width || null, height: metadata.height || null, format: metadata.format || ext.slice(1), has_alpha: Boolean(metadata.hasAlpha),
    },
    analysis_path: relativeRunPath(original),
    provider_path: relativeRunPath(provider),
    provider_variant: {
      decision, reasons, sha256: hashFile(provider), bytes: providerBytes,
      width: outputMetadata.width || null, height: outputMetadata.height || null, format: outputMetadata.format || path.extname(provider).slice(1),
      lossy: decision === "prepared_derivative" && path.extname(provider).toLowerCase() !== ".png",
      bytes_saved: Math.max(0, inputBytes - providerBytes), ratio: inputBytes ? Number((providerBytes / inputBytes).toFixed(4)) : null,
      policy,
    },
  });
}

const manifest = {
  schema_version: "sellerpilot.reference_assets_manifest.v1",
  status: "ready",
  created_at: new Date().toISOString(),
  run_id: normalized.run_id,
  policy: {
    analysis_uses_originals: true,
    provider_uses_prepared_variants: true,
    compression_is_conditional: true,
    originals_are_never_modified: true,
  },
  sources: records,
};
const index = {
  schema_version: "sellerpilot.source_reference_index.v1",
  status: "ready",
  source_count: records.length,
  source_ids: records.map((record) => record.source_id),
  sources: records.map((record) => ({
    source_id: record.source_id,
    product_membership: record.product_membership,
    provisional_role: record.provisional_role,
    evidence_tags: record.evidence_tags,
    analysis_path: record.analysis_path,
    image: { bytes: record.original.bytes, width: record.original.width, height: record.original.height, format: record.original.format },
  })),
};
const manifestPath = path.join(reportDir, "reference-assets-manifest.json");
const indexPath = path.join(reportDir, "source-reference-index.json");
writeJson(manifestPath, manifest);
writeJson(indexPath, index);
console.log(JSON.stringify({ status: "ready", source_count: records.length, prepared_count: records.filter((item) => item.provider_variant.decision === "prepared_derivative").length, manifest: manifestPath, index: indexPath }, null, 2));

async function inspectImage(file, sharpRuntime) {
  if (!sharpRuntime) return { width: null, height: null, format: path.extname(file).slice(1).toLowerCase(), hasAlpha: false };
  try { return await sharpRuntime(file, { failOn: "none" }).metadata(); }
  catch (error) { fail(`Unable to inspect source image ${file}: ${error.message}`); }
}

async function prepareForUpload({ sharp: sharpRuntime, input, output, metadata, policy, format }) {
  let side = Math.min(policy.maxSide, Math.max(Number(metadata.width || 0), Number(metadata.height || 0)) || policy.maxSide);
  let quality = policy.quality;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let pipeline = sharpRuntime(input, { failOn: "none" }).rotate().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" });
    pipeline = format === "png" ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }) : pipeline.jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true });
    await pipeline.toFile(output);
    const bytes = fs.statSync(output).size;
    if (bytes <= policy.targetBytes) return sharpRuntime(output).metadata();
    if (format !== "png" && quality > policy.minQuality) quality = Math.max(policy.minQuality, quality - 4);
    else side = Math.max(policy.minSide, Math.floor(side * 0.84));
  }
  return sharpRuntime(output).metadata();
}

function compressionPolicy(role, parsedArgs) {
  const fidelityCritical = ["detail", "logo", "surface_material"].includes(role);
  const mb = 1024 * 1024;
  const maxBytes = positiveInteger(parsedArgs[fidelityCritical ? "detail-max-bytes" : "max-bytes"]) || (fidelityCritical ? 12 * mb : 8 * mb);
  const targetBytes = positiveInteger(parsedArgs[fidelityCritical ? "detail-target-bytes" : "target-bytes"]) || (fidelityCritical ? 10 * mb : 6 * mb);
  return {
    class: fidelityCritical ? "fidelity_critical" : "standard_reference",
    maxBytes,
    targetBytes: Math.min(maxBytes, targetBytes),
    maxSide: positiveInteger(parsedArgs[fidelityCritical ? "detail-max-side" : "max-side"]) || (fidelityCritical ? 6144 : 4096),
    minSide: 2048,
    quality: fidelityCritical ? 94 : 92,
    minQuality: fidelityCritical ? 86 : 82,
  };
}

function materializeOriginal(input, output, expectedHash) {
  if (fs.existsSync(output) && hashFile(output) === expectedHash) return;
  try { fs.copyFileSync(input, output, fs.constants.COPYFILE_FICLONE); }
  catch { fs.copyFileSync(input, output); }
}
function loadSharp() {
  try { return require("sharp"); }
  catch {
    try { return require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp")); }
    catch { return null; }
  }
}
function hashFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function safeExtension(file) { const ext = path.extname(file).toLowerCase(); return /^\.(png|jpe?g|webp|gif|tiff?|avif|heic|heif)$/.test(ext) ? ext : ".img"; }
function relativeRunPath(file) { return path.relative(runDir, file).split(path.sep).join("/"); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`Unable to read ${file}: ${error.message}`); } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function positiveInteger(value) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : null; }
function parseArgs(argv) { const value = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) value[key] = true; else { value[key] = next; i += 1; } } return value; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/prepare-source-references.mjs --run-dir /abs/run [--normalized-task /abs/normalized-task.json] [--max-bytes N] [--target-bytes N] [--max-side N]"); process.exit(2); }
