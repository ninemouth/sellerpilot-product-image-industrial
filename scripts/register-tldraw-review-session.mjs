#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
node scripts/register-tldraw-review-session.mjs --workspace-dir /abs/run/review-workspace [--session-id chat-or-run-id] [--shared-root ~/.codex/sellerpilot-canvas-service]

Registers a run review workspace as a session in the shared tldraw canvas service.
The shared service can host many sessions at URLs like /?session=<session-id>.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["workspace-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const templateDir = path.join(skillRoot, "assets", "tldraw-review-workspace");
const workspaceDir = path.resolve(args["workspace-dir"]);
const sharedRoot = path.resolve(expandHome(args["shared-root"] || "~/.codex/sellerpilot-product-image-industrial/canvas-service"));
const sessionId = safeSessionId(args["session-id"] || inferSessionId(workspaceDir));
const sessionDir = path.join(sharedRoot, "public", "sessions", sessionId);

for (const required of [
  path.join(workspaceDir, "data", "import-manifest.json"),
  path.join(workspaceDir, "public", "imported-images"),
]) {
  if (!fs.existsSync(required)) {
    throw new Error(`Required workspace artifact not found: ${required}`);
  }
}

if (!fs.existsSync(path.join(sharedRoot, "package.json"))) {
  fs.mkdirSync(sharedRoot, { recursive: true });
  fs.cpSync(templateDir, sharedRoot, { recursive: true });
}

const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, "data", "import-manifest.json"), "utf8"));
const existingSessionManifestPath = path.join(sessionDir, "data", "import-manifest.json");
if (fs.existsSync(existingSessionManifestPath) && !args["allow-session-reuse"]) {
  const existing = readJson(existingSessionManifestPath);
  const existingWorkspace = existing?.workspace || {};
  const incomingWorkspace = manifest.workspace || {};
  const sameWorkspace = existingWorkspace.workspace_dir
    ? path.resolve(existingWorkspace.workspace_dir) === workspaceDir
    : false;
  const sameRun = existingWorkspace.run_id && incomingWorkspace.run_id
    ? existingWorkspace.run_id === incomingWorkspace.run_id
    : false;
  if (!sameWorkspace && !sameRun) {
    throw new Error(`Session id ${sessionId} is already registered for another workspace/run. Use a unique run_id/session_id or pass --allow-session-reuse intentionally.`);
  }
}

fs.rmSync(sessionDir, { recursive: true, force: true });
fs.mkdirSync(path.join(sessionDir, "data"), { recursive: true });
fs.cpSync(path.join(workspaceDir, "public", "imported-images"), path.join(sessionDir, "imported-images"), { recursive: true });
for (const name of ["annotations.json", "canvas-state.json", "generation-tasks.json"]) {
  const source = path.join(workspaceDir, "data", name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(sessionDir, "data", name));
}

const rewritten = {
  ...manifest,
  workspace: {
    ...(manifest.workspace || {}),
    session_id: sessionId,
    workspace_dir: workspaceDir,
    shared_root: sharedRoot,
    registered_at: new Date().toISOString(),
  },
  images: (manifest.images || []).map((image) => ({
    ...image,
    src: image.copied_file
      ? `/sessions/${sessionId}/imported-images/${image.copied_file}`
      : rewriteSessionSrc(image.src, sessionId),
  })),
};
fs.writeFileSync(path.join(sessionDir, "data", "import-manifest.json"), JSON.stringify(rewritten, null, 2));

const registryPath = path.join(sharedRoot, "data", "session-registry.json");
fs.mkdirSync(path.dirname(registryPath), { recursive: true });
const registry = readJson(registryPath) || { schema_version: "sellerpilot.canvas_session_registry.v1", sessions: [] };
registry.sessions = [
  ...(registry.sessions || []).filter((item) => item.session_id !== sessionId),
  {
    session_id: sessionId,
    workspace_dir: workspaceDir,
    session_dir: sessionDir,
    registered_at: new Date().toISOString(),
  },
];
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

console.log(JSON.stringify({
  status: "registered",
  sessionId,
  sharedRoot,
  sessionDir,
  url_path: `/?session=${encodeURIComponent(sessionId)}`,
}, null, 2));

function expandHome(value) {
  return String(value).replace(/^~(?=$|\/)/, os.homedir());
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

function rewriteSessionSrc(src, sessionIdValue) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/sessions/")) return src;
  if (src.startsWith("/")) return `/sessions/${sessionIdValue}${src}`;
  return src;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
