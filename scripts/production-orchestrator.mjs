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
const cacheContext = taskDoc?.cache_context || {};
const dispatcherRegistryPath = path.resolve(args["dispatcher-registry"] || path.join(runDir, "orchestration", "dispatcher-registry.json"));
const dispatcherRegistry = readJson(dispatcherRegistryPath) || { classes: {} };
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
  const paused = Object.values(results).some((item) => item.status === "paused" || String(item.status || "").startsWith("awaiting_"));
  if (paused) {
    for (const task of blocked) {
      results[task.id] = {
        id: task.id,
        phase: task.phase,
        status: "blocked",
        blocked_reason: "upstream structured agent, provider, native host, or human handoff is awaiting evidence",
        hash: hashTask(task),
        depends_on: task.depends_on,
      };
    }
    writeState("paused", "external execution boundary reached");
  } else if (blocked.length) {
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
    if (["agent_planning", "audit_optional"].includes(task.execution_class)) appendJsonLine(path.join(runDir, "telemetry", "agent-context-ledger.jsonl"), {
      schema_version: "sellerpilot.agent_context_ledger.v1", event: "context_cache_hit", at: new Date().toISOString(), task_id: task.id,
      actual_input_tokens: null, actual_output_tokens: null, cache_hit: true,
    });
    return finishTask(task, started, currentHash, { status: "cached", cache_reason: cached });
  }
  if (!execute) {
    return {
      id: task.id,
      phase: task.phase,
      status: "planned",
      hash: currentHash,
      depends_on: task.depends_on,
      outputs: task.outputs,
      skipped_reason: "dry run; pass --execute to run commands",
      ms: 0,
    };
  }
  const dispatcher = resolveDispatcher(task);
  if (dispatcher.strategy === "human_pause") {
    return finishTask(task, started, currentHash, { status: "awaiting_human", paused_reason: "A human decision artifact is required before this task can continue." });
  }
  if (dispatcher.strategy === "artifact_handoff") {
    if (outputsExist(task)) return finishTask(task, started, currentHash, { status: "completed", completion_reason: "declared agent artifacts already exist" });
    const handoff = writeAgentHandoff(task, dispatcher);
    return finishTask(task, started, currentHash, { status: "awaiting_agent", paused_reason: "Structured agent planning handoff was written; resume after its declared outputs exist.", handoff });
  }
  if (!task.command.length) {
    if (dispatcher.strategy === "generation_controller") {
      const handoff = writeProviderHandoff(task, dispatcher);
      return finishTask(task, started, currentHash, { status: "awaiting_provider_or_native_host", paused_reason: "Provider task has no local command binding; an explicit provider/native-host handoff was written.", handoff });
    }
    return finishTask(task, started, currentHash, { status: "failed", exit_code: null, stderr: `dispatcher ${dispatcher.strategy} requires a bound command` });
  }

  const result = await spawnTask(task);
  if (result.exit_code !== 0) return finishTask(task, started, currentHash, { status: "failed", ...result });
  if (task.execution_class === "provider_generation") {
    const controller = readJson(path.join(runDir, "generated-assets", "execution-controller-state.json"));
    if (/awaiting_external|awaiting_host|awaiting_prompt/i.test(String(controller?.status || "")) || !outputsExist(task)) {
      return finishTask(task, started, currentHash, { status: "awaiting_provider_or_native_host", paused_reason: "Generation controller is awaiting a prompt, provider result, or native host callback.", controller_status: controller?.status || null, ...result });
    }
  }
  if (!outputsExist(task)) return finishTask(task, started, currentHash, { status: "failed", stderr: "Command exited successfully but one or more declared outputs are missing.", ...result });
  return finishTask(task, started, currentHash, { status: "completed", ...result });
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
  if (!prior.output_digest || prior.output_digest !== hashDeclaredOutputs(task.outputs)) return "";
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
    execution_class: task.execution_class ? String(task.execution_class) : null,
    depends_on: Array.isArray(task.depends_on) ? task.depends_on.map(String) : [],
    inputs: Array.isArray(task.inputs) ? task.inputs.map(String) : [],
    outputs: Array.isArray(task.outputs) ? task.outputs.map(String) : [],
    command,
    dispatcher: task.dispatcher && typeof task.dispatcher === "object" ? task.dispatcher : null,
    context_rules: Array.isArray(task.context_rules) ? task.context_rules.map(String) : [],
  };
}

