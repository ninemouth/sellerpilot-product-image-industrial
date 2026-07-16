#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.jobs) usage();
const runDir = path.resolve(args["run-dir"]);
const jobsPath = path.resolve(args.jobs);
const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
const jobList = Array.isArray(jobs.jobs) ? jobs.jobs : [];
if (!jobList.length) throw new Error("jobs file must contain jobs[].");

const progressPath = path.join(runDir, "generated-assets", "generation-progress.json");
const statePath = path.join(runDir, "generated-assets", "execution-controller-state.json");
const continueAfterAnchor = Boolean(args["continue-after-anchor-pass"]);
const executeJobs = Boolean(args.execute);
const concurrency = Math.max(1, Math.min(2, Number(args.concurrency || 2)));
const anchorLimit = Math.max(1, Math.min(2, Number(args["anchor-limit"] || 2)));
const split = splitJobs(jobList, anchorLimit);
const anchorJobs = split.anchorJobs;
const remainingJobs = split.remainingJobs;
const anchorDecision = readJson(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"));

if (!continueAfterAnchor) {
  const state = writeState("anchor_ready", anchorJobs, remainingJobs, "Run only capped anchor jobs. Do not schedule remaining jobs before recorded anchor QA pass.");
  if (executeJobs) await executeBatch(anchorJobs, "anchor_executed", state);
  console.log(JSON.stringify({ status: executeJobs ? "anchor_executed" : "anchor_ready", jobs: anchorJobs.map((job) => job.id), capped_anchor_jobs: split.demotedAnchorIds, next_action: "run capped anchor jobs, record anchor QA, then rerun with --continue-after-anchor-pass" }, null, 2));
  process.exit(0);
}

if (!isAnchorApproved(anchorDecision)) {
  writeState("blocked_anchor_qa", anchorJobs, remainingJobs, "Anchor QA must be continue/pass/approved before bounded concurrent remaining generation.");
  console.error(JSON.stringify({ status: "blocked_anchor_qa", message: "Remaining images were not scheduled because anchor QA is not approved." }, null, 2));
  process.exit(1);
}

const state = writeState("remaining_ready", anchorJobs, remainingJobs, "Remaining independent jobs may run with bounded concurrency 2 after anchor QA approval.");
if (executeJobs) await executeBatch(remainingJobs, "remaining_executed", state);
console.log(JSON.stringify({ status: executeJobs ? "remaining_executed" : "remaining_ready", concurrency, jobs: remainingJobs.map((job) => job.id), next_action: "invoke provider adapter per job and update progress after every completed asset" }, null, 2));

function writeState(status, anchors, remaining, policy) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const state = {
    schema_version: "sellerpilot.generation_execution_controller.v2",
    status,
    updated_at: new Date().toISOString(),
    jobs_path: jobsPath,
    concurrency,
    anchor_limit: anchorLimit,
    anchor_job_ids: anchors.map((job) => job.id),
    remaining_job_ids: remaining.map((job) => job.id),
    demoted_anchor_job_ids: split.demotedAnchorIds,
    job_hashes: Object.fromEntries([...anchors, ...remaining].map((job) => [job.id, jobHash(job)])),
    execute_jobs: executeJobs,
    policy,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const progress = readJson(progressPath) || {};
  fs.writeFileSync(progressPath, `${JSON.stringify({ ...progress, execution_controller: state, updated_at: state.updated_at, pending_images: status === "anchor_ready" ? state.anchor_job_ids : state.remaining_job_ids }, null, 2)}\n`);
  return state;
}

function isAnchorApproved(decision) {
  return ["continue", "pass", "approved"].includes(String(decision?.qa_decision || decision?.status || "").toLowerCase());
}

function splitJobs(list, limit) {
  const explicitAnchors = list.filter((job) => job.anchor);
  const selectedAnchors = (explicitAnchors.length ? explicitAnchors : list).slice(0, limit);
  const anchorIds = new Set(selectedAnchors.map((job) => job.id));
  const remaining = list
    .filter((job) => !anchorIds.has(job.id))
    .map((job) => explicitAnchors.includes(job) ? { ...job, demoted_from_anchor: true } : job);
  return {
    anchorJobs: selectedAnchors,
    remainingJobs: remaining,
    demotedAnchorIds: explicitAnchors.slice(limit).map((job) => job.id),
  };
}

function jobHash(job) {
  return crypto.createHash("sha256").update(JSON.stringify({
    id: job.id,
    prompt: job.prompt || "",
    source_images: job.source_images || job.images || [],
    generation_spec: job.generation_spec || job.spec || {},
    command: job.command || null,
  })).digest("hex");
}

async function executeBatch(items, finalStatus, priorState) {
  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(items, finalStatus === "anchor_executed" ? 1 : concurrency, runJob);
  const failed = results.filter((item) => item.status !== "completed");
  const state = {
    ...priorState,
    status: failed.length ? `${finalStatus}_with_failures` : finalStatus,
    updated_at: new Date().toISOString(),
    executed_at: startedAt,
    execution_results: results,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const progress = readJson(progressPath) || {};
  const completedImages = normalizeProgressImages(progress.completed_images);
  const failedImages = normalizeProgressImages(progress.failed_images);
  for (const result of results) {
    if (result.status === "completed") completedImages.push(result.id);
    else failedImages.push(result.id);
  }
  fs.writeFileSync(progressPath, `${JSON.stringify({
    ...progress,
    status: failed.length ? "needs_attention" : finalStatus,
    updated_at: state.updated_at,
    completed_images: [...new Set(completedImages)],
    pending_images: [],
    failed_images: [...new Set(failedImages)],
    execution_controller: state,
  }, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

async function runJob(job) {
  if (Array.isArray(job.command) && job.command.length) {
    return spawnJob(job.command[0], job.command.slice(1), job);
  }
  if (args["command-template"]) {
    const command = renderTemplate(String(args["command-template"]), job);
    return spawnJob(command, [], job, { shell: true });
  }
  return { id: job.id, status: "planned", hash: jobHash(job), skipped_reason: "no command supplied" };
}

function spawnJob(command, argv, job, options = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, argv, { shell: Boolean(options.shell), cwd: runDir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code, signal) => {
      resolve({
        id: job.id,
        status: code === 0 ? "completed" : "failed",
        exit_code: code,
        signal,
        ms: Date.now() - started,
        hash: jobHash(job),
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-4000),
      });
    });
  });
}

function renderTemplate(template, job) {
  const values = {
    id: job.id,
    prompt: job.prompt || "",
    output_dir: job.output_dir || path.join(runDir, "generated-assets", job.id),
    progress_file: job.progress_file || path.join(runDir, "generated-assets", `progress-${job.id}.json`),
  };
  return template.replace(/\{([a-z_]+)\}/g, (_, key) => shellQuote(values[key] || ""));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  })).then(() => results);
}

function normalizeProgressImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : item?.id || item?.file || item?.path).filter(Boolean);
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const value = argv[i + 1]; if (!value || value.startsWith("--")) result[argv[i].slice(2)] = true; else { result[argv[i].slice(2)] = value; i += 1; } } return result; }
function usage() { console.error("Usage: node scripts/generation-execution-controller.mjs --run-dir /abs/run --jobs /abs/jobs.json [--continue-after-anchor-pass] [--concurrency 2] [--anchor-limit 2] [--execute] [--command-template '...{id}...']"); process.exit(2); }
