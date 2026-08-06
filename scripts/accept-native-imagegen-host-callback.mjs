#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const args = parseArgs(process.argv);
if (args.help || !args.callback) usage();
const callbackPath = path.resolve(args.callback);
const callback = readJson(callbackPath);
if (!callback || callback.schema_version !== "sellerpilot.native_imagegen_host_callback.v1") fail("Callback is unreadable or incompatible.");
if (!callback.run_dir || !callback.role || !callback.handoff || !callback.status) fail("Callback needs run_dir, role, handoff, and status.");
const runDir = path.resolve(callback.run_dir);
const handoff = path.resolve(runDir, callback.handoff);
const status = String(callback.status).toLowerCase();
if (!['succeeded', 'failed'].includes(status)) fail("Callback status must be succeeded or failed.");
if (status === 'succeeded' && (!callback.image_path || !callback.tool_call_id)) fail("Successful callback needs image_path and tool_call_id.");
const script = path.join(skillRootFrom(import.meta.url), "scripts", "record-native-imagegen-result.mjs");
const argv = [script, "--run-dir", runDir, "--role", callback.role, "--status", status, "--handoff", handoff, "--execution-evidence", callback.tool_call_id || `host-callback-failure:${callback.failure_code || 'unknown'}`];
if (callback.image_path) argv.push("--image-path", path.resolve(runDir, callback.image_path));
const result = spawnSync(process.execPath, argv, { cwd: runDir, encoding: "utf8" });
const report = { schema_version: "sellerpilot.native_imagegen_host_callback_receipt.v1", received_at: new Date().toISOString(), callback: callbackPath, run_dir: runDir, role: callback.role, status: result.status === 0 ? "recorded" : "rejected", tool_call_id: callback.tool_call_id || null, result: result.stdout ? safeJson(result.stdout) : null, error: result.status === 0 ? null : (result.stderr || result.stdout || "callback recording failed").trim() };
const out = path.join(runDir, "runtime", `native-imagegen-host-callback-${String(callback.role).toLowerCase()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ status: report.status, receipt: out }, null, 2));
if (result.status !== 0) process.exitCode = 1;
function parseArgs(argv) { const x = {}; for (let i=2;i<argv.length;i+=1) { if (!argv[i].startsWith('--')) continue; const k=argv[i].slice(2), v=argv[i+1]; if (!v||v.startsWith('--')) x[k]=true; else {x[k]=v;i+=1;} } return x; }
function readJson(file) { try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;} }
function safeJson(v) { try{return JSON.parse(v);}catch{return v.trim();} }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/accept-native-imagegen-host-callback.mjs --callback /abs/callback.json"); process.exit(2); }
