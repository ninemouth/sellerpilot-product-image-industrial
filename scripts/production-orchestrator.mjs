#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.tasks) usage();

const runDir = path.resolve(args["run-dir"]);
const tasksPath = path.resolve(args.tasks);
const execute = Boolean(args.execute);
const concurrency = Math.max(1, Math.min(4, Number(args.concurrency || 4)));
const cancelFile = args["cancel-file"] ? path.resolve(args["cancel-file"]) : path.join(runDir, "orchestration", "cancel");
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "orchestration");
const statePath = path.join(outDir, "production-orchestrator-state.json");
fs.mkdirSync(outDir, { recursive: true });

const priorState = readJson(statePath) || {};
const taskDoc = readJson(tasksPath);
const tasks = Array.isArray(taskDoc?.tasks) ? taskDoc.tasks.map(normalizeTask) : [];
if (!tasks.length) throw new Error("tasks file must contain tasks[].");
assertUniqueIds(tasks);
assertDependenciesExist(tasks);

const results = {};
const startedAt = new Date().toISOString();
writeState("running", "orchestration started");

let failed = false;
while (!failed) {
  if (fs.existsSync(cancelFile)) {
    markUnfinished("cancelled", "cancel file present");
    writeState("cancelled", `cancelled by ${cancelFile}`);
    break;
  }

  const ready = tasks.filter((task) => !results[task.id] && dependenciesCompleted(task, results));
  if (!ready.length) break;

  const batch = ready.slice(0, concurrency);
  for (const task of batch) {
    results[task.id] = {
      id: task.id,
      phase: task.phase,
      status: "running",
      started_at: new Date().toISOString(),
      hash: hashTask(task),
      depends_on: task.depends_on,
    };
  }
  writeState("running", `running ${batch.map((task) => task.id).join(", ")}`);

  const batchResults = await Promise.all(batch.map(runTask));
  for (const result of batchResults) results[result.id] = result;
  writeState("running", `finished ${batch.map((task) => task.id).join(", ")}`);
  failed = batchResults.some((result) => result.status === "failed");
}

if (!failed) {
  const blocked = tasks.filter((task) => !results[task.id]);
  if (blocked.length) {
    for (const task of blocked) {
      results[task.id] = {
        id: task.id,
        phase: task.phase,
        status: "blocked",
        blocked_reason: "dependency failed, missing, or cycle detected",
        hash: hashTask(task),
        depends_on: task.depends_on,
      };
    }
    writeState("blocked", "one or more tasks could not be scheduled");
    process.exitCode = 1;
  } else {
    writeState("completed", "all tasks finished");
  }
} else {
  markUnfinished("blocked", "upstream task failed");
  writeState("failed", "one or more tasks failed");
  process.exitCode = 1;
}

console.log(JSON.stringify(summarizeState(readJson(statePath)), null, 2));

async function runTask(task) {
  const started = Date.now();
  const currentHash = hashTask(task);
  const cached = cacheHit(task, currentHash);
  if (cached) {
    return {
      id: task.id,
      phase: task.phase,
      status: "cached",
      hash: currentHash,
      depends_on: task.depends_on,
      outputs: task.outputs,
      cache_reason: cached,
      ms: 0,
    };
  }
  if (!execute || !task.command.length) {
    return {
      id: task.id,
      phase: task.phase,
      status: "planned",
      hash: currentHash,
      depends_on: task.depends_on,
      outputs: task.outputs,
      skipped_reason: execute ? "no command supplied" : "dry run; pass --execute to run commands",
      ms: 0,
    };
  }

  const result = await spawnTask(task);
  return {
    id: task.id,
    phase: task.phase,
    status: result.exit_code === 0 ? "completed" : "failed",
    hash: currentHash,
    depends_on: task.depends_on,
    outputs: task.outputs,
    ms: Date.now() - started,
    ...result,
  };
}

