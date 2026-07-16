#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

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
node scripts/normalize-source-product-asset.mjs --input /abs/source-enhanced.png --out-dir /abs/run/source-normalized \\
  [--card-color "#ffffff"] [--threshold 30]

Creates layout-safe product assets from a user-owned source image:
  product-cutout-transparent.png
  product-on-card-safe.png
  product-normalization-report.json

This script is deterministic source-asset cleanup. It does not invent product
details and should not replace the original image for source understanding.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.input || !args["out-dir"]) usage();

const input = path.resolve(args.input);
const outDir = path.resolve(args["out-dir"]);
const cardColor = parseColor(args["card-color"] || "#ffffff");
const threshold = clamp(Number(args.threshold || 30), 8, 80);
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, "product-normalization-report.json");
const transparentPath = path.join(outDir, "product-cutout-transparent.png");
const cardSafePath = path.join(outDir, "product-on-card-safe.png");
const cacheKey = normalizationCacheKey({ input, cardColor, threshold });
const cached = readJsonSafe(reportPath);
if (cached?.cache?.key === cacheKey && fs.existsSync(cached.outputs?.product_cutout_transparent || transparentPath) && fs.existsSync(cached.outputs?.product_on_card_safe || cardSafePath)) {
  console.log(JSON.stringify({
    status: "cache_hit",
    transparentPath: cached.outputs.product_cutout_transparent,
    cardSafePath: cached.outputs.product_on_card_safe,
    reportPath,
  }, null, 2));
  process.exit(0);
}

let sharp;
try {
  sharp = require("sharp");
} catch (error) {
  const bundled = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
  try {
    sharp = require(bundled);
  } catch {
    console.error("Missing sharp. Set NODE_PATH to bundled node_modules or install sharp.");
    throw error;
  }
}

const originalImage = sharp(input, { failOn: "none" }).rotate();
const meta = await originalImage.metadata();
const source = sharp(input, { failOn: "none" }).rotate().ensureAlpha();
const width = meta.width || 0;
const height = meta.height || 0;
if (!width || !height) throw new Error(`Cannot read image dimensions for ${input}`);

const raw = await source.raw().toBuffer();
const background = estimateBorderBackground(raw, width, height);
const bgMask = floodFillBackground(raw, width, height, background, threshold);
const output = Buffer.from(raw);
let transparentPixels = 0;
let semitransparentPixels = 0;
let originalTransparentPixels = 0;

for (let i = 0; i < width * height; i += 1) {
  const offset = i * 4;
  if (raw[offset + 3] < 250) originalTransparentPixels += 1;
  if (bgMask[i]) {
    output[offset + 3] = 0;
    transparentPixels += 1;
    continue;
  }
  const d = colorDistance(raw[offset], raw[offset + 1], raw[offset + 2], background);
  if (d <= threshold + 14 && touchesBackground(bgMask, width, height, i)) {
    output[offset + 3] = Math.min(output[offset + 3], 210);
    semitransparentPixels += 1;
  }
}

await sharp(output, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 6 }).toFile(transparentPath);
await sharp(output, { raw: { width, height, channels: 4 } })
  .flatten({ background: cardColor })
  .png({ compressionLevel: 6 })
  .toFile(cardSafePath);

