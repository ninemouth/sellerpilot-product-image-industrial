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
node scripts/product-background-card-consistency-gate.mjs --copy-json /abs/run/blueprint/panels.json --out-dir /abs/run/qa \\
  [--run-dir /abs/run] [--delta-threshold 12]

Checks that products placed on white/cards/infographics use transparent or
card-safe source assets instead of a visible gray/white rectangular source
background.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["copy-json"] || !args["out-dir"]) usage();

const copyJson = path.resolve(args["copy-json"]);
const outDir = path.resolve(args["out-dir"]);
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : inferRunDirFromCopyJson(copyJson);
const deltaThreshold = Number(args["delta-threshold"] || 12);
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

const panels = JSON.parse(fs.readFileSync(copyJson, "utf8"));
if (!Array.isArray(panels)) throw new Error("copy-json must be a JSON array");

const findings = [];
for (const [index, panel] of panels.entries()) {
  const imageIndex = index + 1;
  const layoutCard = isCardOrInfographicPanel(panel);
  const structuredRisk = textify([
    panel.product_background_card_mismatch,
    panel.product_rect_background_visible,
    panel.gray_source_background_visible,
    panel.grey_source_background_visible,
    panel.product_background_residue_risk,
    panel.final_product_background_review,
  ]);
  if (truthyRisk(structuredRisk)) {
    findings.push({
      severity: "fail",
      type: "product-background-card-mismatch",
      image_index: imageIndex,
      message: "Panel/final review reports a visible source image background rectangle or product/card background mismatch.",
    });
  }
  if (!layoutCard) continue;

  const assetPath = resolveAssetPath(panel, runDir);
  const normalizedReportPath = resolveNormalizedReportPath(panel, runDir);
  const hasTransparentSignal = truthySafe(textify([
    panel.uses_transparent_product_asset,
    panel.transparent_product_asset,
    panel.product_asset_has_alpha,
  ]));
  if (!assetPath && !hasTransparentSignal && !normalizedReportPath) {
    findings.push({
      severity: "warn",
      type: "missing-product-asset-background-evidence",
      image_index: imageIndex,
      message: "Card/infographic panel does not record a transparent/card-safe product asset or normalization report.",
    });
    continue;
  }

  const report = normalizedReportPath ? readJsonSafe(normalizedReportPath) : null;
  if (report?.outputs?.product_cutout_transparent && fs.existsSync(report.outputs.product_cutout_transparent)) {
    const bgCoverage = Number(report.normalization?.background_coverage || 0);
    if (bgCoverage <= 0.01 && !hasTransparentSignal) {
      findings.push({
        severity: "warn",
        type: "weak-source-background-normalization",
        image_index: imageIndex,
        source_report: normalizedReportPath,
        message: "Source asset normalization removed little or no background; inspect whether the product still has a visible rectangular source backdrop.",
      });
    }
    continue;
  }

  if (!assetPath || !fs.existsSync(assetPath)) continue;
  const analysis = await analyzeAssetBackground(assetPath, panel);
  if (!analysis.hasAlpha && analysis.deltaFromCard > deltaThreshold) {
    findings.push({
      severity: "fail",
      type: "product-background-card-mismatch",
      image_index: imageIndex,
      file: assetPath,
      message: `Product asset has no alpha and its edge background ${analysis.edgeBackgroundHex} differs from card ${analysis.cardColorHex} by ${analysis.deltaFromCard.toFixed(1)}. Use a transparent cutout or product-on-card-safe asset.`,
    });
  } else if (!analysis.hasAlpha) {
    findings.push({
      severity: "warn",
      type: "product-asset-no-alpha",
      image_index: imageIndex,
      file: assetPath,
      message: "Product asset has no alpha. It can pass only because its detected edge background is close to the card color.",
    });
  }
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.product_background_card_consistency_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  panel_count: panels.length,
  findings,
};

