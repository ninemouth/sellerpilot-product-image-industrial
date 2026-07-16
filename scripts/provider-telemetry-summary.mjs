#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
const roots = collectRoots(args);
if (!roots.length) usage();

const minRuns = Number(args["min-runs"] || 3);
const minMeaningfulJobs = Number(args["min-meaningful-jobs"] || 10);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(process.cwd(), "telemetry");
const runDirs = unique(roots.flatMap(resolveRunDirs));
const traces = runDirs.map(readTraceForRun).filter(Boolean);
const allJobs = traces.flatMap((trace) => trace.generation_jobs.map((job) => ({ ...job, run_dir: trace.run_dir })));
const meaningfulJobs = allJobs.filter((job) => Number.isFinite(job.provider_first_byte_ms) || Number.isFinite(job.provider_response_ms));
const findings = [];

if (traces.length < minRuns) {
  findings.push({
    severity: "warn",
    type: "insufficient-run-sample",
    message: `Only ${traces.length} run(s) with phase trace were found; collect at least ${minRuns} before changing global timeout/concurrency defaults.`,
  });
}
if (meaningfulJobs.length < minMeaningfulJobs) {
  findings.push({
    severity: "warn",
    type: "insufficient-meaningful-provider-sample",
    message: `Only ${meaningfulJobs.length} provider job(s) include meaningful first-byte/response timing; collect at least ${minMeaningfulJobs} before tuning global provider thresholds.`,
  });
}

const report = {
  schema_version: "sellerpilot.provider_telemetry_summary.v1",
  status: findings.length ? "insufficient_sample" : "ready",
  created_at: new Date().toISOString(),
  roots,
  thresholds: {
    min_runs: minRuns,
    min_meaningful_jobs: minMeaningfulJobs,
  },
  sample: {
    run_count: traces.length,
    job_count: allJobs.length,
    meaningful_provider_job_count: meaningfulJobs.length,
    completed_job_count: allJobs.filter((job) => job.status === "completed").length,
    failed_job_count: allJobs.filter((job) => job.status === "failed").length,
    repaired_job_count: allJobs.filter((job) => job.status === "repaired_by_final_asset").length,
  },
  metrics: {
    provider_total_ms: stats(allJobs.map((job) => job.total_ms).filter(isNumber)),
    provider_first_byte_ms: stats(allJobs.map((job) => job.provider_first_byte_ms).filter(isNumber)),
    provider_response_ms: stats(allJobs.map((job) => job.provider_response_ms).filter(isNumber)),
    download_ms: stats(allJobs.map((job) => job.download_ms).filter(isNumber)),
  },
  run_summaries: traces.map((trace) => ({
    run_dir: trace.run_dir,
    status: trace.status,
    child_progress_files: trace.snapshot?.child_progress_files || 0,
    completed_jobs: trace.snapshot?.completed_jobs || 0,
    failed_jobs: trace.snapshot?.failed_jobs || 0,
    pending_jobs: trace.snapshot?.pending_jobs || 0,
    final_gate_status: trace.snapshot?.final_gate_status || null,
    provider_first_byte_samples: trace.metrics?.provider_first_byte_ms?.count || 0,
  })),
  findings,
  decision: {
    may_tune_global_timeouts_or_concurrency: findings.length === 0,
    next_action: findings.length
      ? "Collect more runs with production-phase-tracer before changing global timeout/concurrency defaults."
      : "Use p50/p95 metrics to propose scoped timeout/concurrency changes.",
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "provider-telemetry-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "provider-telemetry-summary.md"), toMarkdown(report));
console.log(JSON.stringify({
  status: report.status,
  summary: path.join(outDir, "provider-telemetry-summary.json"),
  run_count: report.sample.run_count,
  meaningful_provider_job_count: report.sample.meaningful_provider_job_count,
}, null, 2));

function collectRoots(input) {
  const out = [];
  if (input["run-dir"]) out.push(path.resolve(input["run-dir"]));
  if (input["runs-root"]) out.push(path.resolve(input["runs-root"]));
  if (input.paths) out.push(...String(input.paths).split(",").map((item) => path.resolve(item.trim())).filter(Boolean));
  return out;
}

function resolveRunDirs(root) {
  if (fs.existsSync(path.join(root, "telemetry", "phase-trace.json")) || fs.existsSync(path.join(root, "generated-assets"))) return [root];
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (fs.existsSync(path.join(current, "telemetry", "phase-trace.json"))) {
      out.push(current);
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      stack.push(path.join(current, entry.name));
    }
  }
  return out;
}

function readTraceForRun(runDir) {
  const tracePath = path.join(runDir, "telemetry", "phase-trace.json");
  if (!fs.existsSync(tracePath)) return null;
  const trace = readJsonSafe(tracePath);
  if (!trace) return null;
  return {
    ...trace,
    run_dir: trace.run_dir || runDir,
    generation_jobs: Array.isArray(trace.generation_jobs) ? trace.generation_jobs : [],
  };
}

function stats(values) {
  if (!values.length) return { count: 0, min: null, p50: null, p95: null, max: null };
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted, pct) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1);
  return sorted[index];
}

function toMarkdown(report) {
  const lines = [
    "# Provider Telemetry Summary",
    "",
    `- Status: ${report.status}`,
    `- Runs: ${report.sample.run_count}`,
    `- Jobs: ${report.sample.job_count}`,
    `- Meaningful provider jobs: ${report.sample.meaningful_provider_job_count}`,
    `- May tune global defaults: ${report.decision.may_tune_global_timeouts_or_concurrency}`,
    "",
    "## Metrics",
    "",
    `- First byte p50/p95: ${fmt(report.metrics.provider_first_byte_ms.p50)} / ${fmt(report.metrics.provider_first_byte_ms.p95)}`,
    `- Response p50/p95: ${fmt(report.metrics.provider_response_ms.p50)} / ${fmt(report.metrics.provider_response_ms.p95)}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.type}: ${finding.message}`);
  lines.push("");
  return lines.join("\n");
}

function fmt(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : "n/a";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function isNumber(value) {
  return Number.isFinite(value);
}

function readJsonSafe(file) {
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
  console.error("Usage: node scripts/provider-telemetry-summary.mjs --run-dir /abs/run | --runs-root /abs/runs [--min-runs 3] [--min-meaningful-jobs 10] [--out-dir /abs/out]");
  process.exit(2);
}
