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
node scripts/reconcile-generation-progress.mjs --run-dir /abs/run \\
  [--manifest /abs/run/export/final-images-manifest.json] [--mode runtime-generated|external-import] [--from-child-progress]

Updates generated-assets/generation-progress.json from the current run-scoped
final-images manifest after export. This fixes stale progress evidence without
regenerating already-approved images. Use --from-child-progress before final
export when per-job progress-*.json files exist but the main progress file is
stale.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const progressPath = path.join(runDir, "generated-assets", "generation-progress.json");
const mode = String(args.mode || "runtime-generated");
const fromChildProgress = Boolean(args["from-child-progress"]);

if (fromChildProgress) {
  reconcileFromChildProgress();
  process.exit(0);
}

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Final images manifest not found: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const images = Array.isArray(manifest.images) ? manifest.images : [];
if (!images.length) {
  throw new Error("Final images manifest has no images to reconcile.");
}

const now = new Date().toISOString();
fs.mkdirSync(path.dirname(progressPath), { recursive: true });
const existing = fs.existsSync(progressPath) ? readJsonSafe(progressPath) : {};
const completed = images.map((item, index) => ({
  index: item.index || index + 1,
  file: path.basename(item.path || item.file || ""),
  path: item.path || path.join(manifest.image_dir || path.join(runDir, "final-images"), item.file || ""),
  reconciled_from_manifest: true,
}));

const progress = {
  schema_version: "sellerpilot.generation_progress.v1",
  ...existing,
  status: "final_exported",
  updated_at: now,
  mode: existing.mode || "quality_production",
  image_count: images.length,
  completed_images: completed,
  pending_images: [],
  failed_images: [],
  next_action: "run final localized/marketing/export checks, then final-delivery-gate",
  reconciled_from_manifest: true,
  reconciliation_mode: mode,
  reconciliation_source_manifest: manifestPath,
};

if (mode === "external-import") {
  progress.external_import_allowed = true;
  progress.manual_final_import = true;
  progress.final_asset_origin = "external/imported final images";
}

fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
console.log(JSON.stringify({
  status: "reconciled",
  runDir,
  manifest: manifestPath,
  progress: progressPath,
  completed_images: completed.length,
  mode,
}, null, 2));

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function reconcileFromChildProgress() {
  const now = new Date().toISOString();
  const existing = fs.existsSync(progressPath) ? readJsonSafe(progressPath) : {};
  const child = collectChildProgress(path.join(runDir, "generated-assets"));
  if (!child.length) throw new Error("No generated-assets/progress-*.json files found to reconcile.");
  const completed = [];
  const pending = [];
  const failed = [];
  const seenCompletedPaths = new Set();
  for (const item of child) {
    const status = normalize(item.status);
    const id = item.id;
    if (status === "completed") {
      const images = normalizeCompletedImages(item);
      if (images.length) {
        for (const image of images) {
          const key = image.path || image.file || id;
          if (seenCompletedPaths.has(key)) continue;
          seenCompletedPaths.add(key);
          completed.push({ id, ...image, reconciled_from_child_progress: true });
        }
      } else {
        completed.push({ id, reconciled_from_child_progress: true });
      }
    } else if (/generating|downloading|pending|running|prepared/.test(status)) {
      pending.push(id);
    } else if (status === "failed") {
      failed.push({
        id,
        code: item.runtime?.failure?.code || item.failure?.code || "generation_failed",
        reconciled_from_child_progress: true,
      });
    }
  }
  const expected = Number(existing.image_count || existing.expected_count || 0) || null;
  const status = pending.length
    ? "runtime_in_progress"
    : failed.length
      ? "partial_runtime_progress"
      : expected && completed.length >= expected
        ? "runtime_completed"
        : "runtime_progress_reconciled";
  const anchorDecision = readJsonSafe(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"));
  const progress = {
    schema_version: "sellerpilot.generation_progress.v1",
    ...existing,
    status,
    updated_at: now,
    mode: existing.mode || "quality_production",
    image_count: expected,
    completed_images: completed,
    pending_images: pending,
    failed_images: failed,
    next_action: failed.length || pending.length
      ? "review anchor batch decision and continue only failed or missing assets"
      : "run export gate, overview, tldraw, and final-delivery-gate",
    reconciled_from_child_progress: true,
    child_progress_files: child.map((item) => item.file),
    anchor_batch: anchorDecision?.qa_decision || anchorDecision?.status ? {
      qa_decision: anchorDecision.qa_decision || anchorDecision.status,
      source: path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"),
    } : existing.anchor_batch || null,
  };
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  console.log(JSON.stringify({
    status: "reconciled_from_child_progress",
    runDir,
    progress: progressPath,
    completed_images: completed.length,
    pending_images: pending.length,
    failed_images: failed.length,
  }, null, 2));
}

function collectChildProgress(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((item) => /^progress-.+\.json$/i.test(item))
    .sort()
    .map((item) => {
      const file = path.join(dir, item);
      const progressItem = readJsonSafe(file);
      if (!progressItem || !Object.keys(progressItem).length) return null;
      return {
        id: item.replace(/^progress-/i, "").replace(/\.json$/i, ""),
        file,
        ...progressItem,
      };
    })
    .filter(Boolean);
}

function normalizeCompletedImages(item) {
  const images = item.runtime?.completed_images || item.completed_images || [];
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => {
    if (typeof image === "string") {
      return {
        index: index + 1,
        file: path.basename(image),
        path: image,
      };
    }
    const imagePath = image.image_path || image.path || "";
    return {
      index: index + 1,
      file: path.basename(imagePath || image.file || ""),
      path: imagePath || image.path || "",
      actual_size: image.actual_size || null,
    };
  }).filter((image) => image.path || image.file);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
