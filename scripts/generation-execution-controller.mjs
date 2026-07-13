#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

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
const concurrency = Math.max(1, Math.min(2, Number(args.concurrency || 2)));
const anchorJobs = jobList.filter((job) => job.anchor);
const remainingJobs = jobList.filter((job) => !job.anchor);
const anchorDecision = readJson(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"));

if (!continueAfterAnchor) {
  writeState("anchor_ready", anchorJobs, remainingJobs, "Run only anchor jobs. Do not schedule remaining jobs before recorded anchor QA pass.");
  console.log(JSON.stringify({ status: "anchor_ready", jobs: anchorJobs.map((job) => job.id), next_action: "run anchor jobs, record anchor QA, then rerun with --continue-after-anchor-pass" }, null, 2));
  process.exit(0);
}

if (!isAnchorApproved(anchorDecision)) {
  writeState("blocked_anchor_qa", anchorJobs, remainingJobs, "Anchor QA must be continue/pass/approved before bounded concurrent remaining generation.");
  console.error(JSON.stringify({ status: "blocked_anchor_qa", message: "Remaining images were not scheduled because anchor QA is not approved." }, null, 2));
  process.exit(1);
}

writeState("remaining_ready", anchorJobs, remainingJobs, "Remaining independent jobs may run with bounded concurrency 2 after anchor QA approval.");
console.log(JSON.stringify({ status: "remaining_ready", concurrency, jobs: remainingJobs.map((job) => job.id), next_action: "invoke provider adapter per job and update progress after every completed asset" }, null, 2));

function writeState(status, anchors, remaining, policy) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const state = { schema_version: "sellerpilot.generation_execution_controller.v1", status, updated_at: new Date().toISOString(), jobs_path: jobsPath, concurrency, anchor_job_ids: anchors.map((job) => job.id), remaining_job_ids: remaining.map((job) => job.id), policy };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const progress = readJson(progressPath) || {};
  fs.writeFileSync(progressPath, `${JSON.stringify({ ...progress, execution_controller: state, updated_at: state.updated_at }, null, 2)}\n`);
}

function isAnchorApproved(decision) {
  return ["continue", "pass", "approved"].includes(String(decision?.qa_decision || decision?.status || "").toLowerCase());
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const value = argv[i + 1]; if (!value || value.startsWith("--")) result[argv[i].slice(2)] = true; else { result[argv[i].slice(2)] = value; i += 1; } } return result; }
function usage() { console.error("Usage: node scripts/generation-execution-controller.mjs --run-dir /abs/run --jobs /abs/jobs.json [--continue-after-anchor-pass] [--concurrency 2]"); process.exit(2); }
