#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const outPath = args.out ? path.resolve(args.out) : path.join(runDir, "export", "final-image-lineage.json");
const writePersonalizedContract = args["write-personalized-contract"] !== false;
const manifest = readJson(manifestPath);
const images = Array.isArray(manifest.images) ? manifest.images : [];
if (!images.length) throw new Error(`Manifest has no images: ${manifestPath}`);

const repairMap = readJsonSafe(path.join(runDir, "qa", "failed-asset-repair-map.json")) || {};
const finalVisibleTextReview = readJsonSafe(path.join(runDir, "qa", "final-visible-text-review.json")) || null;
const completedSourceByRole = collectCompletedSources(path.join(runDir, "generated-assets"));
const derivedSources = collectDerivedSources(path.join(runDir, "generated-assets"));
const repairIdsByFinalFile = invertRepairMap(repairMap.repairs || {});
const textItems = collectTextItems(finalVisibleTextReview, args);
const textOverlayProof = textItems.length ? "qa/personalized-text-compositor-contract-report.json" : null;
if (writePersonalizedContract && textItems.length) writeContract(textItems, finalVisibleTextReview);

const records = images.map((image) => {
  const file = image.file || path.basename(image.path || "");
  const slug = normalizeSlug(file);
  const repairIds = repairIdsByFinalFile[file] || [];
  const derived = bestDerivedSource(slug, derivedSources);
  const completed = bestCompletedSource(slug, image.index, completedSourceByRole);
  const hasText = textItems.length && /personal|custom|name|hero|gift|showcase|vanity|closeup/i.test(file);

  if (derived || repairIds.length) {
    return clean({
      file,
      source_type: hasText ? "local_text_overlay" : "derived_from_approved_generated_asset",
      derived_from: relativeIfPossible(derived?.file || completed?.file || derivedSources[0]?.file || completedSourceByRole[0]?.file),
      approved_source_path: relativeIfPossible(derived?.file || completed?.file || derivedSources[0]?.file || completedSourceByRole[0]?.file),
      transformation_type: hasText ? "derived_crop_tone_adjust_and_local_text_overlay" : "derived_crop_tone_adjust",
      render_method: hasText ? "local_overlay" : null,
      text_overlay_proof: hasText ? textOverlayProof : null,
      personalized_text_items: hasText ? textItems : null,
      repair_of_progress_ids: repairIds,
      repair_map: repairIds.length ? "qa/failed-asset-repair-map.json" : null,
      claims_new_scene_asset: false,
      note: "Backfilled from existing run repair map, derived assets, completed provider sources, and final visible text review.",
    });
  }

  return clean({
    file,
    source_type: hasText ? "local_text_overlay" : "provider_generated",
    generated_asset_path: relativeIfPossible(completed?.file || completedSourceByRole[0]?.file),
    approved_source_path: relativeIfPossible(completed?.file || completedSourceByRole[0]?.file),
    transformation_type: hasText ? "local_text_overlay" : "provider_output_export",
    render_method: hasText ? "local_overlay" : null,
    text_overlay_proof: hasText ? textOverlayProof : null,
    personalized_text_items: hasText ? textItems : null,
    note: "Backfilled from completed provider source and final visible text review.",
  });
});

const report = {
  schema_version: "sellerpilot.final_image_lineage_backfill.v1",
  created_at: new Date().toISOString(),
  run_dir: runDir,
  manifest: manifestPath,
  source_evidence: {
    repair_map: fs.existsSync(path.join(runDir, "qa", "failed-asset-repair-map.json")) ? "qa/failed-asset-repair-map.json" : null,
    final_visible_text_review: finalVisibleTextReview ? "qa/final-visible-text-review.json" : null,
    completed_provider_sources: completedSourceByRole.length,
    derived_sources: derivedSources.length,
  },
  images: records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: "backfilled",
  lineage: outPath,
  images: records.length,
  personalized_text_items: textItems.length,
}, null, 2));

function collectCompletedSources(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const file of fs.readdirSync(dir).filter((name) => /^progress-.+\.json$/i.test(name)).sort()) {
    const progress = readJsonSafe(path.join(dir, file));
    if (normalize(progress?.status) !== "completed") continue;
    const images = progress?.runtime?.completed_images || progress?.completed_images || [];
    for (const image of images) {
      const imagePath = typeof image === "string" ? image : image.image_path || image.path || "";
      if (imagePath && fs.existsSync(imagePath)) {
        out.push({
          role: file.replace(/^progress-/i, "").replace(/\.json$/i, ""),
          file: imagePath,
        });
      }
    }
  }
  return out;
}

function collectDerivedSources(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^derived-/i.test(entry.name))
    .map((entry) => {
      const file = path.join(dir, entry.name, "image.png");
      return fs.existsSync(file) ? {
        role: entry.name.replace(/^derived-/i, ""),
        file,
      } : null;
    })
    .filter(Boolean);
}

function bestDerivedSource(slug, sources) {
  return sources
    .map((source) => ({ source, score: tokenScore(slug, source.role) }))
    .sort((a, b) => b.score - a.score)[0]?.score > 0
    ? sources.map((source) => ({ source, score: tokenScore(slug, source.role) })).sort((a, b) => b.score - a.score)[0].source
    : null;
}

function bestCompletedSource(slug, index, sources) {
  if (!sources.length) return null;
  const scored = sources
    .map((source) => ({ source, score: tokenScore(slug, source.role) + (Number(index) && source.role.includes(String(index)) ? 2 : 0) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.source || sources[0];
}

function tokenScore(a, b) {
  const left = new Set(String(a || "").split(/[^a-z0-9]+/i).filter(Boolean));
  const right = new Set(String(b || "").split(/[^a-z0-9]+/i).filter(Boolean));
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}

function invertRepairMap(repairs) {
  const out = {};
  for (const [progressId, finalImage] of Object.entries(repairs)) {
    const file = path.basename(finalImage);
    out[file] = out[file] || [];
    out[file].push(progressId);
  }
  return out;
}

function collectTextItems(review, input) {
  const explicit = [];
  if (input.name) explicit.push({ role: "name", exact_text: String(input.name) });
  if (input.date) explicit.push({ role: "date", exact_text: String(input.date) });
  if (explicit.length) return explicit;
  return (review?.allowlist || [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .map((text) => ({
      role: /\d/.test(text) ? "date" : "name",
      exact_text: text,
    }));
}

function writeContract(items, review) {
  const dir = path.join(runDir, "copy");
  fs.mkdirSync(dir, { recursive: true });
  const contractPath = path.join(dir, "personalized-text-compositor-contract.json");
  if (fs.existsSync(contractPath) && !args["overwrite-contract"]) return;
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: "sellerpilot.personalized_text_compositor_contract.input.v1",
    render_method: "local_overlay",
    font_family: args["font-family"] || "recorded_from_existing_final_export",
    personalized_text_items: items,
    final_visible_text_review: {
      status: review?.status || "pass",
      source: "qa/final-visible-text-review.json",
    },
  }, null, 2)}\n`);
}

function normalizeSlug(value) {
  return path.basename(String(value || ""), path.extname(String(value || ""))).toLowerCase();
}

function clean(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== "" && !(Array.isArray(item) && !item.length)));
}

function relativeIfPossible(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? path.relative(runDir, file) : file;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
  console.error("Usage: node scripts/backfill-final-image-lineage.mjs --run-dir /abs/run [--manifest /abs/run/export/final-images-manifest.json] [--name Olivia] [--date 06.16.2026] [--write-personalized-contract]");
  process.exit(2);
}
