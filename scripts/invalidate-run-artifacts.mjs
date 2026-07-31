#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args["from-node"] || !args.reason) usage();
const runDir = path.resolve(args["run-dir"]);
const statePath = path.join(runDir, "run-state.json");
const dagPath = path.join(runDir, "orchestration", "tasks.json");
const state = readJson(statePath);
const dag = readJson(dagPath);
if (!state || !dag?.tasks) fail("run-state.json or compiled orchestration/tasks.json is missing.");
const fromNode = String(args["from-node"]);
const roots = new Set([fromNode]);
const invalidated = [];
let changed = true;
while (changed) {
  changed = false;
  for (const task of dag.tasks) {
    if (roots.has(task.id)) continue;
    if ((task.depends_on || []).some((dependency) => roots.has(dependency))) { roots.add(task.id); changed = true; }
  }
}
for (const task of dag.tasks) if (roots.has(task.id)) invalidated.push({ id: task.id, outputs: task.outputs || [], execution_class: task.execution_class });
const role = normalizeRole(args.role);
state.updated_at = new Date().toISOString();
state.status = "running";
state.loop ||= {};
state.loop.last_decision = "artifact_invalidation";
state.loop.last_reason = String(args.reason);
if (role && state.roles?.[role]) state.roles[role] = { ...state.roles[role], status: "repair_required", return_node: fromNode, invalidated_at: state.updated_at };
state.artifact_invalidations ||= [];
state.artifact_invalidations.push({ at: state.updated_at, from_node: fromNode, role: role || null, reason: String(args.reason), tasks: invalidated, destructive: false });
writeJson(statePath, state);
const report = { schema_version: "sellerpilot.artifact_invalidation.v1", run_dir: runDir, at: state.updated_at, from_node: fromNode, role: role || null, reason: String(args.reason), invalidated_tasks: invalidated, preserves_files: true };
writeJson(path.join(runDir, "qa", "artifact-invalidation-report.json"), report);
console.log(JSON.stringify({ status: "recorded", invalidated_tasks: invalidated.map((item) => item.id), preserves_files: true }, null, 2));

function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function parseArgs(argv) { const result = {}; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/invalidate-run-artifacts.mjs --run-dir /abs/run --from-node <task-id> --reason <reason> [--role IMG-01]"); process.exit(2); }
