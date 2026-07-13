#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
node scripts/start-tldraw-shared-service.mjs [--shared-root ~/.codex/sellerpilot-canvas-service] [--port 5190] [--session-id ...] [--prepare-only] [--dry-run]

Prepares or starts one shared tldraw canvas service. Preparation syncs the
template and installs dependencies once during skill install/update; normal
task startup only reuses prepared dependencies. Individual chats/runs are
opened as sessions with /?session=<session-id>.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const templateDir = path.join(skillRoot, "assets", "tldraw-review-workspace");
const sharedRoot = path.resolve(expandHome(args["shared-root"] || "~/.codex/sellerpilot-product-image-industrial/canvas-service"));
const statePath = path.join(sharedRoot, "data", "shared-server-state.json");
const logDir = path.join(sharedRoot, "logs");
const host = "127.0.0.1";
const waitMs = args["wait-ms"] ? Number(args["wait-ms"]) : 20000;
const preparing = Boolean(args["prepare-only"]);

const templateSync = syncSharedTemplate({
  templateDir,
  sharedRoot,
  dryRun: Boolean(args["dry-run"]) || !preparing,
});
const dependency = prepareDependencies({ sharedRoot, dryRun: Boolean(args["dry-run"]), templateSync, allowInstall: preparing });

if (args["prepare-only"]) {
  console.log(JSON.stringify({
    status: dependency.status,
    sharedRoot,
    dependency,
    templateSync,
  }, null, 2));
  process.exit(dependency.status === "prepared" || dependency.status === "already_prepared" || args["dry-run"] ? 0 : 1);
}

if (!dependenciesReady(sharedRoot)) {
  console.log(JSON.stringify({
    status: "blocked_canvas_dependencies_not_prepared",
    sharedRoot,
    message: "Canvas dependencies were not prepared during skill installation or update. Run the shared service prepare command before production.",
  }, null, 2));
  process.exit(1);
}

const existing = readJson(statePath);
if (existing?.pid && processAlive(existing.pid)) {
  const base = existing.base_url || `http://${host}:${existing.port}/`;
  const url = sessionUrl(base, args["session-id"]);
  if (!templateSync.changed && await urlReady(url, 2500)) {
    console.log(JSON.stringify({
      status: "already_running",
      sharedRoot,
      pid: existing.pid,
      port: existing.port,
      url,
      statePath,
      templateSync,
    }, null, 2));
    process.exit(0);
  }
  try {
    process.kill(Number(existing.pid), "SIGTERM");
  } catch {
    // Stale state or inaccessible process; continue with a fresh server.
  }
}

const port = args.port ? Number(args.port) : await findFreePort(5190);
const baseUrl = `http://${host}:${port}/`;
const url = sessionUrl(baseUrl, args["session-id"]);

if (args["dry-run"]) {
  console.log(JSON.stringify({
    status: "dry_run",
    sharedRoot,
    port,
    url,
    statePath,
    templateSync,
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const stdout = fs.openSync(path.join(logDir, "vite.stdout.log"), "a");
const stderr = fs.openSync(path.join(logDir, "vite.stderr.log"), "a");
const child = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
  cwd: sharedRoot,
  detached: true,
  stdio: ["ignore", stdout, stderr],
});
child.unref();

const state = {
  schema_version: "sellerpilot.shared_review_server_state.v1",
  status: "running",
  shared_root: sharedRoot,
  pid: child.pid,
  host,
  port,
  base_url: baseUrl,
  url,
  started_at: new Date().toISOString(),
  logs: {
    stdout: path.join(logDir, "vite.stdout.log"),
    stderr: path.join(logDir, "vite.stderr.log"),
  },
};
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

const ready = await waitForUrl(url, waitMs);
if (!ready) {
  state.status = "starting_unverified";
  state.warning = `Server process started but ${url} did not respond within ${waitMs}ms. Check logs before presenting as ready.`;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({
    status: "starting_unverified",
    sharedRoot,
    pid: child.pid,
    port,
    url,
    statePath,
    logs: state.logs,
    templateSync,
    warning: state.warning,
  }, null, 2));
  process.exitCode = 1;
} else {
  state.status = "ready";
  state.ready_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({
    status: "ready",
    sharedRoot,
    pid: child.pid,
    port,
    url,
    statePath,
    templateSync,
  }, null, 2));
}

