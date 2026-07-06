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
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/create-review-canvas.mjs --images <comma-separated image paths> --out <review-canvas.html> [--title "..."]
node scripts/create-review-canvas.mjs --image-dir <directory> --out <review-canvas.html> [--title "..."]

The generated HTML is a local infinite-canvas style review board with draggable cards,
per-image annotations, localStorage persistence, and JSON export.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.out || (!args.images && !args["image-dir"])) usage();

let images = [];
if (args.images) {
  images = args.images.split(",").map((item) => item.trim()).filter(Boolean);
}
if (args["image-dir"]) {
  images = fs.readdirSync(args["image-dir"])
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort()
    .map((name) => path.join(args["image-dir"], name));
}
if (!images.length) usage();

const outPath = path.resolve(args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const title = args.title || "Product Image Review Canvas";
const boardId = `sellerpilot-review-${Buffer.from(outPath).toString("base64url").slice(0, 16)}`;

const cards = images.map((imagePath, index) => {
  const absolute = path.resolve(imagePath);
  const url = pathToFileURL(absolute).href;
  const label = path.basename(imagePath);
  const x = 80 + (index % 4) * 420;
  const y = 110 + Math.floor(index / 4) * 560;
  return { id: `img-${index + 1}`, index: index + 1, label, url, x, y, path: absolute };
});

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; --brown:#7a421f; --ink:#321b12; --paper:#fffaf5; --line:#e8d4c4; }
  * { box-sizing:border-box; }
  body { margin:0; overflow:hidden; font-family:"Hiragino Sans GB","PingFang SC",Arial,sans-serif; color:var(--ink); background:#f1e8df; }
  header { position:fixed; inset:0 0 auto 0; height:68px; z-index:5; display:flex; align-items:center; gap:14px; padding:0 18px; background:#fff; border-bottom:1px solid var(--line); box-shadow:0 6px 18px rgba(50,27,18,.06); }
  h1 { margin:0; font-size:20px; min-width:300px; }
  button { border:1px solid #caa68d; background:#fff; color:var(--brown); border-radius:10px; padding:9px 13px; font-weight:700; cursor:pointer; }
  button.primary { background:var(--brown); color:#fff; border-color:var(--brown); }
  .hint { margin-left:auto; color:#7d6253; font-size:13px; }
  #viewport { position:fixed; inset:68px 0 0 0; overflow:auto; cursor:grab; }
  #canvas { position:relative; width:2600px; height:1800px; background-image:radial-gradient(#d7c3b5 1px, transparent 1px); background-size:28px 28px; transform-origin:0 0; }
  .card { position:absolute; width:360px; background:#fff; border:1px solid var(--line); border-radius:18px; box-shadow:0 16px 38px rgba(50,27,18,.12); overflow:hidden; }
  .card.dragging { opacity:.86; box-shadow:0 26px 58px rgba(50,27,18,.18); }
  .card-handle { display:flex; align-items:center; gap:10px; padding:12px 14px; background:var(--paper); border-bottom:1px solid var(--line); cursor:grab; user-select:none; }
  .badge { width:30px; height:30px; display:grid; place-items:center; border-radius:999px; background:var(--brown); color:#fff; font-weight:900; }
  .label { font-size:13px; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  img { width:100%; display:block; background:#fff; }
  textarea { width:100%; height:112px; border:0; border-top:1px solid var(--line); resize:vertical; padding:12px; font:14px/1.5 inherit; outline:none; }
  .path { padding:8px 12px 12px; color:#8a6b59; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border-top:1px solid #f1e3d7; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <button id="reset">重置布局</button>
  <button id="export" class="primary">导出批注 JSON</button>
  <button id="clear">清空批注</button>
  <span class="hint">拖动卡片排布；批注自动保存在本机浏览器 localStorage。</span>
</header>
<main id="viewport"><section id="canvas">
${cards.map((card) => `
  <article class="card" data-id="${card.id}" style="left:${card.x}px; top:${card.y}px">
    <div class="card-handle"><span class="badge">${card.index}</span><span class="label">${escapeHtml(card.label)}</span></div>
    <img src="${card.url}" alt="${escapeHtml(card.label)}">
    <textarea placeholder="写批注：保留 / 修改 / 重出图 / 文案调整..."></textarea>
    <div class="path">${escapeHtml(card.path)}</div>
  </article>`).join("\n")}
</section></main>
<script>
const boardId = ${JSON.stringify(boardId)};
const initial = ${JSON.stringify(cards)};
const cards = [...document.querySelectorAll('.card')];
function loadState() {
  try { return JSON.parse(localStorage.getItem(boardId) || '{}'); } catch { return {}; }
}
function saveState() {
  const state = {};
  for (const card of cards) {
    state[card.dataset.id] = {
      left: card.style.left,
      top: card.style.top,
      note: card.querySelector('textarea').value
    };
  }
  localStorage.setItem(boardId, JSON.stringify(state));
}
function applyState() {
  const state = loadState();
  for (const card of cards) {
    const saved = state[card.dataset.id];
    if (!saved) continue;
    if (saved.left) card.style.left = saved.left;
    if (saved.top) card.style.top = saved.top;
    card.querySelector('textarea').value = saved.note || '';
  }
}
applyState();
for (const card of cards) {
  const handle = card.querySelector('.card-handle');
  const textarea = card.querySelector('textarea');
  textarea.addEventListener('input', saveState);
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    card.classList.add('dragging');
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = parseFloat(card.style.left);
    const startTop = parseFloat(card.style.top);
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      card.style.left = Math.max(0, startLeft + moveEvent.clientX - startX) + 'px';
      card.style.top = Math.max(0, startTop + moveEvent.clientY - startY) + 'px';
    };
    const up = () => {
      card.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      saveState();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
document.getElementById('reset').onclick = () => {
  for (const item of initial) {
    const card = document.querySelector('[data-id="' + item.id + '"]');
    card.style.left = item.x + 'px';
    card.style.top = item.y + 'px';
  }
  saveState();
};
document.getElementById('clear').onclick = () => {
  for (const card of cards) card.querySelector('textarea').value = '';
  saveState();
};
document.getElementById('export').onclick = () => {
  saveState();
  const annotations = initial.map((item) => {
    const card = document.querySelector('[data-id="' + item.id + '"]');
    return {
      id: item.id,
      index: item.index,
      label: item.label,
      path: item.path,
      note: card.querySelector('textarea').value,
      position: { left: card.style.left, top: card.style.top }
    };
  });
  const blob = new Blob([JSON.stringify({ title: ${JSON.stringify(title)}, exported_at: new Date().toISOString(), annotations }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'revision-annotations.json';
  link.click();
};
</script>
</body>
</html>`;

fs.writeFileSync(outPath, html);
console.log(outPath);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

