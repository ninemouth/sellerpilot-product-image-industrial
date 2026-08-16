#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role || !args.status) usage();
const runDir = path.resolve(args["run-dir"]);
const statePath = path.join(runDir, "run-state.json");
const state = readJson(statePath);
if (!state || state.schema_version !== "sellerpilot.run_state.v1") fail("run-state.json is missing or incompatible; compile a production plan first.");
const role = normalizeRole(args.role);
if (!role || !state.roles?.[role]) fail(`Unknown role: ${args.role}.`);
const status = normalizeStatus(args.status);
const fingerprint = fingerprintFor(args);
const ledgerPath = path.join(runDir, "telemetry", "cost-ledger.jsonl");
const ledger = readJsonLines(ledgerPath);
const roleEvents = ledger.filter((item) => item.event === "provider_call" && item.role === role);
const attempts = roleEvents.filter((item) => ["succeeded", "failed"].includes(item.status)).length;
const budget = Number(state.budget?.max_provider_calls || 0);
const used = ledger.filter((item) => item.event === "provider_call" && ["succeeded", "failed"].includes(item.status)).length;
const roleLimit = Number(state.budget?.max_provider_attempts_per_role || 0);
const previousFingerprint = [...roleEvents].reverse().find((item) => item.fingerprint)?.fingerprint || null;
const isRetry = attempts > 0;
const evidenceDeltaRequired = Boolean(state.budget?.evidence_delta_required_before_retry ?? state.loop?.retry_requires_evidence_delta);
const rejection = validateCall({ status, isRetry, fingerprint, previousFingerprint, evidenceDeltaRequired, attempts, roleLimit, used, budget });
const now = new Date().toISOString();
const event = {
  schema_version: "sellerpilot.cost_ledger.v1",
  event: "provider_call",
  at: now,
  run_id: state.run_id,
  role,
  status: rejection ? "blocked" : status,
  provider: String(args.provider || "unknown"),
  model: String(args.model || "unknown"),
  prompt_hash: hash(String(args["prompt-hash"] || "")),
  source_hash: hash(String(args["source-hash"] || "")),
  fingerprint,
  attempt: attempts + 1,
  cost_estimate: finiteNumber(args["cost-estimate"]),
  input_tokens: finiteNumber(args["input-tokens"]),
  output_tokens: finiteNumber(args["output-tokens"]),
  cached_tokens: finiteNumber(args["cached-tokens"]),
  latency_ms: finiteNumber(args["latency-ms"]),
  triggering_gate: String(args["triggering-gate"] || "generation_dispatch"),
  state_transition: rejection ? "provider_call_blocked" : providerTransition(status),
  rejection_reason: rejection || null,
};
appendJsonLine(ledgerPath, event);
state.updated_at = now;
state.cost ||= { provider_calls_used: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cost_estimate: 0 };
if (!rejection && ["succeeded", "failed"].includes(status)) {
  state.cost.provider_calls_used += 1;
  state.cost.input_tokens += event.input_tokens || 0;
  state.cost.output_tokens += event.output_tokens || 0;
  state.cost.cached_tokens += event.cached_tokens || 0;
  state.cost.cost_estimate += event.cost_estimate || 0;
  state.roles[role] = { ...state.roles[role], status: roleStatus(status), attempts: Number(state.roles[role].attempts || 0) + 1, evidence_hash: fingerprint, updated_at: now };
}
state.transitions ||= [];
state.transitions.push({ at: now, event: "provider_call", role, status: event.status, decision: event.state_transition, reason: rejection || null });
if (state.transitions.length > 100) state.transitions = state.transitions.slice(-100);
writeJson(statePath, state);
const result = { status: rejection ? "blocked" : "recorded", role, attempt: event.attempt, provider_calls_used: state.cost.provider_calls_used, provider_calls_limit: budget || null, ledger: ledgerPath, reason: rejection || null };
console.log(JSON.stringify(result, null, 2));
if (rejection) process.exitCode = 1;

function validateCall(context) {
  if (!context.status || !["requested", "succeeded", "failed"].includes(context.status)) return "provider call status must be requested, succeeded, or failed";
  if (context.budget && context.used >= context.budget) return `run provider call budget exhausted: ${context.used}/${context.budget}`;
  if (context.roleLimit && context.attempts >= context.roleLimit) return `role provider attempt budget exhausted: ${context.attempts}/${context.roleLimit}`;
  if (context.isRetry && context.evidenceDeltaRequired && context.previousFingerprint === context.fingerprint) return "retry rejected because prompt/source/provider evidence fingerprint did not change";
  return null;
}
function providerTransition(status) { return status === "succeeded" ? "provider_asset_available" : status === "failed" ? "provider_failure_recorded" : "provider_request_recorded"; }
function roleStatus(status) { return status === "succeeded" ? "generated_pending_qa" : status === "failed" ? "repair_required" : "generation_requested"; }
function fingerprintFor(input) { return hash(JSON.stringify({ prompt: input["prompt-hash"] || "", source: input["source-hash"] || "", provider: input.provider || "", model: input.model || "", role: input.role || "" })); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function finiteNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function normalizeStatus(value) { return String(value || "").trim().toLowerCase(); }
function parseArgs(argv) { const result = {}; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (next === undefined || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function readJsonLines(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function appendJsonLine(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `${JSON.stringify(value)}\n`); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/record-provider-call.mjs --run-dir /abs/run --role IMG-01 --status requested|succeeded|failed [--prompt-hash value] [--source-hash value] [--provider name] [--model name]"); process.exit(2); }
