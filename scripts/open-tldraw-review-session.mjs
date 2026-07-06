#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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
node scripts/open-tldraw-review-session.mjs --workspace-dir /abs/run/review-workspace [--session-id run-id] [--shared-root ~/.codex/...] [--wait-ms 20000] [--no-install]

Registers a tldraw review workspace into the shared service, starts or reuses
the shared service, waits until the session URL is reachable, and prints the
ready URL. Use this as the final workflow step when interactive review is next.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["workspace-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const workspaceDir = path.resolve(args["workspace-dir"]);
const sessionId = args["session-id"] || inferSessionId(workspaceDir);
const sharedRootArgs = args["shared-root"] ? ["--shared-root", args["shared-root"]] : [];
const waitArgs = args["wait-ms"] ? ["--wait-ms", String(args["wait-ms"])] : [];
const noInstallArgs = args["no-install"] ? ["--no-install"] : [];

const register = runJson([
  path.join(skillRoot, "scripts", "register-tldraw-review-session.mjs"),
  "--workspace-dir",
  workspaceDir,
  "--session-id",
  sessionId,
  ...sharedRootArgs,
]);

const started = runJson([
  path.join(skillRoot, "scripts", "start-tldraw-shared-service.mjs"),
  "--session-id",
  sessionId,
  ...sharedRootArgs,
  ...waitArgs,
  ...noInstallArgs,
]);

const ok = ["ready", "already_running"].includes(started.status);
const result = {
  status: ok ? "ready" : "blocked",
  sessionId,
  workspaceDir,
  url: started.url,
  register,
  service: started,
};

console.log(JSON.stringify(result, null, 2));
if (!ok) process.exitCode = 1;

function runJson(argv) {
  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(argv[0])} failed: ${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(lastJsonObject(result.stdout));
  } catch (error) {
    throw new Error(`${path.basename(argv[0])} did not return JSON: ${error.message}\n${result.stdout}`);
  }
}

function lastJsonObject(output) {
  const text = String(output || "").trim();
  const start = text.lastIndexOf("\n{");
  return start >= 0 ? text.slice(start + 1) : text;
}

function inferSessionId(dir) {
  const parent = path.basename(path.dirname(dir));
  const self = path.basename(dir);
  return parent && parent !== "." ? parent : self;
}
