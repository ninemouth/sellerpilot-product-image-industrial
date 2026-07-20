#!/usr/bin/env node
import crypto from "node:crypto";
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
node scripts/final-delivery-gate.mjs --run-dir /abs/run [--out-dir /abs/run/qa] [--allow-missing-gates]

Aggregates QA gate reports and blocks final delivery when any upstream gate
failed, scene generation is blocked, or draft assets are present in final-images.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const finalImageDir = path.join(runDir, "final-images");
const overviewReportPath = path.join(runDir, "overview", "delivery-overview-report.json");
const sourceUnderstandingPath = path.join(runDir, "source-understanding", "source-product-understanding.json");
const taskContextPath = path.join(runDir, "00-task-context.yaml");
const generationProgressPath = path.join(runDir, "generated-assets", "generation-progress.json");
const modeReportPath = path.join(runDir, "mode", "production-mode-router-report.json");
fs.mkdirSync(qaDir, { recursive: true });

const reports = loadGateReports(qaDir);
const findings = [];
const allowMissingGates = Boolean(args["allow-missing-gates"]);
const runContext = inferRunContext(runDir);
const runLocale = runContext.locale;
const adaptiveNaturalFinishBatchRequired = requiresAdaptiveNaturalFinishBatch(modeReportPath);

validateCriticalJsonArtifacts({ runDir, qaDir, findings });

if (!allowMissingGates) {
  if (!reports.length) {
    findings.push({
      severity: "fail",
      type: "missing-gate-reports",
      gate_id: "final-delivery-gate",
      message: "No qa/*-report.json files were found. Final delivery requires upstream gate evidence.",
    });
  }
  for (const requiredName of ["marketing-quality-gate-report.json", "copy-strategy-gate-report.json", "product-background-card-consistency-gate-report.json", "image-set-export-gate-report.json"]) {
    if (!reports.some((item) => item.name === requiredName)) {
      findings.push({
        severity: "fail",
        type: "missing-required-gate-report",
        gate_id: "final-delivery-gate",
        source_report: requiredName,
        message: `${requiredName} is required before final ecommerce image delivery can pass.`,
      });
    }
  }
  if (adaptiveNaturalFinishBatchRequired && !reports.some((item) => item.name === "natural-image-finish-batch-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-adaptive-natural-image-finish-batch",
      gate_id: "final-delivery-gate",
      source_report: "natural-image-finish-batch-report.json",
      message: "This production mode requires adaptive natural finishing for every generated final image.",
    });
  }
  if (hasVisiblePanelCopy(runDir) && !reports.some((item) => item.name === "text-layout-proof-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "text-layout-proof-gate-report.json",
      message: "text-layout-proof-gate-report.json is required before final delivery when panels contain visible buyer-facing copy.",
    });
  }
  if (requiresLocalizedCopyQa(runLocale) && !reports.some((item) => item.name === "localized-copy-qa-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "localized-copy-qa-report.json",
      message: `localized-copy-qa-report.json is required before final delivery for locale ${runLocale}.`,
    });
  } else if (requiresLocalizedCopyQa(runLocale)) {
    const localizedReport = reports.find((item) => item.name === "localized-copy-qa-report.json")?.report || null;
    const localizedStatus = normalizeStatus(localizedReport?.status);
    if (!["pass", "pass_with_warnings"].includes(localizedStatus)) {
      findings.push({
        severity: "fail",
        type: "localized-copy-qa-not-passed",
        gate_id: "final-delivery-gate",
        source_report: "localized-copy-qa-report.json",
        message: `localized-copy-qa-report.json must pass before final delivery for locale ${runLocale}; current status is ${localizedReport?.status || "unknown"}.`,
      });
    }
    const finalTextStatus = normalizeStatus(localizedReport?.final_visible_text_review?.status);
    if (!["pass", "not_required"].includes(finalTextStatus)) {
      findings.push({
        severity: "fail",
        type: "missing-localized-final-visible-text-review",
        gate_id: "final-delivery-gate",
        source_report: "localized-copy-qa-report.json",
        message: `Localized final delivery for ${runLocale} requires final raster visible-text review status pass/not_required; current status is ${localizedReport?.final_visible_text_review?.status || "missing"}.`,
      });
    }
  }
}

const sourceGeometryPath = path.join(runDir, "geometry", "source-geometry.json");
if (fs.existsSync(sourceGeometryPath) && requiresGeometryGate(sourceGeometryPath)) {
  if (!reports.some((item) => item.name === "identity-geometry-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "identity-geometry-gate-report.json",
      message: "identity-geometry-gate-report.json is required for apparel or proportion-sensitive products before final delivery can pass.",
    });
  }
}

