#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
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
node scripts/create-delivery-overview.mjs --image-dir /abs/run/final-images --out-dir /abs/run/overview [--title "Product image set overview"]

Creates SET-OVERVIEW-contact-sheet.png as a delivery/package overview image.
This overview is for review and handoff; it must not replace independent final images.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["image-dir"] || !args["out-dir"]) usage();

let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = require("/Users/yang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
}

const imageDir = path.resolve(args["image-dir"]);
const outDir = path.resolve(args["out-dir"]);
const title = args.title || "Product Image Set Overview";
fs.mkdirSync(outDir, { recursive: true });

const images = fs.readdirSync(imageDir)
  .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
  .sort()
  .map((name) => path.join(imageDir, name));
if (!images.length) usage();

const columns = Math.min(Number(args.columns || 4), Math.max(1, images.length));
const tileW = Number(args["tile-width"] || 390);
const thumbH = Number(args["thumb-height"] || 390);
const labelH = 34;
const gap = 30;
const margin = 30;
const titleH = title ? 54 : 0;
const rows = Math.ceil(images.length / columns);
const width = margin * 2 + columns * tileW + (columns - 1) * gap;
const height = margin * 2 + titleH + rows * (thumbH + labelH) + (rows - 1) * (gap + 20);

const composites = [];
if (title) {
  composites.push({
    input: Buffer.from(svgText(title, width - margin * 2, titleH, {
      fontSize: 30,
      fontWeight: 800,
      anchor: "start",
    })),
    left: margin,
    top: margin - 6,
  });
}

for (let i = 0; i < images.length; i += 1) {
  const row = Math.floor(i / columns);
  const col = i % columns;
  const left = margin + col * (tileW + gap);
  const top = margin + titleH + row * (thumbH + labelH + gap + 20);
  const thumb = await sharp(images[i], { failOn: "none" })
    .rotate()
    .resize(tileW, thumbH, { fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  composites.push({ input: thumb, left, top });
  composites.push({
    input: Buffer.from(svgText(labelFor(images[i]), tileW, labelH, {
      fontSize: 15,
      fontWeight: 500,
      anchor: "start",
    })),
    left,
    top: top + thumbH + 8,
  });
}

const overviewPath = path.join(outDir, "SET-OVERVIEW-contact-sheet.png");
await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: "#ffffff",
  },
})
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toFile(overviewPath);

const report = {
  status: "pass",
  checked_at: new Date().toISOString(),
  image_dir: imageDir,
  overview_image: overviewPath,
  image_count: images.length,
  columns,
  rows,
  purpose: "delivery_overview_contact_sheet_not_a_platform_final_image",
  source_images: images,
};
fs.writeFileSync(path.join(outDir, "delivery-overview-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "delivery-overview-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status: "pass", overviewPath, imageCount: images.length }, null, 2));

function labelFor(file) {
  return path.basename(file).replace(/\.(png|jpe?g|webp)$/i, "");
}

function svgText(text, widthValue, heightValue, options) {
  const escaped = escapeXml(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthValue}" height="${heightValue}">
  <style>text{font-family:Arial,Helvetica,sans-serif;fill:#111;letter-spacing:0}</style>
  <text x="0" y="${Math.max(18, Math.floor(heightValue * 0.68))}" font-size="${options.fontSize}" font-weight="${options.fontWeight}" text-anchor="${options.anchor}">${escaped}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toMarkdown(report) {
  return [
    "# Delivery Overview Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Image dir: ${report.image_dir}`,
    `- Overview image: ${report.overview_image}`,
    `- Image count: ${report.image_count}`,
    `- Purpose: ${report.purpose}`,
    "",
  ].join("\n");
}
