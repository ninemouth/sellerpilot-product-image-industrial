#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.event) usage();
const runDir = path.resolve(args["run-dir"]);
const statePath = path.join(runDir, "run-state.json");
const state = readJson(statePath);
if (!state || state.schema_version !== "sellerpilot.run_state.v1") fail("run-state.json is missing or incompatible; compile a production plan before applying transitions.");

const event = String(args.event);
const payload = args.input ? readJson(path.resolve(args.input)) : defaultPayload(event);
if (!payload) fail(`No state payload found for event ${event}.`);
const transition = deriveTransition(event, payload, state);
state.status = transition.status;
state.updated_at = new Date().toISOString();
state.loop ||= {};
state.loop.current_cycle = Number(state.loop.current_cycle || 0) + (transition.increment_cycle ? 1 : 0);
state.loop.last_decision = transition.decision;
state.loop.last_reason = transition.reason;
state.loop.last_event = event;
state.transitions ||= [];
state.transitions.push({ at: state.updated_at, event, ...transition, source: args.input ? path.resolve(args.input) : defaultSource(event) });
if (state.transitions.length > 100) state.transitions = state.transitions.slice(-100);
applyRoleUpdates(state, transition, payload);
writeJson(statePath, state);
console.log(JSON.stringify({ status: "applied", run_status: state.status, decision: transition.decision, event, state: statePath }, null, 2));

function defaultPayload(kind) {
  const file = defaultSource(kind);
  return file ? readJson(file) : null;
}
function defaultSource(kind) {
  const map = {
    qa: path.join(runDir, "qa", "qa-loop-routing-decision.json"),
    watchdog: path.join(runDir, "qa", "runtime-watchdog-report.json"),
    delivery: path.join(runDir, "qa", "final-delivery-gate-report.json"),
    generation: path.join(runDir, "generated-assets", "execution-controller-state.json"),
  };
  return map[kind] || null;
}
function deriveTransition(kind, value, current) {
  if (kind === "qa") {
    const loop = value.loop_decision || {};
    if (loop.status === "continue") return makeTransition("running", "qa_continue", loop.smallest_next_action || "Proceed to next node.", false, []);
    if (String(loop.status || "").startsWith("blocked")) {
      const status = loop.user_input_required ? "paused_for_human_decision" : "blocked";
      return makeTransition(status, loop.status, loop.blocked_reason || loop.smallest_next_action || "QA loop blocked.", false, loop.failed_images || [], loop.return_node);
    }
    return makeTransition("running", loop.status || "qa_repair_required", loop.smallest_next_action || "Repair affected role only.", true, loop.failed_images || [], loop.return_node);
  }
  if (kind === "watchdog") {
    const decision = value.decision || {};
    const classification = value.classification || "unknown";
    if (classification === "auto_closed_ready_handoff") return makeTransition("delivery_ready", classification, decision.reason || "Delivery closure completed.", false, []);
    if (["blocked_stalled_no_progress", "gate_churn_detected"].includes(classification)) return makeTransition("blocked", classification, decision.reason || "Watchdog blocked the run.", false, []);
    if (classification === "ready_but_not_closed") return makeTransition("delivery_ready", classification, decision.smallest_next_action || "Close delivery without generation.", false, []);
    return makeTransition(current.status === "planned" ? "running" : current.status, classification, decision.reason || "Watchdog observation recorded.", false, []);
  }
  if (kind === "delivery") {
    const status = String(value.status || "").toLowerCase();
    if (["pass", "passed", "ready"].includes(status)) return makeTransition("delivered", "final_delivery_pass", "Final delivery gate passed.", false, []);
    return makeTransition("delivery_ready", "final_delivery_repair_required", "Final delivery gate requires closure work; do not regenerate without a root-cause finding.", false, []);
  }
  if (kind === "circuit") {
    if (String(value.status || "").toLowerCase() === "setup_required" || value.decision?.requires_setup_update === true) {
      return makeTransition("blocked", "external_provider_setup_required", "The configured external provider is unavailable from this runtime. Restore connectivity during skill installation or update, then retry the same selected provider without substitution.", false, []);
    }
    const blocked = String(value.status || "").toLowerCase() === "blocked" || value.decision?.stop_provider_retries === true;
    return blocked
      ? makeTransition("blocked", "blocked_provider_circuit_open", "Provider instability circuit is open; automatic provider retries are stopped.", false, [])
      : makeTransition(current.status, "provider_circuit_observed", "Provider circuit observation recorded.", false, []);
  }
  if (kind === "reuse") {
    return makeTransition(current.status, "approved_asset_reuse_recorded", `${Number(value.reuse_count || 0)} approved asset reuse record(s) persisted without provider runtime attribution.`, false, []);
  }
  if (kind === "generation") {
    const controllerStatus = String(value.status || "unknown");
    if (controllerStatus === "blocked_anchor_qa") {
      return makeTransition("paused_for_human_decision", controllerStatus, value.policy || "Anchor QA approval is required before remaining generation.", false, []);
    }
    if (controllerStatus.endsWith("_with_failures")) {
      return makeTransition("running", "generation_repair_required", "Generation controller recorded failed jobs; repair only the failed roles.", true, (value.execution_results || []).filter((item) => item.status === "failed").map((item) => item.id));
    }
    if (["anchor_ready", "anchor_executed", "remaining_ready", "remaining_executed"].includes(controllerStatus)) {
      return makeTransition("running", controllerStatus, value.policy || "Generation controller state recorded.", false, []);
    }
    return makeTransition(current.status, "generation_controller_observed", value.policy || "Generation controller observation recorded.", false, []);
  }
  fail(`Unsupported event: ${kind}.`);
}
function makeTransition(status, decision, reason, incrementCycle, failedImages, returnNode = null) { return { status, decision, reason, increment_cycle: incrementCycle, failed_images: failedImages, return_node: returnNode }; }
function applyRoleUpdates(current, change, value) {
  current.roles ||= {};
  for (const raw of change.failed_images || []) {
    const id = normalizeRole(raw);
    if (!id || !current.roles[id]) continue;
    current.roles[id] = { ...current.roles[id], status: "repair_required", return_node: change.return_node || null, last_failure: change.decision, updated_at: current.updated_at };
  }
  if (change.status === "delivered") for (const role of Object.values(current.roles)) role.status = role.status === "approved" ? "delivered" : role.status;
}
function normalizeRole(value) { if (Number.isInteger(Number(value))) return `IMG-${String(Number(value)).padStart(2, "0")}`; const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function parseArgs(argv) { const result = {}; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/run-state-transition.mjs --run-dir /abs/run --event qa|watchdog|delivery|generation|circuit|reuse [--input /abs/report.json]"); process.exit(2); }
