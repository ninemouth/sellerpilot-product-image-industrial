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
node scripts/identity-consistency-gate.mjs --run-dir /abs/run \\
  [--manifest /abs/run/export/final-images-manifest.json] \\
  [--source /abs/source.png] \\
  [--identity-lock /abs/run/blueprint/02-identity-lock.yaml] \\
  [--review /abs/run/qa/identity-consistency-visual-review.json] \\
  [--out-dir /abs/run/qa]

Blocks final delivery unless every product-bearing final image has explicit
source-vs-generated identity review evidence. Legacy fallback, repaired,
derived, and local-overlay images require per-image pass evidence.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const reviewPath = args.review
  ? path.resolve(args.review)
  : [
    path.join(runDir, "qa", "identity-consistency-visual-review.json"),
    path.join(runDir, "qa", "identity-consistency-review.json"),
    path.join(runDir, "qa", "identity-consistency-report.json"),
  ].find((file) => fs.existsSync(file));
const sourcePath = args.source ? path.resolve(args.source) : findSourceImage(runDir);
const identityLockPath = args["identity-lock"] ? path.resolve(args["identity-lock"]) : findIdentityLock(runDir);
const findings = [];
fs.mkdirSync(qaDir, { recursive: true });

const manifest = readJsonSafe(manifestPath);
const images = normalizeManifestImages(manifest);
if (!manifest) {
  findings.push({
    severity: "fail",
    type: "missing-final-images-manifest",
    return_node: "export-packaging",
    source_report: path.relative(runDir, manifestPath),
    message: "Identity consistency gate requires the current run final-images manifest.",
  });
}
if (!images.length) {
  findings.push({
    severity: "fail",
    type: "missing-final-images-for-identity-review",
    return_node: "export-packaging",
    message: "No final images were found in the manifest for identity review.",
  });
}

const review = reviewPath ? readJsonSafe(reviewPath) : null;
if (!review) {
  findings.push({
    severity: "fail",
    type: "missing-identity-consistency-review",
    return_node: "identity-consistency-gate",
    source_report: reviewPath ? path.relative(runDir, reviewPath) : "qa/identity-consistency-visual-review.json",
    message: "Missing explicit source-vs-generated identity review. Create visual review evidence and mark each final image pass/fail before final delivery.",
  });
}

const reviewByFile = review ? indexReview(review) : new Map();
for (const image of images) {
  const lineage = image.lineage || {};
  const sourceType = normalize(lineage.source_type);
  const requiresStrictReview = requiresStrictIdentityReview(image);
  const reviewItem = reviewByFile.get(image.file) || reviewByFile.get(path.basename(image.file)) || null;
  const status = normalize(firstNonEmpty([reviewItem?.status, reviewItem?.identity_status, reviewItem?.decision]));

  if (!reviewItem) {
    findings.push({
      severity: "fail",
      type: requiresStrictReview ? "legacy-fallback-needs-identity-review" : "missing-per-image-identity-review",
      file: image.file,
      return_node: "identity-consistency-gate",
      message: `${image.file} has no per-image identity review. Compare it against the source product and identity lock before delivery.`,
    });
    continue;
  }

  if (!["pass", "passed", "approved"].includes(status)) {
    findings.push({
      severity: "fail",
      type: requiresStrictReview ? "legacy-fallback-needs-identity-review" : "identity-drift",
      file: image.file,
      return_node: /scene|onbody|lifestyle|fallback/.test(sourceType) ? "scene-asset-production" : "product-identity-lock",
      message: reviewItem.message || reviewItem.reason || `${image.file} identity review status is ${reviewItem.status || "unknown"}; final delivery requires pass.`,
    });
    continue;
  }

  const details = normalize(textify([reviewItem.failed_items, reviewItem.drift, reviewItem.identity_drift, reviewItem.notes]));
  if (/(fail|drift|mismatch|different product|wrong product|not same|不一致|漂移|不符合|不是同一)/.test(details)) {
    findings.push({
      severity: "fail",
      type: "identity-drift",
      file: image.file,
      return_node: "product-identity-lock",
      message: `${image.file} review notes contain unresolved identity drift: ${reviewItem.notes || reviewItem.reason || "see review evidence"}`,
    });
  }
}

if (!sourcePath && !identityLockPath) {
  findings.push({
    severity: "warn",
    type: "identity-source-evidence-missing",
    return_node: "product-identity-lock",
    message: "No source image or identity lock was found. The review can only validate declared consistency evidence, not true source fidelity.",
  });
}

const status = findings.some((item) => item.severity === "fail" || item.severity === "critical")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.identity_consistency_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  source_image: sourcePath || null,
  identity_lock: identityLockPath || null,
  manifest: fs.existsSync(manifestPath) ? manifestPath : null,
  review: reviewPath || null,
  image_count: images.length,
  findings,
};

fs.writeFileSync(path.join(qaDir, "identity-consistency-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(qaDir, "identity-consistency-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir: qaDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function normalizeManifestImages(manifestJson) {
  const raw = Array.isArray(manifestJson?.images) ? manifestJson.images : [];
  return raw.map((item) => ({
    file: path.basename(item.file || item.path || ""),
    path: item.path || null,
    lineage: item.lineage || {},
  })).filter((item) => item.file);
}

function indexReview(reviewJson) {
  const records = [
    ...(Array.isArray(reviewJson.images) ? reviewJson.images : []),
    ...(Array.isArray(reviewJson.generated_images) ? reviewJson.generated_images : []),
    ...(Array.isArray(reviewJson.reviews) ? reviewJson.reviews : []),
  ];
  const map = new Map();
  for (const item of records) {
    const file = path.basename(item.file || item.path || item.image || item.image_path || "");
    if (!file) continue;
    map.set(file, item);
  }
  return map;
}

function requiresStrictIdentityReview(image) {
  const lineage = image.lineage || {};
  const text = normalize(textify([
    lineage.source_type,
    lineage.status,
    lineage.review_status,
    lineage.delivery_status,
    lineage.note,
    lineage.reason,
    lineage.requires_identity_review,
    image.file,
  ]));
  return /(legacy|fallback|repaired|repair|derived|local_overlay|text_overlay|needs_identity_review|identity_review)/.test(text);
}

function findSourceImage(root) {
  const candidates = [
    "source-original/source.png",
    "source-original/source-original.png",
    "source-enhanced/source-enhanced.png",
    "source-normalized/product-on-card-safe.png",
  ];
  for (const rel of candidates) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function findIdentityLock(root) {
  const candidates = [
    "blueprint/02-identity-lock.yaml",
    "blueprint/02-identity-lock.json",
    "blueprint/product-identity-lock.json",
  ];
  for (const rel of candidates) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function firstNonEmpty(values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim()) || "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function textify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textify).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textify).filter(Boolean).join(" ");
  return String(value);
}

function toMarkdown(report) {
  const lines = [
    "# Identity Consistency Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Image count: ${report.image_count}`,
    `- Source image: ${report.source_image || "missing"}`,
    `- Identity lock: ${report.identity_lock || "missing"}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const file = finding.file ? ` (${finding.file})` : "";
    lines.push(`- [${finding.severity}] ${finding.type}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
