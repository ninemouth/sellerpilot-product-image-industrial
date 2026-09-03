#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const skillRoot = skillRootFrom(import.meta.url);
const checks = [];
check("package JSON", () => JSON.parse(read("package.json")));
check("sync alias forwards release arguments", () => {
  const pkg = JSON.parse(read("package.json"));
  if (pkg.scripts?.sync !== "npm run sync:codex --") {
    throw new Error("npm run sync must forward --source, --remote-branch, and other release arguments to sync:codex");
  }
});
check("skill package metadata", () => {
  const result = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "verify-skill-package.mjs")], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "skill package validation failed");
});
check("skill progressive disclosure budget", () => {
  const skill = read("SKILL.md");
  const lines = skill.split("\n").length;
  if (lines > 500) throw new Error(`SKILL.md must remain under 500 lines, got ${lines}`);
  const fixedEntryBytes = Buffer.byteLength(skill) + Buffer.byteLength(read("AGENTS.md"));
  if (fixedEntryBytes > 30_000) throw new Error(`fixed SKILL.md + AGENTS.md context must remain under 30 KB, got ${fixedEntryBytes} bytes`);
  if (!skill.includes("production-runtime-runbook.md")) throw new Error("SKILL.md must route exact runtime operations to the on-demand runbook");
  if (!skill.includes("quality-critical-contract.md")) throw new Error("SKILL.md must route detailed quality constraints to the trigger-loaded contract");
  if (!fs.existsSync(path.join(skillRoot, "references", "production-runtime-runbook.md"))) throw new Error("production runtime runbook is missing");
  const qualityContract = read("references/quality-critical-contract.md");
  for (const token of ["Ozon ordinary categories", "platform preference memory", "store-wide style", "commerce design research planner", "surface material", "Final Delivery Gate"]) if (!qualityContract.includes(token)) throw new Error(`trigger-loaded quality contract missing ${token}`);
});
check("compiled dispatcher and context-budget boundary", () => {
  const compiler = read("scripts/compile-production-plan.mjs");
  const orchestrator = read("scripts/production-orchestrator.mjs");
  const controller = read("scripts/generation-execution-controller.mjs");
  for (const token of ["planning/normalized-task.json", "dispatcher-registry.json", "generation-jobs.json", "production-artifact-integrity-gate", "requires_before_generation", "requires_before_delivery"]) if (!compiler.includes(token)) throw new Error(`compiler missing ${token}`);
  for (const token of ["artifact_handoff", "generation_controller", "agent-context-ledger.jsonl", "phase-events.jsonl", "cache_context", "hashDeclaredOutputs", "hashPath", "context_cache_hit"]) if (!orchestrator.includes(token)) throw new Error(`orchestrator missing ${token}`);
  for (const token of ["anchor_limit", "Math.min(3", "awaiting_native_host", "Math.min(2", "mapWithConcurrency"]) if (!controller.includes(token)) throw new Error(`generation controller missing ${token}`);
});
check("control-plane benchmark safety boundary", () => {
  const benchmark = read("scripts/benchmark-control-plane.mjs");
  for (const token of ["provider_generation_calls: 0", '"--provider", "native_codex"', '"--no-auto-start"', "fs.rmSync(temp", "first_dag_advance", "tldraw_reuse"]) if (!benchmark.includes(token)) throw new Error(`control-plane benchmark missing ${token}`);
});
check("provider pin and explicit telemetry boundary", () => {
  const resolver = read("scripts/resolve-image-provider.mjs");
  const runtime = read("scripts/thinkai-image-runtime.mjs");
  const tracer = read("scripts/production-phase-tracer.mjs");
  for (const token of ["reused_pinned", "resolution_digest", "Pinned provider resolution digest mismatch"]) if (!resolver.includes(token)) throw new Error(`provider resolver missing ${token}`);
  for (const token of ["usage_source", "cost_source", "provider_request", "provider_runtime", "download"]) if (!runtime.includes(token)) throw new Error(`provider runtime missing ${token}`);
  for (const token of ["explicit_span_events", "legacy_file_mtime_estimate", "estimate_only", "actual_input_tokens", "actual_output_tokens"]) if (!tracer.includes(token)) throw new Error(`phase tracer missing ${token}`);
});
check("tldraw lightweight workspace boundary", () => {
  const creator = read("scripts/create-tldraw-review-workspace.mjs");
  const registrar = read("scripts/register-tldraw-review-session.mjs");
  const template = read("scripts/lib/tldraw-template.mjs");
  for (const token of ["copyTldrawAppTemplate", "linkOrCopyFile", "source_fingerprint"]) if (!`${creator}\n${registrar}\n${template}`.includes(token)) throw new Error(`tldraw workspace boundary missing ${token}`);
  if (!template.includes('"src"') || /^\s*"node_modules"\s*,?$/m.test(template)) throw new Error("tldraw template allowlist must include src and exclude node_modules");
  if (!registrar.includes("assets_reused")) throw new Error("tldraw session registration must reuse unchanged assets");
});
for (const file of ["contracts/production-contract.json", "contracts/platform-overrides.json", "contracts/integration-suite-registry.json", "schemas/production-contract.schema.json", "schemas/run-state.schema.json", "schemas/platform-overrides.schema.json"]) check(file, () => JSON.parse(read(file)));
check("production contract invariants", () => {
  const contract = JSON.parse(read("contracts/production-contract.json"));
  if (!contract.modes?.[contract.default_mode]) throw new Error("default mode is missing");
  if (contract.loop_policy?.retry_requires_evidence_delta !== true) throw new Error("retry evidence delta must be mandatory");
  if (contract.loop_policy?.final_delivery_is_root_cause !== false) throw new Error("final delivery must not be a retry root cause");
  for (const [mode, config] of Object.entries(contract.modes || {})) {
    if (mode !== "revision_repair" && config.requires_review_workspace_for_final_delivery !== true) throw new Error(`${mode} must require a review workspace for formal final delivery`);
  }
});
check("platform overrides invariants", () => {
  const overrides = JSON.parse(read("contracts/platform-overrides.json"));
  if (overrides.schema_version !== "sellerpilot.platform_overrides.v1") throw new Error("platform override schema version is invalid");
  if (overrides.platforms?.ozon?.required_ratio !== "3:4") throw new Error("Ozon ordinary-category ratio contract is missing");
});
check("third-party dispatch boundary", () => {
  const dispatch = read("scripts/create-image-generation-dispatch.mjs");
  for (const token of ["resolve-image-provider.mjs", "third_party_proxy", "create-native-imagegen-handoff.mjs", "runtime_script", "outbound_network", "do_not_substitute_provider", "--progress-file", "--request-timeout-seconds", "provider_request_timeout_seconds"]) if (!dispatch.includes(token)) throw new Error(`dispatch missing ${token}`);
});
check("provider profile registry boundary", () => {
  const resolver = read("scripts/resolve-image-provider.mjs");
  const registry = read("scripts/lib/provider-profile-registry.mjs");
  const manager = read("scripts/manage-image-provider-profiles.mjs");
  const picker = read("scripts/select-image-provider-interactive.mjs");
  for (const [name, text, tokens] of [
    ["registry", registry, ["codex-native", "nvidia-flux", "BUILT_IN_PROVIDER_PROFILES", "legacy_migration"]],
    ["resolver", resolver, ["--profile", "selected_profile_source", "sellerpilot.image_provider_resolution.v2"]],
    ["manager", manager, ["list", "upsert", "select", "remove", "api-key-stdin"]],
    ["picker", picker, ["macos_provider_picker", "windows_provider_picker", "linux_provider_picker"]],
  ]) for (const token of tokens) if (!text.includes(token)) throw new Error(`${name} missing ${token}`);
  if (resolver.includes('const THINKAI_BASE_URL')) throw new Error("resolver must not make ThinkAI a default provider profile");
});
check("provider wait observability boundary", () => {
  const watchdog = read("scripts/runtime-watchdog.mjs");
  const plan = read("scripts/production-efficiency-plan.mjs");
  for (const [name, text, tokens] of [
    ["watchdog", watchdog, ["provider_wait_stale", "Heartbeats do not count as provider progress", "pending.length && noMeaningfulProgress"]],
    ["efficiency plan", plan, ["provider_request_timeout_seconds", "provider_meaningful_progress_stale_seconds", "Do not change global provider defaults"]],
  ]) for (const token of tokens) if (!text.includes(token)) throw new Error(`${name} missing ${token}`);
});
check("cross-platform module path boundary", () => {
  const forbidden = ["new URL(\"..\", import.meta.url)", ".pathname"].join("");
  const offenders = fs.readdirSync(path.join(skillRoot, "scripts"))
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) => name !== "verify-static.mjs")
    .filter((name) => fs.readFileSync(path.join(skillRoot, "scripts", name), "utf8").includes(forbidden));
  if (offenders.length) throw new Error(`file URL pathnames must not be used as native paths: ${offenders.join(", ")}`);
  const helper = read("scripts/lib/skill-paths.mjs");
  if (!helper.includes("fileURLToPath")) throw new Error("skill path helper must convert file URLs with fileURLToPath");
});
check("generic provider capability boundary", () => {
  const resolver = read("scripts/resolve-image-provider.mjs");
  const runtime = read("scripts/thinkai-image-runtime.mjs");
  const spec = read("scripts/resolve-generation-spec.mjs");
  for (const [name, text] of [["resolver", resolver], ["runtime", runtime], ["generation spec", spec]]) {
    if (!text.includes("provider-capabilities.mjs")) throw new Error(`${name} must use provider capability normalization`);
  }
  if (runtime.includes('args.quality || "hd"') || spec.includes('args.quality || "hd"')) throw new Error("legacy DALL-E quality defaults must not reach generic providers");
  if (spec.includes("nearestSupportedSizeForRatio")) throw new Error("provider size capability must not rewrite the platform target size");
  if (!spec.includes("args.size || platformTargetSize")) throw new Error("generation spec must default the provider request to the platform target size");
});
check("NVIDIA FLUX provider adapter boundary", () => {
  const resolver = read("scripts/resolve-image-provider.mjs");
  const runtime = read("scripts/nvidia-flux-image-runtime.mjs");
  const configurator = read("scripts/configure-image-provider.mjs");
  for (const [name, text, tokens] of [
    ["resolver", resolver, ["nvidia_nim_flux", "nvidia-flux-image-runtime.mjs"]],
    ["NVIDIA runtime", runtime, ["ai.api.nvidia.com/v1/genai", "flux.2-klein-4b", "artifacts", "base64"]],
    ["configurator", configurator, ["nvidia_nim_flux", "NVIDIA_API_KEY"]],
  ]) for (const token of tokens) if (!text.includes(token)) throw new Error(`${name} missing ${token}`);
});
check("provider route precedes generation boundary", () => {
  const compiler = read("scripts/compile-production-plan.mjs");
  const skill = read("SKILL.md");
  if (!compiler.includes('id: "provider-resolution"') || !compiler.includes('depends_on: ["provider-resolution"]')) throw new Error("generation spec must depend on provider resolution");
  if (!skill.includes("Treat its `selected_mode` as the sole execution authority")) throw new Error("skill must require provider-mode resolution before generation");
});
check("third-party setup-time execution boundary", () => {
  const runtime = read("scripts/thinkai-image-runtime.mjs");
  const circuit = read("scripts/provider-instability-circuit-breaker.mjs");
  const transitions = read("scripts/run-state-transition.mjs");
  const skill = read("SKILL.md");
  const runbook = read("references/production-runtime-runbook.md");
  for (const [name, text, tokens] of [
    ["runtime", runtime, ["external_provider_transport_unavailable", "external_provider_host_policy_blocked", "Bad access", "external_provider_host_policy"]],
    ["circuit", circuit, ["setup_required", "external-provider-transport-unavailable", "external-provider-host-policy-blocked", "do not substitute native imagegen"]],
    ["run-state transition", transitions, ["blocked", "external_provider_setup_required", "external_provider_host_policy_blocked"]],
    ["skill", skill, ["A ready configured route already covers reference upload", "never ask again whether to send references", "never needs a second upload-consent prompt"]],
    ["runbook", runbook, ["Setup-time provider authorization", "do not prompt again", "external_provider_host_policy_blocked"]],
  ]) for (const token of tokens) if (!text.includes(token)) throw new Error(`${name} missing ${token}`);
});
check("automatic cross-platform provider setup boundary", () => {
  const installer = read("scripts/sync-to-codex-skill.mjs");
  const updater = read("scripts/update-from-github.mjs");
  const ensure = read("scripts/ensure-image-provider-configuration.mjs");
  const dialog = read("scripts/configure-image-provider-interactive.mjs");
  for (const token of ["ensure-image-provider-configuration.mjs", "no-provider-config-prompt"]) if (!installer.includes(token)) throw new Error(`sync installer missing ${token}`);
  for (const token of ["release baseline verification", "verify:skill-package", "full-verify"]) if (!installer.includes(token)) throw new Error(`sync verification policy missing ${token}`);
  for (const token of ["probeSourceVerificationDependencies", "sourceVerificationInstallArgs", "Preparing locked source dependencies"]) if (!installer.includes(token)) throw new Error(`sync dependency repair missing ${token}`);
  for (const token of ["confirm-update", "git", "clone", "sync-to-codex-skill.mjs", "installed_readback", "rollback_status"]) if (!updater.includes(token)) throw new Error(`GitHub updater missing ${token}`);
  if (updater.includes('"--skip-verify"')) throw new Error("GitHub updater must not bypass source verification");
  for (const token of ["third_party_proxy", "configuration_required", "--no-prompt", "secure_local_input_pending"]) if (!ensure.includes(token)) throw new Error(`automatic provider setup missing ${token}`);
  for (const token of ["darwin", "win32", "UseSystemPasswordChar", "zenity", "key_output: \"never_printed\""]) if (!dialog.includes(token)) throw new Error(`interactive provider dialog missing ${token}`);
});
check("installed runtime-artifact cleanup boundary", () => {
  const installer = read("scripts/sync-to-codex-skill.mjs");
  for (const token of ["purgeInstalledRuntimeArtifacts", "installed_runtime_artifacts_removed", "work/", "README.md"]) {
    if (!installer.includes(token)) throw new Error(`sync installer missing stale runtime-artifact cleanup token ${token}`);
  }
});
check("decision-first canvas review boundary", () => {
  const canvas = read("assets/tldraw-review-workspace/src/main.jsx");
  const parser = read("scripts/parse-canvas-annotations.mjs");
  for (const token of ["thumbnail-nav", "QUICK_FEEDBACK", "提交修改给 AI", "implicitly_approved_image_ids", "unannotated_images: \"keep_approved\"", "tldraw_snapshots_by_image", "selected-image-floor", "stable-dom-image-floor", "canvasSnapshotsRef.current[selectedImageId]", "editor.loadSnapshot(snapshot)", "restoreSelectedCanvas", "canvasImportTimerRef", "getCurrentPageShapeIds", "displayedImageIdRef.current = \"\""]) if (!canvas.includes(token)) throw new Error(`canvas review missing ${token}`);
  for (const token of ["implicitly_approved_image_ids", "scene-asset-required", "scene-asset-production", "snapshot_image_ids"]) if (!parser.includes(token)) throw new Error(`canvas task parser missing ${token}`);
});
check("integration suite registry invariants", () => {
  const registry = JSON.parse(read("contracts/integration-suite-registry.json"));
  if (registry.schema_version !== "sellerpilot.integration_suite_registry.v1") throw new Error("integration suite registry schema version is invalid");
  for (const name of ["control-plane", "canvas-review", "delivery"]) if (!registry.suites?.[name]?.filters?.length) throw new Error(`integration suite ${name} has no filters`);
});
for (const file of fs.readdirSync(path.join(skillRoot, "scripts")).filter((name) => name.endsWith(".mjs")).sort()) {
  check(`syntax ${file}`, () => {
    const result = spawnSync(process.execPath, ["--check", path.join(skillRoot, "scripts", file)], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "syntax check failed");
  });
}
for (const file of fs.readdirSync(path.join(skillRoot, "workflows")).filter((name) => name.endsWith(".yaml")).sort()) {
  check(`workflow ${file}`, () => {
    const raw = read(path.join("workflows", file));
    const legacyCompatibility = file !== "ecommerce-product-image-generation.yaml" && raw.includes("compatibility_mode: compiler_default");
    const required = file === "ecommerce-product-image-generation.yaml"
      ? ["workflow_id:", "execution_modes:", "qa-loop-router", "final-delivery-gate"]
      : legacyCompatibility
        ? ["workflow_id:", "inherits: ecommerce-product-image-generation", "compatibility_mode: compiler_default", "platform_override:"]
        : ["workflow_id:", "inherits:", "qa-loop-router", "final-delivery-gate"];
    for (const token of required) if (!raw.includes(token)) throw new Error(`missing ${token}`);
    if (!legacyCompatibility && raw.indexOf("qa-loop-router") > raw.indexOf("final-delivery-gate")) throw new Error("final delivery must follow QA routing");
  });
}
const failed = checks.filter((item) => item.status === "fail");
if (process.argv.includes("--verbose")) for (const item of checks) console.log(`${item.status.toUpperCase()} ${item.name}${item.message ? `: ${item.message}` : ""}`);
else for (const item of failed) console.error(`FAIL ${item.name}: ${item.message}`);
console.log(JSON.stringify({ status: failed.length ? "fail" : "pass", checks: checks.length, failed: failed.length }, null, 2));
if (failed.length) process.exitCode = 1;

function check(name, fn) { try { fn(); checks.push({ name, status: "pass" }); } catch (error) { checks.push({ name, status: "fail", message: error.message }); } }
function read(file) { return fs.readFileSync(path.join(skillRoot, file), "utf8"); }