const physicalTruthPath = path.join(runDir, "blueprint", "02b-product-physical-truth.json");
if (fs.existsSync(physicalTruthPath) && requiresPhysicalTruthGate(physicalTruthPath)) {
  if (!reports.some((item) => item.name === "product-physics-fact-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "product-physics-fact-gate-report.json",
      message: "product-physics-fact-gate-report.json is required when physical function/use/scale truth is locked before final delivery can pass.",
    });
  }
}

const surfaceMaterialLockPath = path.join(runDir, "surface-material", "canonical-material-lock.json");
if (fs.existsSync(surfaceMaterialLockPath) && !reports.some((item) => item.name === "surface-material-transfer-gate-report.json")) {
  findings.push({
    severity: "fail",
    type: "missing-required-gate-report",
    gate_id: "final-delivery-gate",
    source_report: "surface-material-transfer-gate-report.json",
    message: "surface-material-transfer-gate-report.json is required when a canonical surface material lock exists.",
  });
}

if (fs.existsSync(sourceUnderstandingPath) && requiresSourceUnderstandingGate(sourceUnderstandingPath)) {
  if (!reports.some((item) => item.name === "source-product-understanding-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "source-product-understanding-gate-report.json",
      message: "source-product-understanding-gate-report.json is required when source image recognition, OCR text, dimensions, labels, or product facts are present.",
    });
  }
}

if (requiresIdentityConsistencyGate(runDir)) {
  if (!reports.some((item) => item.name === "identity-consistency-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "identity-consistency-gate-report.json",
      message: "identity-consistency-gate-report.json is required when source product identity evidence exists or final images include legacy/fallback/derived/repaired lineage.",
    });
  }
}

for (const item of reports) {
  const status = normalizeStatus(item.report.status);
  if (["fail", "blocked", "needs_visual_review"].includes(status)) {
    findings.push({
      severity: status === "needs_visual_review" ? "warn" : "fail",
      type: "upstream-gate-not-passed",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported status ${item.report.status}. Final delivery cannot be marked passed while upstream gates are unresolved.`,
    });
  } else if (status === "warn") {
    findings.push({
      severity: "warn",
      type: "upstream-gate-warning",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported warnings. Review before publishing.`,
    });
  }

  for (const raw of Array.isArray(item.report.findings) ? item.report.findings : []) {
    const severity = normalizeSeverity(raw.severity);
    if (["fail", "critical"].includes(severity)) {
      findings.push({
        severity: "fail",
        type: normalizeType(raw.type || "upstream-finding"),
        gate_id: item.gate_id,
        source_report: item.name,
        image_index: raw.image_index || raw.index || null,
        file: raw.file || null,
        message: raw.message || `${item.gate_id} has unresolved fail finding.`,
      });
    }
  }
}

const requestPackPath = [
  path.join(runDir, "prompt-pack", "10-generation-request-pack.yaml"),
].find((file) => fs.existsSync(file));
if (requestPackPath) {
  const requestPack = fs.readFileSync(requestPackPath, "utf8");
  if (/generation_status:\s*blocked_runtime_unavailable/i.test(requestPack)) {
    findings.push({
      severity: "fail",
      type: "blocked-runtime-unavailable",
      gate_id: "final-delivery-gate",
      source_report: path.relative(runDir, requestPackPath),
      message: "Request pack is blocked because the runtime cannot execute GPT built-in image generation with source image references.",
    });
  }
}

