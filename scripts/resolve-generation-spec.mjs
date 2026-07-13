#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["out-dir"]) usage();

const platform = String(args.platform || "").trim();
const category = String(args.category || "").trim();
const requestedRatio = args["required-ratio"] || inferPlatformRatio(platform, category) || "1:1";
const ratio = parseRatio(requestedRatio);
const longEdge = Number(args["long-edge"] || 2560);
const size = args.size || sizeForRatio(ratio, longEdge);
const spec = {
  schema_version: "sellerpilot.generation_spec.v1",
  status: "ready",
  provider: String(args.provider || "thinkai-gpt-image-2"),
  platform: platform || null,
  category: category || null,
  required_ratio: ratio.label,
  requested_size: size,
  quality: String(args.quality || "hd"),
  policy: "Resolve platform ratio before provider execution. Do not generate a landscape default and discover a platform-ratio failure only at export.",
};
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "generation-spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
console.log(JSON.stringify(spec, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) result[key.slice(2)] = true;
    else { result[key.slice(2)] = value; i += 1; }
  }
  return result;
}

function usage() {
  console.error("Usage: node scripts/resolve-generation-spec.mjs --out-dir /abs/run/generation-spec [--platform Ozon] [--category apparel] [--required-ratio 3:4] [--size WIDTHxHEIGHT]");
  process.exit(2);
}

function inferPlatformRatio(platformName, categoryName) {
  if (/ozon|озон/i.test(platformName)) return /fresh|food|食品/i.test(categoryName) ? "1:1" : "3:4";
  if (/amazon|亚马逊|pinduoduo|拼多多|temu|shein|etsy/i.test(platformName)) return "1:1";
  return "";
}

function parseRatio(raw) {
  const match = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) throw new Error(`Invalid ratio: ${raw}`);
  return { width: Number(match[1]), height: Number(match[2]), label: `${match[1]}:${match[2]}` };
}

function sizeForRatio(ratio, longEdge) {
  const scale = longEdge / Math.max(ratio.width, ratio.height);
  const width = Math.max(64, Math.round((ratio.width * scale) / 2) * 2);
  const height = Math.max(64, Math.round((ratio.height * scale) / 2) * 2);
  return `${width}x${height}`;
}
