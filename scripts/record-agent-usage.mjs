#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.task) usage();
const runDir = path.resolve(args["run-dir"]);
const taskId = String(args.task);
const ledgerPath = path.join(runDir, "telemetry", "agent-context-ledger.jsonl");
const events = readJsonLines(ledgerPath);
const context = [...events].reverse().find((event) => event.task_id === taskId && event.event === "context_pack_created");
if (!context) fail(`No context pack ledger event exists for task ${taskId}.`);
const event = {
  schema_version: "sellerpilot.agent_context_ledger.v1",
  event: "agent_usage_recorded",
  at: new Date().toISOString(),
  task_id: taskId,
  context_bytes: context.context_bytes,
  estimated_input_tokens: context.estimated_input_tokens,
  actual_input_tokens: finiteOrNull(args["input-tokens"]),
  actual_output_tokens: finiteOrNull(args["output-tokens"]),
  cached_tokens: finiteOrNull(args["cached-tokens"]),
  latency_ms: finiteOrNull(args["latency-ms"]),
  usage_source: String(args["usage-source"] || "host_callback"),
  quality_policy: "measurement only; token accounting must not weaken required product-image quality evidence",
};
fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
updateRunState(runDir, event);
console.log(JSON.stringify({ status: "recorded", task_id: taskId, ledger: ledgerPath, actual_input_tokens: event.actual_input_tokens, actual_output_tokens: event.actual_output_tokens }, null, 2));

function updateRunState(root, value) {
  const file = path.join(root, "run-state.json");
  const state = readJson(file);
  if (!state) return;
  state.cost ||= {};
  state.cost.agent_input_tokens = Number(state.cost.agent_input_tokens || 0) + Number(value.actual_input_tokens || 0);
  state.cost.agent_output_tokens = Number(state.cost.agent_output_tokens || 0) + Number(value.actual_output_tokens || 0);
  state.cost.agent_cached_tokens = Number(state.cost.agent_cached_tokens || 0) + Number(value.cached_tokens || 0);
  state.updated_at = value.at;
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}
function parseArgs(argv) { const result = {}; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function readJsonLines(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function finiteOrNull(value) { if (value === undefined) return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/record-agent-usage.mjs --run-dir /abs/run --task <task-id> [--input-tokens N] [--output-tokens N] [--cached-tokens N] [--latency-ms N]"); process.exit(2); }