function hashTask(task) {
  const inputHashes = {};
  for (const input of task.inputs) {
    inputHashes[input] = hashPath(resolveRunPath(input));
  }
  return sha256(JSON.stringify({
    id: task.id,
    phase: task.phase,
    command: task.command,
    inputs: inputHashes,
    outputs: task.outputs,
    cache_key: task.cache_key || null,
    cache_context: cacheContext,
    dispatcher: resolveDispatcher(task),
    dependency_hashes: Object.fromEntries(task.depends_on.map((id) => {
      const dependency = results[id] || priorState.tasks?.find((item) => item.id === id);
      return [id, dependency ? `${dependency.hash || "missing"}:${dependency.output_digest || "missing-output-digest"}` : "missing"];
    })),
  }));
}

function resolveDispatcher(task) {
  if (task.dispatcher) return task.dispatcher;
  if (dispatcherRegistry.classes?.[task.execution_class]) return dispatcherRegistry.classes[task.execution_class];
  if (["agent_planning", "audit_optional"].includes(task.execution_class)) return { strategy: "artifact_handoff" };
  if (task.execution_class === "provider_generation") return { strategy: "generation_controller" };
  if (task.execution_class === "human_decision") return { strategy: "human_pause" };
  return { strategy: "direct_command" };
}

function outputsExist(task) {
  return task.outputs.length > 0 && task.outputs.every((file) => fs.existsSync(resolveRunPath(file)));
}

function finishTask(task, started, currentHash, details) {
  const ended = Date.now();
  const result = {
    id: task.id,
    phase: task.phase,
    hash: currentHash,
    depends_on: task.depends_on,
    outputs: task.outputs,
    execution_class: task.execution_class,
    ms: ended - started,
    input_bytes: pathsBytes(task.inputs),
    output_bytes: pathsBytes(task.outputs),
    output_digest: hashDeclaredOutputs(task.outputs),
    ...details,
  };
  appendJsonLine(path.join(runDir, "telemetry", "phase-events.jsonl"), {
    schema_version: "sellerpilot.phase_event.v1",
    event: "task_span",
    task_id: task.id,
    phase: task.phase,
    execution_class: task.execution_class,
    status: result.status,
    started_at: new Date(started).toISOString(),
    ended_at: new Date(ended).toISOString(),
    duration_ms: result.ms,
    input_bytes: result.input_bytes,
    output_bytes: result.output_bytes,
    cache_hit: result.status === "cached",
  });
  return result;
}

