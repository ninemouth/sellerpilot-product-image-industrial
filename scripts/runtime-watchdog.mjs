#!/usr/bin/env node
import fs from "node:fs";
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
node scripts/runtime-watchdog.mjs --run-dir /abs/run \\
  [--warn-after-seconds 900] [--block-after-seconds 1800] [--stale-after-seconds 900] [--now 2026-07-09T00:00:00Z]

Classifies long-running image production without regenerating assets. It reads
run-local generation progress, final manifest, overview, QA loop state, and gate
reports, then writes qa/runtime-watchdog-report.json/.md.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = path.join(runDir, "qa");
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now value: ${args.now}`);
const plan = readJsonSafe(path.join(runDir, "planning", "production-efficiency-plan.json")) || {};
const progress = readJsonSafe(path.join(runDir, "generated-assets", "generation-progress.json")) || {};
const manifest = readJsonSafe(path.join(runDir, "export", "final-images-manifest.json")) || null;
const qaLoopDecision = readJsonSafe(path.join(qaDir, "qa-loop-routing-decision.json")) || null;
const qaLoopState = readJsonSafe(path.join(qaDir, "qa-loop-state.json")) || null;
const finalGate = readJsonSafe(path.join(qaDir, "final-delivery-gate-report.json")) || null;
const overviewReport = readJsonSafe(path.join(runDir, "overview", "delivery-overview-report.json")) || null;
const anchorDecision = readJsonSafe(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json")) || null;
const thresholds = resolveThresholds({ args, plan, progress });
const files = collectRunFiles(runDir);
const childProgress = collectChildProgress(path.join(runDir, "generated-assets"));
const latestActivity = latestFileActivity(files, now);
const progressActivity = fileActivity(path.join(runDir, "generated-assets", "generation-progress.json"), now);
const manifestImages = manifestImageCount(manifest);
const completed = unique([...normalizeProgressImages(progress.completed_images), ...childProgress.completed]);
const pending = unique([...normalizeProgressImages(progress.pending_images), ...childProgress.pending]);
const failed = unique([...normalizeProgressImages(progress.failed_images), ...childProgress.failed]);
const imageCount = Number(progress.image_count || plan.image_count || manifestImages || 0) || null;
const ageSeconds = secondsBetween(parseDate(progress.updated_at || progress.created_at) || progressActivity?.mtime || latestActivity?.mtime, now);
const runAgeSeconds = secondsBetween(parseDate(progress.created_at) || latestActivity?.oldestMtime || now, now);
const lastMeaningfulProgressAt = latestMeaningfulProgress(progress, childProgress.items);
const meaningfulProgressAgeSeconds = secondsBetween(lastMeaningfulProgressAt, now);
const findings = [];
const decision = classify();

const report = {
  schema_version: "sellerpilot.runtime_watchdog.v1",
  status: decision.status,
  classification: decision.classification,
  checked_at: now.toISOString(),
  run_dir: runDir,
  thresholds,
  runtime_snapshot: {
    progress_status: progress.status || "missing",
    image_count: imageCount,
    completed_images: completed.length,
    pending_images: pending.length,
    failed_images: failed.length,
    child_progress_files: childProgress.items.length,
    manifest_images: manifestImages,
    overview_exists: Boolean(overviewReport),
    final_gate_status: finalGate?.status || null,
    qa_loop_status: qaLoopDecision?.loop_decision?.status || null,
    last_meaningful_progress_at: lastMeaningfulProgressAt ? lastMeaningfulProgressAt.toISOString() : null,
    meaningful_progress_seconds_ago: meaningfulProgressAgeSeconds,
    latest_activity_seconds_ago: latestActivity ? latestActivity.secondsAgo : null,
    progress_activity_seconds_ago: progressActivity ? progressActivity.secondsAgo : null,
    run_age_seconds: Math.max(0, Math.round(runAgeSeconds || 0)),
  },
  decision: {
    stop_automatic_regeneration: decision.stop_automatic_regeneration,
    user_update_required: decision.user_update_required,
    smallest_next_action: decision.smallest_next_action,
    reason: decision.reason,
  },
  findings,
};

fs.mkdirSync(qaDir, { recursive: true });
fs.writeFileSync(path.join(qaDir, "runtime-watchdog-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(qaDir, "runtime-watchdog-report.md"), toMarkdown(report));
console.log(JSON.stringify({
  status: report.status,
  classification: report.classification,
  smallest_next_action: report.decision.smallest_next_action,
  stop_automatic_regeneration: report.decision.stop_automatic_regeneration,
}, null, 2));

if (["blocked", "needs_attention"].includes(report.status)) process.exitCode = 1;

function classify() {
  const loopStatus = normalize(qaLoopDecision?.loop_decision?.status);
  const finalStatus = normalize(finalGate?.status);
  const progressStatus = normalize(progress.status);
  const latestSeconds = latestActivity?.secondsAgo ?? null;
  const progressSeconds = progressActivity?.secondsAgo ?? null;
  const completedEnough = imageCount ? completed.length >= imageCount : Boolean(manifestImages && completed.length >= manifestImages);
  const finalImagesExist = manifestImages > 0;
  const noRecentActivity = latestSeconds != null && latestSeconds > thresholds.stale_after_seconds;
  const noRecentProgress = progressSeconds != null && progressSeconds > thresholds.stale_after_seconds;
  const noMeaningfulProgress = meaningfulProgressAgeSeconds != null && meaningfulProgressAgeSeconds > thresholds.meaningful_progress_stale_seconds;
  const oldEnoughToWarn = Math.max(runAgeSeconds || 0, ageSeconds || 0) >= thresholds.warn_after_seconds;
  const oldEnoughToBlock = Math.max(runAgeSeconds || 0, ageSeconds || 0) >= thresholds.block_after_seconds;
  const anchorDecisionStatus = normalize(anchorDecision?.qa_decision || anchorDecision?.status);
  const remainingStartedBeforeAnchorQa = childProgress.items.some((item) => /^progress-remaining-/i.test(path.basename(item.file))) && !["continue", "pass", "approved"].includes(anchorDecisionStatus);

  if (childProgress.items.length && normalize(progress.status) === "not_started") {
    findings.push(finding("fail", "stale-main-generation-progress", `Main generation-progress.json is still not_started while ${childProgress.items.length} per-job progress file(s) exist.`));
  }

  if (remainingStartedBeforeAnchorQa) {
    findings.push(finding("fail", "remaining-started-before-anchor-qa", "Remaining image jobs ran before anchor batch QA recorded continue/pass/approved."));
    return makeDecision("needs_attention", "anchor_qa_bypassed", true, true, "Stop generation. Reconcile per-job progress, review the completed anchor asset(s), then continue only failed or missing jobs after anchor QA approval.", "Remaining jobs bypassed anchor QA approval.");
  }

  if (loopStatus === "blocked_retry_budget_exhausted" || retryBudgetExhausted(qaLoopState)) {
    findings.push(finding("fail", "gate-churn-detected", "QA loop retry budget is exhausted. Stop automatic regeneration and route to the earliest failed node or ask for user/source input."));
    return makeDecision("blocked", "gate_churn_detected", true, true, "Stop generation. Review qa-loop-routing-decision.json and fix the root gate, not the whole image set.", "QA loop retry budget is exhausted.");
  }

  if (failed.length) {
    findings.push(finding("fail", "failed-assets-present", `Generation progress still lists failed assets: ${failed.join(", ")}.`));
    return makeDecision("needs_attention", "failed_assets_pending_repair", true, true, "Regenerate or rerender only failed assets, then rerun focused gates.", "Failed assets remain in generation-progress.json.");
  }

  if (finalImagesExist && (!finalGate || !["pass", "passed", "ready"].includes(finalStatus))) {
    const missing = [];
    if (!overviewReport && manifestImages > 1) missing.push("delivery overview");
    if (!finalGate) missing.push("final delivery gate");
    findings.push(finding("warn", "ready-but-not-closed", `Final manifest has ${manifestImages} image(s), but handoff is not closed${missing.length ? `; missing ${missing.join(", ")}` : ""}.`));
    return makeDecision("needs_attention", "ready_but_not_closed", true, true, "Do not regenerate. Run missing overview/tldraw/final-delivery-gate steps and hand off the current run.", "Final images already exist but delivery closure is incomplete.");
  }

  if (oldEnoughToBlock && noRecentActivity && !completedEnough) {
    findings.push(finding("fail", "stalled-no-progress", `No run file changed for ${latestSeconds}s and image production is not complete.`));
    return makeDecision("blocked", "blocked_stalled_no_progress", true, true, "Stop automatic work. Report completed/pending assets and ask whether to continue, change direction, or repair the blocked node.", "Long-running task has no recent filesystem progress.");
  }

  if (oldEnoughToWarn && noRecentProgress && pending.length) {
    if (noMeaningfulProgress) {
      findings.push(finding("fail", "provider-meaningful-progress-stale", `No provider meaningful progress event for ${meaningfulProgressAgeSeconds}s while ${pending.length} pending asset(s) remain.`));
      return makeDecision("needs_attention", "provider_wait_stale", true, true, "Stop waiting on the current provider job. Preserve completed assets, mark only the stale job retryable, and continue from the failed/missing asset list.", "Heartbeat alone is not meaningful provider progress.");
    }
    findings.push(finding("warn", "active-generation-or-network-wait", `No generation-progress update for ${progressSeconds}s while ${pending.length} pending asset(s) remain.`));
    return makeDecision("continue", "active_generation_wait", false, true, "Give the user a progress update, then continue only pending assets if the image generation call is still active.", "The run is long, but pending assets suggest generation/network wait rather than a QA loop.");
  }

  if (oldEnoughToWarn && noRecentActivity && !pending.length && !completedEnough) {
    findings.push(finding("warn", "planning-or-gate-stall", `Run exceeded ${thresholds.warn_after_seconds}s without recent activity and has no explicit pending generation assets.`));
    return makeDecision("needs_attention", "local_planning_or_gate_stall", true, true, "Run qa-loop-router or the next missing gate; do not restart full generation.", "Long-running run appears stalled outside active image generation.");
  }

  if (pending.length || /generating|in_progress|running|pending/.test(progressStatus)) {
    return makeDecision("continue", "active_generation_wait", false, oldEnoughToWarn, "Continue only pending assets and update generation-progress.json after each output.", "Generation has pending assets or an in-progress status.");
  }

  return makeDecision("continue", "normal_on_track", false, false, "Proceed to the next workflow node.", "No runtime stall detected.");
}

function resolveThresholds({ args: rawArgs, plan: rawPlan, progress: rawProgress }) {
  const policy = rawPlan.progress_update_policy || rawPlan.progress_update || rawProgress.progress_update_policy || {};
  const warn = Number(rawArgs["warn-after-seconds"] || policy.long_running_threshold_seconds || policy.user_visible_update_interval_seconds || 900);
  const block = Number(rawArgs["block-after-seconds"] || policy.block_after_seconds || Math.max(warn * 2, 1800));
  const stale = Number(rawArgs["stale-after-seconds"] || policy.stale_after_seconds || warn);
  const meaningful = Number(rawArgs["meaningful-progress-stale-seconds"] || policy.meaningful_progress_stale_seconds || Math.min(stale, 600));
  return {
    warn_after_seconds: Number.isFinite(warn) && warn > 0 ? warn : 900,
    block_after_seconds: Number.isFinite(block) && block > 0 ? block : 1800,
    stale_after_seconds: Number.isFinite(stale) && stale > 0 ? stale : 900,
    meaningful_progress_stale_seconds: Number.isFinite(meaningful) && meaningful > 0 ? meaningful : 600,
  };
}

function collectChildProgress(dir) {
  const result = { items: [], completed: [], pending: [], failed: [] };
  if (!fs.existsSync(dir)) return result;
  for (const file of fs.readdirSync(dir).filter((item) => /^progress-.+\.json$/i.test(item)).map((item) => path.join(dir, item)).sort()) {
    const item = readJsonSafe(file);
    if (!item) continue;
    const id = path.basename(file).replace(/^progress-/i, "").replace(/\.json$/i, "");
    const status = normalize(item.status);
    const normalized = { id, file, ...item };
    result.items.push(normalized);
    if (status === "completed") result.completed.push(...normalizeProgressImages(item.runtime?.completed_images || item.completed_images || [id]));
    else if (status === "failed") result.failed.push(id);
    else if (/generating|downloading|pending|running|prepared/.test(status)) result.pending.push(id);
  }
  return result;
}

function latestMeaningfulProgress(mainProgress, childItems) {
  const dates = [];
  for (const item of [mainProgress, ...childItems]) {
    const direct = parseDate(item?.runtime?.last_meaningful_progress_at);
    if (direct) dates.push(direct);
    for (const event of item?.runtime?.meaningful_progress_events || []) {
      const date = parseDate(event.at);
      if (date) dates.push(date);
    }
  }
  return dates.sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function collectRunFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const ignored = new Set(["node_modules", ".git"]);
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        out.push(full);
      }
    }
  }
  return out;
}

function latestFileActivity(files, currentTime) {
  let latest = null;
  let oldest = null;
  for (const file of files) {
    const activity = fileActivity(file, currentTime);
    if (!activity) continue;
    if (!latest || activity.mtime > latest.mtime) latest = { ...activity, file };
    if (!oldest || activity.mtime < oldest.mtime) oldest = activity;
  }
  return latest ? { ...latest, oldestMtime: oldest?.mtime || latest.mtime } : null;
}

function fileActivity(file, currentTime) {
  try {
    const stat = fs.statSync(file);
    const secondsAgo = Math.max(0, Math.round((currentTime.getTime() - stat.mtimeMs) / 1000));
    return { mtime: stat.mtime, secondsAgo };
  } catch {
    return null;
  }
}

function retryBudgetExhausted(state) {
  const signatures = state?.signatures || {};
  return Object.values(signatures).some((item) => {
    const attempts = Number(item?.attempts || item?.count || 0);
    const budget = Number(item?.retry_budget || item?.budget || 0);
    return budget > 0 && attempts > budget;
  });
}

function manifestImageCount(value) {
  if (!value) return 0;
  if (Array.isArray(value.images)) return value.images.length;
  if (Array.isArray(value.files)) return value.files.length;
  if (Array.isArray(value.final_images)) return value.final_images.length;
  return 0;
}

function normalizeProgressImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    return item?.file || item?.path || item?.id || item?.image_id || JSON.stringify(item);
  }).filter(Boolean);
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function secondsBetween(from, to) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function finding(severity, type, message) {
  return { severity, type, message };
}

function makeDecision(status, classification, stop, userUpdate, nextAction, reason) {
  return {
    status,
    classification,
    stop_automatic_regeneration: stop,
    user_update_required: userUpdate,
    smallest_next_action: nextAction,
    reason,
  };
}

function toMarkdown(report) {
  const lines = [
    "# Runtime Watchdog Report",
    "",
    `- Status: ${report.status}`,
    `- Classification: ${report.classification}`,
    `- Stop automatic regeneration: ${report.decision.stop_automatic_regeneration}`,
    `- User update required: ${report.decision.user_update_required}`,
    `- Smallest next action: ${report.decision.smallest_next_action}`,
    "",
    "## Snapshot",
    `- Progress status: ${report.runtime_snapshot.progress_status}`,
    `- Completed images: ${report.runtime_snapshot.completed_images}`,
    `- Pending images: ${report.runtime_snapshot.pending_images}`,
    `- Failed images: ${report.runtime_snapshot.failed_images}`,
    `- Manifest images: ${report.runtime_snapshot.manifest_images}`,
    `- Latest activity seconds ago: ${report.runtime_snapshot.latest_activity_seconds_ago ?? "unknown"}`,
    "",
    "## Findings",
    ...(report.findings.length ? report.findings.map((item) => `- [${item.severity}] ${item.type}: ${item.message}`) : ["- None"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
