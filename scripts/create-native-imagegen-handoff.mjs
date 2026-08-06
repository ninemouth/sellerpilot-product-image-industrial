#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role || !args.prompt) usage();
const runDir = path.resolve(args["run-dir"]);
const role = normalizeRole(args.role);
if (!role) fail("role must be IMG-01 style.");
const state = readJson(path.join(runDir, "run-state.json"));
if (state?.schema_version !== "sellerpilot.run_state.v1") fail("run-state.json is missing or incompatible; compile a production plan first.");
const prompt = String(args.prompt);
const sourceHash = String(args["source-hash"] || sourceFingerprint(args.image));
const handoffId = crypto.createHash("sha256").update(JSON.stringify({ run_id: state.run_id, role, prompt, sourceHash, created_at: new Date().toISOString() })).digest("hex").slice(0, 20);
const out = args.out ? path.resolve(args.out) : path.join(runDir, "generated-assets", `native-imagegen-handoff-${role.toLowerCase()}.json`);
const record = spawnSync(process.execPath, [path.join(skillRootFrom(import.meta.url), "scripts", "record-provider-call.mjs"), "--run-dir", runDir, "--role", role, "--status", "requested", "--prompt-hash", prompt, "--source-hash", sourceHash, "--provider", "native_codex", "--model", "imagegen", "--triggering-gate", args["triggering-gate"] || "generation_dispatch"], { cwd: runDir, encoding: "utf8" });
if (record.status !== 0) { process.stderr.write(record.stderr || record.stdout || "Native imagegen preflight was blocked.\n"); process.exit(record.status || 1); }
const handoff = {
  schema_version: "sellerpilot.native_imagegen_handoff.v1",
  handoff_id: handoffId,
  created_at: new Date().toISOString(),
  run_id: state.run_id,
  role,
  provider: "native_codex",
  model: "imagegen",
  prompt,
  prompt_hash: sha(prompt),
  source_evidence: sourceHash,
  source_hash: sha(sourceHash),
  source_image: args.image ? path.relative(runDir, path.resolve(args.image)) : null,
  output_path: args["output-path"] ? path.relative(runDir, path.resolve(args["output-path"])) : null,
  execution_requirements: ["invoke the host native imagegen/image_gen tool with this prompt and source references", "save the real output file", "call record-native-imagegen-result.mjs with --handoff and host execution evidence id"],
  preflight_ledger: JSON.parse(record.stdout),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(handoff, null, 2)}\n`);
console.log(JSON.stringify({ status: "ready", handoff: out, handoff_id: handoffId, role, next_action: "invoke native imagegen then record its real output with --handoff" }, null, 2));

function sha(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function sourceFingerprint(image) { if (!image) return ""; const file = path.resolve(image); return fs.existsSync(file) ? sha(fs.readFileSync(file)) : file; }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/create-native-imagegen-handoff.mjs --run-dir /abs/run --role IMG-01 --prompt '<final prompt>' [--image /abs/source.png] [--source-hash value] [--output-path /abs/run/generated-assets/IMG-01/image.png]"); process.exit(2); }
