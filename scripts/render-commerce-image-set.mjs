#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
NODE_PATH=<node_modules> node scripts/render-commerce-image-set.mjs \\
  --source-image /abs/product.png \\
  --out-dir /abs/output-dir \\
  --product-name "复古棕色单肩女包" \\
  --dimensions "28 x 8 x 20cm" \\
  --platform "拼多多"

Optional:
  --copy-json /abs/copy.json
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  --allow-scene-layout-draft

The script renders one 1200x1200 PNG per copy-json panel.
Each panel may include "image", "image_path", "generated_asset_path", or
"scene_asset_path" to use a generated scene/detail asset. Scene roles require a
panel-specific generated/photo scene asset unless --allow-scene-layout-draft is set.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["source-image"] || !args["out-dir"] || !args["product-name"]) usage();

const sourceImage = path.resolve(args["source-image"]);
const outDir = path.resolve(args["out-dir"]);
const productName = args["product-name"];
const dimensions = args.dimensions || "";
const platform = args.platform || "电商平台";
const sourceUrl = pathToFileURL(sourceImage).href;
fs.mkdirSync(outDir, { recursive: true });

const defaultPanels = [
  { asset_id: "IMG-01-main-product", slug: "main-product", title: productName, sub: "通勤 / 逛街 / 约会都好搭", tag: "一眼看清包型与颜色", mode: "main", camera_angle: "front three-quarter" },
  { asset_id: "IMG-02-size-scale", slug: "size-scale", title: "尺寸清楚", sub: dimensions || "长宽高信息", tag: "日常出门更好判断大小", mode: "size", camera_angle: "front measurement" },
  { asset_id: "IMG-03-detail-quality", slug: "detail-quality", title: "细节更耐看", sub: "开合 / 五金 / 走线 / 配件", tag: "近看也有搭配亮点", mode: "details", camera_angle: "macro detail grid" },
  { asset_id: "IMG-04-wearing-scene", slug: "wearing-scene", title: "上身更好搭", sub: "单肩 / 斜挎 / 日常通勤", tag: "搭配裙装、外套都自然", mode: "plain", camera_angle: "on-body three-quarter" },
  { asset_id: "IMG-05-daily-carry-scale", slug: "daily-carry-scale", title: "随身小物好搭配", sub: "手机 / 口红 / 钥匙 / 纸巾 / 小钱包", tag: "小物放置为尺寸参考", mode: "capacity", camera_angle: "top-down beside-product scale" },
  { asset_id: "IMG-06-lifestyle-scene", slug: "lifestyle-scene", title: "场景轻松搭配", sub: "通勤、逛街、约会都适合", tag: "换个场合也不突兀", mode: "plain", camera_angle: "lifestyle environment" },
  { asset_id: "IMG-07-decision-summary", slug: "decision-summary", title: "一眼看懂", sub: "颜色 / 尺寸 / 背法 / 细节", tag: "下单前重点信息集中看", mode: "summary", camera_angle: "summary layout" },
];

const panels = args["copy-json"]
  ? JSON.parse(fs.readFileSync(args["copy-json"], "utf8"))
  : defaultPanels;

