#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role || !args.prompt) usage();
const skillRoot = skillRootFrom(import.meta.url);
const runDir = path.resolve(args["run-dir"]);
fs.mkdirSync(runDir, { recursive: true });
const role = normalizeRole(args.role);
if (!role) fail("role must be IMG-01 style.");
const images = args.image.map((file) => path.resolve(file));
const resolverArgs = [path.join(skillRoot, "scripts", "resolve-image-provider.mjs"), "--run-dir", runDir];
for (const [flag, key] of [["--provider", "provider"], ["--config", "provider-config"], ["--codex-config", "codex-config"]]) if (args[key]) resolverArgs.push(flag, args[key]);
const resolved = spawnSync(process.execPath, resolverArgs, { cwd: runDir, encoding: "utf8" });
const resolution = parseJson(resolved.stdout);
if (!resolution) fail("Image provider resolution produced no readable result.");
if (resolution.status !== "ready") {
  console.log(JSON.stringify({ status: resolution.status, selected_mode: resolution.selected_mode, provider: resolution.provider, next_action: resolution.next_action }, null, 2));
  process.exitCode = 1;
} else if (resolution.selected_mode === "native_codex") {
  const nativeArgs = [path.join(skillRoot, "scripts", "create-native-imagegen-handoff.mjs"), "--run-dir", runDir, "--role", role, "--prompt", args.prompt, "--output-path", outputPath()];
  if (images[0]) nativeArgs.push("--image", images[0]);
  if (args["source-hash"]) nativeArgs.push("--source-hash", args["source-hash"]);
  const native = spawnSync(process.execPath, nativeArgs, { cwd: runDir, encoding: "utf8" });
  if (native.status !== 0) { process.stderr.write(native.stderr || native.stdout || "Native dispatch handoff failed.\n"); process.exit(native.status || 1); }
  const handoff = parseJson(native.stdout);
  console.log(JSON.stringify({ status: "ready", selected_mode: "native_codex", role, resolution: resolution.run_report, handoff: handoff?.handoff || null, next_action: "Use the host native imagegen/image_gen tool, then record its output with telemetry:record-native-imagegen --handoff." }, null, 2));
} else if (resolution.selected_mode === "third_party_proxy") {
  const handoff = {
    schema_version: "sellerpilot.third_party_imagegen_handoff.v1",
    handoff_id: crypto.createHash("sha256").update(JSON.stringify({ run_dir: runDir, role, prompt: args.prompt, images, at: new Date().toISOString() })).digest("hex").slice(0, 20),
    created_at: new Date().toISOString(),
    run_id: readJson(path.join(runDir, "run-state.json"))?.run_id || null,
    role,
    provider_resolution: path.relative(runDir, resolution.run_report || path.join(runDir, "runtime", "image-provider-resolution.json")),
    provider: { id: resolution.provider?.id, name: resolution.provider?.name, base_url: resolution.provider?.base_url, model: resolution.provider?.model, runtime_script: resolution.provider?.runtime_script },
    prompt: args.prompt,
    source_images: images.map((file) => path.relative(runDir, file)),
    output_dir: path.relative(runDir, path.dirname(outputPath())),
    execution_capabilities: ["outbound_network"],
    authorization_boundary: {
      required_capability: "outbound_network",
      applies_to: ["provider_request", "provider_asset_download"],
      fallback_policy: "do_not_substitute_provider",
    },
    execution_requirements: ["invoke only the resolved OpenAI-compatible runtime", "run the runtime through a host execution call authorized for outbound network access", "pass --run-dir and --role so provider budget and evidence-delta checks apply", "do not fall back to native imagegen or another provider when this dispatch selected third_party_proxy"],
  };
  const out = path.join(runDir, "generated-assets", `third-party-imagegen-handoff-${role.toLowerCase()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(handoff, null, 2)}\n`);
  const command = [resolution.provider.runtime_script, "--run-dir", runDir, "--role", role, "--prompt", args.prompt, "--output-dir", path.dirname(outputPath()), "--base-url", resolution.provider.base_url, "--model", resolution.provider.model, "--api-key-env", resolution.provider.api_key_env, "--provider-resolution", resolution.run_report, ...images.flatMap((file) => ["--image", file])];
  console.log(JSON.stringify({ status: "ready", selected_mode: "third_party_proxy", role, resolution: resolution.run_report, handoff: out, runtime_command: command, required_execution_capabilities: ["outbound_network"], next_action: "Execute the resolved runtime command with the host's outbound-network authorization. It records requested/succeeded/failed provider ledger events itself; do not substitute another provider if authorization is unavailable." }, null, 2));
} else fail(`Unsupported resolved provider mode: ${resolution.selected_mode}`);

function outputPath() { return path.resolve(args["output-path"] || path.join(runDir, "generated-assets", role, "image.png")); }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function parseArgs(argv) { const result = { image: [] }; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (key === "image") { if (!value || value.startsWith("--")) fail("--image requires a path"); result.image.push(value); i += 1; } else if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function parseJson(value) { try { return JSON.parse(String(value || "").trim()); } catch { return null; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/create-image-generation-dispatch.mjs --run-dir /abs/run --role IMG-01 --prompt '<final prompt>' [--image /abs/source.png] [--provider auto|native_codex|third_party_proxy] [--provider-config /abs/image-provider.json] [--codex-config /abs/config.toml] [--output-path /abs/run/generated-assets/IMG-01/image.png]"); process.exit(2); }
