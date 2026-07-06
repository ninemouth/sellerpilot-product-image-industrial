#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
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
node scripts/start-tldraw-review-workspace.mjs --workspace-dir /abs/run/review-workspace [--port 5190] [--no-install] [--dry-run]

Starts one Vite/tldraw review server per workspace directory. If an existing
server for the same workspace is still alive, it returns that server instead of
starting another instance.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["workspace-dir"]) usage();

const workspaceDir = path.resolve(args["workspace-dir"]);
const statePath = path.join(workspaceDir, "data", "server-state.json");
const logDir = path.join(workspaceDir, "logs");
const host = "127.0.0.1";
const waitMs = args["wait-ms"] ? Number(args["wait-ms"]) : 20000;

if (!fs.existsSync(path.join(workspaceDir, "package.json"))) {
  throw new Error(`Workspace package.json not found: ${workspaceDir}`);
}

const existing = readJson(statePath);
if (existing?.pid && processAlive(existing.pid)) {
  const url = existing.url || `http://${host}:${existing.port}/`;
  if (await urlReady(url, 2500)) {
    console.log(JSON.stringify({
      status: "already_running",
      workspaceDir,
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

const requestedPort = args.port ? Number(args.port) : null;
const port = requestedPort || await findFreePort(5190);
const url = `http://${host}:${port}/`;

if (args["dry-run"]) {
  console.log(JSON.stringify({
    status: "dry_run",
    workspaceDir,
    port,
    url,
    statePath,
  }, null, 2));
  process.exit(0);
}

if (!args["no-install"] && !fs.existsSync(path.join(workspaceDir, "node_modules"))) {
  const install = spawnSync("npm", ["install"], {
    cwd: workspaceDir,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    process.exit(install.status || 1);
  }
}

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
const stdout = fs.openSync(path.join(logDir, "vite.stdout.log"), "a");
const stderr = fs.openSync(path.join(logDir, "vite.stderr.log"), "a");
const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
  cwd: workspaceDir,
  detached: true,
  stdio: ["ignore", stdout, stderr],
});
child.unref();

const state = {
  schema_version: "sellerpilot.review_server_state.v1",
  status: "running",
  workspace_dir: workspaceDir,
  pid: child.pid,
  host,
  port,
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
    workspaceDir,
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
    workspaceDir,
    pid: child.pid,
    port,
    url,
    statePath,
  }, null, 2));
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

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") tryPort(port + 1);
        else reject(error);
      });
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
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