const css = `
*{box-sizing:border-box} body{margin:0;background:#f4eee8;font-family:"Hiragino Sans GB","PingFang SC",Arial,sans-serif;color:#321b12}
.panel{width:1200px;height:1200px;position:relative;overflow:hidden;background:linear-gradient(145deg,#fffaf5 0%,#f2dfcf 100%);border:1px solid #ead7ca}
.panel:before{content:"";position:absolute;inset:42px;border:2px solid rgba(133,82,46,.13)}
.headline{position:absolute;top:64px;left:72px;right:72px;z-index:2}.headline span{display:inline-grid;place-items:center;width:68px;height:68px;border-radius:50%;background:#7a421f;color:#fff;font-weight:800;font-size:28px;margin-right:18px}
h1{display:inline;font-size:64px;line-height:1;margin:0;letter-spacing:0}.headline p{margin:22px 0 0;font-size:34px;color:#75452d;font-weight:600}
.photo{position:absolute;left:115px;right:115px;bottom:130px;top:255px;display:grid;place-items:center}.bag{max-width:92%;max-height:92%;object-fit:contain;filter:drop-shadow(0 24px 34px rgba(62,32,18,.18))}
.foot{position:absolute;left:72px;right:72px;bottom:58px;margin:0;font-size:30px;color:#fff;background:#8a512d;border-radius:999px;padding:20px 34px;text-align:center;font-weight:700}
.main{background:#fff}.main .photo{top:205px}.measure{position:absolute;z-index:3;background:#7a421f;color:#fff;padding:16px 24px;border-radius:14px;font-size:34px;font-weight:800}
.measure-a{left:260px;bottom:24px}.measure-b{right:18px;top:220px}.measure-c{left:72px;top:270px}
.detail-grid{position:absolute;left:72px;right:72px;top:230px;bottom:145px;display:grid;grid-template-columns:1fr 1fr;gap:26px}.detail-card{position:relative;overflow:hidden;border-radius:24px;background:#fff;border:2px solid #ead4c4}.detail-card img{width:100%;height:100%;object-fit:cover;transform:scale(1.72)}.detail-card b{position:absolute;left:18px;bottom:18px;background:rgba(122,66,31,.92);color:#fff;padding:12px 20px;border-radius:999px;font-size:28px}
.items{position:absolute;right:95px;top:360px;width:390px;display:grid;grid-template-columns:1fr 1fr;gap:18px}.items div{height:112px;border-radius:24px;background:#fff;border:2px dashed #bf8c6b;display:grid;place-items:center;font-size:32px;font-weight:900;color:#7a421f}
.summary-list{position:absolute;right:72px;top:285px;width:450px;display:grid;gap:18px}.summary-list div{background:#fff;border-radius:24px;padding:22px 26px;border-left:14px solid #8a512d}.summary-list b{display:block;color:#8a512d;font-size:28px;margin-bottom:8px}.summary-list span{font-size:34px;font-weight:900}
`;

function panelImageUrl(panel) {
  const panelImage = panelImagePath(panel);
  return panelImage ? pathToFileURL(path.resolve(panelImage)).href : sourceUrl;
}

validateSceneAssets(panels);

function panelHtml(panel, index) {
  const num = String(index + 1).padStart(2, "0");
  const mode = panel.mode || "plain";
  const imageUrl = panelImageUrl(panel);
  let body = `<div class="photo"><img class="bag" src="${imageUrl}"></div>`;
  if (mode === "size") {
    const parts = (dimensions.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)/i) || []).slice(1);
    body = `<div class="photo"><span class="measure measure-a">长 ${parts[0] || ""}cm</span><span class="measure measure-b">高 ${parts[2] || ""}cm</span><span class="measure measure-c">宽 ${parts[1] || ""}cm</span><img class="bag" src="${imageUrl}"></div>`;
  }
  if (mode === "details") {
    const detailTiles = panel.detail_tiles || [
      { label: "顺滑开合", origin: "22% 18%", scale: 1.9 },
      { label: "五金扣环", origin: "18% 48%", scale: 2.1 },
      { label: "走线边缘", origin: "58% 72%", scale: 2.0 },
      { label: "挂件点缀", origin: "12% 78%", scale: 2.2 },
    ];
    body = `<div class="detail-grid">${detailTiles.map((tile) => `<div class="detail-card"><img src="${imageUrl}" style="transform:scale(${Number(tile.scale || 1.9)});transform-origin:${escapeHtml(tile.origin || "50% 50%")}"><b>${escapeHtml(tile.label || "细节")}</b></div>`).join("")}</div>`;
  }
  if (mode === "capacity") {
    body = `<div class="photo" style="right:470px"><img class="bag" src="${imageUrl}"></div><div class="items"><div>手机</div><div>口红</div><div>钥匙</div><div>纸巾</div><div>小钱包</div></div>`;
  }
  if (mode === "summary") {
    body = `<div class="photo" style="right:560px"><img class="bag" src="${imageUrl}"></div><div class="summary-list"><div><b>平台</b><span>${escapeHtml(platform)}</span></div><div><b>尺寸</b><span>${escapeHtml(dimensions || "待确认")}</span></div><div><b>背法</b><span>单肩 / 斜挎</span></div><div><b>细节</b><span>拉链 / 扣环 / 挂件</span></div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><section id="panel" class="panel ${mode}"><div class="headline"><span>${num}</span><h1>${escapeHtml(panel.title)}</h1><p>${escapeHtml(panel.sub || "")}</p></div>${body}<p class="foot">${escapeHtml(panel.tag || "")}</p></section></body></html>`;
}

