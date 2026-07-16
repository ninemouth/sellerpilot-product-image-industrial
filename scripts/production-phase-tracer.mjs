#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "telemetry");
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${args.now}`);

const progress = readJsonSafe(path.join(runDir, "generated-assets", "generation-progress.json")) || {};
const childJobs = collectChildProgress(path.join(runDir, "generated-assets"));
const assetReuse = readJsonSafe(path.join(runDir, "generated-assets", "asset-reuse-manifest.json")) || null;
const manifest = readJsonSafe(path.join(runDir, "export", "final-images-manifest.json")) || null;
const finalGate = readJsonSafe(path.join(runDir, "qa", "final-delivery-gate-report.json")) || null;
const overview = readJsonSafe(path.join(runDir, "overview", "delivery-overview-report.json")) || null;
const phaseSpans = collectPhaseSpans(runDir);
const jobMetrics = childJobs.map(jobMetricsFromProgress);
const completedJobs = jobMetrics.filter((job) => job.status === "completed");
const reusedJobs = jobMetrics.filter((job) => job.status === "reused_approved_asset" || job.source_type === "asset_reuse");
const failedJobs = jobMetrics.filter((job) => job.status === "failed");
const pendingJobs = jobMetrics.filter((job) => /generating|downloading|pending|running|prepared/.test(job.status));
const findings = [];

if (!childJobs.length && !manifest) {
  findings.push(finding("warn", "no-runtime-or-final-evidence", "No per-job progress files or final manifest were found."));
}
if (childJobs.length && normalize(progress.status) === "not_started") {
  findings.push(finding("fail", "main-progress-stale", `Main generation-progress.json is not_started while ${childJobs.length} per-job progress file(s) exist.`));
}
for (const job of jobMetrics) {
  if (job.provider_first_byte_ms == null && ["completed", "failed"].includes(job.status)) {
    findings.push(finding("warn", "missing-provider-first-byte-event", `${job.id} has no provider_first_byte_received event.`));
  }
}

const report = {
  schema_version: "sellerpilot.production_phase_trace.v1",
  status: findings.some((item) => item.severity === "fail") ? "needs_attention" : "ready",
  created_at: now.toISOString(),
  run_dir: runDir,
  snapshot: {
    main_progress_status: progress.status || "missing",
    expected_image_count: Number(progress.image_count || 0) || null,
    child_progress_files: childJobs.length,
    completed_jobs: completedJobs.length,
    reused_jobs: reusedJobs.length,
    failed_jobs: failedJobs.length,
    pending_jobs: pendingJobs.length,
    manifest_images: manifestImageCount(manifest),
    overview_exists: Boolean(overview),
    final_gate_status: finalGate?.status || null,
    asset_reuse_records: Array.isArray(assetReuse?.records) ? assetReuse.records.length : 0,
  },
  phase_spans: phaseSpans,
  generation_jobs: jobMetrics,
  metrics: {
    provider_total_ms: stats(providerJobs(jobMetrics).map((job) => job.total_ms).filter(isNumber)),
    provider_first_byte_ms: stats(providerJobs(jobMetrics).map((job) => job.provider_first_byte_ms).filter(isNumber)),
    provider_response_ms: stats(providerJobs(jobMetrics).map((job) => job.provider_response_ms).filter(isNumber)),
    download_ms: stats(providerJobs(jobMetrics).map((job) => job.download_ms).filter(isNumber)),
    phase_duration_ms: Object.fromEntries(phaseSpans.map((phase) => [phase.phase, phase.duration_ms])),
  },
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "phase-trace.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "phase-trace.md"), toMarkdown(report));
console.log(JSON.stringify({
  status: report.status,
  trace: path.join(outDir, "phase-trace.json"),
  completed_jobs: completedJobs.length,
  failed_jobs: failedJobs.length,
  pending_jobs: pendingJobs.length,
}, null, 2));

function collectPhaseSpans(root) {
  const definitions = [
    ["source_preflight_ms", () => ["source-original", "source-enhanced", "source-normalized", "source-understanding", "source-image-set-manifest.json"].flatMap((entry) => collectFiles(path.join(root, entry)))],
    ["planning_ms", () => ["mode", "planning", "brief-intake", "strategy", "research", "blueprint", "layout-drafts", "prompt-pack", "generation-spec"].flatMap((entry) => collectFiles(path.join(root, entry)))],
    ["provider_runtime_ms", () => collectProviderRuntimeFiles(root)],
    ["asset_reuse_ms", () => collectAssetReuseFiles(root)],
    ["local_compositor_ms", () => collectLocalCompositorFiles(root)],
    ["qa_ms", () => collectFiles(path.join(root, "qa"))],
    ["export_ms", () => ["final-images", "export", "overview"].flatMap((entry) => collectFiles(path.join(root, entry)))],
    ["canvas_ready_ms", () => collectFiles(path.join(root, "review-workspace"))],
  ];
  return definitions.map(([phase, getFiles]) => {
    const files = getFiles();
    const span = spanForFiles(files);
    return {
      phase,
      files: files.length,
      started_at: span.started_at,
      ended_at: span.ended_at,
      duration_ms: span.duration_ms,
    };
  });
}

function collectProviderRuntimeFiles(root) {
  const reuseDirs = new Set((assetReuse?.records || []).map((item) => path.dirname(path.join(root, item.current_asset_path || ""))));
  return collectFiles(path.join(root, "generated-assets")).filter((file) => {
    if (path.basename(file) === "asset-reuse-manifest.json") return false;
    if (/progress-reused-/i.test(path.basename(file))) return false;
    for (const dir of reuseDirs) {
      if (file === dir || file.startsWith(`${dir}${path.sep}`)) return false;
    }
    return /(?:request|response|summary|progress-.+)\.json$/i.test(path.basename(file));
  });
}

function collectAssetReuseFiles(root) {
  const files = [];
  const reusePath = path.join(root, "generated-assets", "asset-reuse-manifest.json");
  if (fs.existsSync(reusePath)) files.push(reusePath);
  for (const item of assetReuse?.records || []) {
    const current = path.join(root, item.current_asset_path || "");
    files.push(...collectFiles(path.dirname(current)));
  }
  files.push(...collectFiles(path.join(root, "generated-assets")).filter((file) => /progress-reused-/i.test(path.basename(file))));
  return [...new Set(files.filter((file) => fs.existsSync(file)))];
}

function collectLocalCompositorFiles(root) {
  const files = [];
  const copyContract = path.join(root, "copy", "personalized-text-compositor-contract.json");
  if (fs.existsSync(copyContract)) files.push(copyContract);
  const visibleText = path.join(root, "qa", "final-visible-text-review.json");
  if (fs.existsSync(visibleText)) files.push(visibleText);
  const scriptsDir = path.join(root, "scripts");
  if (fs.existsSync(scriptsDir)) {
    files.push(...collectFiles(scriptsDir).filter((file) => /export.*(?:final|embroidery)|compositor/i.test(path.basename(file))));
  }
  const lineageRecords = Array.isArray(manifest?.images) ? manifest.images : [];
  for (const item of lineageRecords) {
    const sourceType = normalize(item.lineage?.source_type);
    if (/text_overlay|personalized/.test(sourceType) || item.lineage?.render_method === "local_overlay") {
      const image = path.resolve(item.path || path.join(root, "final-images", item.file || ""));
      if (fs.existsSync(image)) files.push(image);
    }
  }
  return [...new Set(files)];
}

function collectFiles(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function spanForFiles(files) {
  if (!files.length) return { started_at: null, ended_at: null, duration_ms: null };
  const mtimes = files.map((file) => fs.statSync(file).mtime).sort((a, b) => a.getTime() - b.getTime());
  const started = mtimes[0];
  const ended = mtimes[mtimes.length - 1];
  return {
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    duration_ms: Math.max(0, ended.getTime() - started.getTime()),
  };
}

function collectChildProgress(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((item) => /^progress-.+\.json$/i.test(item))
    .sort()
    .map((item) => {
      const file = path.join(dir, item);
      const progressItem = readJsonSafe(file);
      if (!progressItem) return null;
      return {
        id: item.replace(/^progress-/i, "").replace(/\.json$/i, ""),
        file,
        ...progressItem,
      };
    })
    .filter(Boolean);
}

function jobMetricsFromProgress(job) {
  const events = Array.isArray(job.runtime?.meaningful_progress_events) ? job.runtime.meaningful_progress_events : [];
  const eventAt = (name) => parseDate(events.find((event) => event.event === name)?.at);
  const started = eventAt("request_started") || parseDate(job.created_at) || parseDate(job.updated_at) || fileMtime(job.file);
  const firstByte = eventAt("provider_first_byte_received");
  const response = eventAt("response_received");
  const downloadStarted = eventAt("download_started");
  const assetVerified = eventAt("asset_verified") || eventAt("download_item_verified");
  const ended = assetVerified || parseDate(job.updated_at) || fileMtime(job.file);
  return {
    id: job.id,
    file: job.file,
    status: normalize(job.status || "unknown"),
    source_type: job.source_type || null,
    provider_timing_applicable: job.provider_timing_applicable !== false && job.source_type !== "asset_reuse" && normalize(job.status) !== "reused_approved_asset",
    started_at: started ? started.toISOString() : null,
    ended_at: ended ? ended.toISOString() : null,
    total_ms: diffMs(started, ended),
    provider_first_byte_ms: diffMs(started, firstByte),
    provider_response_ms: diffMs(started, response),
    download_ms: diffMs(downloadStarted, assetVerified),
    meaningful_events: events.map((event) => event.event),
    completed_images: normalizeImages(job.runtime?.completed_images || job.completed_images),
    failure_code: job.runtime?.failure?.code || null,
  };
}

function providerJobs(jobs) {
  return jobs.filter((job) => job.provider_timing_applicable !== false);
}

function normalizeImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : item?.image_path || item?.path || item?.file).filter(Boolean);
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

function manifestImageCount(value) {
  if (!value) return 0;
  if (Array.isArray(value.images)) return value.images.length;
  if (Array.isArray(value.files)) return value.files.length;
  if (Array.isArray(value.final_images)) return value.final_images.length;
  return 0;
}

function fileMtime(file) {
  try { return fs.statSync(file).mtime; } catch { return null; }
}

function diffMs(start, end) {
  if (!start || !end) return null;
  return Math.max(0, end.getTime() - start.getTime());
}

function isNumber(value) {
  return Number.isFinite(value);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function finding(severity, type, message) {
  return { severity, type, message };
}

function toMarkdown(report) {
  const lines = [
    "# Production Phase Trace",
    "",
    `- Status: ${report.status}`,
    `- Child progress files: ${report.snapshot.child_progress_files}`,
    `- Completed jobs: ${report.snapshot.completed_jobs}`,
    `- Reused approved assets: ${report.snapshot.reused_jobs}`,
    `- Failed jobs: ${report.snapshot.failed_jobs}`,
    `- Pending jobs: ${report.snapshot.pending_jobs}`,
    `- Manifest images: ${report.snapshot.manifest_images}`,
    "",
    "## Metrics",
    `- Provider total p50/p95: ${formatMetric(report.metrics.provider_total_ms.p50)} / ${formatMetric(report.metrics.provider_total_ms.p95)}`,
    `- First byte p50/p95: ${formatMetric(report.metrics.provider_first_byte_ms.p50)} / ${formatMetric(report.metrics.provider_first_byte_ms.p95)}`,
    `- Download p50/p95: ${formatMetric(report.metrics.download_ms.p50)} / ${formatMetric(report.metrics.download_ms.p95)}`,
    "",
    "## Phase Spans",
    ...report.phase_spans.map((phase) => `- ${phase.phase}: ${formatMetric(phase.duration_ms)} (${phase.files} files)`),
    "",
    "## Findings",
    ...(report.findings.length ? report.findings.map((item) => `- [${item.severity}] ${item.type}: ${item.message}`) : ["- None"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function formatMetric(ms) {
  return ms == null ? "n/a" : `${ms}ms`;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) result[argv[i].slice(2)] = true;
    else { result[argv[i].slice(2)] = value; i += 1; }
  }
  return result;
}

function usage() {
  console.error("Usage: node scripts/production-phase-tracer.mjs --run-dir /abs/run [--out-dir /abs/run/telemetry] [--now ISO]");
  process.exit(2);
}