function writeAgentHandoff(task, dispatcher) {
  const packDir = path.join(runDir, "orchestration", "context-packs");
  const handoffDir = path.join(runDir, "orchestration", "handoffs");
  const evidencePaths = unique(["planning/normalized-task.json", ...task.inputs, ...task.depends_on.flatMap((id) => tasks.find((item) => item.id === id)?.outputs || [])]);
  const evidence = evidencePaths.filter((file) => fs.existsSync(resolveRunPath(file))).map((file) => {
    const absolute = resolveRunPath(file);
    const stat = fs.statSync(absolute);
    return { path: file, bytes: pathBytes(absolute), sha256: stat.isFile() ? sha256(fs.readFileSync(absolute)) : null };
  });
  const pack = {
    schema_version: "sellerpilot.agent_context_pack.v1",
    created_at: new Date().toISOString(),
    task: { id: task.id, phase: task.phase, execution_class: task.execution_class, trigger_reason: task.trigger_reason },
    instructions: dispatcher.instructions || task.dispatcher?.instructions || "Produce only the declared outputs from the supplied evidence and rule IDs.",
    rule_ids: task.context_rules,
    evidence,
    declared_outputs: task.outputs,
    quality_policy: "Do not weaken identity, physical truth, copy, scene, localization, material, lineage, or final-delivery gates to save tokens.",
  };
  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  const packPath = path.join(packDir, `${task.id}.json`);
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(packPath, serialized);
  const estimate = Math.ceil(Buffer.byteLength(serialized) / 4);
  appendJsonLine(path.join(runDir, "telemetry", "agent-context-ledger.jsonl"), {
    schema_version: "sellerpilot.agent_context_ledger.v1", event: "context_pack_created", at: new Date().toISOString(), task_id: task.id,
    context_bytes: Buffer.byteLength(serialized), estimated_input_tokens: estimate, actual_input_tokens: null, actual_output_tokens: null,
    rule_ids: task.context_rules, evidence_bytes: evidence.reduce((sum, item) => sum + item.bytes, 0), cache_hit: false,
  });
  const handoff = {
    schema_version: "sellerpilot.agent_task_handoff.v1", created_at: new Date().toISOString(), task_id: task.id,
    context_pack: path.relative(runDir, packPath).split(path.sep).join("/"), expected_outputs: task.outputs,
    resume_command: `node ${path.resolve(process.argv[1])} --run-dir ${runDir} --tasks ${tasksPath} --execute`,
  };
  const handoffPath = path.join(handoffDir, `${task.id}.json`);
  fs.mkdirSync(handoffDir, { recursive: true });
  fs.writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  return path.relative(runDir, handoffPath).split(path.sep).join("/");
}

function writeProviderHandoff(task, dispatcher) {
  const file = path.join(runDir, "orchestration", "handoffs", `${task.id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    schema_version: "sellerpilot.provider_task_handoff.v1",
    created_at: new Date().toISOString(),
    task_id: task.id,
    stage: dispatcher.stage || null,
    jobs: dispatcher.jobs || "orchestration/generation-jobs.json",
    expected_outputs: task.outputs,
    policy: "Use only the run-pinned provider resolution; never substitute a provider or mark the task complete without generated asset evidence.",
  }, null, 2)}\n`);
  return path.relative(runDir, file).split(path.sep).join("/");
}

function pathsBytes(paths) { return paths.reduce((sum, file) => sum + pathBytes(resolveRunPath(file)), 0); }
function pathBytes(file) { if (!fs.existsSync(file)) return 0; const stat = fs.statSync(file); if (stat.isFile()) return stat.size; return fs.readdirSync(file, { withFileTypes: true }).reduce((sum, entry) => sum + pathBytes(path.join(file, entry.name)), 0); }
function hashDeclaredOutputs(outputs) { return sha256(JSON.stringify(Object.fromEntries(outputs.map((file) => [file, hashPath(resolveRunPath(file))])))); }
function hashPath(file) {
  if (!fs.existsSync(file)) return "missing";
  const stat = fs.statSync(file);
  if (stat.isFile()) return sha256(fs.readFileSync(file));
  if (!stat.isDirectory()) return sha256(`${stat.mode}:${stat.size}:${stat.mtimeMs}`);
  const entries = fs.readdirSync(file, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return sha256(JSON.stringify(entries.map((entry) => [entry.name, entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other", hashPath(path.join(file, entry.name))])));
}
function appendJsonLine(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${JSON.stringify(value)}\n`); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

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
  console.error("Usage: node scripts/production-orchestrator.mjs --run-dir /abs/run --tasks /abs/run/orchestration/tasks.json [--execute] [--concurrency 4] [--dispatcher-registry /abs/registry.json] [--cancel-file /abs/run/orchestration/cancel]");
  process.exit(2);
}