let chromium;
try {
  chromium = require("playwright").chromium;
} catch (error) {
  const bundled = "/Users/yang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
  try {
    chromium = require(bundled).chromium;
  } catch {
    console.error("Missing playwright. Set NODE_PATH to bundled node_modules or install playwright.");
    throw error;
  }
}

const launchOptions = { headless: true };
if (args.chrome) launchOptions.executablePath = args.chrome;
else if (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")) launchOptions.executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
else if (fs.existsSync("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")) launchOptions.executablePath = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1 });
const imagePaths = [];
for (let i = 0; i < panels.length; i += 1) {
  const panel = panels[i];
  const stem = outputStem(panel, i);
  const htmlPath = path.join(outDir, `_${stem}.html`);
  fs.writeFileSync(htmlPath, panelHtml(panel, i));
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForLoadState("networkidle");
  const out = path.join(outDir, `${stem}.png`);
  await page.locator("#panel").screenshot({ path: out });
  imagePaths.push(out);
}
await browser.close();

console.log(outDir);

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function outputStem(panel, index) {
  const raw = panel.filename || panel.asset_id || `${stablePrefix(index)}-${panel.slug || "panel"}`;
  return String(raw)
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()
    .replace(/^IMG-(\d{2})-(.*)$/i, (_, n, rest) => `IMG-${n}-${rest.toLowerCase()}`)
    .replace(/^POSTER-(\d{2})-(.*)$/i, (_, n, rest) => `POSTER-${n}-${rest.toLowerCase()}`)
    .replace(/^DETAIL-(\d{2})-(.*)$/i, (_, n, rest) => `DETAIL-${n}-${rest.toLowerCase()}`);
}

function stablePrefix(index) {
  return `IMG-${String(index + 1).padStart(2, "0")}`;
}

function panelImagePath(panel) {
  return panel.scene_asset_path || panel.generated_asset_path || panel.image || panel.image_path || panel.source_image;
}

function hasPanelSpecificGeneratedSceneAsset(panel) {
  if (panel.scene_asset_path || panel.generated_asset_path) return true;
  const assetType = normalize([
    panel.scene_asset_type,
    panel.final_asset_type,
    panel.asset_type,
    panel.asset_origin,
    panel.generation_status,
  ].filter(Boolean).join(" "));
  return Boolean((panel.image || panel.image_path) && /(built_in|imagegen|runtime|generated|photo|scene_asset|approved)/i.test(assetType));
}

function isScenePanel(panel) {
  return /场景|上身|穿搭|通勤|咖啡|逛街|约会|街|lifestyle|wear|outfit|commute|cafe|date|street|shopping/i.test([
    panel.image_role,
    panel.role,
    panel.title,
    panel.slug,
    panel.asset_id,
    panel.background_or_scene,
  ].filter(Boolean).join(" "));
}

function validateSceneAssets(panelList) {
  if (args["allow-scene-layout-draft"]) return;
  const failures = [];
  for (let i = 0; i < panelList.length; i += 1) {
    const panel = panelList[i];
    if (!isScenePanel(panel)) continue;
    const imagePath = panelImagePath(panel);
    const resolved = imagePath ? path.resolve(imagePath) : "";
    if (!hasPanelSpecificGeneratedSceneAsset(panel)) {
      failures.push(`image ${i + 1}: scene role has no panel-specific generated/photo scene asset`);
      continue;
    }
    if (resolved && resolved === sourceImage) {
      failures.push(`image ${i + 1}: scene role reuses the source product cutout as the scene asset`);
    }
  }
  if (failures.length) {
    throw new Error([
      "Scene roles cannot be rendered as final images from layout/cutout assets alone.",
      "Prepare real GPT built-in generated scene assets first, or rerun with --allow-scene-layout-draft for draft-only review.",
      ...failures,
    ].join("\n"));
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
