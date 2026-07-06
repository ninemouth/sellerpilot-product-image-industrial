#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
node scripts/create-identity-consistency-review.mjs \\
  --source /abs/source.png \\
  --generated-dir /abs/generated-images \\
  --out-dir /abs/run/qa \\
  [--identity-lock /abs/identity-lock.yaml]

Alternative:
  --images "/abs/01.png,/abs/02.png"

Creates:
  identity-consistency-review.html
  identity-consistency-report.json

This tool creates a side-by-side product identity review surface. It does not
replace visual inspection.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.source || !args["out-dir"] || (!args["generated-dir"] && !args.images)) usage();

const source = path.resolve(args.source);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

let images = [];
if (args.images) {
  images = args.images.split(",").map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item));
}
if (args["generated-dir"]) {
  images = fs.readdirSync(args["generated-dir"])
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort()
    .map((name) => path.join(path.resolve(args["generated-dir"]), name));
}
if (!images.length) usage();

const identityLock = args["identity-lock"] && fs.existsSync(args["identity-lock"])
  ? readIdentityLock(path.resolve(args["identity-lock"]))
  : null;

const defaultChecklist = [
  "silhouette/proportions",
  "primary color family",
  "material appearance/texture",
  "hardware shape and color",
  "closure/zipper/opening",
  "strap or handle structure",
  "accessories/decorations",
  "logos/markings/patterns",
  "distinctive details",
  "no invented pockets/compartments/bundle items",
];

const lockChecklist = extractChecklist(identityLock);
const checklist = lockChecklist.length ? lockChecklist : defaultChecklist;
const report = {
  status: "needs_visual_review",
  created_at: new Date().toISOString(),
  source,
  identity_lock: args["identity-lock"] ? path.resolve(args["identity-lock"]) : null,
  checklist,
  generated_images: images.map((image, index) => ({
    index: index + 1,
    image,
    review_required: true,
    fail_if: [
      "product identity differs from source",
      "critical details are missing, added, or redesigned",
      "product is too hidden to verify",
      "detail crop cannot be traced to source evidence",
    ],
  })),
};

const reportPath = path.join(outDir, "identity-consistency-report.json");
const htmlPath = path.join(outDir, "identity-consistency-review.html");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(htmlPath, renderHtml({ source, images, checklist, reportPath }));
console.log(JSON.stringify({ htmlPath, reportPath, images: images.length }, null, 2));

function extractChecklist(lock) {
  if (!lock) return [];
  if (Array.isArray(lock.raw_checklist)) return lock.raw_checklist;
  const root = lock.identity_lock || lock;
  if (Array.isArray(root.detail_checklist)) {
    return root.detail_checklist.map((item) => {
      if (typeof item === "string") return item;
      return [item.item, item.expected].filter(Boolean).join(": ");
    }).filter(Boolean);
  }
  const must = root.must_preserve || {};
  const fields = [
    "silhouette",
    "proportions",
    "primary_color",
    "material_appearance",
    "texture",
    "hardware",
    "closure",
    "strap_or_handle",
    "accessory_or_decoration",
    "logo_or_markings",
  ];
  return fields.map((field) => must[field] ? `${field}: ${must[field]}` : "").filter(Boolean);
}

function readIdentityLock(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch {
    const lines = content.split(/\r?\n/);
    const rawChecklist = [];
    let inMustPreserve = false;
    let inDetailChecklist = false;
    for (const line of lines) {
      if (/^\s*must_preserve:\s*$/.test(line)) {
        inMustPreserve = true;
        inDetailChecklist = false;
        continue;
      }
      if (/^\s*detail_checklist:\s*/.test(line)) {
        inMustPreserve = false;
        inDetailChecklist = true;
        continue;
      }
      if (/^\s{2}\S/.test(line) && !/^\s{4}/.test(line)) {
        inMustPreserve = false;
        inDetailChecklist = false;
      }
      if (inMustPreserve) {
        const match = line.match(/^\s{4}([a-zA-Z0-9_]+):\s*(.*)$/);
        if (match && match[2]) rawChecklist.push(`${match[1]}: ${match[2]}`);
        if (match && !match[2] && match[1] !== "distinctive_details") rawChecklist.push(match[1]);
      }
      if (inDetailChecklist) {
        const match = line.match(/^\s*-\s*(.+)$/);
        if (match) rawChecklist.push(match[1]);
      }
    }
    return { raw_checklist: rawChecklist.filter(Boolean) };
  }
}

function renderHtml({ source, images, checklist, reportPath }) {
  const sourceUrl = pathToFileURL(source).href;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Product Identity Consistency Review</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:"PingFang SC",Arial,sans-serif;background:#f6f1ea;color:#2e1a12}
  header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e8d8ca;padding:18px 24px;z-index:2}
  h1{margin:0 0 8px;font-size:22px} p{margin:0;color:#755744}
  main{padding:22px;display:grid;gap:22px}.row{display:grid;grid-template-columns:360px 1fr 360px;gap:18px;align-items:start;background:#fff;border:1px solid #e8d8ca;border-radius:14px;padding:16px}
  .panel{border:1px solid #ead8ca;border-radius:12px;overflow:hidden;background:#fff}.panel h2{margin:0;padding:10px 12px;background:#fff7f0;font-size:15px}.panel img{display:block;width:100%;height:auto}
  .check{padding:0 8px}.check h2{font-size:16px;margin:0 0 10px}.check label{display:block;margin:8px 0;font-size:14px}.meta{font-size:12px;color:#7b6254;word-break:break-all;margin-top:10px}
</style>
</head>
<body>
<header>
  <h1>商品身份一致性检查</h1>
  <p>左侧为原图，中间为生成图，右侧按身份锁定细节逐项检查。报告：${escapeHtml(reportPath)}</p>
</header>
<main>
${images.map((image, index) => `
  <section class="row">
    <div class="panel"><h2>原图 / Source</h2><img src="${sourceUrl}"></div>
    <div class="panel"><h2>生成图 ${index + 1} / Generated</h2><img src="${pathToFileURL(image).href}"><div class="meta">${escapeHtml(image)}</div></div>
    <div class="check"><h2>一致性核对</h2>
      ${checklist.map((item) => `<label><input type="checkbox"> ${escapeHtml(item)}</label>`).join("")}
      <div class="meta">失败则只重生成该图；不要整套重跑。</div>
    </div>
  </section>`).join("\n")}
</main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
