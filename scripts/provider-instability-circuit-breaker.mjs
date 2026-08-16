#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const maxFailuresPerRole = Number(args["max-failures-per-role"] || 2);
const maxTotalFailures = Number(args["max-total-failures"] || 6);
const repairMap = readJsonSafe(path.join(runDir, "qa", "failed-asset-repair-map.json")) || {};
const manifest = readJsonSafe(path.join(runDir, "export", "final-images-manifest.json")) || null;
const progressFiles = collectProgressFiles(path.join(runDir, "generated-assets"));
const diagnostics = collectProviderFailureDiagnostics(path.join(runDir, "runtime"));
const attempts = [
  ...progressFiles.map((item) => attemptFromProgress(item, repairMap)),
  ...diagnostics.filter((diagnostic) => !progressFiles.some((item) => roleKey(item.id) === roleKey(diagnostic.role))).map((diagnostic) => attemptFromDiagnostic(diagnostic)),
];
const failedAttempts = attempts.filter((item) => item.failed);
const unresolvedFailures = failedAttempts.filter((item) => !item.repaired_by_final_asset);
const setupRequiredFailures = unresolvedFailures.filter((item) => item.failure_code === "external_provider_transport_unavailable");
const ledgerPreflightFailures = unresolvedFailures.filter((item) => isLedgerPreflightFailure(item.failure_code));
const providerFailures = unresolvedFailures.filter((item) => item.failure_code !== "external_provider_transport_unavailable" && !isLedgerPreflightFailure(item.failure_code));
const nonRetryableFailures = providerFailures.filter((item) => item.retryable === false);
const roleCounts = countBy(failedAttempts.filter((item) => item.failure_code !== "external_provider_transport_unavailable" && !isLedgerPreflightFailure(item.failure_code)), (item) => item.role_key);
const repeatedRoles = Object.entries(roleCounts)
  .filter(([, count]) => count >= maxFailuresPerRole)
  .map(([role_key, failed_attempts]) => ({ role_key, failed_attempts }));
const repairedCount = failedAttempts.length - unresolvedFailures.length;
const providerCircuitOpen = nonRetryableFailures.length > 0 || (providerFailures.length > 0 && (repeatedRoles.length > 0 || providerFailures.length >= maxTotalFailures));
const setupRequired = setupRequiredFailures.length > 0;
const ledgerPreflightBlocked = ledgerPreflightFailures.length > 0;
const trigger = setupRequired || ledgerPreflightBlocked || providerCircuitOpen;
const status = setupRequired ? "setup_required" : ledgerPreflightBlocked || providerCircuitOpen ? "blocked" : failedAttempts.length ? "pass_with_warnings" : "pass";
const findings = [];

