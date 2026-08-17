#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const skillRoot = skillRootFrom(import.meta.url);
const args = parseArgs(process.argv);
const iterations = boundedInteger(args.iterations, 5, 1, 20);
const baselineEntryBytes = positiveNumber(args["baseline-entry-bytes"]);
const templateDir = path.join(skillRoot, "assets", "tldraw-review-workspace");
const samples = [];

for (let index = 0; index < iterations; index += 1) samples.push(runSample(index + 1));

const fixedEntryBytes = fs.statSync(path.join(skillRoot, "SKILL.md")).size + fs.statSync(path.join(skillRoot, "AGENTS.md")).size;
const report = {
  schema_version: "sellerpilot.control_plane_benchmark.v1",
  created_at: new Date().toISOString(),
  iterations,
  safety: {
    network_calls: 0,
    provider_generation_calls: 0,
    provider_mode: "native_codex_wait_boundary",
    temp_runs_removed: true,
  },
  latency_ms: {
    compile: stats(samples.map((item) => item.compile_ms)),
    first_dag_advance: stats(samples.map((item) => item.first_dag_advance_ms)),
    tldraw_create: stats(samples.map((item) => item.tldraw_create_ms)),
    tldraw_reuse: stats(samples.map((item) => item.tldraw_reuse_ms)),
  },
  artifacts: {
    task_count: samples[0]?.task_count || 0,
    adaptive_anchor_limit: samples[0]?.adaptive_anchor_limit || 0,
    first_dag_statuses: [...new Set(samples.map((item) => item.first_dag_status))],
    tldraw_workspace_bytes: stats(samples.map((item) => item.tldraw_workspace_bytes)),
    prewarmed_template_bytes: directoryBytes(templateDir),
    workspace_has_node_modules: samples.some((item) => item.workspace_has_node_modules),
    asset_transfer_modes: [...new Set(samples.flatMap((item) => item.asset_transfer_modes))],
  },
  context: {
    fixed_entry_bytes: fixedEntryBytes,
    baseline_entry_bytes: baselineEntryBytes,
    reduction_percent: baselineEntryBytes ? round((1 - fixedEntryBytes / baselineEntryBytes) * 100, 1) : null,
  },
};

console.log(JSON.stringify(report, null, 2));

function runSample(sampleNumber) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `sellerpilot-control-plane-benchmark-${sampleNumber}-`));
  const runDir = path.join(temp, "run");
  const sourceDir = path.join(temp, "source");
  const finalDir = path.join(runDir, "final-images");
  const workspaceDir = path.join(temp, "review-workspace");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(finalDir, { recursive: true });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const sourceImage = path.join(sourceDir, "product-source.png");
  fs.writeFileSync(sourceImage, png);
  fs.writeFileSync(path.join(finalDir, "IMG-01-hero.png"), png);

  try {
    const compile = measure([
      "scripts/compile-production-plan.mjs", "--run-dir", runDir,
      "--platform", "Ozon", "--category", "printed fabric bag", "--locale", "ru-RU", "--image-count", "8",
      "--source-image", sourceImage, "--has-source-image", "true", "--visible-copy", "true", "--scene-requested", "true",
      "--surface-material-canonical", "true", "--provider", "native_codex",
    ]);
    const orchestrate = measure(["scripts/production-orchestrator.mjs", "--run-dir", runDir, "--tasks", path.join(runDir, "orchestration", "tasks.json"), "--execute"]);
    const create = measure(["scripts/create-tldraw-review-workspace.mjs", "--out-dir", workspaceDir, "--image-dir", finalDir, "--run-dir", runDir, "--no-auto-start"]);
    const reuse = measure(["scripts/create-tldraw-review-workspace.mjs", "--out-dir", workspaceDir, "--image-dir", finalDir, "--run-dir", runDir, "--no-auto-start"]);
    const compiled = parseJsonOutput(compile.stdout, "compiler");
    const orchestrated = parseJsonOutput(orchestrate.stdout, "orchestrator");
    const created = parseJsonOutput(create.stdout, "tldraw create");
    const reused = parseJsonOutput(reuse.stdout, "tldraw reuse");
    if (orchestrated.status !== "paused") throw new Error(`benchmark expected a safe agent boundary, got ${orchestrated.status}`);
    if (created.workspaceStatus !== "created" || reused.workspaceStatus !== "reused") throw new Error("tldraw benchmark did not exercise both create and reuse paths");
    return {
      compile_ms: compile.ms,
      first_dag_advance_ms: orchestrate.ms,
      tldraw_create_ms: create.ms,
      tldraw_reuse_ms: reuse.ms,
      task_count: compiled.task_count,
      adaptive_anchor_limit: JSON.parse(fs.readFileSync(path.join(runDir, "orchestration", "generation-jobs.json"), "utf8")).anchor_limit,
      first_dag_status: orchestrated.status,
      tldraw_workspace_bytes: directoryBytes(workspaceDir),
      workspace_has_node_modules: fs.existsSync(path.join(workspaceDir, "node_modules")),
      asset_transfer_modes: created.assetTransferModes || [],
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function measure(scriptArgs) {
  const started = process.hrtime.bigint();
  const result = spawnSync(process.execPath, scriptArgs, { cwd: skillRoot, encoding: "utf8" });
  const ms = round(Number(process.hrtime.bigint() - started) / 1e6, 1);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${scriptArgs[0]} failed`);
  return { ms, stdout: result.stdout };
}

function parseJsonOutput(value, label) {
  try { return JSON.parse(String(value || "").trim()); }
  catch { throw new Error(`${label} did not return one JSON object`); }
}

function directoryBytes(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(target).reduce((sum, name) => sum + directoryBytes(path.join(target, name)), 0);
}

function stats(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0] ?? null, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) ?? null };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else { parsed[key] = next; index += 1; }
  }
  return parsed;
}

function boundedInteger(value, fallback, min, max) { const number = Number(value); return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function positiveNumber(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function round(value, precision) { const factor = 10 ** precision; return Math.round(value * factor) / factor; }
