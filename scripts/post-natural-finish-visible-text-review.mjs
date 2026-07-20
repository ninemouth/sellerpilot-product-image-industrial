#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = path.join(runDir, "qa");
const manifestPath = path.resolve(args.manifest || path.join(runDir, "export", "final-images-manifest.json"));
const batchPath = path.resolve(args.batch || path.join(qaDir, "natural-image-finish-batch-report.json"));
const evidencePath = args.evidence ? path.resolve(args.evidence) : null;
const outPath = path.resolve(args.out || path.join(qaDir, "post-natural-finish-visible-text-review.json"));

const manifest = readJsonRequired(manifestPath, "final images manifest");
const batch = readJsonRequired(batchPath, "natural image finish batch report");
if (batch.status !== "pass" || batch.all_final_images_processed !== true) {
  fail("natural_finish_batch_not_passed", "The adaptive natural finish batch must pass before text regression review.");
}

const manifestImages = Array.isArray(manifest.images) ? manifest.images : [];
const batchAssets = Array.isArray(batch.assets) ? batch.assets : [];
const manifestByFile = new Map(manifestImages.map((item) => [basename(item.file || item.path), item]));
const visibleAssets = batchAssets.filter((item) => item.contains_visible_text === true);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (!visibleAssets.length) {
  const report = {
    schema_version: "sellerpilot.post_natural_finish_visible_text_review.v1",
    gate_id: "post-natural-finish-visible-text-review",
    status: "not_required",
    checked_at: new Date().toISOString(),
    reason: "batch_contains_no_visible_text_assets",
    batch_report: relativeRunPath(batchPath),
    manifest: relativeRunPath(manifestPath),
    visible_text_image_count: 0,
    images: [],
    findings: [],
  };
  writeJson(outPath, report);
  print(report);
  process.exit(0);
}

if (args.initialize && !evidencePath) {
  const existing = readJson(outPath);
  if (existingReviewStillMatches(existing)) {
    print(existing);
    process.exit(0);
  }
  const report = {
    schema_version: "sellerpilot.post_natural_finish_visible_text_review.v1",
    gate_id: "post-natural-finish-visible-text-review",
    status: "needs_visual_review",
    checked_at: new Date().toISOString(),
    reason: "visible_text_assets_require_post_finish_raster_review",
    batch_report: relativeRunPath(batchPath),
    manifest: relativeRunPath(manifestPath),
    visible_text_image_count: visibleAssets.length,
    required_files: visibleAssets.map((item) => item.file),
    images: visibleAssets.map((item) => ({
      file: item.file,
      status: "needs_visual_review",
      current_sha256: currentImageHash(manifestByFile.get(item.file), item.file),
    })),
    findings: [{ severity: "review", type: "post-finish-visible-text-review-required" }],
  };
  writeJson(outPath, report);
  print(report);
  process.exit(0);
}

if (!evidencePath) {
  fail("review_evidence_required", "Visible-text assets require structured post-finish visual review evidence.");
}

const evidence = readJsonRequired(evidencePath, "visible text review evidence");
const reviewerMethod = String(evidence.reviewer_method || evidence.method || "").trim();
const evidenceImages = Array.isArray(evidence.images) ? evidence.images : [];
const findings = [];
const reviewedImages = [];

if (!reviewerMethod) {
  findings.push({ severity: "fail", type: "reviewer-method-missing" });
}

for (const asset of visibleAssets) {
  const currentSha256 = currentImageHash(manifestByFile.get(asset.file), asset.file);
  const reviewed = evidenceImages.find((item) => basename(item.file) === asset.file);
  const reviewedSha256 = String(reviewed?.reviewed_sha256 || reviewed?.sha256 || "").trim().toLowerCase();
  const status = normalize(reviewed?.status);
  if (!reviewed) {
    findings.push({ severity: "fail", type: "visible-text-image-unreviewed", file: asset.file });
  } else if (status !== "pass") {
    findings.push({ severity: "fail", type: "visible-text-image-review-failed", file: asset.file });
  } else if (!reviewedSha256 || reviewedSha256 !== currentSha256) {
    findings.push({ severity: "fail", type: "visible-text-image-review-hash-mismatch", file: asset.file });
  }
  reviewedImages.push({
    file: asset.file,
    status: status || "missing",
    reviewed_sha256: reviewedSha256 || null,
    current_sha256: currentSha256,
    notes: reviewed?.notes || null,
  });
}

const report = {
  schema_version: "sellerpilot.post_natural_finish_visible_text_review.v1",
  gate_id: "post-natural-finish-visible-text-review",
  status: findings.some((item) => item.severity === "fail") ? "fail" : "pass",
  checked_at: new Date().toISOString(),
  reviewer_method: reviewerMethod || null,
  reviewer: evidence.reviewer || null,
  batch_report: relativeRunPath(batchPath),
  manifest: relativeRunPath(manifestPath),
  evidence: relativeRunPath(evidencePath),
  visible_text_image_count: visibleAssets.length,
  images: reviewedImages,
  findings,
};
writeJson(outPath, report);
print(report);
if (report.status !== "pass") process.exitCode = 1;

function currentImageHash(image, file) {
  const imagePath = path.resolve(image?.path || path.join(runDir, "final-images", file));
  if (!isInsideRun(imagePath) || !fs.existsSync(imagePath)) {
    throw new Error(`Current final image is missing or outside this run: ${file}`);
  }
  return sha256File(imagePath);
}

function existingReviewStillMatches(existing) {
  if (existing?.status !== "pass" || !String(existing.reviewer_method || "").trim()) return false;
  const reviewed = new Map((existing.images || []).map((item) => [basename(item.file), item]));
  return visibleAssets.every((asset) => {
    const item = reviewed.get(asset.file);
    return normalize(item?.status) === "pass"
      && String(item?.reviewed_sha256 || "").toLowerCase() === currentImageHash(manifestByFile.get(asset.file), asset.file);
  });
}

function isInsideRun(file) {
  const relative = path.relative(runDir, path.resolve(file));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function relativeRunPath(file) {
  const relative = path.relative(runDir, path.resolve(file));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : path.resolve(file);
}

function basename(value) {
  return path.basename(String(value || ""));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function readJsonRequired(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Required ${label} is missing or invalid.`);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function print(report) {
  console.log(JSON.stringify({
    status: report.status,
    visible_text_image_count: report.visible_text_image_count,
    report: outPath,
  }, null, 2));
}

function fail(reason, message) {
  console.error(JSON.stringify({ status: "blocked", reason, user_message: message }, null, 2));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
node scripts/post-natural-finish-visible-text-review.mjs \\
  --run-dir /abs/run \\
  [--manifest /abs/run/export/final-images-manifest.json] \\
  [--batch /abs/run/qa/natural-image-finish-batch-report.json] \\
  [--initialize | --evidence /abs/run/qa/review-evidence.json]`);
  process.exit(2);
}
