#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

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
node scripts/build-source-image-set.mjs --images "/abs/a.png,/abs/b.jpg" --out-dir /abs/run [--category "女包"]
node scripts/build-source-image-set.mjs --image-dir /abs/source-dir --out-dir /abs/run [--category "女包"]

Creates source-image-set-manifest.json, enhanced source images, and a starter identity lock.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"] || (!args.images && !args["image-dir"])) usage();

const outDir = path.resolve(args["out-dir"]);
const originalDir = path.join(outDir, "source-original");
const enhancedDir = path.join(outDir, "source-enhanced");
const blueprintDir = path.join(outDir, "blueprint");
fs.mkdirSync(originalDir, { recursive: true });
fs.mkdirSync(enhancedDir, { recursive: true });
fs.mkdirSync(blueprintDir, { recursive: true });

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  try {
    sharp = require("/Users/yang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
  } catch {
    sharp = null;
  }
}

const inputImages = collectImages(args);
if (!inputImages.length) usage();

const records = [];
for (let i = 0; i < inputImages.length; i += 1) {
  const input = path.resolve(inputImages[i]);
  const ext = path.extname(input).toLowerCase() || ".png";
  const base = `source-${String(i + 1).padStart(2, "0")}${ext}`;
  const originalPath = path.join(originalDir, base);
  fs.copyFileSync(input, originalPath);
  const role = inferRole(input);
  const enhancedPath = path.join(enhancedDir, `source-${String(i + 1).padStart(2, "0")}-enhanced.png`);
  const quality = await enhanceOrCopy(originalPath, enhancedPath);
  records.push({
    index: i + 1,
    input,
    original_path: originalPath,
    enhanced_path: enhancedPath,
    role,
    quality_findings: quality,
    identity_evidence: evidenceForRole(role),
    use_for: useForRole(role),
  });
}

const primary = records.find((item) => item.role === "primary_identity")
  || records.find((item) => item.role === "front")
  || records[0];
const manifest = {
  created_at: new Date().toISOString(),
  category: args.category || "",
  source_images: records,
  primary_identity_image: primary.enhanced_path,
  source_product_understanding: createSourceUnderstanding(primary.enhanced_path),
  best_detail_sources: records.filter((item) => item.role === "detail").map((item) => item.enhanced_path),
  best_packaging_sources: records.filter((item) => ["packaging", "logo"].includes(item.role)).map((item) => item.enhanced_path),
  conflicts: [],
  missing_angles: inferMissingAngles(records),
};

const manifestPath = path.join(outDir, "source-image-set-manifest.json");
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const identityPath = path.join(blueprintDir, "02-identity-lock.yaml");
if (!fs.existsSync(identityPath)) {
  fs.writeFileSync(identityPath, identityLockYaml(manifest));
}
console.log(JSON.stringify({ manifestPath, identityPath, count: records.length }, null, 2));

