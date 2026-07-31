#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role || !args.status) usage();

const runDir = path.resolve(args["run-dir"]);
const role = normalizeRole(args.role);
const status = String(args.status).toLowerCase();
if (!role || !["requested", "succeeded", "failed"].includes(status)) fail("role must be IMG-01 style and status must be requested, succeeded, or failed.");
const imagePath = args["image-path"] ? path.resolve(args["image-path"]) : null;
if (status === "succeeded" && (!imagePath || !fs.existsSync(imagePath))) fail("A successful native imagegen result requires an existing --image-path.");

const handoff = args.handoff ? readJson(path.resolve(args.handoff)) : null;
if (args.handoff && (!handoff || handoff.schema_version !== "sellerpilot.native_imagegen_handoff.v1")) fail("--handoff is unreadable or incompatible.");
if (handoff && (handoff.run_id !== readJson(path.join(runDir, "run-state.json"))?.run_id || handoff.role !== role)) fail("Native imagegen handoff does not belong to this run and role.");
const prompt = String(handoff?.prompt || args.prompt || args["prompt-hash"] || "");
const source = String(handoff?.source_evidence || args["source-hash"] || "");
const ledger = path.join(path.resolve(new URL("..", import.meta.url).pathname), "scripts", "record-provider-call.mjs");
const ledgerArgs = [ledger, "--run-dir", runDir, "--role", role, "--status", status, "--prompt-hash", prompt, "--source-hash", source, "--provider", "native_codex", "--model", "imagegen", "--triggering-gate", args["triggering-gate"] || "generation_dispatch"];
for (const [flag, key] of [["--latency-ms", "latency-ms"], ["--cost-estimate", "cost-estimate"], ["--input-tokens", "input-tokens"], ["--output-tokens", "output-tokens"], ["--cached-tokens", "cached-tokens"]]) {
  if (args[key] !== undefined) ledgerArgs.push(flag, String(args[key]));
}
const recorded = spawnSync(process.execPath, ledgerArgs, { cwd: runDir, encoding: "utf8" });
if (recorded.status !== 0) {
  process.stderr.write(recorded.stderr || recorded.stdout || "Native imagegen ledger recording failed.\n");
  process.exit(recorded.status || 1);
}

const evidence = {
  schema_version: "sellerpilot.native_imagegen_result.v1",
  recorded_at: new Date().toISOString(),
  run_id: readJson(path.join(runDir, "run-state.json"))?.run_id || null,
  role,
  status,
  provider: "native_codex",
  model: "imagegen",
  prompt_hash: sha(prompt),
  source_hash: sha(source),
  image_path: imagePath ? path.relative(runDir, imagePath) : null,
  image_sha256: imagePath ? hashFile(imagePath) : null,
  native_execution_evidence: args["execution-evidence"] || null,
  handoff_id: handoff?.handoff_id || null,
  handoff_path: args.handoff ? path.relative(runDir, path.resolve(args.handoff)) : null,
  ledger_record: JSON.parse(recorded.stdout),
};
const out = path.join(runDir, "generated-assets", `native-imagegen-${role.toLowerCase()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: "recorded", provider: "native_codex", role, evidence: out, ledger: evidence.ledger_record.ledger }, null, 2));

function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function hashFile(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/record-native-imagegen-result.mjs --run-dir /abs/run --role IMG-01 --status requested|succeeded|failed [--handoff /abs/run/generated-assets/native-imagegen-handoff-img-01.json] [--prompt value] [--source-hash value] [--image-path /abs/image.png] [--execution-evidence id]"); process.exit(2); }
