#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
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
node scripts/enhance-source-image.mjs --input /abs/source.png --out-dir /abs/run/source-enhanced

Outputs:
  source-enhanced.png
  source-quality-report.json

This is a deterministic preflight enhancer for low-quality seller photos:
auto-orient, normalize, mild sharpen, optional upscale to 1200px max side,
and quality report. It does not invent missing product details.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.input || !args["out-dir"]) usage();

const input = path.resolve(args.input);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

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

const image = sharp(input, { failOn: "none" }).rotate();
const meta = await image.metadata();
const stats = await image.stats();
const width = meta.width || 0;
const height = meta.height || 0;
const minSide = Math.min(width, height);
const maxSide = Math.max(width, height);
const channels = stats.channels || [];
const luminanceApprox = channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / Math.max(1, Math.min(3, channels.length));
const isSmall = maxSide > 0 && maxSide < 1200;
const isVerySmall = maxSide > 0 && maxSide < 800;
const likelyDark = luminanceApprox < 70;
const likelyWashed = luminanceApprox > 235;

const enhancedPath = path.join(outDir, "source-enhanced.png");
let pipeline = sharp(input, { failOn: "none" })
  .rotate()
  .normalise()
  .modulate({ brightness: likelyDark ? 1.08 : 1, saturation: 1.02 })
  .sharpen({ sigma: 0.8, m1: 0.8, m2: 1.6 });

if (isSmall) {
  pipeline = pipeline.resize({
    width: width >= height ? 1200 : undefined,
    height: height > width ? 1200 : undefined,
    fit: "inside",
    withoutEnlargement: false,
    kernel: "lanczos3",
  });
}

await pipeline.png({ compressionLevel: 9 }).toFile(enhancedPath);
const outMeta = await sharp(enhancedPath).metadata();

const report = {
  input,
  output: enhancedPath,
  original: {
    width,
    height,
    format: meta.format,
    space: meta.space,
    hasAlpha: Boolean(meta.hasAlpha),
    luminanceApprox: Number(luminanceApprox.toFixed(2)),
  },
  enhanced: {
    width: outMeta.width,
    height: outMeta.height,
    format: outMeta.format,
  },
  findings: {
    isSmall,
    isVerySmall,
    likelyDark,
    likelyWashed,
  },
  recommendedUse: isVerySmall
    ? "Use enhanced image for planning and layout, but generate/re-shoot scene assets for final marketing images."
    : "Use enhanced image as source identity reference and deterministic layout input.",
  warning: "Enhancement is deterministic cleanup only; it must not invent material, hardware, dimensions, capacity, certifications, or brand facts.",
};

const reportPath = path.join(outDir, "source-quality-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ enhancedPath, reportPath }, null, 2));