const backgroundCoverage = transparentPixels / Math.max(1, width * height);
const report = {
  schema_version: "sellerpilot.source_asset_normalization.v1",
  status: backgroundCoverage > 0.03 ? "normalized" : "no_large_background_removed",
  input,
  outputs: {
    product_cutout_transparent: transparentPath,
    product_on_card_safe: cardSafePath,
  },
  image: {
    width,
    height,
    has_alpha: Boolean(meta.hasAlpha),
    original_transparent_pixels: originalTransparentPixels,
  },
  normalization: {
    method: "edge-connected-background-removal",
    card_color: rgbToHex(cardColor),
    estimated_source_background_rgb: background,
    threshold,
    transparent_pixels: transparentPixels,
    semitransparent_edge_pixels: semitransparentPixels,
    background_coverage: Number(backgroundCoverage.toFixed(4)),
    layout_use_policy: "Use product-cutout-transparent.png for cards/infographics. Use product-on-card-safe.png only when the renderer cannot preserve alpha.",
    png_compression_level: 6,
  },
  cache: {
    key: cacheKey,
    source_hash: fileHash(input),
    reusable_when: "source hash, threshold, and card color are unchanged",
  },
  warnings: [
    "Use the original or enhanced source image for product recognition and visible-text reading.",
    "Inspect cutout edges for reflective, white, transparent, hairy, perforated, or fine-blade products before final delivery.",
    "Do not use a cutout pasted on a decorative background as a real lifestyle scene.",
  ],
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  transparentPath,
  cardSafePath,
  reportPath,
}, null, 2));

function normalizationCacheKey({ input: inputPath, cardColor: cardRgb, threshold: thresholdValue }) {
  return crypto.createHash("sha256").update(JSON.stringify({
    source_hash: fileHash(inputPath),
    card_color: rgbToHex(cardRgb),
    threshold: thresholdValue,
    algorithm: "edge-connected-background-removal-v1-png6",
  })).digest("hex");
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function estimateBorderBackground(buffer, widthValue, heightValue) {
  const samples = [];
  const margin = Math.max(2, Math.floor(Math.min(widthValue, heightValue) * 0.04));
  const step = Math.max(1, Math.floor(Math.min(widthValue, heightValue) / 90));
  for (let y = 0; y < heightValue; y += step) {
    for (let x = 0; x < widthValue; x += step) {
      const nearEdge = x < margin || y < margin || x >= widthValue - margin || y >= heightValue - margin;
      if (!nearEdge) continue;
      const offset = (y * widthValue + x) * 4;
      if (buffer[offset + 3] < 20) continue;
      samples.push([buffer[offset], buffer[offset + 1], buffer[offset + 2]]);
    }
  }
  if (!samples.length) return { r: 255, g: 255, b: 255 };
  return {
    r: median(samples.map((item) => item[0])),
    g: median(samples.map((item) => item[1])),
    b: median(samples.map((item) => item[2])),
  };
}

function floodFillBackground(buffer, widthValue, heightValue, background, thresholdValue) {
  const total = widthValue * heightValue;
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= widthValue || y >= heightValue) return;
    const index = y * widthValue + x;
    if (mask[index]) return;
    if (!isBackgroundLike(buffer, index, background, thresholdValue)) return;
    mask[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < widthValue; x += 1) {
    seed(x, 0);
    seed(x, heightValue - 1);
  }
  for (let y = 0; y < heightValue; y += 1) {
    seed(0, y);
    seed(widthValue - 1, y);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % widthValue;
    const y = Math.floor(index / widthValue);
    seed(x - 1, y);
    seed(x + 1, y);
    seed(x, y - 1);
    seed(x, y + 1);
  }
  return mask;
}

function isBackgroundLike(buffer, index, background, thresholdValue) {
  const offset = index * 4;
  if (buffer[offset + 3] < 20) return true;
  const d = colorDistance(buffer[offset], buffer[offset + 1], buffer[offset + 2], background);
  return d <= thresholdValue;
}

function touchesBackground(mask, widthValue, heightValue, index) {
  const x = index % widthValue;
  const y = Math.floor(index / widthValue);
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  return offsets.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= widthValue || ny >= heightValue) return false;
    return Boolean(mask[ny * widthValue + nx]);
  });
}

function colorDistance(r, g, b, background) {
  return Math.sqrt(
    (r - background.r) ** 2
    + (g - background.g) ** 2
    + (b - background.b) ** 2,
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function parseColor(value) {
  const text = String(value || "").trim();
  const hex = text.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  throw new Error(`Unsupported color ${value}; use #RRGGBB.`);
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