if (setupRequired) {
  findings.push({
    severity: "fail",
    type: "external-provider-transport-unavailable",
    message: `The configured external provider could not be reached for ${setupRequiredFailures.map((item) => item.role_key).join(", ")}. No provider request reached the remote service; restore external-provider connectivity during skill installation or update, then retry the same selected provider.`,
  });
} else if (ledgerPreflightBlocked) {
  findings.push({
    severity: "fail",
    type: "provider-ledger-preflight-blocked",
    message: `Provider request was blocked locally before network execution for ${ledgerPreflightFailures.map((item) => item.role_key).join(", ")}. Inspect the current run contract, role binding, budget, or evidence-delta requirement; do not treat this as a remote provider failure.`,
  });
} else if (providerCircuitOpen) {
  findings.push({
    severity: "fail",
    type: nonRetryableFailures.length ? "provider-non-retryable-refusal" : "provider-instability-circuit-breaker-triggered",
    message: nonRetryableFailures.length
      ? `Provider returned ${nonRetryableFailures.length} non-retryable refusal(s) for ${nonRetryableFailures.map((item) => item.role_key).join(", ")}. Stop automatic retries until account, permission, model access, or configuration is corrected.`
      : `Provider attempts have ${failedAttempts.length} failed job(s), ${unresolvedFailures.length} unresolved, and repeated failed roles: ${repeatedRoles.map((item) => item.role_key).join(", ") || "none"}. Stop automatic provider retries.`,
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
    failure_diagnostics: diagnostics.length,
    failed_attempts: failedAttempts.length,
    setup_required_failures: setupRequiredFailures.length,
    repaired_failed_attempts: repairedCount,
    unresolved_failed_attempts: unresolvedFailures.length,
    non_retryable_failures: nonRetryableFailures.length,
    ledger_preflight_failures: ledgerPreflightFailures.length,
    repeated_failed_roles: repeatedRoles,
    manifest_images: Array.isArray(manifest?.images) ? manifest.images.length : 0,
  },
  decision: {
    stop_provider_retries: trigger,
    requires_user_authorization: false,
    requires_setup_update: setupRequired,
    required_capability: null,
    allowed_next_actions: setupRequired
      ? [
        "restore external-provider connectivity during skill installation or update",
        "retry the same resolved provider runtime after setup succeeds",
        "do not substitute native imagegen or another provider",
      ]
      : ledgerPreflightBlocked
      ? [
        "inspect the provider ledger rejection reason",
        "repair the run contract, role binding, budget, or evidence delta",
        "retry only after the preflight condition is resolved",
        "do not switch providers or count this as a remote provider failure",
      ]
      : trigger
      ? [
        "review approved generated assets",
        "derive from approved assets when policy allows",
        "downgrade unstable scene role",
        ...(nonRetryableFailures.length ? ["repair provider account, permission, model access, or configuration before retrying"] : ["ask user before additional provider retries"]),
      ]
      : ["continue workflow", "preserve provider failure evidence"],
  },
  findings,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "provider-instability-circuit-breaker-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "provider-instability-circuit-breaker-report.md"), toMarkdown(report));
syncRunState();
console.log(JSON.stringify({ status, failed_attempts: failedAttempts.length, unresolved_failed_attempts: unresolvedFailures.length, outDir }, null, 2));
if (trigger) process.exitCode = 1;

function syncRunState() {
  if (!fs.existsSync(path.join(runDir, "run-state.json"))) return;
  const script = path.join(skillRootFrom(import.meta.url), "scripts", "run-state-transition.mjs");
  const result = spawnSync(process.execPath, [script, "--run-dir", runDir, "--event", "circuit", "--input", path.join(outDir, "provider-instability-circuit-breaker-report.json")], { cwd: runDir, encoding: "utf8" });
  if (result.status !== 0) console.error(`run-state circuit projection skipped: ${(result.stderr || result.stdout || "unknown error").trim()}`);
}

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
    retryable: item.progress.runtime?.failure?.retryable ?? item.progress.failure?.retryable ?? null,
    meaningful_events: (item.progress.runtime?.meaningful_progress_events || []).map((event) => event.event),
    updated_at: item.progress.updated_at || null,
  };
}

function attemptFromDiagnostic(item) {
  return {
    id: item.role || "unbound",
    progress_file: item.file,
    role_key: roleKey(item.role),
    status: "failed",
    failed: true,
    repaired_by_final_asset: null,
    failure_code: item.error_code || null,
    retryable: item.retryable === false ? false : item.retryable === true ? true : null,
    meaningful_events: [],
    updated_at: item.recorded_at || null,
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

function collectProviderFailureDiagnostics(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^provider-failure-diagnostic-.+\.json$/i.test(name))
    .sort()
    .flatMap((name) => {
      const file = path.join(dir, name);
      const value = readJsonSafe(file);
      if (!value || value.schema_version !== "sellerpilot.provider_failure_diagnostic.v1") return [];
      return [{ ...value, file: path.relative(runDir, file) }];
    });
}

function roleKey(id) {
  return String(id || "")
    .replace(/^(anchor|remaining)-/i, "")
    .replace(/-(retry|simple|gen|edit|rerun)\d*$/i, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .toLowerCase();
}

function isLedgerPreflightFailure(code) {
  return new Set([
    "provider_evidence_delta_required",
    "provider_run_budget_exhausted",
    "provider_role_budget_exhausted",
    "provider_run_state_invalid",
    "provider_role_unregistered",
    "provider_ledger_preflight_failed",
  ]).has(String(code || ""));
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