if (fs.existsSync(finalImageDir)) {
  const finalImageNames = fs.readdirSync(finalImageDir).filter((item) => /\.(png|jpe?g|webp)$/i.test(item));
  if (finalImageNames.length > 1) {
    validateTaskContext({ taskContextPath, runContext, findings });
    validateGenerationProgress({ generationProgressPath, finalImageNames, findings });
    validateAnchorBatchEvidence({ runDir, finalImageNames, findings });
  }
  for (const name of finalImageNames) {
    if (/\b(?:layout-)?draft\b|placeholder|wireframe|blocked/i.test(name)) {
      findings.push({
        severity: "fail",
        type: "draft-exported-as-final",
        gate_id: "final-delivery-gate",
        file: path.join(finalImageDir, name),
        message: `Draft, placeholder, wireframe, or blocked asset is present in final-images: ${name}.`,
      });
    }
  }
  const exportReport = reports.find((item) => item.name === "image-set-export-gate-report.json")?.report || null;
  const manifestPath = exportReport?.image_manifest ? path.resolve(exportReport.image_manifest) : "";
  if (finalImageNames.length > 1 && !manifestPath) {
    findings.push({
      severity: "fail",
      type: "missing-final-images-manifest",
      gate_id: "final-delivery-gate",
      source_report: "image-set-export-gate-report.json",
      message: "Multi-image delivery requires image-set-export-gate-report.json to point at export/final-images-manifest.json so images are scoped to one run.",
    });
  }
  if (manifestPath) {
    validateFinalImagesManifest({ manifestPath, runDir, finalImageDir, finalImageNames, findings });
  }
  if (finalImageNames.length > 1 && !args["allow-missing-overview"]) {
    if (!fs.existsSync(overviewReportPath)) {
      findings.push({
        severity: "fail",
        type: "missing-delivery-overview",
        gate_id: "final-delivery-gate",
        source_report: "overview/delivery-overview-report.json",
        message: "Multi-image sets must include overview/SET-OVERVIEW-contact-sheet.png plus delivery-overview-report.json for package review.",
      });
    } else {
      try {
        const overview = JSON.parse(fs.readFileSync(overviewReportPath, "utf8"));
        if (!overview.overview_image || !fs.existsSync(overview.overview_image)) {
          findings.push({
            severity: "fail",
            type: "missing-delivery-overview-image",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: "Delivery overview report exists but overview_image is missing on disk.",
          });
        }
        if (Number(overview.image_count || 0) !== finalImageNames.length) {
          findings.push({
            severity: "fail",
            type: "stale-delivery-overview",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview covers ${overview.image_count || 0} images, but final-images contains ${finalImageNames.length}. Regenerate the overview.`,
          });
        }
        const exportReport = reports.find((item) => item.name === "image-set-export-gate-report.json")?.report || null;
        if (exportReport?.image_manifest && !overview.image_manifest) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-missing-manifest",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: "Delivery overview must be created from the current run final-images manifest, not from an unscoped directory scan.",
          });
        }
        if (exportReport?.image_manifest && overview.image_manifest && path.resolve(exportReport.image_manifest) !== path.resolve(overview.image_manifest)) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-manifest-mismatch",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview used ${overview.image_manifest}, but export gate used ${exportReport.image_manifest}. Regenerate the overview from the current run manifest.`,
          });
        }
        if (exportReport?.run_id && overview.run_id && exportReport.run_id !== overview.run_id) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-run-mismatch",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview run_id ${overview.run_id} does not match export gate run_id ${exportReport.run_id}.`,
          });
        }
      } catch (error) {
        findings.push({
          severity: "fail",
          type: "unreadable-delivery-overview-report",
          gate_id: "final-delivery-gate",
          source_report: "overview/delivery-overview-report.json",
          message: error.message,
        });
      }
    }
  }
}

const qaLoopPath = path.join(qaDir, "qa-loop-routing-decision.json");
if (fs.existsSync(qaLoopPath)) {
  try {
    const routing = JSON.parse(fs.readFileSync(qaLoopPath, "utf8"));
    const decision = routing.loop_decision || {};
    if (decision.status && decision.status !== "continue") {
      const qaLoopMtime = fs.statSync(qaLoopPath).mtimeMs;
      const newerReports = reports
        .filter((item) => {
          try {
            return fs.statSync(item.file).mtimeMs > qaLoopMtime + 1;
          } catch {
            return false;
          }
        })
        .map((item) => item.name);
      const currentFailingReports = reports
        .filter((item) => ["fail", "blocked", "needs_visual_review"].includes(normalizeStatus(item.report.status)))
        .map((item) => item.name);
      if (newerReports.length && !currentFailingReports.length) {
        findings.push({
          severity: "fail",
          type: "stale-qa-loop-routing-decision",
          gate_id: "qa-loop-router",
          source_report: "qa-loop-routing-decision.json",
          message: `QA loop decision is ${decision.status}, but upstream gate reports were updated after it (${newerReports.join(", ")}). Rerun qa-loop-router once so it can close to continue before final delivery.`,
        });
      } else {
        findings.push({
          severity: "fail",
          type: "qa-loop-not-closed",
          gate_id: "qa-loop-router",
          source_report: "qa-loop-routing-decision.json",
          message: `QA loop decision is ${decision.status}; return node ${decision.return_node || "unknown"} must be resolved before final delivery.`,
        });
      }
    }
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-qa-loop-routing-decision",
      gate_id: "final-delivery-gate",
      source_report: "qa-loop-routing-decision.json",
      message: error.message,
    });
  }
}

const status = findings.some((item) => item.severity === "fail" || item.severity === "critical")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  reports_seen: reports.map((item) => item.name),
  findings,
};

fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir: qaDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function loadGateReports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /-report\.json$/.test(name))
    .filter((name) => name !== "final-delivery-gate-report.json")
    .map((name) => {
      const file = path.join(dir, name);
      try {
        const report = JSON.parse(fs.readFileSync(file, "utf8"));
        return { file, name, gate_id: gateIdFromName(name), report };
      } catch (error) {
        return {
          file,
          name,
          gate_id: gateIdFromName(name),
          report: {
            status: "fail",
            findings: [{
              severity: "fail",
              type: "unreadable-gate-report",
              message: error.message,
            }],
          },
        };
      }
    });
}

