#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const skillRoot = skillRootFrom(import.meta.url);
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
const anchorLimit = resolveAnchorLimit(args["anchor-limit"], jobs);
const split = splitJobs(jobList, anchorLimit);
const anchorJobs = split.anchorJobs;
const remainingJobs = split.remainingJobs;
const anchorDecision = readJson(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"));

if (!continueAfterAnchor) {
  const state = writeState("anchor_ready", anchorJobs, remainingJobs, "Run only capped anchor jobs. Do not schedule remaining jobs before recorded anchor QA pass.");
  const finalState = executeJobs ? await executeBatch(anchorJobs, "anchor_executed", state) : state;
  console.log(JSON.stringify({ status: finalState.status, jobs: anchorJobs.map((job) => job.id), capped_anchor_jobs: split.demotedAnchorIds, next_action: "run capped anchor jobs, record anchor QA, then rerun with --continue-after-anchor-pass" }, null, 2));
  process.exit(0);
}

if (!isAnchorApproved(anchorDecision)) {
  writeState("blocked_anchor_qa", anchorJobs, remainingJobs, "Anchor QA must be continue/pass/approved before bounded concurrent remaining generation.");
  console.error(JSON.stringify({ status: "blocked_anchor_qa", message: "Remaining images were not scheduled because anchor QA is not approved." }, null, 2));
  process.exit(1);
}

const state = writeState("remaining_ready", anchorJobs, remainingJobs, "Remaining independent jobs may run with bounded concurrency 2 after anchor QA approval.");
const finalState = executeJobs ? await executeBatch(remainingJobs, "remaining_executed", state) : state;
console.log(JSON.stringify({ status: finalState.status, concurrency, jobs: remainingJobs.map((job) => job.id), next_action: "invoke provider adapter per job and update progress after every completed asset" }, null, 2));

function writeState(status, anchors, remaining, policy) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const state = {
    schema_version: "sellerpilot.generation_execution_controller.v2",
    status,
    updated_at: new Date().toISOString(),
    jobs_path: jobsPath,
    concurrency,
    anchor_limit: anchorLimit,
    anchor_selection_reason: jobs.anchor_selection_reason || readJson(path.join(runDir, "run-state.json"))?.budget?.anchor_selection_reason || "risk_adaptive_default",
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
  syncRunState();
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
    prompt: resolveJobPrompt(job),
    prompt_pack_digest: artifactDigest(job.prompt_ref?.path),
    source_images: job.source_images || job.images || [],
    source_manifest: job.source_manifest || null,
    source_manifest_digest: artifactDigest(job.source_manifest),
    source_annotations_digest: artifactDigest(job.source_annotations),
    source_evidence_summary_digest: artifactDigest(job.source_evidence_summary),
    reference_policy: job.reference_policy || null,
    generation_spec: job.generation_spec || job.spec || {},
    generation_spec_digest: artifactDigest(typeof (job.generation_spec || job.spec) === "string" ? (job.generation_spec || job.spec) : null),
    provider_resolution_digest: artifactDigest(job.provider_resolution),
    command: job.command || null,
  })).digest("hex");
}

