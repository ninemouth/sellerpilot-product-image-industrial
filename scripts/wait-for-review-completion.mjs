#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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
node scripts/wait-for-review-completion.mjs --workspace-dir /abs/run/review-workspace [--run-dir /abs/run] [--session-id run-id] [--timeout-ms 600000]

Waits for the tldraw Complete Review handoff, parses review-completion.json into
generation-tasks.json, and writes a Codex wakeup report for the next revision step.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["workspace-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const workspaceDir = path.resolve(args["workspace-dir"]);
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : inferRunDir(workspaceDir);
const sessionId = args["session-id"] || readJson(path.join(workspaceDir, "data", "import-manifest.json"))?.workspace?.session_id || "";
const sharedRoot = path.resolve(expandHome(args["shared-root"] || "~/.codex/sellerpilot-product-image-industrial/canvas-service"));
const timeoutMs = Number(args["timeout-ms"] ?? 600000);
const pollMs = Number(args["poll-ms"] ?? 1000);
const startedAt = Date.now();

const candidates = completionCandidates({ workspaceDir, sharedRoot, sessionId });
let ready = null;
while (Date.now() - startedAt <= timeoutMs) {
  ready = findReady(candidates);
  if (ready) break;
  await sleep(pollMs);
}

if (!ready) {
  const report = {
    schema_version: "sellerpilot.review_completion_wakeup.v1",
    status: "timeout",
    checked_at: new Date().toISOString(),
    workspace_dir: workspaceDir,
    run_dir: runDir,
    session_id: sessionId,
    timeout_ms: timeoutMs,
    candidates,
    next_codex_step: "Ask the user to click Complete Review or provide the downloaded review-completion.json.",
  };
  writeWakeupReport({ runDir, workspaceDir, report });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else {
  const completionPath = ready.completion_file || path.join(path.dirname(ready.ready_file), "review-completion.json");
  const tasksPath = path.join(workspaceDir, "data", "generation-tasks.json");
  const parse = spawnSync(process.execPath, [
    path.join(skillRoot, "scripts", "parse-canvas-annotations.mjs"),
    "--annotations", completionPath,
    "--out", tasksPath,
    ...(runDir ? ["--run-dir", runDir] : []),
  ], { cwd: skillRoot, encoding: "utf8" });
  if (parse.status !== 0) {
    throw new Error([
      `parse-canvas-annotations failed with exit ${parse.status}`,
      parse.stdout?.trim(),
      parse.stderr?.trim(),
    ].filter(Boolean).join("\n"));
  }
  const tasks = readJson(tasksPath) || {};
  const report = {
    schema_version: "sellerpilot.review_completion_wakeup.v1",
    status: "ready",
    completed_at: new Date().toISOString(),
    workspace_dir: workspaceDir,
    run_dir: runDir,
    session_id: sessionId,
    ready_file: ready.ready_file,
    completion_file: completionPath,
    generation_tasks_file: tasksPath,
    task_count: Number(tasks.task_count || 0),
    grouped_summary: tasks.grouped_summary || {},
    next_codex_step: tasks.task_count
      ? "Continue revision using generation-tasks.json; revise only affected assets."
      : "No open annotation tasks found; ask whether to finalize or collect more feedback.",
  };
  writeWakeupReport({ runDir, workspaceDir, report });
  console.log(JSON.stringify(report, null, 2));
}

function completionCandidates({ workspaceDir: workspace, sharedRoot: shared, sessionId: session }) {
  const list = [
    {
      source: "workspace",
      ready_file: path.join(workspace, "data", "review-completion-ready.json"),
      completion_file: path.join(workspace, "data", "review-completion.json"),
    },
  ];
  if (session) {
    list.push({
      source: "shared-session",
      ready_file: path.join(shared, "public", "sessions", session, "data", "review-completion-ready.json"),
      completion_file: path.join(shared, "public", "sessions", session, "data", "review-completion.json"),
    });
  }
  return list;
}

function findReady(candidates) {
  for (const candidate of candidates) {
    const ready = readJson(candidate.ready_file);
    if (ready?.status === "ready" && fs.existsSync(candidate.completion_file)) {
      return {
        ...candidate,
        ...ready,
        ready_file: candidate.ready_file,
        completion_file: candidate.completion_file,
      };
    }
  }
  return null;
}

function writeWakeupReport({ runDir: run, workspaceDir: workspace, report }) {
  fs.mkdirSync(path.join(workspace, "data"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "data", "review-completion-wakeup-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (run) {
    fs.mkdirSync(path.join(run, "qa"), { recursive: true });
    fs.writeFileSync(path.join(run, "qa", "review-completion-wakeup-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
}

function inferRunDir(workspace) {
  const base = path.basename(workspace);
  if (base === "review-workspace") return path.dirname(workspace);
  return "";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandHome(value) {
  return String(value).replace(/^~(?=$|\/)/, os.homedir());
}
