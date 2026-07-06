#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
node scripts/create-tldraw-review-workspace.mjs --out-dir /abs/review-workspace --manifest /abs/run/export/final-images-manifest.json --run-dir /abs/run [--title "..."] [--session-id "..."]
node scripts/create-tldraw-review-workspace.mjs --out-dir /abs/review-workspace --image-dir /abs/run/final-images --run-dir /abs/run [--title "..."] [--session-id "..."]
node scripts/create-tldraw-review-workspace.mjs --out-dir /abs/review-workspace --images "/abs/a.png,/abs/b.png" [--run-dir /abs/run] [--title "..."] [--session-id "..."]

Creates a React + Vite + tldraw review workspace with copied image assets and
data/import-manifest.json for Codex-readable annotation handoff. By default it
also starts or reuses the shared tldraw service and returns a ready URL. Pass
--no-auto-start for selftests or file-only artifact generation.`));
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"] || (!args["image-dir"] && !args.images && !args.manifest)) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const templateDir = path.join(skillRoot, "assets", "tldraw-review-workspace");
const outDir = path.resolve(args["out-dir"]);
const title = args.title || "SellerPilot Product Image Review";
const now = new Date().toISOString();
const autoStart = !args["no-auto-start"];
const scope = collectScopedImages(args, { purpose: "tldraw-review-workspace" });
const runDir = scope.runDir || (args["run-dir"] ? path.resolve(args["run-dir"]) : "");
const sessionId = safeSessionId(args["session-id"] || scope.runId || inferSessionId(outDir));
const sourceImages = [...new Set(scope.images.map((item) => path.resolve(item)))];
if (!sourceImages.length) usage();

if (!fs.existsSync(templateDir)) {
  throw new Error(`Template directory not found: ${templateDir}`);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(templateDir, outDir, { recursive: true });

const publicImageDir = path.join(outDir, "public", "imported-images");
fs.mkdirSync(publicImageDir, { recursive: true });

const usedCopiedFiles = new Set();
const images = sourceImages.map((sourcePath, index) => {
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const base = path.basename(sourcePath, ext)
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `image-${index + 1}`;
  const id = idFromName(base, index);
  const candidate = base.toUpperCase().startsWith(id) ? `${base}${ext}` : `${id}-${base}${ext}`;
  const file = uniqueFilename(candidate, usedCopiedFiles, index);
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
    run_id: scope.runId || "",
    session_id: sessionId,
    created_at: now,
    source: "sellerpilot-product-image-industrial",
    image_source: scope.source,
    image_manifest: scope.manifestPath || "",
  },
  images,
  protocol: {
    annotations_file: "data/annotations.json",
    canvas_state_file: "data/canvas-state.json",
    generation_tasks_file: "data/generation-tasks.json",
    review_completion_file: "data/review-completion.json",
    review_screenshot_pattern: "sellerpilot-review-*.png",
    layer_policy: "generated images are the bottom floor layer; standards and annotations float above; no independent canvas zoom",
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
  schema_version: "sellerpilot.canvas_state.v2",
  updated_at: "",
  snapshot: null,
  board: {
    zoom_policy: "locked-no-independent-canvas-zoom",
    layer_order: ["image-floor-layer", "standard-overlay-layer", "top-controls"],
  },
  fallback_layout: images.map((image, index) => ({
    image_id: image.id,
    file: image.file,
    copied_file: image.copied_file,
    path: image.path,
    x: 32 + (index % 3) * 372,
    y: 32 + Math.floor(index / 3) * 452,
    width: 332,
    height: 408,
  })),
}, null, 2));
fs.writeFileSync(path.join(outDir, "data", "generation-tasks.json"), JSON.stringify({
  schema_version: "sellerpilot.generation_tasks.v1",
  created_at: "",
  source_annotations: "",
  tasks: [],
}, null, 2));
fs.writeFileSync(path.join(outDir, "data", "review-completion.json"), JSON.stringify({
  schema_version: "sellerpilot.review_completion.v1",
  completed_at: "",
  workspace: manifest.workspace,
  annotations: [],
  annotation_count: 0,
  open_annotation_count: 0,
  review_screenshot: null,
  next_codex_step: "Click Complete Review in the browser, then have Codex capture the session or parse the downloaded review-completion.json.",
}, null, 2));

fs.writeFileSync(path.join(outDir, "HOW_TO_USE_WITH_CODEX.md"), [
  "# SellerPilot tldraw Review Workspace",
  "",
  autoStart ? "This workspace was created with automatic shared-service startup enabled." : "This workspace was created with automatic startup disabled.",
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
  "2. Generated images render as the bottom floor layer. Standards, A-H region guides, and annotations float above the images.",
  "3. Use the top image dropdown and direct image-standard form to create deterministic per-image annotations.",
  "4. Click `Complete Review` to create a screenshot plus `review-completion.json` browser handoff payload.",
  "5. Ask Codex to capture the session or parse the completion/annotations JSON into `data/generation-tasks.json`.",
  "",
  "Codex handoff command:",
  "",
  "```bash",
  `node ${path.join(skillRoot, "scripts", "parse-canvas-annotations.mjs")} --annotations ${path.join(outDir, "data", "annotations.json")} --out ${path.join(outDir, "data", "generation-tasks.json")}`,
  "```",
  "",
  "Codex screenshot/session capture command when a browser session URL is available:",
  "",
  "```bash",
  `node ${path.join(skillRoot, "scripts", "capture-review-session.mjs")} --url http://127.0.0.1:5190/?session=${sessionId} --out-dir ${path.join(outDir, "captures")}`,
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

