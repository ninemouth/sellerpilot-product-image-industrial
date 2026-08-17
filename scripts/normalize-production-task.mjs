#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { normalizeProductionTask, resolvePlatformOverride, writeNormalizedTask } from "./lib/normalized-task.mjs";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.platform || !args.category) usage();
const skillRoot = skillRootFrom(import.meta.url);
const runDir = path.resolve(args["run-dir"]);
const overridesPath = path.resolve(args["platform-overrides"] || path.join(skillRoot, "contracts", "platform-overrides.json"));
const overrides = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
const platformOverride = resolvePlatformOverride(overrides, args.platform);
const normalized = normalizeProductionTask({ args, runDir, platformOverride });
const out = path.resolve(args.out || path.join(runDir, "planning", "normalized-task.json"));
writeNormalizedTask(out, normalized);
console.log(JSON.stringify({ status: "ready", normalized_task: out, content_digest: normalized.content_digest }, null, 2));

function parseArgs(argv) { const result = { "source-image": [] }; for (let index = 2; index < argv.length; index += 1) { const arg = argv[index]; if (!arg.startsWith("--")) continue; const key = arg.slice(2); const next = argv[index + 1]; if (key === "source-image") { if (!next || next.startsWith("--")) throw new Error("--source-image requires a path."); result[key].push(next); index += 1; } else if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function usage() { console.error("Usage: node scripts/normalize-production-task.mjs --run-dir /abs/run --platform <platform> --category <category> [--platform-overrides file] [production inputs]"); process.exit(2); }