function syncSharedTemplate({ templateDir: sourceDir, sharedRoot: destDir, dryRun }) {
  const sourceHash = hashTemplate(sourceDir);
  const markerPath = path.join(destDir, "data", "template-sync.json");
  const existingMarker = readJson(markerPath);
  const missingApp = !fs.existsSync(path.join(destDir, "package.json")) || !fs.existsSync(path.join(destDir, "src", "main.jsx"));
  const changed = missingApp || existingMarker?.source_hash !== sourceHash;
  const result = {
    source_hash: sourceHash,
    previous_hash: existingMarker?.source_hash || null,
    changed,
    dry_run: dryRun,
  };
  if (!changed || dryRun) return result;

  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ["package.json", "package-lock.json", "index.html", "vite.config.js"]) {
    const source = path.join(sourceDir, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(destDir, name));
  }
  for (const name of ["src"]) {
    const source = path.join(sourceDir, name);
    const dest = path.join(destDir, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, { recursive: true });
  }
  fs.mkdirSync(path.join(destDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(destDir, "public", "sessions"), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({
    schema_version: "sellerpilot.tldraw_template_sync.v1",
    source_hash: sourceHash,
    synced_at: new Date().toISOString(),
    source_dir: sourceDir,
  }, null, 2));
  result.synced = true;
  return result;
}

function prepareDependencies({ sharedRoot: root, dryRun, templateSync, allowInstall }) {
  const markerPath = path.join(root, "data", "dependency-preparation.json");
  const lockPath = path.join(root, "package-lock.json");
  const lockHash = fs.existsSync(lockPath) ? crypto.createHash("sha256").update(fs.readFileSync(lockPath)).digest("hex") : "";
  const existing = readJson(markerPath);
  const needsInstall = !dependenciesReady(root) || existing?.lock_hash !== lockHash || templateSync.changed;
  if (!needsInstall) return { status: "already_prepared", lock_hash: lockHash, marker_path: markerPath };
  if (!allowInstall) return { status: "not_prepared", lock_hash: lockHash, marker_path: markerPath };
  if (dryRun) return { status: "dry_run", lock_hash: lockHash, marker_path: markerPath, would_install: true };
  const install = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
  if (install.status !== 0) return { status: "failed", lock_hash: lockHash, marker_path: markerPath };
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({
    schema_version: "sellerpilot.tldraw_dependency_preparation.v1",
    status: "prepared",
    prepared_at: new Date().toISOString(),
    lock_hash: lockHash,
  }, null, 2));
  return { status: "prepared", lock_hash: lockHash, marker_path: markerPath };
}

function dependenciesReady(root) {
  return fs.existsSync(path.join(root, "node_modules", "vite")) && fs.existsSync(path.join(root, "node_modules", "tldraw"));
}

function hashTemplate(dir) {
  const hash = crypto.createHash("sha256");
  for (const file of listTemplateFiles(dir)) {
    hash.update(path.relative(dir, file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listTemplateFiles(dir) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "data", "public", "logs"].includes(entry.name)) continue;
        stack.push(full);
      } else if (/\.(json|js|jsx|css|html)$/.test(entry.name)) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

function expandHome(value) {
  return String(value).replace(/^~(?=$|\/)/, os.homedir());
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function sessionUrl(baseUrl, sessionId) {
  if (!sessionId) return baseUrl;
  return `${baseUrl}?session=${encodeURIComponent(sessionId)}`;
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") tryPort(port + 1);
        else reject(error);
      });
      server.once("listening", () => server.close(() => resolve(port)));
      server.listen(port, host);
    };
    tryPort(startPort);
  });
}

function urlReady(url, timeoutMs) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await urlReady(url, 1500)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}
