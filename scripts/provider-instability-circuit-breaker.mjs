#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const maxFailuresPerRole = Number(args["max-failures-per-role"] || 2);
const maxTotalFailures = Number(args["max-total-failures"] || 6);
const repairMap = readJsonSafe(path.join(runDir, "qa", "failed-asset-repair-map.json")) || {};
const manifest = readJsonSafe(path.join(runDir, "export", "final-images-manifest.json")) || null;
const progressFiles = collectProgressFiles(path.join(runDir, "generated-assets"));
const attempts = progressFiles.map((item) => attemptFromProgress(item, repairMap));
const failedAttempts = attempts.filter((item) => item.failed);
const unresolvedFailures = failedAttempts.filter((item) => !item.repaired_by_final_asset);
const roleCounts = countBy(failedAttempts, (item) => item.role_key);
const repeatedRoles = Object.entries(roleCounts)
  .filter(([, count]) => count >= maxFailuresPerRole)
  .map(([role_key, failed_attempts]) => ({ role_key, failed_attempts }));
const repairedCount = failedAttempts.length - unresolvedFailures.length;
const trigger = unresolvedFailures.length > 0 && (repeatedRoles.length > 0 || failedAttempts.length >= maxTotalFailures);
const status = trigger ? "blocked" : failedAttempts.length ? "pass_with_warnings" : "pass";
const findings = [];

if (trigger) {
  findings.push({
    severity: "fail",
    type: "provider-instability-circuit-breaker-triggered",
    message: `Provider attempts have ${failedAttempts.length} failed job(s), ${unresolvedFailures.length} unresolved, and repeated failed roles: ${repeatedRoles.map((item) => item.role_key).join(", ") || "none"}. Stop automatic provider retries.`,
  });
} else if (failedAttempts.length) {
  findings.push({
    severity: "warn",
    type: "provider-instability-repaired",
    message: `${failedAttempts.length} failed provider attempt(s) were observed; ${repairedCount} are repaired by final assets. Keep this as performance evidence, not a reason to retry the full set.`,
  });
}

const report = {
  schema_version: "sellerpilot.provider_instability_circuit_breaker.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  thresholds: {
    max_failures_per_role: maxFailuresPerRole,
    max_total_failures: maxTotalFailures,
  },
  attempts,
  summary: {
    progress_files: progressFiles.length,
    failed_attempts: failedAttempts.length,
    repaired_failed_attempts: repairedCount,
    unresolved_failed_attempts: unresolvedFailures.length,
    repeated_failed_roles: repeatedRoles,
    manifest_images: Array.isArray(manifest?.images) ? manifest.images.length : 0,
  },
  decision: {
    stop_provider_retries: trigger,
    allowed_next_actions: trigger
      ? [
        "review approved generated assets",
        "derive from approved assets when policy allows",
        "downgrade unstable scene role",
        "ask user before additional provider retries",
      ]
      : ["continue workflow", "preserve provider failure evidence"],
  },
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "provider-instability-circuit-breaker-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "provider-instability-circuit-breaker-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, failed_attempts: failedAttempts.length, unresolved_failed_attempts: unresolvedFailures.length, outDir }, null, 2));
if (status === "blocked") process.exitCode = 1;

function attemptFromProgress(item, repairs) {
  const status = normalize(item.progress.status);
  const progressRel = path.relative(runDir, item.file);
  const repairedFinal = repairs.repairs?.[path.basename(item.file)] || repairs.repairs?.[progressRel] || null;
  const failed = status === "failed" || status === "repaired_by_final_asset" || Boolean(item.progress.runtime?.failure || item.progress.failure);
  return {
    id: item.id,
    progress_file: progressRel,
    role_key: roleKey(item.id),
    status,
    failed,
    repaired_by_final_asset: repairedFinal || (status === "repaired_by_final_asset" ? "unknown_final_asset" : null),
    failure_code: item.progress.runtime?.failure?.code || item.progress.failure?.code || null,
    meaningful_events: (item.progress.runtime?.meaningful_progress_events || []).map((event) => event.event),
    updated_at: item.progress.updated_at || null,
  };
}

function collectProgressFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^progress-.+\.json$/i.test(name))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return {
        id: name.replace(/^progress-/i, "").replace(/\.json$/i, ""),
        file,
        progress: readJsonSafe(file) || {},
      };
    });
}

function roleKey(id) {
  return String(id || "")
    .replace(/^(anchor|remaining)-/i, "")
    .replace(/-(retry|simple|gen|edit|rerun)\d*$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .toLowerCase();
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function toMarkdown(report) {
  const lines = [
    "# Provider Instability Circuit Breaker",
    "",
    `- Status: ${report.status}`,
    `- Failed attempts: ${report.summary.failed_attempts}`,
    `- Repaired failed attempts: ${report.summary.repaired_failed_attempts}`,
    `- Unresolved failed attempts: ${report.summary.unresolved_failed_attempts}`,
    `- Stop provider retries: ${report.decision.stop_provider_retries}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.type}: ${finding.message}`);
  lines.push("");
  return lines.join("\n");
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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
  console.error("Usage: node scripts/provider-instability-circuit-breaker.mjs --run-dir /abs/run [--out-dir /abs/run/qa] [--max-failures-per-role 2] [--max-total-failures 6]");
  process.exit(2);
}
