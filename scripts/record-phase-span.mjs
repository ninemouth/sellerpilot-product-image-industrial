#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.phase || !args.start) usage();
const started = new Date(args.start);
const ended = new Date(args.end || new Date().toISOString());
if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime()) || ended < started) fail("Phase span timestamps are invalid.");
const event = {
  schema_version: "sellerpilot.phase_event.v1",
  event: "explicit_span",
  task_id: args.task || null,
  phase: String(args.phase),
  status: String(args.status || "completed"),
  started_at: started.toISOString(),
  ended_at: ended.toISOString(),
  duration_ms: ended.getTime() - started.getTime(),
  input_bytes: finiteOrNull(args["input-bytes"]),
  output_bytes: finiteOrNull(args["output-bytes"]),
};
const file = path.join(path.resolve(args["run-dir"]), "telemetry", "phase-events.jsonl");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
console.log(JSON.stringify({ status: "recorded", phase: event.phase, duration_ms: event.duration_ms, ledger: file }, null, 2));

function parseArgs(argv) { const result = {}; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function finiteOrNull(value) { if (value === undefined) return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/record-phase-span.mjs --run-dir /abs/run --phase <name> --start <ISO> [--end <ISO>] [--task id] [--status completed]"); process.exit(2); }