function spawnTask(task) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(task.command[0], task.command.slice(1), {
      cwd: runDir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code, signal) => {
      resolve({
        exit_code: code,
        signal,
        command: task.command,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
        process_ms: Date.now() - started,
      });
    });
  });
}

function cacheHit(task, currentHash) {
  if (!task.outputs.length) return "";
  const prior = priorState.tasks?.find((item) => item.id === task.id);
  if (!prior || !["completed", "cached"].includes(prior.status)) return "";
  if (prior.hash !== currentHash) return "";
  if (!task.outputs.every((file) => fs.existsSync(resolveRunPath(file)))) return "";
  return "task hash unchanged and declared outputs exist";
}

function dependenciesCompleted(task, taskResults) {
  return task.depends_on.every((id) => ["completed", "cached", "planned"].includes(taskResults[id]?.status));
}

function markUnfinished(status, reason) {
  for (const task of tasks) {
    if (!results[task.id]) {
      results[task.id] = {
        id: task.id,
        phase: task.phase,
        status,
        reason,
        hash: hashTask(task),
        depends_on: task.depends_on,
      };
    }
  }
}

function writeState(status, message) {
  const now = new Date().toISOString();
  const state = {
    schema_version: "sellerpilot.production_orchestrator.v1",
    status,
    message,
    run_dir: runDir,
    tasks_path: tasksPath,
    concurrency,
    execute,
    cancel_file: cancelFile,
    started_at: startedAt,
    updated_at: now,
    tasks: tasks.map((task) => results[task.id] || {
      id: task.id,
      phase: task.phase,
      status: "pending",
      hash: hashTask(task),
      depends_on: task.depends_on,
    }),
    phase_spans_ms: phaseSpans(Object.values(results)),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function phaseSpans(items) {
  const spans = {};
  for (const item of items) {
    if (!item?.phase || !Number.isFinite(item.ms)) continue;
    spans[item.phase] = (spans[item.phase] || 0) + item.ms;
  }
  return spans;
}

function normalizeTask(task) {
  if (!task?.id) throw new Error("each task needs id");
  const command = Array.isArray(task.command) ? task.command.map(String) : [];
  return {
    ...task,
    id: String(task.id),
    phase: String(task.phase || "general"),
    depends_on: Array.isArray(task.depends_on) ? task.depends_on.map(String) : [],
    inputs: Array.isArray(task.inputs) ? task.inputs.map(String) : [],
    outputs: Array.isArray(task.outputs) ? task.outputs.map(String) : [],
    command,
  };
}

function hashTask(task) {
  const inputHashes = {};
  for (const input of task.inputs) {
    const file = resolveRunPath(input);
    inputHashes[input] = fs.existsSync(file) && fs.statSync(file).isFile()
      ? sha256(fs.readFileSync(file))
      : "missing";
  }
  return sha256(JSON.stringify({
    id: task.id,
    phase: task.phase,
    command: task.command,
    inputs: inputHashes,
    outputs: task.outputs,
    cache_key: task.cache_key || null,
  }));
}

function resolveRunPath(file) {
  return path.isAbsolute(file) ? file : path.join(runDir, file);
}

function assertUniqueIds(list) {
  const seen = new Set();
  for (const task of list) {
    if (seen.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    seen.add(task.id);
  }
}

function assertDependenciesExist(list) {
  const ids = new Set(list.map((task) => task.id));
  for (const task of list) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) throw new Error(`task ${task.id} depends on missing task ${dep}`);
    }
  }
}

function summarizeState(state) {
  const counts = {};
  for (const task of state.tasks || []) counts[task.status] = (counts[task.status] || 0) + 1;
  return {
    status: state.status,
    state: statePath,
    counts,
    phase_spans_ms: state.phase_spans_ms || {},
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function usage() {
  console.error("Usage: node scripts/production-orchestrator.mjs --run-dir /abs/run --tasks /abs/run/orchestration/tasks.json [--execute] [--concurrency 4] [--cancel-file /abs/run/orchestration/cancel]");
  process.exit(2);
}