async function executeBatch(items, finalStatus, priorState) {
  const startedAt = new Date().toISOString();
  const results = await mapWithConcurrency(items, finalStatus === "anchor_executed" ? 1 : concurrency, runJob);
  const failed = results.filter((item) => item.status === "failed");
  const awaiting = results.filter((item) => item.status.startsWith("awaiting_"));
  const state = {
    ...priorState,
    status: failed.length ? `${finalStatus}_with_failures` : awaiting.length ? `${finalStatus}_awaiting_external` : finalStatus,
    updated_at: new Date().toISOString(),
    executed_at: startedAt,
    execution_results: results,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const progress = readJson(progressPath) || {};
  const completedImages = new Set(normalizeProgressImages(progress.completed_images));
  const failedImages = new Set(normalizeProgressImages(progress.failed_images));
  for (const result of results) {
    if (result.status === "completed") { completedImages.add(result.id); failedImages.delete(result.id); }
    else if (result.status === "failed") { failedImages.add(result.id); completedImages.delete(result.id); }
    else if (result.status.startsWith("awaiting_")) failedImages.delete(result.id);
  }
  fs.writeFileSync(progressPath, `${JSON.stringify({
    ...progress,
    status: failed.length ? "needs_attention" : awaiting.length ? "awaiting_external_execution" : finalStatus,
    updated_at: state.updated_at,
    completed_images: [...completedImages],
    pending_images: awaiting.map((item) => item.id),
    failed_images: [...failedImages],
    execution_controller: state,
  }, null, 2)}\n`);
  syncRunState();
  if (failed.length) process.exitCode = 1;
  return state;
}

function syncRunState() {
  if (!fs.existsSync(path.join(runDir, "run-state.json"))) return;
  const script = path.join(skillRootFrom(import.meta.url), "scripts", "run-state-transition.mjs");
  const result = spawnSync(process.execPath, [script, "--run-dir", runDir, "--event", "generation", "--input", statePath], { cwd: runDir, encoding: "utf8" });
  if (result.status !== 0) console.error(`run-state generation projection skipped: ${(result.stderr || result.stdout || "unknown error").trim()}`);
}

async function runJob(job) {
  const existing = existingCompletedJob(job);
  if (existing) return existing;
  if (Array.isArray(job.command) && job.command.length) {
    const result = await spawnJob(job.command[0], job.command.slice(1), job);
    return result.status === "completed" ? promoteGeneratedAsset(job, result) : result;
  }
  if (args["command-template"]) {
    const command = renderTemplate(String(args["command-template"]), job);
    const result = await spawnJob(command, [], job, { shell: true });
    return result.status === "completed" ? promoteGeneratedAsset(job, result) : result;
  }
  const prompt = resolveJobPrompt(job);
  if (!prompt) return { id: job.id, status: "awaiting_prompt", hash: jobHash(job), paused_reason: `No role prompt is available from ${job.prompt_ref?.path || "job.prompt"}.` };
  const referenceSelection = selectReferences(job, prompt);
  if (referenceSelection.status === "failed") return { id: job.id, status: "failed", hash: jobHash(job), stderr: referenceSelection.stderr };
  const dispatchArgs = [path.join(skillRoot, "scripts", "create-image-generation-dispatch.mjs"), "--run-dir", runDir, "--role", job.id, "--prompt", prompt, "--output-path", path.join(resolveJobPath(job.output_dir || path.join("generated-assets", job.id)), "image.png")];
  for (const image of referenceSelection.images) dispatchArgs.push("--image", image);
  if (job.generation_spec) dispatchArgs.push("--generation-spec", resolveJobPath(job.generation_spec));
  const dispatched = spawnSync(process.execPath, dispatchArgs, { cwd: runDir, encoding: "utf8" });
  const payload = parseLastJson(dispatched.stdout);
  if (dispatched.status !== 0 || !payload) return { id: job.id, status: "failed", hash: jobHash(job), exit_code: dispatched.status, stderr: (dispatched.stderr || dispatched.stdout || "generation dispatch failed").slice(-4000) };
  if (payload.selected_mode === "native_codex") {
    return { id: job.id, status: "awaiting_native_host", hash: jobHash(job), handoff: payload.handoff, reference_selection: referenceSelection.report, selected_source_ids: referenceSelection.sourceIds, next_action: payload.next_action };
  }
  if (payload.selected_mode === "third_party_proxy" && Array.isArray(payload.runtime_command) && payload.runtime_command.length) {
    const result = await spawnJob(process.execPath, payload.runtime_command, job);
    const withSelection = { ...result, reference_selection: referenceSelection.report, selected_source_ids: referenceSelection.sourceIds };
    return result.status === "completed" ? promoteGeneratedAsset(job, withSelection) : withSelection;
  }
  return { id: job.id, status: "failed", hash: jobHash(job), stderr: "Dispatch returned no executable provider route." };
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

function resolveAnchorLimit(explicit, document) {
  const state = readJson(path.join(runDir, "run-state.json"));
  const configured = Number(explicit || document.anchor_limit || state?.budget?.max_anchor_assets || 2);
  return Math.max(1, Math.min(3, jobList.length, Number.isFinite(configured) ? Math.round(configured) : 2));
}

function resolveJobPrompt(job) {
  if (String(job.prompt || "").trim()) return String(job.prompt).trim();
  const ref = job.prompt_ref || {};
  if (!ref.path) return "";
  const doc = readJson(resolveJobPath(ref.path));
  if (!doc) return "";
  const role = String(ref.role || job.id);
  const candidates = [
    ...(Array.isArray(doc.prompts) ? doc.prompts : []),
    ...(Array.isArray(doc.roles) ? doc.roles : []),
    ...(Array.isArray(doc.images) ? doc.images : []),
  ];
  const item = candidates.find((entry) => [entry?.id, entry?.role, entry?.image_id].map(String).includes(role));
  return String(item?.prompt || item?.final_prompt || doc?.roles?.[role]?.prompt || doc?.prompts?.[role] || doc?.[role]?.prompt || doc?.[role] || "").trim();
}

function selectReferences(job, prompt) {
  if (job.source_manifest) {
    const selectionArgs = [
      path.join(skillRoot, "scripts", "select-source-references.mjs"),
      "--run-dir", runDir,
      "--role", job.id,
      "--prompt", prompt,
      "--manifest", resolveJobPath(job.source_manifest),
      "--annotations", resolveJobPath(job.source_annotations || "source-understanding/source-reference-annotations.json"),
      "--summary", resolveJobPath(job.source_evidence_summary || "source-understanding/source-evidence-summary.json"),
      "--provider-resolution", resolveJobPath(job.provider_resolution || "runtime/image-provider-resolution.json"),
      "--max-count", String(Math.max(1, Math.min(2, Number(job.reference_policy?.max_images || 2)))),
    ];
    const selected = spawnSync(process.execPath, selectionArgs, { cwd: runDir, encoding: "utf8" });
    const payload = parseLastJson(selected.stdout);
    if (selected.status !== 0 || !payload || !Array.isArray(payload.selected_images)) return { status: "failed", images: [], sourceIds: [], report: null, stderr: (selected.stderr || selected.stdout || "reference selection failed").slice(-4000) };
    return { status: "ready", images: payload.selected_images.map((item) => path.resolve(item)), sourceIds: payload.selected_source_ids || [], report: payload.selection_report || null };
  }
  return { status: "legacy", images: (job.source_images || job.images || []).map((item) => resolveJobPath(item)), sourceIds: [], report: null };
}

function existingCompletedJob(job) {
  const evidence = readJson(path.join(runDir, "generated-assets", `native-imagegen-${job.id.toLowerCase()}.json`));
  const source = locateGeneratedAsset(job);
  if (!source || (evidence && !["succeeded", "generated", "completed"].includes(String(evidence.status || "").toLowerCase()))) return null;
  return promoteGeneratedAsset(job, { id: job.id, status: "completed", hash: jobHash(job), cache_reason: "verified generated asset already exists" });
}

function promoteGeneratedAsset(job, result) {
  const source = locateGeneratedAsset(job);
  if (!source) return { ...result, status: "failed", stderr: "Provider command completed but no verified image asset was found." };
  const finalDir = path.join(runDir, "final-images");
  fs.mkdirSync(finalDir, { recursive: true });
  const ext = path.extname(source).toLowerCase() || ".png";
  const destination = path.join(finalDir, `${job.id}-generated${ext}`);
  if (!fs.existsSync(destination) || fs.statSync(destination).size !== fs.statSync(source).size) {
    try { fs.linkSync(source, destination); } catch { fs.copyFileSync(source, destination); }
  }
  return { ...result, status: "completed", generated_asset: source, final_asset: destination };
}

function locateGeneratedAsset(job) {
  const dir = resolveJobPath(job.output_dir || path.join("generated-assets", job.id));
  const summary = readJson(path.join(dir, "summary.json"));
  const fromSummary = summary?.images?.map((item) => item.image_path || item.path).find((file) => file && fs.existsSync(file));
  if (fromSummary) return path.resolve(fromSummary);
  for (const name of ["image.png", "image.jpg", "image.jpeg", "image.webp"]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0) return file;
  }
  return null;
}

function resolveJobPath(value) { return path.isAbsolute(String(value || "")) ? String(value) : path.join(runDir, String(value || "")); }
function artifactDigest(value) { if (!value) return null; try { return crypto.createHash("sha256").update(fs.readFileSync(resolveJobPath(value))).digest("hex"); } catch { return "missing"; } }
function parseLastJson(value) { const text = String(value || "").trim(); const start = text.lastIndexOf("\n{"); try { return JSON.parse(start >= 0 ? text.slice(start + 1) : text); } catch { return null; } }

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