function validateFinalImagesManifest({ manifestPath, runDir, finalImageDir, finalImageNames, findings }) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.run_dir && path.resolve(manifest.run_dir) !== runDir) {
      findings.push({
        severity: "fail",
        type: "final-images-manifest-run-mismatch",
        gate_id: "final-delivery-gate",
        source_report: path.relative(runDir, manifestPath),
        message: `Final image manifest belongs to ${manifest.run_dir}, not ${runDir}.`,
      });
    }
    const manifestNames = new Set((manifest.images || []).map((item) => path.basename(item.path || item.file || "")));
    for (const name of finalImageNames) {
      if (!manifestNames.has(name)) {
        findings.push({
          severity: "fail",
          type: "unmanifested-final-image",
          gate_id: "final-delivery-gate",
          source_report: path.relative(runDir, manifestPath),
          file: path.join(finalImageDir, name),
          message: `${name} is present in final-images but not in the run-scoped final-images manifest.`,
        });
      }
    }
    for (const item of manifest.images || []) {
      const file = path.resolve(item.path || path.join(manifest.image_dir || finalImageDir, item.file || ""));
      if (!file.startsWith(`${path.resolve(finalImageDir)}${path.sep}`)) {
        findings.push({
          severity: "fail",
          type: "manifest-image-outside-final-dir",
          gate_id: "final-delivery-gate",
          source_report: path.relative(runDir, manifestPath),
          file,
          message: "Final image manifest points outside this run's final-images directory.",
        });
      }
    }
    validateFinalImageLineageReports({ manifest, runDir, findings, adaptiveNaturalFinishBatchRequired });
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-final-images-manifest",
      gate_id: "final-delivery-gate",
      source_report: path.relative(runDir, manifestPath),
      message: error.message,
    });
  }
}

function validateFinalImageLineageReports({ manifest, runDir, findings, adaptiveNaturalFinishBatchRequired = false }) {
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const sourceTypes = images.map((item) => normalizeText(item.lineage?.source_type)).filter(Boolean);
  const hasDerived = sourceTypes.some((type) => /derived|repair|repaired/.test(type));
  const hasPersonalizedText = images.some((item) => {
    const lineage = item.lineage || {};
    const type = normalizeText(lineage.source_type);
    return /text_overlay|personalized/.test(type)
      || normalizeText(lineage.render_method) === "local_overlay"
      || Array.isArray(lineage.personalized_text_items);
  });
  const hasNaturalImageFinish = images.some((item) => normalizeText(item.lineage?.transformation_type) === "natural_image_finish");
  if (hasDerived && !fs.existsSync(path.join(runDir, "qa", "final-image-lineage-gate-report.json"))) {
    findings.push({
      severity: "fail",
      type: "missing-final-image-lineage-gate",
      gate_id: "final-delivery-gate",
      source_report: "qa/final-image-lineage-gate-report.json",
      message: "Final manifest contains derived/repaired image lineage; run final-image-lineage-gate before final delivery.",
    });
  }
  if (hasPersonalizedText && !fs.existsSync(path.join(runDir, "qa", "personalized-text-compositor-contract-report.json"))) {
    findings.push({
      severity: "fail",
      type: "missing-personalized-text-compositor-contract",
      gate_id: "final-delivery-gate",
      source_report: "qa/personalized-text-compositor-contract-report.json",
      message: "Final manifest contains local/personalized text overlay lineage; run personalized-text-compositor-contract before final delivery.",
    });
  }
  if (hasNaturalImageFinish && !fs.existsSync(path.join(runDir, "qa", "natural-image-finish-gate-report.json"))) {
    findings.push({
      severity: "fail",
      type: "missing-natural-image-finish-gate",
      gate_id: "final-delivery-gate",
      source_report: "qa/natural-image-finish-gate-report.json",
      message: "Final manifest contains natural_image_finish lineage; run the natural image finish gate before final delivery.",
    });
  }
  if (adaptiveNaturalFinishBatchRequired) {
    validateAdaptiveNaturalFinishBatch({ manifest, runDir, findings });
  }
}

