#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outPath = args.out ? path.resolve(args.out) : path.join(runDir, "generated-assets", "asset-reuse-manifest.json");
const writeProgress = args["write-progress"] !== false;
const overwriteProgress = Boolean(args["overwrite-progress"]);
const repairMap = readJsonSafe(path.join(runDir, "qa", "failed-asset-repair-map.json")) || {};
const lineage = readJsonSafe(path.join(runDir, "export", "final-image-lineage.json")) || readJsonSafe(path.join(runDir, "qa", "final-image-lineage.json")) || {};
const manifest = readJsonSafe(path.join(runDir, "export", "final-images-manifest.json")) || {};
const records = collectReuseRecords();

const report = {
  schema_version: "sellerpilot.asset_reuse_manifest.v1",
  status: records.length ? "recorded" : "no_reuse_detected",
  created_at: new Date().toISOString(),
  run_dir: runDir,
  source_evidence: {
    repair_map: fs.existsSync(path.join(runDir, "qa", "failed-asset-repair-map.json")) ? "qa/failed-asset-repair-map.json" : null,
    final_image_lineage: fs.existsSync(path.join(runDir, "export", "final-image-lineage.json")) ? "export/final-image-lineage.json" : null,
    final_images_manifest: fs.existsSync(path.join(runDir, "export", "final-images-manifest.json")) ? "export/final-images-manifest.json" : null,
  },
  reuse_count: records.length,
  records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
let progressFiles = 0;
if (writeProgress) progressFiles = writeSyntheticProgress(records);

console.log(JSON.stringify({
  status: report.status,
  manifest: outPath,
  reuse_count: records.length,
  progress_files: progressFiles,
}, null, 2));

function collectReuseRecords() {
  const byAsset = new Map();
  const add = (assetPath, source) => {
    if (!assetPath) return;
    const current = resolveRunPath(assetPath);
    if (!current || !fs.existsSync(current)) return;
    const key = path.relative(runDir, current);
    const existing = byAsset.get(key) || {
      id: safeId(path.dirname(key).split(path.sep).pop() || path.basename(key, path.extname(key))),
      current_asset_path: key,
      original_source_path: null,
      reused_from_run: null,
      reuse_reason: repairMap.failure_review?.repair_strategy || repairMap.failure_review?.observed_issue || "approved_asset_reuse",
      approved_by: [],
      final_images: [],
      provider_timing_applicable: false,
    };
    existing.approved_by = unique([...existing.approved_by, source]);
    const summary = readJsonSafe(path.join(path.dirname(current), "summary.json"));
    const original = originalFromSummary(summary);
    if (original && path.resolve(original) !== path.resolve(current)) {
      existing.original_source_path = original;
      existing.reused_from_run = inferRunDir(original);
    }
    for (const finalImage of finalImagesForAsset(key)) {
      existing.final_images = unique([...existing.final_images, finalImage]);
    }
    byAsset.set(key, existing);
  };

  for (const asset of Array.isArray(repairMap.keep_assets) ? repairMap.keep_assets : []) {
    add(asset, "qa/failed-asset-repair-map.json");
  }

  for (const item of lineageRecords()) {
    for (const key of ["approved_source_path", "derived_from", "generated_asset_path"]) {
      if (item[key]) add(item[key], "export/final-image-lineage.json");
    }
  }

  const assetsDir = path.join(runDir, "generated-assets");
  if (fs.existsSync(assetsDir)) {
    for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const image = path.join(assetsDir, entry.name, "image.png");
      const summary = readJsonSafe(path.join(assetsDir, entry.name, "summary.json"));
      if (fs.existsSync(image) && originalFromSummary(summary)) add(image, "generated-assets/summary.json");
    }
  }

  return [...byAsset.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function lineageRecords() {
  const records = Array.isArray(lineage.images) ? lineage.images : Array.isArray(lineage.lineage) ? lineage.lineage : [];
  const manifestRecords = Array.isArray(manifest.images) ? manifest.images.map((item) => ({ file: item.file, ...(item.lineage || {}) })) : [];
  return [...records, ...manifestRecords];
}

function finalImagesForAsset(assetRel) {
  const out = [];
  for (const item of lineageRecords()) {
    const refs = [item.approved_source_path, item.derived_from, item.generated_asset_path]
      .filter(Boolean)
      .map((value) => path.normalize(path.isAbsolute(value) ? path.relative(runDir, value) : value));
    if (refs.includes(path.normalize(assetRel))) out.push(path.basename(item.file || item.path || item.final_image || ""));
  }
  for (const finalImage of Object.values(repairMap.repairs || {})) {
    if (finalImage) out.push(path.basename(finalImage));
  }
  return out.filter(Boolean);
}

function originalFromSummary(summary) {
  const imagePath = summary?.images?.[0]?.image_path || summary?.image_path || null;
  const outputDir = summary?.output_dir || null;
  const candidate = imagePath || (outputDir ? path.join(outputDir, "image.png") : null);
  if (!candidate || !path.isAbsolute(candidate)) return null;
  return path.resolve(candidate).startsWith(`${runDir}${path.sep}`) ? null : candidate;
}

function inferRunDir(file) {
  const marker = `${path.sep}generated-assets${path.sep}`;
  const index = String(file || "").indexOf(marker);
  return index > 0 ? String(file).slice(0, index) : null;
}

function writeSyntheticProgress(items) {
  const dir = path.join(runDir, "generated-assets");
  fs.mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const item of items) {
    const file = path.join(dir, `progress-reused-${item.id}.json`);
    if (fs.existsSync(file) && !overwriteProgress) continue;
    fs.writeFileSync(file, `${JSON.stringify({
      schema_version: "sellerpilot.synthetic_progress.asset_reuse.v1",
      id: `reused-${item.id}`,
      status: "reused_approved_asset",
      source_type: "asset_reuse",
      provider_timing_applicable: false,
      updated_at: new Date().toISOString(),
      current_asset_path: item.current_asset_path,
      original_source_path: item.original_source_path,
      reused_from_run: item.reused_from_run,
      approved_by: item.approved_by,
      final_images: item.final_images,
      runtime: {
        completed_images: [{
          image_path: path.join(runDir, item.current_asset_path),
          reused_approved_asset: true,
        }],
      },
    }, null, 2)}\n`);
    count += 1;
  }
  return count;
}

function resolveRunPath(value) {
  if (!value) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(runDir, value);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function safeId(value) {
  return String(value || "asset").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
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
  console.error("Usage: node scripts/record-asset-reuse.mjs --run-dir /abs/run [--out /abs/run/generated-assets/asset-reuse-manifest.json] [--write-progress] [--overwrite-progress]");
  process.exit(2);
}
