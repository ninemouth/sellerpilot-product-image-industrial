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
  [--manifest /abs/run/export/final-images-manifest.json] [--mode runtime-generated|external-import]

Updates generated-assets/generation-progress.json from the current run-scoped
final-images manifest after export. This fixes stale progress evidence without
regenerating already-approved images.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const progressPath = path.join(runDir, "generated-assets", "generation-progress.json");
const mode = String(args.mode || "runtime-generated");

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