function collectImages(parsedArgs) {
  if (parsedArgs.images) {
    return parsedArgs.images.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return fs.readdirSync(parsedArgs["image-dir"])
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort()
    .map((name) => path.join(parsedArgs["image-dir"], name));
}

function createSourceUnderstanding(primaryImage) {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "create-source-product-understanding.mjs");
  const understandingDir = path.join(outDir, "source-understanding");
  const result = spawnSync(process.execPath, [
    script,
    "--image", primaryImage,
    "--out-dir", understandingDir,
    "--category", args.category || "",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const expected = path.join(understandingDir, "source-product-understanding.json");
  if (result.status === 0 && fs.existsSync(expected)) return expected;
  return {
    status: "not_created",
    reason: result.stderr || result.stdout || `create-source-product-understanding exited ${result.status}`,
  };
}

function inferRole(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (/competitor|reference|竞品|参考/.test(name)) return "competitor_reference";
  if (/detail|close|macro|细节|五金|拉链|logo|texture/.test(name)) return "detail";
  if (/pack|box|包装/.test(name)) return "packaging";
  if (/logo|标/.test(name)) return "logo";
  if (/side|侧/.test(name)) return "side";
  if (/back|背|后/.test(name)) return "back";
  if (/front|main|primary|主图|正面/.test(name)) return "primary_identity";
  if (/scene|life|model|场景|上身/.test(name)) return "scene";
  return "unknown";
}

function evidenceForRole(role) {
  const map = {
    primary_identity: ["silhouette", "proportions", "primary_color", "material_appearance", "visible_structure"],
    front: ["silhouette", "proportions", "front_structure"],
    side: ["depth", "side_profile", "strap_or_handle"],
    back: ["back_structure"],
    detail: ["hardware", "closure", "texture", "stitching", "accessory_or_decoration"],
    packaging: ["packaging", "logo_or_markings"],
    logo: ["logo_or_markings"],
    scene: ["scale", "use_context"],
  };
  return map[role] || ["needs_visual_review"];
}

function useForRole(role) {
  const map = {
    primary_identity: ["identity_lock", "main_image", "scene_reference"],
    front: ["identity_lock", "main_image"],
    side: ["identity_lock", "size_or_profile"],
    back: ["identity_lock"],
    detail: ["detail_image", "identity_lock"],
    packaging: ["packaging_or_trust_image"],
    logo: ["identity_lock", "brand_mark_check"],
    scene: ["scene_context_reference"],
  };
  return map[role] || ["manual_review"];
}

function inferMissingAngles(records) {
  const roles = new Set(records.map((item) => item.role));
  return ["primary_identity", "side", "back", "detail"].filter((role) => !roles.has(role));
}

async function enhanceOrCopy(input, output) {
  if (!sharp) {
    fs.copyFileSync(input, output);
    return { enhancer: "copy_only", note: "sharp unavailable" };
  }
  const image = sharp(input, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  let pipeline = sharp(input, { failOn: "none" }).rotate().normalise().sharpen({ sigma: 0.7, m1: 0.7, m2: 1.4 });
  const maxSide = Math.max(meta.width || 0, meta.height || 0);
  if (maxSide && maxSide < 1200) {
    pipeline = pipeline.resize({
      width: (meta.width || 0) >= (meta.height || 0) ? 1200 : undefined,
      height: (meta.height || 0) > (meta.width || 0) ? 1200 : undefined,
      fit: "inside",
      withoutEnlargement: false,
      kernel: "lanczos3",
    });
  }
  await pipeline.png({ compressionLevel: 9 }).toFile(output);
  const outMeta = await sharp(output).metadata();
  return {
    enhancer: "sharp_normalise_sharpen",
    original_width: meta.width,
    original_height: meta.height,
    enhanced_width: outMeta.width,
    enhanced_height: outMeta.height,
    small_source: Boolean(maxSide && maxSide < 1200),
  };
}

function identityLockYaml(manifest) {
  return [
    "identity_lock:",
    `  source_images: ${JSON.stringify(manifest.source_images.map((item) => item.enhanced_path))}`,
    `  enhanced_source_image: ${JSON.stringify(manifest.primary_identity_image)}`,
    `  product_category: ${JSON.stringify(manifest.category || "")}`,
    "  must_preserve:",
    "    silhouette:",
    "    proportions:",
    "    primary_color:",
    "    material_appearance:",
    "    texture:",
    "    hardware:",
    "    closure:",
    "    strap_or_handle:",
    "    accessory_or_decoration:",
    "    logo_or_markings:",
    "    distinctive_details: []",
    "  flexible:",
    "    background: true",
    "    lighting: true",
    "    model_or_props: true",
    "    camera_angle: true",
    "    crop: true",
    "  forbidden_changes:",
    "    - changing color family",
    "    - changing silhouette or size ratio",
    "    - adding/removing product structures or accessories",
    "    - changing material appearance",
    "    - inventing interior, capacity, bundle items, branding, or certification",
    "  detail_checklist:",
    ...manifest.source_images.flatMap((item) => item.identity_evidence.map((evidence) => `    - ${item.role}: ${evidence}`)),
    "",
  ].join("\n");
}