const next = [
  `node ${path.join(skillRoot, "scripts", "register-tldraw-review-session.mjs")} --workspace-dir ${outDir} --session-id ${sessionId}`,
  `node ${path.join(skillRoot, "scripts", "start-tldraw-shared-service.mjs")} --session-id ${sessionId}`,
];

let autoStartResult = null;
if (autoStart) {
  autoStartResult = openReviewSession({ skillRoot, outDir, sessionId, args });
}

const status = autoStart
  ? autoStartResult?.status === "ready" ? "created_and_started" : "created_auto_start_blocked"
  : "created";

console.log(JSON.stringify({
  status,
  workspaceStatus: "created",
  outDir,
  sessionId,
  images: images.length,
  autoStart,
  url: autoStartResult?.url || null,
  autoStartResult,
  next,
}, null, 2));
if (autoStart && autoStartResult?.status !== "ready") process.exitCode = 1;

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

function uniqueFilename(candidate, used, index) {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const ext = path.extname(candidate);
  const stem = path.basename(candidate, ext);
  let next = `${stem}-${String(index + 1).padStart(2, "0")}${ext}`;
  let counter = 2;
  while (used.has(next)) {
    next = `${stem}-${String(index + 1).padStart(2, "0")}-${counter}${ext}`;
    counter += 1;
  }
  used.add(next);
  return next;
}

function inferSessionId(dir) {
  const parent = path.basename(path.dirname(dir));
  const self = path.basename(dir);
  return parent && parent !== "." ? parent : self;
}

function openReviewSession({ skillRoot, outDir, sessionId, args }) {
  const argv = [
    path.join(skillRoot, "scripts", "open-tldraw-review-session.mjs"),
    "--workspace-dir",
    outDir,
    "--session-id",
    sessionId,
  ];
  if (args["shared-root"]) argv.push("--shared-root", args["shared-root"]);
  if (args["wait-ms"]) argv.push("--wait-ms", String(args["wait-ms"]));
  if (args["no-install"]) argv.push("--no-install");
  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return {
      status: "blocked",
      error: result.stderr || result.stdout || `open-tldraw-review-session exited ${result.status}`,
    };
  }
  try {
    return JSON.parse(lastJsonObject(result.stdout));
  } catch (error) {
    return {
      status: "blocked",
      error: `open-tldraw-review-session did not return JSON: ${error.message}`,
      stdout: result.stdout,
    };
  }
}

function lastJsonObject(output) {
  const text = String(output || "").trim();
  const start = text.lastIndexOf("\n{");
  return start >= 0 ? text.slice(start + 1) : text;
}