fs.writeFileSync(path.join(outDir, "product-background-card-consistency-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "product-background-card-consistency-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

async function analyzeAssetBackground(assetPath, panel) {
  const image = sharp(assetPath, { failOn: "none" }).rotate().ensureAlpha();
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const raw = await image.raw().toBuffer();
  const edge = estimateBorderBackground(raw, width, height);
  const card = parseColor(firstNonEmpty([
    panel.card_background_color,
    panel.card_color,
    panel.panel_background_color,
    panel.background_card_color,
    "#ffffff",
  ]));
  const transparentPixels = countTransparentPixels(raw, width, height);
  return {
    hasAlpha: Boolean(meta.hasAlpha && transparentPixels > width * height * 0.02),
    edgeBackground: edge,
    edgeBackgroundHex: rgbToHex(edge),
    cardColor: card,
    cardColorHex: rgbToHex(card),
    deltaFromCard: colorDistance(edge.r, edge.g, edge.b, card),
  };
}

function isCardOrInfographicPanel(panel) {
  const text = normalize(textify([
    panel.image_role,
    panel.role,
    panel.layout_intent,
    panel.graphic_design_intent,
    panel.visual_composition,
    panel.background_or_scene,
    panel.card_background_color,
    panel.card_color,
  ]));
  return /(card|white|infographic|spec|feature|comparison|parameter|clean marketplace|白卡|白底|卡片|参数|卖点|对比|信息图|规格|功能)/i.test(text);
}

function resolveAssetPath(panel, currentRunDir) {
  const value = firstNonEmpty([
    panel.product_cutout_path,
    panel.normalized_product_asset,
    panel.transparent_product_asset_path,
    panel.product_on_card_safe_path,
    panel.product_asset_path,
    panel.source_product_asset_path,
  ]);
  return resolveMaybeRelative(value, currentRunDir);
}

function resolveNormalizedReportPath(panel, currentRunDir) {
  const value = firstNonEmpty([
    panel.product_normalization_report,
    panel.source_asset_normalization_report,
    panel.normalized_asset_report,
  ]);
  return resolveMaybeRelative(value, currentRunDir);
}

function resolveMaybeRelative(value, currentRunDir) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (path.isAbsolute(text)) return text;
  if (currentRunDir) return path.resolve(currentRunDir, text);
  return path.resolve(path.dirname(copyJson), text);
}

function inferRunDirFromCopyJson(file) {
  const dir = path.dirname(file);
  if (path.basename(dir) === "blueprint" || path.basename(dir) === "copy") return path.dirname(dir);
  return null;
}

function estimateBorderBackground(buffer, widthValue, heightValue) {
  const samples = [];
  const margin = Math.max(2, Math.floor(Math.min(widthValue, heightValue) * 0.05));
  const step = Math.max(1, Math.floor(Math.min(widthValue, heightValue) / 80));
  for (let y = 0; y < heightValue; y += step) {
    for (let x = 0; x < widthValue; x += step) {
      const nearEdge = x < margin || y < margin || x >= widthValue - margin || y >= heightValue - margin;
      if (!nearEdge) continue;
      const offset = (y * widthValue + x) * 4;
      if (buffer[offset + 3] < 230) continue;
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

function countTransparentPixels(buffer, widthValue, heightValue) {
  let count = 0;
  for (let i = 0; i < widthValue * heightValue; i += 1) {
    if (buffer[i * 4 + 3] < 245) count += 1;
  }
  return count;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function parseColor(value) {
  const text = String(value || "").trim();
  const hex = text.match(/^#?([0-9a-f]{6})$/i)?.[1];
  if (!hex) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function colorDistance(r, g, b, background) {
  return Math.sqrt(
    (r - background.r) ** 2
    + (g - background.g) ** 2
    + (b - background.b) ** 2,
  );
}

function rgbToHex(color) {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function truthyRisk(value) {
  const text = normalize(textify(value));
  if (!text) return false;
  if (/^(false|no|none|pass|passed|ok|clear|clean|not_detected|not detected|无|没有|通过)$/.test(text)) return false;
  return /(true|yes|fail|failed|risk|detected|mismatch|visible|rectangle|gray|grey|background|residue|灰底|底色|矩形|色差|残留)/i.test(text);
}

function truthySafe(value) {
  const text = normalize(textify(value));
  return /^(true|yes|1|pass|passed|ok|transparent|alpha|clean|通过|透明)$/.test(text);
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
    "# Product Background Card Consistency Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Panel count: ${report.panel_count}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const item of report.findings) {
    const image = item.image_index ? ` image ${item.image_index}` : "";
    const file = item.file ? ` (${path.basename(item.file)})` : "";
    lines.push(`- [${item.severity}] ${item.type}${image}${file}: ${item.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
