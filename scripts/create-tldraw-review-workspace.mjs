#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
node scripts/create-tldraw-review-workspace.mjs --out-dir /abs/review-workspace --image-dir /abs/final-images [--run-dir /abs/run] [--title "..."] [--session-id "..."]
node scripts/create-tldraw-review-workspace.mjs --out-dir /abs/review-workspace --images "/abs/a.png,/abs/b.png" [--run-dir /abs/run] [--title "..."] [--session-id "..."]

Creates a React + Vite + tldraw review workspace with copied image assets and
data/import-manifest.json for Codex-readable annotation handoff.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"] || (!args["image-dir"] && !args.images)) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const templateDir = path.join(skillRoot, "assets", "tldraw-review-workspace");
const outDir = path.resolve(args["out-dir"]);
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
const title = args.title || "SellerPilot Product Image Review";
const now = new Date().toISOString();
const sessionId = safeSessionId(args["session-id"] || inferSessionId(outDir));

let sourceImages = [];
if (args.images) {
  sourceImages = args.images.split(",").map((item) => item.trim()).filter(Boolean);
}
if (args["image-dir"]) {
  const imageDir = path.resolve(args["image-dir"]);
  sourceImages.push(...fs.readdirSync(imageDir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort()
    .map((name) => path.join(imageDir, name)));
}
sourceImages = [...new Set(sourceImages.map((item) => path.resolve(item)))];
if (!sourceImages.length) usage();

if (!fs.existsSync(templateDir)) {
  throw new Error(`Template directory not found: ${templateDir}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(templateDir, outDir, { recursive: true });

const publicImageDir = path.join(outDir, "public", "imported-images");
fs.mkdirSync(publicImageDir, { recursive: true });

const images = sourceImages.map((sourcePath, index) => {
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const base = path.basename(sourcePath, ext)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `image-${index + 1}`;
  const id = idFromName(base, index);
  const file = base.toUpperCase().startsWith(id) ? `${base}${ext}` : `${id}-${base}${ext}`;
  const dest = path.join(publicImageDir, file);
  fs.copyFileSync(sourcePath, dest);
  return {
    id,
    file: path.basename(sourcePath),
    copied_file: file,
    path: sourcePath,
    src: `/imported-images/${file}`,
    role_hint: roleHint(path.basename(sourcePath)),
    status: "review_pending",
  };
});

const manifest = {
  workspace: {
    title,
    run_dir: runDir,
    session_id: sessionId,
    created_at: now,
    source: "sellerpilot-product-image-industrial",
  },
  images,
  protocol: {
    annotations_file: "data/annotations.json",
    canvas_state_file: "data/canvas-state.json",
    generation_tasks_file: "data/generation-tasks.json",
  },
};

fs.writeFileSync(path.join(outDir, "data", "import-manifest.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(outDir, "data", "annotations.json"), JSON.stringify({
  schema_version: "sellerpilot.review_annotations.v1",
  exported_at: "",
  workspace: manifest.workspace,
  annotations: [],
}, null, 2));
fs.writeFileSync(path.join(outDir, "data", "canvas-state.json"), JSON.stringify({
  schema_version: "sellerpilot.canvas_state.v1",
  updated_at: "",
  snapshot: null,
  fallback_layout: images.map((image, index) => ({
    image_id: image.id,
    file: image.file,
    path: image.path,
    x: 64 + (index % 4) * 360,
    y: 96 + Math.floor(index / 4) * 470,
  })),
}, null, 2));
fs.writeFileSync(path.join(outDir, "data", "generation-tasks.json"), JSON.stringify({
  schema_version: "sellerpilot.generation_tasks.v1",
  created_at: "",
  source_annotations: "",
  tasks: [],
}, null, 2));

fs.writeFileSync(path.join(outDir, "HOW_TO_USE_WITH_CODEX.md"), [
  "# SellerPilot tldraw Review Workspace",
  "",
  "Preferred shared-service flow:",
  "",
  "```bash",
  `node ${path.join(skillRoot, "scripts", "register-tldraw-review-session.mjs")} --workspace-dir ${outDir} --session-id ${sessionId}`,
  `node ${path.join(skillRoot, "scripts", "start-tldraw-shared-service.mjs")} --session-id ${sessionId}`,
  "```",
  "",
  "This uses one shared local tldraw service and opens this workspace as a session.",
  "",
  "Review flow:",
  "",
  "1. Open the Vite URL in Codex/Browser.",
  "2. Use tldraw for arrows, sketches, and spatial notes.",
  "3. Use the left panel to create deterministic per-image annotations.",
  "4. Export `annotations.json` and save it to `data/annotations.json`.",
  "5. Ask Codex to run `parse-canvas-annotations.mjs` to create `data/generation-tasks.json`.",
  "",
  "Codex handoff command:",
  "",
  "```bash",
  `node ${path.join(skillRoot, "scripts", "parse-canvas-annotations.mjs")} --annotations ${path.join(outDir, "data", "annotations.json")} --out ${path.join(outDir, "data", "generation-tasks.json")}`,
  "```",
  "",
  "Controlled launcher:",
  "",
  "```bash",
  `node ${path.join(skillRoot, "scripts", "start-tldraw-review-workspace.mjs")} --workspace-dir ${outDir}`,
  "```",
  "",
  "The isolated launcher writes `data/server-state.json` and reuses a live server for this workspace instead of starting duplicates.",
  "",
].join("\n"));

console.log(JSON.stringify({
  status: "created",
  outDir,
  sessionId,
  images: images.length,
  next: [
    `node ${path.join(skillRoot, "scripts", "register-tldraw-review-session.mjs")} --workspace-dir ${outDir} --session-id ${sessionId}`,
    `node ${path.join(skillRoot, "scripts", "start-tldraw-shared-service.mjs")} --session-id ${sessionId}`,
  ],
}, null, 2));

function idFromName(name, index) {
  const match = name.match(/^(IMG|POSTER|DETAIL)-\d{2}/i);
  if (match) return match[0].toUpperCase();
  return `IMG-${String(index + 1).padStart(2, "0")}`;
}

function roleHint(name) {
  const value = name.toLowerCase();
  if (/scene|wear|outfit|commute|weekend|lifestyle/.test(value)) return "scene_or_lifestyle";
  if (/detail|macro|quality|material/.test(value)) return "detail";
  if (/main|hero/.test(value)) return "main";
  if (/summary|decision/.test(value)) return "summary";
  return "general";
}

function safeSessionId(value) {
  return String(value || "session")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "session";
}

function inferSessionId(dir) {
  const parent = path.basename(path.dirname(dir));
  const self = path.basename(dir);
  return parent && parent !== "." ? parent : self;
}
