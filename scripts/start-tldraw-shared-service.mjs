#!/usr/bin/env node
import fs from "node:fs";
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
node scripts/start-tldraw-shared-service.mjs [--shared-root ~/.codex/sellerpilot-canvas-service] [--port 5190] [--session-id ...] [--no-install] [--dry-run]

Starts or reuses one shared tldraw canvas service. Individual chats/runs are
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

if (!fs.existsSync(path.join(sharedRoot, "package.json"))) {
  fs.mkdirSync(sharedRoot, { recursive: true });
  fs.cpSync(templateDir, sharedRoot, { recursive: true });
}

const existing = readJson(statePath);
if (existing?.pid && processAlive(existing.pid)) {
  const base = existing.base_url || `http://${host}:${existing.port}/`;
  const url = sessionUrl(base, args["session-id"]);
  if (await urlReady(url, 2500)) {
    console.log(JSON.stringify({
      status: "already_running",
      sharedRoot,
      pid: existing.pid,
      port: existing.port,
      url,
      statePath,
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
  }, null, 2));
  process.exit(0);
}

if (!args["no-install"] && !fs.existsSync(path.join(sharedRoot, "node_modules"))) {
  const install = spawnSync("npm", ["install"], { cwd: sharedRoot, stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status || 1);
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const stdout = fs.openSync(path.join(logDir, "vite.stdout.log"), "a");
const stderr = fs.openSync(path.join(logDir, "vite.stderr.log"), "a");
const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
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
  }, null, 2));
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