function validateAdaptiveNaturalFinishBatch({ manifest, runDir, findings }) {
  const batchPath = path.join(runDir, "qa", "natural-image-finish-batch-report.json");
  const batch = readJsonSafe(batchPath);
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const assets = Array.isArray(batch?.assets) ? batch.assets : [];
  const manifestFiles = new Set(images.map((item) => path.basename(item.file || item.path || "")));
  const processedFiles = new Set(assets.map((item) => path.basename(item.file || item.output || "")));
  if (
    batch?.status !== "pass"
    || batch?.all_final_images_processed !== true
    || Number(batch?.processed_count) !== images.length
    || manifestFiles.size !== processedFiles.size
    || [...manifestFiles].some((file) => !processedFiles.has(file))
  ) {
    findings.push({
      severity: "fail",
      type: "adaptive-natural-image-finish-batch-incomplete",
      gate_id: "final-delivery-gate",
      source_report: "qa/natural-image-finish-batch-report.json",
      message: "Adaptive natural finish batch must pass and cover every current manifest image exactly once.",
    });
    return;
  }
  for (const image of images) {
    const file = path.basename(image.file || image.path || "");
    const asset = assets.find((item) => path.basename(item.file || item.output || "") === file);
    if (
      normalizeText(image.lineage?.transformation_type) !== "natural_image_finish"
      || !asset?.selected_profile
      || !asset?.proof
    ) {
      findings.push({
        severity: "fail",
        type: "adaptive-natural-image-finish-image-missing-profile-or-lineage",
        gate_id: "final-delivery-gate",
        source_report: "qa/natural-image-finish-batch-report.json",
        file,
        message: `${file} is missing adaptive profile, proof, or natural_image_finish lineage.`,
      });
    }
  }
  const visibleAssets = assets.filter((item) => item.contains_visible_text === true);
  const reviewPath = path.join(runDir, "qa", "post-natural-finish-visible-text-review.json");
  const review = readJsonSafe(reviewPath);
  const acceptableStatus = visibleAssets.length ? "pass" : "not_required";
  if (normalizeStatus(review?.status) !== acceptableStatus) {
    findings.push({
      severity: "fail",
      type: "post-natural-finish-visible-text-review-not-passed",
      gate_id: "final-delivery-gate",
      source_report: "qa/post-natural-finish-visible-text-review.json",
      message: visibleAssets.length
        ? "Visible-text images require a post-finish raster text review before delivery."
        : "Textless batches require a not_required post-finish text review record.",
    });
  }
  if (visibleAssets.length) {
    const reviewerMethod = String(review?.reviewer_method || "").trim();
    if (!reviewerMethod) {
      findings.push({
        severity: "fail",
        type: "post-natural-finish-visible-text-reviewer-method-missing",
        gate_id: "final-delivery-gate",
        source_report: "qa/post-natural-finish-visible-text-review.json",
        message: "Post-finish visible-text review must record the reviewer method.",
      });
    }
    const reviewed = new Map((review?.images || []).map((item) => [path.basename(item.file || ""), item]));
    for (const asset of visibleAssets) {
      const item = reviewed.get(asset.file);
      const image = images.find((candidate) => path.basename(candidate.file || candidate.path || "") === asset.file);
      const imagePath = path.resolve(image?.path || path.join(runDir, "final-images", asset.file));
      const currentSha256 = fs.existsSync(imagePath) ? sha256File(imagePath) : "";
      const reviewedSha256 = String(item?.reviewed_sha256 || item?.sha256 || "").trim().toLowerCase();
      if (normalizeStatus(item?.status) !== "pass") {
        findings.push({
          severity: "fail",
          type: "post-natural-finish-visible-text-image-unreviewed",
          gate_id: "final-delivery-gate",
          source_report: "qa/post-natural-finish-visible-text-review.json",
          file: asset.file,
          message: `${asset.file} contains visible text and lacks a passing post-finish review.`,
        });
      } else if (!reviewedSha256 || reviewedSha256 !== currentSha256 || reviewedSha256 !== asset.output_sha256) {
        findings.push({
          severity: "fail",
          type: "post-natural-finish-visible-text-review-hash-mismatch",
          gate_id: "final-delivery-gate",
          source_report: "qa/post-natural-finish-visible-text-review.json",
          file: asset.file,
          message: `${asset.file} no longer matches the raster payload that passed post-finish visible-text review.`,
        });
      }
    }
  }
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function requiresAdaptiveNaturalFinishBatch(reportPath) {
  const report = readJsonSafe(reportPath);
  return Array.isArray(report?.execution_policy?.required_quality_path)
    && report.execution_policy.required_quality_path.includes("adaptive-natural-image-finish-batch-all-generated-images");
}

function validateCriticalJsonArtifacts({ runDir: currentRunDir, qaDir: currentQaDir, findings: output }) {
  const critical = [
    "generated-assets/generation-progress.json",
    "generated-assets/anchor-batch-qa-decision.json",
    "qa/anchor-batch-qa-decision.json",
    "export/final-images-manifest.json",
    "overview/delivery-overview-report.json",
    "qa/qa-loop-routing-decision.json",
    "qa/qa-loop-state.json",
  ];
  for (const rel of critical) {
    const file = path.join(currentRunDir, rel);
    if (!fs.existsSync(file)) continue;
    const raw = readTextSafe(file);
    if (/<<<<<<<|>>>>>>>|\*\*\* Begin Patch|\*\*\* End Patch|^@@\s/m.test(raw)) {
      output.push({
        severity: "fail",
        type: artifactFailureType(rel),
        gate_id: "production-artifact-integrity-gate",
        source_report: rel,
        message: `${rel} contains patch/conflict/markdown marker text. Regenerate this machine artifact from its owning script before final delivery.`,
      });
      continue;
    }
    try {
      JSON.parse(raw);
    } catch (error) {
      output.push({
        severity: "fail",
        type: artifactFailureType(rel),
        gate_id: "production-artifact-integrity-gate",
        source_report: rel,
        message: `${rel} is not valid JSON: ${error.message}`,
      });
    }
  }
  if (fs.existsSync(currentQaDir)) {
    for (const entry of fs.readdirSync(currentQaDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/-report\.json$/.test(entry.name) || entry.name === "final-delivery-gate-report.json") continue;
      const file = path.join(currentQaDir, entry.name);
      const raw = readTextSafe(file);
      try {
        JSON.parse(raw);
      } catch (error) {
        output.push({
          severity: "fail",
          type: "corrupt-qa-report-json",
          gate_id: "production-artifact-integrity-gate",
          source_report: path.relative(currentRunDir, file),
          message: `${entry.name} is not valid JSON: ${error.message}`,
        });
      }
    }
  }
}

function artifactFailureType(rel) {
  if (/anchor-batch-qa-decision\.json$/.test(rel)) return "corrupt-anchor-batch-decision-json";
  if (/generation-progress\.json$/.test(rel)) return "corrupt-generation-progress-json";
  if (/final-images-manifest\.json$/.test(rel)) return "corrupt-final-images-manifest-json";
  return "local-artifact-corruption";
}

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function requiresIdentityConsistencyGate(currentRunDir) {
  const finalDir = path.join(currentRunDir, "final-images");
  const hasFinals = fs.existsSync(finalDir) && fs.readdirSync(finalDir).some((name) => /\.(png|jpe?g|webp)$/i.test(name));
  if (!hasFinals) return false;
  const identityLockExists = [
    "blueprint/02-identity-lock.yaml",
    "blueprint/02-identity-lock.json",
    "blueprint/product-identity-lock.json",
  ].some((rel) => fs.existsSync(path.join(currentRunDir, rel)));
  const sourceEvidenceExists = [
    "source-understanding/source-product-understanding.json",
    "source-original/source.png",
    "source-original/source-original.png",
    "source-enhanced/source-enhanced.png",
  ].some((rel) => fs.existsSync(path.join(currentRunDir, rel)));
  const manifest = readJsonSafe(path.join(currentRunDir, "export", "final-images-manifest.json"));
  const lineageRequiresReview = Array.isArray(manifest?.images) && manifest.images.some((item) => {
    const text = normalizeText(textifyForGate([
      item.lineage?.source_type,
      item.lineage?.status,
      item.lineage?.delivery_status,
      item.lineage?.requires_identity_review,
      item.file,
    ]));
    return /(legacy|fallback|derived|repair|repaired|local_overlay|text_overlay|needs_identity_review)/.test(text);
  });
  return identityLockExists || sourceEvidenceExists || lineageRequiresReview;
}

function validateTaskContext({ taskContextPath: contextPath, runContext: context, findings }) {
  if (!fs.existsSync(contextPath)) {
    findings.push({
      severity: "fail",
      type: "missing-task-context",
      gate_id: "final-delivery-gate",
      source_report: "00-task-context.yaml",
      message: "Multi-image delivery requires 00-task-context.yaml so platform, category, locale, and run_id cannot drift across tasks.",
    });
    return;
  }
  for (const key of ["run_id", "platform", "category"]) {
    if (!String(context[key] || "").trim()) {
      findings.push({
        severity: "fail",
        type: `missing-task-context-${key.replace(/_/g, "-")}`,
        gate_id: "final-delivery-gate",
        source_report: "00-task-context.yaml",
        message: `00-task-context.yaml is missing ${key}; final delivery needs run-scoped platform/category identity.`,
      });
    }
  }
}

function validateGenerationProgress({ generationProgressPath: progressPath, finalImageNames, findings }) {
  if (!fs.existsSync(progressPath)) {
    findings.push({
      severity: "fail",
      type: "missing-generation-progress",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: "Multi-image delivery requires generated-assets/generation-progress.json with completed/pending/failed asset state.",
    });
    return;
  }
  let progress;
  try {
    progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-generation-progress",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: error.message,
    });
    return;
  }

  const status = normalizeText(progress.status);
  const completed = normalizeProgressImages(progress.completed_images);
  const pending = normalizeProgressImages(progress.pending_images);
  const failed = normalizeProgressImages(progress.failed_images);
  const externalImport = hasExternalFinalImport(progress);
  if (["planned", "not_started", "pending", "initialized"].includes(status) && !completed.length && !externalImport) {
    findings.push({
      severity: "fail",
      type: "stale-generation-progress",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: `Generation progress is still "${progress.status}" with no completed_images, but final-images contains ${finalImageNames.length} files. Update progress after each asset or run manifest/progress reconciliation.`,
    });
  }
  if (failed.length) {
    findings.push({
      severity: "fail",
      type: "generation-progress-has-failed-assets",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: `Generation progress still lists failed assets: ${failed.join(", ")}.`,
    });
  }
  if (pending.length && !["complete", "completed", "final_exported", "exported", "ready"].includes(status)) {
    findings.push({
      severity: "fail",
      type: "generation-progress-has-pending-assets",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: `Generation progress still lists pending assets: ${pending.join(", ")}.`,
    });
  }
  if (!externalImport && completed.length && completed.length < finalImageNames.length) {
    findings.push({
      severity: "fail",
      type: "generation-progress-underreports-finals",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/generation-progress.json",
      message: `Generation progress completed_images has ${completed.length} items, but final-images contains ${finalImageNames.length} files.`,
    });
  }
}

