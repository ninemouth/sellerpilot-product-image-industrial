import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;

export function imageScopeUsage(extra = "") {
  return [
    extra,
    "",
    "Image isolation:",
    "  Prefer --manifest /abs/run/export/final-images-manifest.json.",
    "  With --image-dir, also pass --run-dir and use exactly /abs/run/final-images.",
    "  Shared outputs folders are blocked unless --allow-unscoped-image-dir is explicit.",
  ].filter(Boolean).join("\n");
}

export function listImageFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => IMAGE_EXT_RE.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

export function collectScopedImages(args, options = {}) {
  const purpose = options.purpose || "image_scope";
  const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
  const runContext = readRunContext(runDir);

  if (args.manifest) {
    const manifestPath = path.resolve(args.manifest);
    const manifest = readJson(manifestPath);
    const images = normalizeManifestImages(manifest, manifestPath);
    assertManifestRun(manifest, runContext, args);
    assertFilesExist(images);
    return {
      source: "manifest",
      images,
      manifest,
      manifestPath,
      runDir: runContext.run_dir || runDir,
      runId: manifest.run_id || runContext.run_id || "",
    };
  }

  if (args.images) {
    const images = args.images.split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(item));
    assertFilesExist(images);
    return {
      source: "explicit_images",
      images,
      manifest: null,
      manifestPath: "",
      runDir: runContext.run_dir || runDir,
      runId: runContext.run_id || "",
    };
  }

  if (!args["image-dir"]) {
    throw new Error(`No images provided for ${purpose}. Pass --manifest, --images, or scoped --image-dir.`);
  }

  const imageDir = path.resolve(args["image-dir"]);
  if (!args["allow-unscoped-image-dir"]) {
    if (!runDir) {
      throw new Error(`Refusing unscoped image directory for ${purpose}: ${imageDir}. Pass --run-dir with /final-images, or use --manifest.`);
    }
    const expected = path.join(runDir, "final-images");
    if (!samePath(imageDir, expected)) {
      throw new Error(`Refusing cross-run image directory for ${purpose}: ${imageDir}. Expected exactly ${expected}. Use --manifest for an explicit image list.`);
    }
  }

  const images = listImageFiles(imageDir);
  return {
    source: "scoped_image_dir",
    images,
    manifest: null,
    manifestPath: "",
    imageDir,
    runDir: runContext.run_dir || runDir,
    runId: runContext.run_id || "",
  };
}

export function createFinalImagesManifest({ runDir, imageDir, images, outPath, purpose = "final_images", existingManifest = null }) {
  const context = readRunContext(runDir);
  const manifestPath = outPath || path.join(runDir, "export", "final-images-manifest.json");
  const resolvedImages = images.map((file) => path.resolve(file));
  const lineage = collectFinalImageLineage(runDir);
  const manifest = {
    schema_version: "sellerpilot.final_images_manifest.v1",
    created_at: new Date().toISOString(),
    run_id: context.run_id || safeRunId(path.basename(runDir || path.dirname(manifestPath))),
    run_dir: runDir ? path.resolve(runDir) : "",
    image_dir: imageDir ? path.resolve(imageDir) : "",
    purpose,
    source_manifest: existingManifest?.manifest_path || null,
    image_count: resolvedImages.length,
    images: resolvedImages.map((file, index) => {
      const fileName = path.basename(file);
      return {
        index: index + 1,
        id: inferImageId(file, index),
        file: fileName,
        path: file,
        sha256: sha256File(file),
        lineage: lineage[fileName] || {
          source_type: "unknown",
          note: "No final image lineage metadata was supplied before manifest creation.",
        },
      };
    }),
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath };
}

export function collectFinalImageLineage(runDir) {
  if (!runDir) return {};
  const byFile = {};
  for (const rel of [
    path.join("export", "final-image-lineage.json"),
    path.join("qa", "final-image-lineage.json"),
  ]) {
    const file = path.join(runDir, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const parsed = readJson(file);
      const records = Array.isArray(parsed.images) ? parsed.images : Array.isArray(parsed.lineage) ? parsed.lineage : [];
      for (const item of records) {
        const key = path.basename(item.file || item.path || item.final_image || "");
        if (!key) continue;
        byFile[key] = normalizeLineage(item, runDir);
      }
    } catch {
      // Invalid lineage is checked by the lineage gate; manifest creation stays non-destructive.
    }
  }

  const repairMapPath = path.join(runDir, "qa", "failed-asset-repair-map.json");
  if (fs.existsSync(repairMapPath)) {
    try {
      const repairMap = readJson(repairMapPath);
      const repairs = repairMap.repairs || {};
      for (const [progressFile, finalImage] of Object.entries(repairs)) {
        const key = path.basename(finalImage);
        if (!key) continue;
        byFile[key] = {
          source_type: byFile[key]?.source_type || "repaired_final_asset",
          ...byFile[key],
          repair_of_progress_ids: unique([...(byFile[key]?.repair_of_progress_ids || []), progressFile]),
          repair_map: path.relative(runDir, repairMapPath),
        };
      }
    } catch {
      // The repair map gate/final gate can report this; avoid breaking export.
    }
  }

  return byFile;
}

