#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectScopedImages, imageScopeUsage } from "./lib/image-scope.mjs";

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
  console.error(imageScopeUsage(`Usage:
node scripts/create-region-review-html.mjs --run-dir /abs/run --manifest /abs/run/export/final-images-manifest.json --out /abs/review/review.html
node scripts/create-region-review-html.mjs --run-dir /abs/run --image-dir /abs/run/final-images --out /abs/review/review.html
node scripts/create-region-review-html.mjs --images "/abs/IMG-01.png,/abs/IMG-02.png" --out /abs/review/review.html

Creates a review.html with A-H editable regions, click-position capture, quick issue types, and exportable revision feedback.`));
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.out || (!args.images && !args["image-dir"] && !args.manifest)) usage();

const scope = collectScopedImages(args, { purpose: "region-review-html" });
let images = scope.images;
if (!images.length) usage();

const out = path.resolve(args.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
const records = images.map((image, index) => ({
  id: inferId(image, index),
  path: path.resolve(image),
  url: pathToFileURL(path.resolve(image)).href,
}));

fs.writeFileSync(out, render(records));
console.log(out);

function inferId(image, index) {
  const base = path.basename(image, path.extname(image));
  const match = base.match(/^(?:IMG|POSTER|DETAIL)[-_]?\d+(?:[-_][a-z0-9]+)*$/i);
  return match ? base.replace(/_/g, "-").toUpperCase().replace(/^(IMG|POSTER|DETAIL)-(\d{2})-(.*)$/i, (_, type, n, rest) => `${type.toUpperCase()}-${n}-${rest.toLowerCase()}`) : `IMG-${String(index + 1).padStart(2, "0")}-review-image`;
}

function render(items) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>SellerPilot Region Review</title>
<style>
*{box-sizing:border-box} body{margin:0;background:#f5f0ea;color:#2f1a12;font-family:"PingFang SC",Arial,sans-serif}
header{position:sticky;top:0;z-index:3;background:#fff;border-bottom:1px solid #e6d5c8;padding:14px 20px;display:flex;gap:12px;align-items:center}
h1{font-size:20px;margin:0} button{border:1px solid #9a633c;background:#fff;color:#7a421f;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer}.primary{background:#7a421f;color:#fff}
main{padding:18px;display:grid;gap:18px}.card{background:#fff;border:1px solid #e6d5c8;border-radius:12px;padding:14px;display:grid;grid-template-columns:minmax(360px,620px) 1fr;gap:16px}
.imageWrap{position:relative;border:1px solid #ead8ca;background:#fff;overflow:hidden}.imageWrap img{display:block;width:100%}.marker{position:absolute;border:3px solid #e84b2a;background:rgba(232,75,42,.08);pointer-events:none;display:none}.markerLabel{position:absolute;background:#e84b2a;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;display:none;pointer-events:none}
.panel{display:grid;gap:10px;align-content:start}.meta{font-size:12px;color:#806858;word-break:break-all} label{display:grid;gap:4px;font-weight:700;color:#5d3a26} select,input,textarea{width:100%;border:1px solid #d8bdab;border-radius:8px;padding:8px;font:14px/1.45 inherit} textarea{height:92px;resize:vertical}.summary{white-space:pre-wrap;background:#fff;border:1px solid #e6d5c8;border-radius:12px;padding:14px}
</style>
</head>
<body>
<header><h1>商品图 A-H 区域返修</h1><button class="primary" id="copy">复制反馈汇总</button><button id="download">下载 JSON</button></header>
<main>
${items.map((item) => cardHtml(item)).join("\n")}
<section class="summary" id="summary"></section>
</main>
<script>
const regions = {
  A: "A区 产品主体",
  B: "B区 背景",
  C: "C区 主标题",
  D: "D区 副标题",
  E: "E区 卖点标签",
  F: "F区 装饰元素",
  G: "G区 人物/场景",
  H: "H区 整体风格"
};
function detectRegion(x, y) {
  if (x >= 30 && x <= 70 && y >= 25 && y <= 78) return "A";
  if (y <= 22) return "C";
  if (y > 22 && y <= 35 && x < 72) return "D";
  if (x >= 70 && y < 70) return "E";
  if (x < 18 || x > 82 || y < 14 || y > 86) return "B";
  if (x > 58 && y > 38 && y < 82) return "G";
  if (y > 78) return "F";
  return "H";
}
function defaultRequest(region) {
  if (region === "A") return "请直接修改A区 产品主体，保持产品比例、外观、结构、颜色、材质观感和品牌/标记一致。";
  if (region === "B") return "请调整B区 背景，保留产品主体与文案，增强干净度和平台调性。";
  if (region === "C") return "请优化C区 主标题，保持短、清楚、买家视角。";
  if (region === "D") return "请优化D区 副标题，避免内部话术和未证实承诺。";
  if (region === "E") return "请减少或优化E区 卖点标签，控制数量并避免密集小字。";
  if (region === "F") return "请调整F区 装饰元素，减少干扰并增加留白。";
  if (region === "G") return "请调整G区 人物/场景，让场景真实服务产品，不抢主体。";
  return "请调整H区 整体风格，保留产品和核心文案，只优化光影、色彩、氛围和层级。";
}
function updateSummary() {
  const blocks = [...document.querySelectorAll(".card")].map((card) => {
    const id = card.dataset.id;
    const x = card.querySelector(".x").value || "未点击";
    const y = card.querySelector(".y").value || "未点击";
    const region = card.querySelector(".region").value;
    const issue = card.querySelector(".issue").value;
    const request = card.querySelector(".request").value;
    return "修改 " + id + ":\\n点击位置：横向 " + x + " / 纵向 " + y + "\\n修改区域：" + regions[region] + "\\n问题类型：" + issue + "\\n具体要求：" + request;
  }).join("\\n\\n");
  document.getElementById("summary").textContent = blocks;
}
for (const card of document.querySelectorAll(".card")) {
  const wrap = card.querySelector(".imageWrap");
  const marker = card.querySelector(".marker");
  const label = card.querySelector(".markerLabel");
  wrap.addEventListener("click", (event) => {
    const rect = wrap.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) / rect.width * 100);
    const y = Math.round((event.clientY - rect.top) / rect.height * 100);
    const region = detectRegion(x, y);
    card.querySelector(".x").value = x + "%";
    card.querySelector(".y").value = y + "%";
    card.querySelector(".region").value = region;
    card.querySelector(".request").value = defaultRequest(region);
    marker.style.display = "block";
    marker.style.left = Math.max(0, x - 8) + "%";
    marker.style.top = Math.max(0, y - 8) + "%";
    marker.style.width = "16%";
    marker.style.height = "16%";
    label.style.display = "block";
    label.style.left = x + "%";
    label.style.top = y + "%";
    label.textContent = regions[region];
    updateSummary();
  });
  for (const input of card.querySelectorAll("select,input,textarea")) input.addEventListener("input", updateSummary);
}
document.getElementById("copy").onclick = async () => navigator.clipboard.writeText(document.getElementById("summary").textContent);
document.getElementById("download").onclick = () => {
  const data = [...document.querySelectorAll(".card")].map((card) => ({
    id: card.dataset.id,
    click: { x: card.querySelector(".x").value, y: card.querySelector(".y").value },
    region: card.querySelector(".region").value,
    issue: card.querySelector(".issue").value,
    request: card.querySelector(".request").value,
    path: card.dataset.path
  }));
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), revisions: data }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "region-revision-feedback.json";
  link.click();
};
updateSummary();
</script>
</body>
</html>`;
}

function cardHtml(item) {
  return `<section class="card" data-id="${escapeHtml(item.id)}" data-path="${escapeHtml(item.path)}">
  <div class="imageWrap"><img src="${item.url}" alt="${escapeHtml(item.id)}"><div class="marker"></div><div class="markerLabel"></div></div>
  <div class="panel">
    <h2>${escapeHtml(item.id)}</h2>
    <div class="meta">${escapeHtml(item.path)}</div>
    <label>点击位置 X<input class="x" readonly></label>
    <label>点击位置 Y<input class="y" readonly></label>
    <label>修改区域<select class="region">${Object.entries({
      A:"A区 产品主体",B:"B区 背景",C:"C区 主标题",D:"D区 副标题",E:"E区 卖点标签",F:"F区 装饰元素",G:"G区 人物/场景",H:"H区 整体风格"
    }).map(([key, value]) => `<option value="${key}">${value}</option>`).join("")}</select></label>
    <label>问题类型<select class="issue"><option>改产品一致性</option><option>改文案</option><option>改场景</option><option>改风格</option><option>减少杂乱</option><option>重出该图</option></select></label>
    <label>具体要求<textarea class="request">请点击图片选择修改区域，或手动填写返修要求。</textarea></label>
  </div>
</section>`;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
