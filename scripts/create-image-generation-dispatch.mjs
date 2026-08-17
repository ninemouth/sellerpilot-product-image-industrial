#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { relativeContractPath } from "./lib/portable-path.mjs";
import { providerReferenceLimits } from "./lib/source-reference-policy.mjs";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.role || !args.prompt) usage();
const skillRoot = skillRootFrom(import.meta.url);
const runDir = path.resolve(args["run-dir"]);
fs.mkdirSync(runDir, { recursive: true });
const role = normalizeRole(args.role);
if (!role) fail("role must be IMG-01 style.");
const images = args.image.map((file) => path.resolve(file));
const generationSpecPath = path.resolve(args["generation-spec"] || path.join(runDir, "generation-spec", "generation-spec.json"));
const generationSpec = readJson(generationSpecPath);
const requestedSize = String(args.size || generationSpec?.requested_size || "").trim() || null;
const efficiencyPlan = readJson(path.join(runDir, "planning", "production-efficiency-plan.json")) || {};
const providerTimeoutSeconds = positiveInteger(args["request-timeout-seconds"] || efficiencyPlan?.progress_update_policy?.provider_request_timeout_seconds) || 900;
const progressFile = path.join(runDir, "generated-assets", `progress-${role.toLowerCase()}.json`);
const pinnedResolutionPath = path.join(runDir, "runtime", "image-provider-resolution.json");
const routeOverrides = ["provider", "profile", "provider-config", "codex-config"].filter((key) => args[key]);
if (fs.existsSync(pinnedResolutionPath) && routeOverrides.length) fail(`This run already has a pinned provider route; per-role route overrides are forbidden (${routeOverrides.join(", ")}). Compile a new run for a different route.`);
let resolution = fs.existsSync(pinnedResolutionPath) ? readJson(pinnedResolutionPath) : null;
if (!resolution) {
  const resolverArgs = [path.join(skillRoot, "scripts", "resolve-image-provider.mjs"), "--run-dir", runDir];
  const normalizedProvider = readJson(path.join(runDir, "planning", "normalized-task.json"))?.provider_request || {};
  const routeArgs = {
    provider: args.provider || normalizedProvider.mode,
    profile: args.profile || normalizedProvider.profile_id,
    "provider-config": args["provider-config"] || normalizedProvider.provider_config,
    "codex-config": args["codex-config"] || normalizedProvider.codex_config,
  };
  for (const [flag, key] of [["--provider", "provider"], ["--profile", "profile"], ["--config", "provider-config"], ["--codex-config", "codex-config"]]) if (routeArgs[key] && !(key === "provider" && routeArgs[key] === "auto")) resolverArgs.push(flag, routeArgs[key]);
  const resolved = spawnSync(process.execPath, resolverArgs, { cwd: runDir, encoding: "utf8" });
  resolution = parseJson(resolved.stdout);
}
if (!resolution) fail("Image provider resolution produced no readable result.");
resolution.run_report = pinnedResolutionPath;
validatePinnedResolution(resolution);
if (resolution.status === "ready") validateReferenceImages(images, resolution);
if (resolution.status !== "ready") {
  console.log(JSON.stringify({ status: resolution.status, selected_mode: resolution.selected_mode, provider: resolution.provider, next_action: resolution.next_action }, null, 2));
  process.exitCode = 1;
} else if (resolution.selected_mode === "native_codex") {
  const nativeArgs = [path.join(skillRoot, "scripts", "create-native-imagegen-handoff.mjs"), "--run-dir", runDir, "--role", role, "--prompt", args.prompt, "--output-path", outputPath()];
  for (const image of images) nativeArgs.push("--image", image);
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
    provider_resolution: relativeRunPath(resolution.run_report || path.join(runDir, "runtime", "image-provider-resolution.json")),
    provider: { id: resolution.provider?.id, name: resolution.provider?.name, base_url: resolution.provider?.base_url, model: resolution.provider?.model, runtime_script: resolution.provider?.runtime_script },
    generation_spec: generationSpec?.status === "ready" ? relativeRunPath(generationSpecPath) : null,
    requested_size: requestedSize,
    progress_file: relativeRunPath(progressFile),
    provider_timeout_seconds: providerTimeoutSeconds,
    meaningful_progress_timeout_seconds: positiveInteger(efficiencyPlan?.progress_update_policy?.provider_meaningful_progress_stale_seconds),
    prompt: args.prompt,
    source_images: images.map(relativeRunPath),
    output_dir: relativeRunPath(path.dirname(outputPath())),
    execution_capabilities: ["outbound_network"],
    setup_authorization: {
      mode: "configured_provider",
      granted_when: "third_party_proxy was selected and configured during skill installation or update",
      applies_to: ["provider_reference_image_upload", "provider_request", "provider_asset_download"],
      fallback_policy: "do_not_substitute_provider",
    },
    execution_requirements: ["invoke only the resolved provider runtime", "upload user-provided reference images to the configured route directly without requesting another user authorization", "if the host blocks outbound reference-image upload, record external_provider_host_policy_blocked and preserve the run", "pass --run-dir and --role so provider budget and evidence-delta checks apply", "do not fall back to native imagegen, another provider, or a local draft presented as a final image when this dispatch selected third_party_proxy"],
  };
  const out = path.join(runDir, "generated-assets", `third-party-imagegen-handoff-${role.toLowerCase()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(handoff, null, 2)}\n`);
  const command = [resolution.provider.runtime_script, "--run-dir", runDir, "--role", role, "--prompt", args.prompt, "--output-dir", path.dirname(outputPath()), "--progress-file", progressFile, "--base-url", resolution.provider.base_url, "--model", resolution.provider.model, "--api-key-env", resolution.provider.api_key_env, "--provider-resolution", resolution.run_report, ...(requestedSize ? ["--size", requestedSize] : []), ...(providerTimeoutSeconds ? ["--request-timeout-seconds", String(providerTimeoutSeconds)] : []), ...images.flatMap((file) => ["--image", file])];
  console.log(JSON.stringify({ status: "ready", selected_mode: "third_party_proxy", role, resolution: resolution.run_report, handoff: out, runtime_command: command, required_execution_capabilities: ["outbound_network"], next_action: "Execute the resolved runtime command directly. The configured third-party route is already authorized at skill setup; record requested/succeeded/failed provider ledger events and do not substitute another provider." }, null, 2));
} else fail(`Unsupported resolved provider mode: ${resolution.selected_mode}`);