function normalizeLineage(item, runDir) {
  const out = {
    source_type: item.source_type || item.origin || "unknown",
  };
  for (const key of [
    "derived_from",
    "approved_source_path",
    "generated_asset_path",
    "text_overlay_proof",
    "natural_finish_proof",
    "natural_finish_batch_proof",
    "transformation_type",
    "upstream_source_type",
    "upstream_transformation_type",
    "render_method",
    "adaptive_profile",
    "reason",
    "note",
    "claims_new_scene_asset",
    "output_sha256",
    "requires_identity_review",
    "contains_visible_text",
    "text_protection_applied",
    "alpha_preserved",
  ]) {
    if (item[key] != null && item[key] !== "") out[key] = item[key];
  }
  for (const key of ["repair_of_progress_ids", "personalized_text_items"]) {
    if (Array.isArray(item[key])) out[key] = item[key];
  }
  for (const key of ["derived_from", "approved_source_path", "generated_asset_path", "text_overlay_proof", "natural_finish_proof", "natural_finish_batch_proof"]) {
    if (out[key] && path.isAbsolute(out[key])) out[key] = path.relative(runDir, out[key]);
  }
  return out;
}

export function readRunContext(runDir) {
  if (!runDir) return {};
  const resolved = path.resolve(runDir);
  const jsonPath = path.join(resolved, "run-context.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = readJson(jsonPath);
      return {
        ...parsed,
        run_dir: parsed.run_dir || resolved,
      };
    } catch {
      // Fall through to YAML-lite parsing.
    }
  }
  const yamlPath = path.join(resolved, "00-task-context.yaml");
  const context = { run_dir: resolved };
  if (fs.existsSync(yamlPath)) {
    const text = fs.readFileSync(yamlPath, "utf8");
    const runId = text.match(/^run_id:\s*(.+)$/m)?.[1];
    const platform = text.match(/^platform:\s*(.+)$/m)?.[1];
    const category = text.match(/^category:\s*(.+)$/m)?.[1];
    if (runId) context.run_id = unquote(runId);
    if (platform) context.platform = unquote(platform);
    if (category) context.category = unquote(category);
  }
  return context;
}

export function writeRunContext(runDir, context) {
  const runContext = {
    schema_version: "sellerpilot.run_context.v1",
    ...context,
    run_dir: path.resolve(runDir),
  };
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-context.json"), `${JSON.stringify(runContext, null, 2)}\n`);
  return runContext;
}

export function safeRunId(value) {
  return String(value || "run")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "run";
}

export function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

function normalizeManifestImages(manifest, manifestPath) {
  if (!Array.isArray(manifest.images) || !manifest.images.length) {
    throw new Error(`Image manifest has no images: ${manifestPath}`);
  }
  return manifest.images.map((item) => path.resolve(item.path || path.join(manifest.image_dir || path.dirname(manifestPath), item.file || "")));
}

function assertManifestRun(manifest, runContext, args) {
  const expectedRunId = args["run-id"] || runContext.run_id || "";
  if (expectedRunId && manifest.run_id && manifest.run_id !== expectedRunId) {
    throw new Error(`Manifest run_id mismatch: expected ${expectedRunId}, got ${manifest.run_id}.`);
  }
  if (runContext.run_dir && manifest.run_dir && !samePath(manifest.run_dir, runContext.run_dir)) {
    throw new Error(`Manifest run_dir mismatch: expected ${runContext.run_dir}, got ${manifest.run_dir}.`);
  }
}

function assertFilesExist(images) {
  const missing = images.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Image manifest/list includes missing files: ${missing.join(", ")}`);
  }
}

function inferImageId(file, index) {
  const stem = path.basename(file, path.extname(file));
  const match = stem.match(/^(IMG|POSTER|DETAIL)-\d{2}(?:-[a-z0-9]+)*$/i);
  return match ? stem : `IMG-${String(index + 1).padStart(2, "0")}`;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (/^".*"$/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