function validateAnchorBatchEvidence({ runDir: currentRunDir, finalImageNames, findings }) {
  if (finalImageNames.length <= 3) return;
  const progress = readJsonSafe(path.join(currentRunDir, "generated-assets", "generation-progress.json"));
  if (progress?.anchor_batch_required === false || hasExternalFinalImport(progress)) return;

  const candidates = [
    path.join(currentRunDir, "generated-assets", "anchor-batch-qa-decision.json"),
    path.join(currentRunDir, "generated-assets", "generation-progress.json"),
    path.join(currentRunDir, "qa", "anchor-batch-qa.json"),
    path.join(currentRunDir, "qa", "anchor-batch-qa-decision.json"),
    path.join(currentRunDir, "qa", "anchor-batch-qa-report.json"),
    path.join(currentRunDir, "blueprint", "quality-production-blueprint.json"),
  ].filter((file) => fs.existsSync(file));

  let evidence = null;
  for (const file of candidates) {
    const parsed = readJsonSafe(file);
    const decision = normalizeText(firstNonEmpty([
      parsed?.qa_decision,
      parsed?.decision,
      parsed?.anchor_batch?.qa_decision,
      parsed?.anchor_batch?.decision,
      parsed?.anchor_batch?.status,
      parsed?.generation_pacing?.anchor_batch?.qa_decision,
      parsed?.status,
    ]));
    if (["continue", "pass", "passed", "approved", "ready"].includes(decision)) {
      evidence = { file, decision };
      break;
    }
    if (["revise_prompt", "ask_user", "blocked", "fail", "failed"].includes(decision)) {
      evidence = { file, decision };
      break;
    }
  }

  if (!evidence) {
    findings.push({
      severity: "fail",
      type: "missing-anchor-batch-qa-decision",
      gate_id: "final-delivery-gate",
      source_report: "generated-assets/anchor-batch-qa-decision.json",
      message: "Multi-image quality delivery requires anchor batch QA evidence before continuing the full set. Generate a small anchor batch, record qa_decision=continue/pass, then continue missing assets only.",
    });
    return;
  }
  if (!["continue", "pass", "passed", "approved", "ready"].includes(evidence.decision)) {
    findings.push({
      severity: "fail",
      type: "anchor-batch-qa-not-cleared",
      gate_id: "final-delivery-gate",
      source_report: path.relative(currentRunDir, evidence.file),
      message: `Anchor batch QA decision is "${evidence.decision}", so full-set final delivery is not cleared.`,
    });
  }
}

function requiresGeometryGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const text = JSON.stringify(parsed).toLowerCase();
    if (/"status"\s*:\s*"pending_annotation"/.test(JSON.stringify(parsed))) return false;
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  }
}

function requiresPhysicalTruthGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const root = parsed.product_physical_truth || parsed;
    if (/pending|unknown|not_run/i.test(String(root.status || ""))) return false;
    const text = JSON.stringify(root).toLowerCase();
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  }
}

function inferRunContext(runDir) {
  const taskContextPath = path.join(runDir, "00-task-context.yaml");
  const context = {
    run_id: extractYamlScalar(taskContextPath, "run_id"),
    platform: extractYamlScalar(taskContextPath, "platform"),
    category: extractYamlScalar(taskContextPath, "category"),
    locale: extractYamlScalar(taskContextPath, "locale"),
  };
  const contextPlanPath = path.join(runDir, "research", "platform-context-plan.json");
  if (fs.existsSync(contextPlanPath)) {
    try {
      const plan = JSON.parse(fs.readFileSync(contextPlanPath, "utf8"));
      const overlay = plan?.platform_category_profile_overlay || {};
      context.platform ||= String(overlay.platform || plan?.platform || "").trim();
      context.category ||= String(overlay.category || plan?.category || "").trim();
      context.locale ||= String(overlay.locale || plan?.locale || "").trim();
    } catch {
      return context;
    }
  }
  return context;
}