function outputPath() { return path.resolve(args["output-path"] || path.join(runDir, "generated-assets", role, "image.png")); }
function relativeRunPath(file) { return relativeContractPath(runDir, file); }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function parseArgs(argv) { const result = { image: [] }; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (key === "image") { if (!value || value.startsWith("--")) fail("--image requires a path"); result.image.push(value); i += 1; } else if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function parseJson(value) { try { return JSON.parse(String(value || "").trim()); } catch { return null; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function validatePinnedResolution(value) {
  if (!value.resolution_digest) fail("Pinned provider resolution has no digest.");
  const state = readJson(path.join(runDir, "run-state.json"));
  if (state?.provider_resolution?.digest && state.provider_resolution.digest !== value.resolution_digest) fail("Pinned provider resolution does not match run-state.json.");
}
function validateReferenceImages(files, providerResolution) {
  const limits = providerReferenceLimits(providerResolution);
  if (files.length > limits.max_count) fail(`Reference selection produced ${files.length} images, but this provider route allows at most ${limits.max_count}. Select role-specific references before dispatch.`);
  let totalBytes = 0;
  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`Selected reference image is missing: ${file}`);
    const bytes = fs.statSync(file).size;
    if (bytes > limits.max_per_image_bytes) fail(`Selected reference image exceeds the provider per-image byte limit (${bytes} > ${limits.max_per_image_bytes}). Run source reference preparation first.`);
    totalBytes += bytes;
  }
  if (totalBytes > limits.max_total_bytes) fail(`Selected reference images exceed the provider total byte limit (${totalBytes} > ${limits.max_total_bytes}). Reduce the role-specific selection.`);
}
function positiveInteger(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/create-image-generation-dispatch.mjs --run-dir /abs/run --role IMG-01 --prompt '<final prompt>' [--image /abs/source.png] [--generation-spec /abs/run/generation-spec/generation-spec.json] [--size WxH] [--provider auto|native_codex|third_party_proxy] [--profile PROFILE_ID] [--provider-config /abs/image-provider.json] [--codex-config /abs/config.toml] [--output-path /abs/run/generated-assets/IMG-01/image.png]"); process.exit(2); }
