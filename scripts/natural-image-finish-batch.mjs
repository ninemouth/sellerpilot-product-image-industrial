#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runDir = path.resolve(args["run-dir"]);
const finalDir = path.join(runDir, "final-images");
const exportDir = path.join(runDir, "export");
const qaDir = path.join(runDir, "qa");
const backupDir = path.join(runDir, "generated-assets", "natural-finish-originals");
const stagingDir = path.join(runDir, "generated-assets", "natural-finish-staging");
const manifestPath = path.resolve(args.manifest || path.join(exportDir, "final-images-manifest.json"));
const panelsPath = resolvePanelsPath();
const batchReportPath = path.join(qaDir, "natural-image-finish-batch-report.json");
const gateReportPath = path.join(qaDir, "natural-image-finish-gate-report.json");
const visibleTextReviewPath = path.join(qaDir, "post-natural-finish-visible-text-review.json");
const lineagePath = path.join(exportDir, "final-image-lineage.json");
const runtimeRoot = path.resolve(args["runtime-root"] || path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sellerpilot-product-image-industrial", "natural-image-runtime"));

if (!fs.existsSync(finalDir)) fail("final_images_missing", "Current run final-images directory does not exist.");

const manifest = readJson(manifestPath);
const panels = readPanels(panelsPath);
const priorLineage = readLineage(lineagePath, manifest);
const preparation = runJson(process.execPath, [
  path.join(skillRoot, "scripts", "prepare-natural-image-runtime.mjs"),
  "--check",
  "--runtime-root", runtimeRoot,
  "--skill-root", skillRoot,
  "--include-diagnostics",
], true);
if (!preparation?.ready) fail("natural_image_runtime_not_prepared", "Natural image runtime is not prepared.");

const runtimePython = preparation.diagnostics?.runtime_python;
const ffmpeg = preparation.diagnostics?.ffmpeg;
if (!runtimePython || !ffmpeg) fail("runtime_diagnostics_incomplete", "Prepared runtime diagnostics are incomplete.");

const images = collectImages(manifest);
if (!images.length) fail("no_generated_images", "No generated images were found in the current run final-images scope.");

if (!args.force && alreadyApplied(images, manifest, readJson(batchReportPath))) {
  initializeVisibleTextReview();
  console.log(JSON.stringify({
    status: "already_applied",
    image_count: images.length,
    batch_report: batchReportPath,
    user_message: "Adaptive natural finish is already applied to every current final image.",
  }, null, 2));
  process.exit(0);
}

const jobs = images.map((image, index) => createJob(image, index));
if (args["dry-run"]) {
  const planned = jobs.map((job) => {
    const inspection = runJson(runtimePython, [
      path.join(skillRoot, "scripts", "natural-image-finish.py"),
      job.source,
      "--inspect",
      "--profile", "auto",
      "--role-hint", job.roleHint,
      "--contains-visible-text", job.visibleTextHint,
      "--ffmpeg", ffmpeg,
    ]);
    return {
      file: job.file,
      role_hint: job.roleHint,
      metadata_visible_text: job.visibleTextHint,
      recognition: inspection.recognition,
    };
  });
  console.log(JSON.stringify({
    schema_version: "sellerpilot.natural_image_finish_batch_plan.v1",
    status: "planned",
    image_count: jobs.length,
    jobs: planned,
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(backupDir, { recursive: true });
fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
fs.mkdirSync(qaDir, { recursive: true });
fs.mkdirSync(exportDir, { recursive: true });

const backupManifest = prepareBackups(jobs);
const processed = [];
try {
  for (const job of jobs) {
    const source = path.join(backupDir, job.file);
    const staged = path.join(stagingDir, job.file);
    const proofPath = path.join(qaDir, `natural-image-finish-${safeSlug(path.basename(job.file, path.extname(job.file)))}.json`);
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    const commandArgs = [
      path.join(skillRoot, "scripts", "natural-image-finish.py"),
      source,
      "--output", staged,
      "--profile", "auto",
      "--role-hint", job.roleHint,
      "--contains-visible-text", job.visibleTextHint,
      "--allow-alpha",
      "--ffmpeg", ffmpeg,
      "--report", proofPath,
    ];
    if (job.visibleTextHint === "true") commandArgs.push("--preserve-text");
    const result = spawnSync(runtimePython, commandArgs, {
      cwd: skillRoot,
      encoding: "utf8",
      maxBuffer: 30 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`Adaptive natural finish failed for ${job.file}.`);
    }
    const proof = readJsonRequired(proofPath);
    if (proof.status !== "pass" || !fs.existsSync(staged)) {
      throw new Error(`Adaptive natural finish proof is incomplete for ${job.file}.`);
    }
    if (proof.width !== job.width || proof.height !== job.height) {
      throw new Error(`Adaptive natural finish changed dimensions for ${job.file}.`);
    }
    const abReview = proof.protection?.camera_photoshop_realism?.naturalness_ab_review;
    if (!abReview || !["pass", "warn"].includes(String(abReview.status || "").toLowerCase())) {
      throw new Error(`Adaptive natural finish A/B naturalness review blocked ${job.file}.`);
    }
    processed.push({
      ...job,
      source,
      staged,
      proofPath,
      proof,
    });
  }
} catch (error) {
  writeBatchFailure(error, processed, jobs);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  console.error(JSON.stringify({
    status: "blocked",
    reason: "adaptive_natural_finish_batch_failed",
    preserved_final_images: true,
    processed_before_failure: processed.length,
    image_count: jobs.length,
  }, null, 2));
  process.exit(1);
}

try {
  promoteBatch(processed);
} catch (error) {
  writeBatchFailure(error, processed, jobs);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  console.error(JSON.stringify({
    status: "blocked",
    reason: "adaptive_natural_finish_batch_promotion_failed",
    preserved_final_images: true,
    processed_count: processed.length,
    image_count: jobs.length,
  }, null, 2));
  process.exit(1);
}
const lineageRecords = processed.map((item) => buildLineage(item, priorLineage[item.file] || {}));
writeJson(lineagePath, {
  schema_version: "sellerpilot.final_image_lineage.v1",
  updated_at: new Date().toISOString(),
  batch_transformation: "adaptive_natural_image_finish_all_generated_images",
  images: lineageRecords,
});

const assets = processed.map((item) => {
  const finalPath = path.join(finalDir, item.file);
  const proof = readJsonRequired(item.proofPath);
  proof.output = finalPath;
  proof.promoted_from = relativeRunPath(item.staged);
  proof.output_sha256 = sha256File(finalPath);
  writeJson(item.proofPath, proof);
  return {
    file: item.file,
    role: item.roleHint,
    status: "pass",
    input: relativeRunPath(item.source),
    output: relativeRunPath(finalPath),
    input_sha256: proof.input_sha256,
    output_sha256: proof.output_sha256,
    selected_profile: proof.selected_profile,
    recognition: proof.recognition,
    naturalness_ab_review: proof.protection?.camera_photoshop_realism?.naturalness_ab_review || null,
    contains_visible_text: proof.recognition?.contains_visible_text === true,
    text_protection_applied: proof.protection?.text_protection_applied === true,
    alpha_preserved: proof.protection?.alpha_preserved === true,
    approved_source: true,
    proof: relativeRunPath(item.proofPath),
  };
});
const naturalnessAb = summarizeNaturalnessAbReviews(assets);

writeJson(gateReportPath, {
  schema_version: "sellerpilot.natural_image_finish_gate.v2",
  gate_id: "natural-image-finish-gate",
  status: "pass",
  checked_at: new Date().toISOString(),
  policy: {
    coverage: "all_current_run_generated_final_images",
    adaptive_classification_required: true,
    visible_text_policy: "detect_and_restore_text_region_pixels",
    alpha_policy: "preserve_original_alpha_channel",
    transaction_policy: "stage_all_then_promote_or_preserve_original_set",
  },
  image_count: images.length,
  processed_count: assets.length,
  all_final_images_processed: assets.length === images.length,
  camera_photoshop_naturalness_ab: naturalnessAb,
  assets,
  findings: [],
});

const profileCounts = countBy(assets, (item) => item.selected_profile || "unknown");
writeJson(batchReportPath, {
  schema_version: "sellerpilot.natural_image_finish_batch.v1",
  gate_id: "natural-image-finish-batch",
  status: "pass",
  completed_at: new Date().toISOString(),
  run_dir: runDir,
  image_count: images.length,
  processed_count: assets.length,
  all_final_images_processed: assets.length === images.length,
  profile_counts: profileCounts,
  camera_photoshop_naturalness_ab: naturalnessAb,
  original_backup_manifest: relativeRunPath(path.join(backupDir, "backup-manifest.json")),
  final_image_hashes: Object.fromEntries(assets.map((item) => [item.file, item.output_sha256])),
  assets,
  rollback_available: true,
  findings: [],
});

updateManifest(manifest, assets, lineageRecords);
initializeVisibleTextReview();
fs.rmSync(stagingDir, { recursive: true, force: true });

const lineageGate = spawnSync(process.execPath, [
  path.join(skillRoot, "scripts", "final-image-lineage-gate.mjs"),
  "--run-dir", runDir,
  "--manifest", manifestPath,
], { cwd: skillRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (lineageGate.status !== 0) {
  console.error(lineageGate.stderr || lineageGate.stdout);
  process.exit(1);
}

console.log(JSON.stringify({
  status: "pass",
  image_count: images.length,
  processed_count: assets.length,
  all_final_images_processed: true,
  profile_counts: profileCounts,
  camera_photoshop_naturalness_ab: naturalnessAb,
  batch_report: batchReportPath,
  gate_report: gateReportPath,
  visible_text_review: visibleTextReviewPath,
  manifest: manifestPath,
  user_message: "Every generated final image received an adaptive natural finish.",
}, null, 2));

function collectImages(existingManifest) {
  const entries = Array.isArray(existingManifest?.images)
    ? existingManifest.images
    : fs.readdirSync(finalDir)
        .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
        .sort()
        .map((file, index) => ({ file, id: inferId(file, index) }));
  return entries.map((entry, index) => {
    const file = path.basename(entry.file || entry.path || "");
    const imagePath = path.resolve(entry.path || path.join(finalDir, file));
    if (!file || path.dirname(imagePath) !== path.resolve(finalDir) || !fs.existsSync(imagePath)) {
      fail("invalid_final_image_scope", `Final image entry ${file || index} is outside the current run or missing.`);
    }
    const dimensions = imageDimensions(imagePath);
    return {
      ...entry,
      id: entry.id || inferId(file, index),
      file,
      path: imagePath,
      width: dimensions.width,
      height: dimensions.height,
    };
  });
}

function createJob(image, index) {
  const panel = matchPanel(image, index);
  const roleHint = [
    image.role,
    image.image_role,
    image.title,
    image.id,
    image.file,
    panel?.image_role,
    panel?.role,
    panel?.title,
    panel?.scene,
    panel?.usage_context,
  ].filter(Boolean).join(" | ");
  const previous = priorLineage[image.file] || image.lineage || {};
  const visibleText = hasVisibleText(panel)
    || /text_overlay|personalized/.test(normalize(previous.source_type))
    || Array.isArray(previous.personalized_text_items);
  return {
    ...image,
    index,
    source: image.path,
    roleHint,
    visibleTextHint: visibleText ? "true" : "auto",
  };
}

function prepareBackups(items) {
  const existing = readJson(path.join(backupDir, "backup-manifest.json"));
  const records = [];
  for (const job of items) {
    const backup = path.join(backupDir, job.file);
    const existingRecord = existing?.images?.find((item) => item.file === job.file);
    if (!fs.existsSync(backup) || !existingRecord || sha256File(backup) !== existingRecord.sha256) {
      fs.copyFileSync(job.path, backup);
    }
    records.push({
      file: job.file,
      path: relativeRunPath(backup),
      sha256: sha256File(backup),
      original_final_path: relativeRunPath(job.path),
    });
  }
  const value = {
    schema_version: "sellerpilot.natural_image_finish_backup.v1",
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    run_dir: runDir,
    image_count: records.length,
    images: records,
  };
  writeJson(path.join(backupDir, "backup-manifest.json"), value);
  return value;
}

function promoteBatch(items) {
  const promoted = [];
  try {
    for (const item of items) {
      const finalPath = path.join(finalDir, item.file);
      const temporary = `${finalPath}.natural-finish-${process.pid}.tmp${path.extname(finalPath)}`;
      fs.copyFileSync(item.staged, temporary);
      fs.renameSync(temporary, finalPath);
      promoted.push(item.file);
    }
  } catch (error) {
    for (const item of items) {
      const backup = path.join(backupDir, item.file);
      if (fs.existsSync(backup)) fs.copyFileSync(backup, path.join(finalDir, item.file));
    }
    throw new Error(`Batch promotion failed and originals were restored: ${error.message}`);
  }
  return promoted;
}

function buildLineage(item, previous) {
  const proof = item.proof;
  const previousSourceType = previous.source_type || "unknown";
  const keepTextOverlayType = /text_overlay|personalized/.test(normalize(previousSourceType));
  const record = {
    file: item.file,
    source_type: keepTextOverlayType ? previousSourceType : "derived_from_approved_generated_asset",
    derived_from: relativeRunPath(item.source),
    approved_source_path: relativeRunPath(item.source),
    transformation_type: "natural_image_finish",
    upstream_source_type: previousSourceType,
    upstream_transformation_type: previous.transformation_type || null,
    render_method: keepTextOverlayType ? (previous.render_method || "local_overlay") : "local_adaptive_batch_finish",
    natural_finish_proof: relativeRunPath(item.proofPath),
    natural_finish_batch_proof: "qa/natural-image-finish-batch-report.json",
    adaptive_profile: proof.selected_profile,
    contains_visible_text: proof.recognition?.contains_visible_text === true,
    text_protection_applied: proof.protection?.text_protection_applied === true,
    alpha_preserved: proof.protection?.alpha_preserved === true,
    output_sha256: proof.output_sha256,
    claims_new_scene_asset: false,
    requires_identity_review: true,
    note: "Adaptive natural finish applied in the all-generated-images transactional batch.",
  };
  for (const key of ["text_overlay_proof", "personalized_text_items", "repair_of_progress_ids", "repair_map"]) {
    if (previous[key] != null) record[key] = previous[key];
  }
  return record;
}

function updateManifest(existingManifest, assets, lineageRecords) {
  const lineageByFile = Object.fromEntries(lineageRecords.map((item) => [item.file, item]));
  const previousByFile = Object.fromEntries((existingManifest?.images || []).map((item) => [path.basename(item.file || item.path || ""), item]));
  const imagesOut = assets.map((asset, index) => {
    const previous = previousByFile[asset.file] || {};
    const finalPath = path.join(finalDir, asset.file);
    return {
      ...previous,
      index: previous.index || index + 1,
      id: previous.id || inferId(asset.file, index),
      file: asset.file,
      path: finalPath,
      sha256: sha256File(finalPath),
      lineage: lineageByFile[asset.file],
    };
  });
  writeJson(manifestPath, {
    schema_version: existingManifest?.schema_version || "sellerpilot.final_images_manifest.v1",
    ...existingManifest,
    updated_at: new Date().toISOString(),
    run_id: existingManifest?.run_id || path.basename(runDir),
    run_dir: runDir,
    image_dir: finalDir,
    image_count: imagesOut.length,
    images: imagesOut,
  });
}

function alreadyApplied(currentImages, existingManifest, batchReport) {
  if (batchReport?.status !== "pass" || batchReport?.all_final_images_processed !== true) return false;
  if (batchReport.image_count !== currentImages.length) return false;
  const manifestImages = Array.isArray(existingManifest?.images) ? existingManifest.images : [];
  return currentImages.every((image) => {
    const manifestImage = manifestImages.find((item) => path.basename(item.file || item.path || "") === image.file);
    return manifestImage?.lineage?.transformation_type === "natural_image_finish"
      && batchReport.final_image_hashes?.[image.file] === sha256File(image.path);
  });
}

function initializeVisibleTextReview() {
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, "scripts", "post-natural-finish-visible-text-review.mjs"),
    "--run-dir", runDir,
    "--manifest", manifestPath,
    "--batch", batchReportPath,
    "--initialize",
  ], { cwd: skillRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error("Post-finish visible-text review initialization failed.");
  }
}

function readPanels(file) {
  const value = readJson(file);
  if (Array.isArray(value)) return value;
  for (const key of ["panels", "images", "items", "shots"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function matchPanel(image, index) {
  return panels.find((panel) => {
    const file = path.basename(panel.file || panel.image_file || panel.output || panel.path || "");
    const id = String(panel.id || panel.image_id || panel.stable_id || "");
    return (file && file === image.file) || (id && id === String(image.id));
  }) || panels[index] || null;
}

function hasVisibleText(panel) {
  if (!panel) return false;
  const values = [];
  for (const key of [
    "visible_copy", "headline", "subtitle", "copy", "title_text", "body_copy",
    "selling_points", "labels", "localized_copy", "personalized_text_items",
  ]) {
    if (panel[key] != null) values.push(panel[key]);
  }
  return values.some((value) => {
    if (Array.isArray(value)) return value.some((item) => String(item?.text || item || "").trim());
    if (typeof value === "object") return JSON.stringify(value).replace(/[{}\[\]":,]/g, "").trim().length > 0;
    return String(value || "").trim().length > 0;
  });
}

function readLineage(file, existingManifest) {
  const byFile = {};
  const lineage = readJson(file);
  for (const item of lineage?.images || []) {
    const key = path.basename(item.file || item.path || "");
    if (key) byFile[key] = item;
  }
  for (const item of existingManifest?.images || []) {
    const key = path.basename(item.file || item.path || "");
    if (key && item.lineage) byFile[key] = item.lineage;
  }
  return byFile;
}

function imageDimensions(file) {
  const inspection = runJson(runtimePython, [
    path.join(skillRoot, "scripts", "natural-image-finish.py"),
    file,
    "--inspect",
    "--ffmpeg", ffmpeg,
  ]);
  if (!inspection?.recognition?.width || !inspection?.recognition?.height) {
    throw new Error(`Could not read image dimensions for ${path.basename(file)}.`);
  }
  return inspection.recognition;
}

function resolvePanelsPath() {
  if (args.panels) return path.resolve(args.panels);
  for (const candidate of [
    path.join(runDir, "blueprint", "panels.json"),
    path.join(runDir, "panels.json"),
    path.join(runDir, "blueprint", "quality-production-blueprint.json"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(runDir, "blueprint", "panels.json");
}

function writeBatchFailure(error, completed, allJobs) {
  fs.mkdirSync(qaDir, { recursive: true });
  writeJson(batchReportPath, {
    schema_version: "sellerpilot.natural_image_finish_batch.v1",
    gate_id: "natural-image-finish-batch",
    status: "blocked",
    checked_at: new Date().toISOString(),
    image_count: allJobs.length,
    processed_count: completed.length,
    all_final_images_processed: false,
    preserved_final_images: true,
    reason: "adaptive_natural_finish_batch_failed",
    diagnostic: error.message,
    findings: [{ severity: "fail", type: "adaptive-natural-finish-batch-incomplete" }],
  });
}

function countBy(items, selector) {
  const result = {};
  for (const item of items) {
    const key = selector(item);
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

function summarizeNaturalnessAbReviews(items) {
  const assetReviews = items.map((item) => {
    const review = item.naturalness_ab_review || {};
    return {
      file: item.file,
      status: String(review.status || "missing"),
      score: Number.isFinite(Number(review.score)) ? Number(review.score) : null,
      selected_profile: item.selected_profile || null,
      visual_state: item.recognition?.visual_state?.primary || null,
      warnings: Array.isArray(review.warnings) ? review.warnings : [],
      blockers: Array.isArray(review.blockers) ? review.blockers : [],
      policy: review.policy || null,
    };
  });
  const scores = assetReviews
    .map((item) => item.score)
    .filter((score) => Number.isFinite(score));
  const blockedCount = assetReviews.filter((item) => item.status === "blocked" || item.blockers.length).length;
  const warnCount = assetReviews.filter((item) => item.status === "warn" || item.warnings.length).length;
  const missingCount = assetReviews.filter((item) => item.status === "missing").length;
  const status = blockedCount || missingCount
    ? "blocked"
    : (warnCount ? "pass_with_warnings" : "pass");
  return {
    schema_version: "sellerpilot.camera_photoshop_naturalness_ab.v1",
    status,
    average_score: scores.length ? round2(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    min_score: scores.length ? round2(Math.min(...scores)) : null,
    warn_count: warnCount,
    blocked_count: blockedCount,
    missing_count: missingCount,
    asset_reviews: assetReviews,
    policy: "perceptual_camera_photoshop_quality_not_detector_targeting",
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function relativeRunPath(file) {
  const relative = path.relative(runDir, path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : path.resolve(file);
}

function inferId(file, index) {
  return path.basename(file).match(/^(IMG|POSTER|DETAIL)-\d+/i)?.[0]?.toUpperCase() || `IMG-${String(index + 1).padStart(2, "0")}`;
}

function safeSlug(value) {
  return String(value || "asset").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readJsonRequired(file) {
  const value = readJson(file);
  if (!value) throw new Error(`Required JSON is missing or invalid: ${path.basename(file)}`);
  return value;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function runJson(command, commandArgs, allowFailure = false) {
  const result = spawnSync(command, commandArgs, { cwd: skillRoot, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new Error(`${path.basename(command)} failed.`);
  try { return JSON.parse(result.stdout.trim()); } catch { return null; }
}

function fail(type, message) {
  console.error(JSON.stringify({ status: "blocked", reason: type, user_message: message }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; i += 1; }
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
node scripts/natural-image-finish-batch.mjs \\
  --run-dir /abs/run \\
  [--manifest /abs/run/export/final-images-manifest.json] \\
  [--panels /abs/run/blueprint/panels.json] \\
  [--dry-run] [--force]`);
  process.exit(2);
}