function requiresLocalizedCopyQa(locale) {
  const normalized = String(locale || "").trim().toLowerCase();
  if (!normalized) return false;
  return !/^(zh|zh-|en|en-)/.test(normalized);
}

function extractYamlScalar(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^${escapeRegex(key)}:\\s*(.*?)\\s*$`));
    if (!match) continue;
    const value = String(match[1] || "").replace(/^["']|["']$/g, "").trim();
    if (value) return value;
  }
  return "";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiresSourceUnderstandingGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const text = JSON.stringify(parsed).toLowerCase();
    if (!parsed.source_image && !parsed.vision_ocr_pass?.raw_text && !parsed.text_understanding?.visible_text_items?.length) return false;
    return /(source|ocr|visible_text|dimension|length|width|height|diameter|label|warning|model|install|function|material|weight|尺寸|文字|标签|型号|安装|功能|材质|重量)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(source_image|ocr|visible_text|dimension|length|width|height|diameter|label|warning|model|install|function|material|weight|尺寸|文字|标签|型号|安装|功能|材质|重量)/i.test(text);
  }
}

function hasVisiblePanelCopy(currentRunDir) {
  const candidates = [
    path.join(currentRunDir, "blueprint", "panels-array.json"),
    path.join(currentRunDir, "blueprint", "panels.json"),
    path.join(currentRunDir, "blueprint", "quality-production-blueprint.json"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const parsed = readJsonSafe(file);
    const panels = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.panels)
        ? parsed.panels
        : Array.isArray(parsed?.image_set)
          ? parsed.image_set
          : Array.isArray(parsed?.images)
            ? parsed.images
            : [];
    if (panels.some((panel) => panelHasVisibleCopy(panel))) return true;
  }
  return false;
}

function panelHasVisibleCopy(panel) {
  if (!panel || typeof panel !== "object") return false;
  const textless = [
    panel.textless_ok,
    panel.no_visible_text,
    panel.visible_text_policy,
  ].some((value) => /^(true|no visible text|textless|none)$/i.test(String(value || "").trim()));
  const text = [
    panel.title,
    panel.sub,
    panel.subtitle,
    panel.tag,
    panel.main_message,
    panel.secondary_message,
    panel.required_copy,
    panel.buyer_facing_message,
    panel.overlay_text,
    panel.badge,
    panel.badges,
    panel.footer_label,
    panel.final_visible_text,
    panel.visible_copy,
    panel.visible_copy_ru,
    panel.copy_lines,
  ].map(textifyForGate).filter(Boolean).join(" ").trim();
  return Boolean(text) && !textless;
}

function textifyForGate(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textifyForGate).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textifyForGate).filter(Boolean).join(" ");
  return String(value);
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "ready", "ok", "continue"].includes(value)) return "pass";
  if (["not_required", "not-required"].includes(value)) return "not_required";
  if (["pass_with_warnings", "ready_with_warnings", "warn"].includes(value)) return "warn";
  if (["fail", "failed"].includes(value)) return "fail";
  if (["blocked"].includes(value)) return "blocked";
  if (["needs_visual_review"].includes(value)) return "needs_visual_review";
  return value || "unknown";
}

function normalizeSeverity(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "error") return "fail";
  if (["critical", "fail", "warn", "info"].includes(value)) return value;
  return "warn";
}

function normalizeType(type) {
  return String(type || "unknown").trim().toLowerCase().replace(/_/g, "-");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProgressImages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return path.basename(item);
      if (!item || typeof item !== "object") return "";
      return path.basename(item.path || item.file || item.filename || item.name || item.id || "");
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function hasExternalFinalImport(progress) {
  if (!progress || typeof progress !== "object") return false;
  const text = normalizeText([
    progress.source,
    progress.mode,
    progress.final_asset_origin,
    progress.import_mode,
    progress.reconciliation_mode,
    progress.notes,
  ].filter(Boolean).join(" "));
  return Boolean(
    progress.external_import_allowed
    || progress.manual_final_import
    || progress.reconciled_from_manifest
    || /(external|manual import|imported final|manifest reconciliation|reconciled from manifest)/i.test(text)
  );
}

function readJsonSafe(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function gateIdFromName(name) {
  return name.replace(/-report\.json$/, "").replace(/\.json$/, "");
}

function toMarkdown(report) {
  const lines = [
    "# Final Delivery Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Run dir: ${report.run_dir}`,
    "",
    "## Reports Seen",
    "",
    ...(report.reports_seen.length ? report.reports_seen.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const image = finding.image_index ? ` image ${finding.image_index}` : "";
    const file = finding.file ? ` (${path.basename(finding.file)})` : "";
    lines.push(`- [${finding.severity}] ${finding.gate_id}/${finding.type}${image}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
