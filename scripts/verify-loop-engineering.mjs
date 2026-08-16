#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const skillRoot = skillRootFrom(import.meta.url);
const compiler = path.join(skillRoot, "scripts", "compile-production-plan.mjs");
const contract = path.join(skillRoot, "contracts", "production-contract.json");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sellerpilot-loop-engineering-"));
const runDir = path.join(temp, "run");

const result = spawnSync(process.execPath, [compiler,
  "--run-dir", runDir,
  "--run-id", "loop-contract-smoke",
  "--platform", "Ozon",
  "--category", "printed fabric bag",
  "--locale", "ru-RU",
  "--image-count", "6",
  "--has-source-image", "true",
  "--visible-copy", "true",
  "--scene-requested", "true",
  "--surface-material-canonical", "true",
], { cwd: skillRoot, encoding: "utf8" });
if (result.status !== 0) throw new Error(result.stderr || result.stdout || "compiler failed");

const state = readJson(path.join(runDir, "run-state.json"));
const plan = readJson(path.join(runDir, "planning", "compiled-production-plan.json"));
const dag = readJson(path.join(runDir, "orchestration", "tasks.json"));
const contractDoc = readJson(contract);

assert(contractDoc.schema_version === "sellerpilot.production_contract.v1", "contract schema version is invalid");
assert(state.schema_version === "sellerpilot.run_state.v1", "run state was not created");
assert(state.mode === "quality_production", "six-image run should compile to quality production");
assert(state.triggers.localized_copy === true && state.triggers.surface_material_canonical === true, "locale and material triggers should persist");
assert(state.goal.platform_override.required_ratio === "3:4", "compiler should apply Ozon platform delta without cloning a workflow");
assert(plan.tasks.some((task) => task.id === "anchor-generation"), "multi-image plan needs anchor generation");
assert(plan.tasks.some((task) => task.id === "generation-spec"), "every compiled plan must resolve a generation spec before provider generation");
assert(plan.tasks.some((task) => task.id === "localized-copy-qa"), "localized plan needs localized copy QA");
assert(plan.tasks.some((task) => task.id === "surface-material-transfer-gate"), "canonical material plan needs transfer gate");
const roleGeneration = plan.tasks.find((task) => task.id === "role-generation");
assert(roleGeneration.depends_on.includes("anchor-qa"), "remaining roles must wait for anchor QA");
assert(plan.tasks.find((task) => task.id === "anchor-generation").depends_on.includes("generation-spec"), "anchor generation must wait for the resolved platform generation spec");
assert(roleGeneration.loop.retry_requires_evidence_delta === true, "provider retry must require evidence delta");
assert(plan.tasks.find((task) => task.id === "final-delivery").loop.name === "delivery_closure", "delivery must use a non-generation closure loop");
assert(plan.tasks.some((task) => task.id === "review-workspace"), "quality production contract must compile a review workspace before delivery");
assert(dag.tasks.every((task) => task.execution_class), "all DAG tasks need execution classes");

const amazonDefaultDir = path.join(temp, "amazon-defaults");
run(skillRoot, ["scripts/compile-production-plan.mjs", "--run-dir", amazonDefaultDir, "--platform", "Amazon", "--category", "bag"]);
const amazonDefaultState = readJson(path.join(amazonDefaultDir, "run-state.json"));
const amazonDefaultPlan = readJson(path.join(amazonDefaultDir, "planning", "compiled-production-plan.json"));
assert(amazonDefaultState.goal.image_count === 7 && amazonDefaultState.goal.input_resolution.image_count_source === "platform_default", "compiler must apply Amazon default image count before mode routing");
assert(amazonDefaultState.mode === "quality_production" && amazonDefaultPlan.tasks.some((task) => task.id === "anchor-generation"), "Amazon default gallery must retain multi-image anchor controls");
assert(amazonDefaultPlan.tasks.some((task) => task.id === "delivery-overview"), "mode contract must compile a delivery overview for platform-default multi-image runs");

const ozonDefaultDir = path.join(temp, "ozon-defaults");
run(skillRoot, ["scripts/compile-production-plan.mjs", "--run-dir", ozonDefaultDir, "--platform", "Ozon", "--category", "bag"]);
const ozonDefaultState = readJson(path.join(ozonDefaultDir, "run-state.json"));
const ozonDefaultPlan = readJson(path.join(ozonDefaultDir, "planning", "compiled-production-plan.json"));
assert(ozonDefaultState.goal.locale === "ru-RU" && ozonDefaultState.goal.input_resolution.locale_source === "platform_default", "compiler must apply the platform locale when none is explicit");
assert(ozonDefaultState.triggers.localized_copy === true && ozonDefaultPlan.tasks.some((task) => task.id === "localized-copy-qa"), "platform locale must activate localized copy safeguards");
const ozonSpecTask = ozonDefaultPlan.tasks.find((task) => task.id === "generation-spec");
assert(ozonSpecTask.command.includes("3:4") && ozonSpecTask.command.includes("--required-ratio"), "platform ratio must be bound into the generation-spec command before provider execution");

const revisionDir = path.join(temp, "revision-review");
run(skillRoot, ["scripts/compile-production-plan.mjs", "--run-dir", revisionDir, "--platform", "Etsy", "--category", "gift", "--mode", "revision_repair"]);
const revisionPlan = readJson(path.join(revisionDir, "planning", "compiled-production-plan.json"));
assert(!revisionPlan.tasks.some((task) => task.id === "review-workspace"), "revision contract must not force a review workspace until annotations are present");
const revisionAnnotatedDir = path.join(temp, "revision-annotated");
run(skillRoot, ["scripts/compile-production-plan.mjs", "--run-dir", revisionAnnotatedDir, "--platform", "Etsy", "--category", "gift", "--mode", "revision_repair", "--annotations-present", "true"]);
const revisionAnnotatedPlan = readJson(path.join(revisionAnnotatedDir, "planning", "compiled-production-plan.json"));
assert(revisionAnnotatedPlan.tasks.some((task) => task.id === "review-workspace"), "annotated revision contract must compile a review workspace");

const incompleteContract = JSON.parse(fs.readFileSync(contract, "utf8"));
incompleteContract.triggers.visible_copy.requires.push("missing_compiled_gate");
const incompleteContractPath = path.join(temp, "incomplete-contract.json");
fs.writeFileSync(incompleteContractPath, JSON.stringify(incompleteContract, null, 2));
const incomplete = spawnSync(process.execPath, [compiler, "--contract", incompleteContractPath, "--run-dir", path.join(temp, "incomplete-contract-run"), "--platform", "Amazon", "--category", "bag", "--visible-copy", "true"], { cwd: skillRoot, encoding: "utf8" });
assert(incomplete.status !== 0 && /missing-compiled-gate/.test(incomplete.stderr), "compiler must reject a contract requirement that has no DAG task coverage");

const tiktokDir = path.join(temp, "tiktok");
run(skillRoot, ["scripts/compile-production-plan.mjs", "--run-dir", tiktokDir, "--platform", "TikTok Shop", "--category", "travel bag", "--image-count", "5", "--competitor-reference", "true"]);
const tiktokPlan = readJson(path.join(tiktokDir, "planning", "compiled-production-plan.json"));
assert(tiktokPlan.platform_override.mobile_first === true && tiktokPlan.tasks.some((task) => task.id === "competitor-pattern-analysis"), "platform deltas and competitive analysis must compile without legacy workflow selection");

const boundaryDir = path.join(temp, "external-boundary");
fs.mkdirSync(path.join(boundaryDir, "orchestration"), { recursive: true });
const outputFile = path.join(boundaryDir, "deterministic.txt");
const boundaryTasks = path.join(boundaryDir, "orchestration", "tasks.json");
fs.writeFileSync(boundaryTasks, JSON.stringify({ tasks: [
  {
    id: "deterministic",
    phase: "pre_gate",
    execution_class: "deterministic_pre_gate",
    outputs: ["deterministic.txt"],
    command: [process.execPath, "-e", "require('fs').writeFileSync(process.argv[1], 'ok')", outputFile],
  },
  {
    id: "provider-boundary",
    phase: "generation",
    execution_class: "provider_generation",
    depends_on: ["deterministic"],
    outputs: ["generated-assets/provider.png"],
  },
] }, null, 2));
const orchestrator = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "production-orchestrator.mjs"), "--run-dir", boundaryDir, "--tasks", boundaryTasks, "--execute"], { cwd: skillRoot, encoding: "utf8" });
assert(orchestrator.status === 0, "external boundary should pause rather than fail the DAG");
const boundaryState = readJson(path.join(boundaryDir, "orchestration", "production-orchestrator-state.json"));
assert(boundaryState.status === "paused", "orchestrator must mark external generation boundary as paused");
assert(boundaryState.tasks.find((task) => task.id === "deterministic").status === "completed", "deterministic predecessor should execute");
assert(boundaryState.tasks.find((task) => task.id === "provider-boundary").status === "paused", "provider task must not be falsely completed");

const unboundDir = path.join(temp, "unbound-boundary");
fs.mkdirSync(path.join(unboundDir, "orchestration"), { recursive: true });
const unboundTasks = path.join(unboundDir, "orchestration", "tasks.json");
fs.writeFileSync(unboundTasks, JSON.stringify({ tasks: [{ id: "requires-binding", phase: "planning", execution_class: "deterministic_pre_gate", outputs: ["qa/unbound.json"], command: [] }] }, null, 2));
const unbound = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "production-orchestrator.mjs"), "--run-dir", unboundDir, "--tasks", unboundTasks, "--execute"], { cwd: skillRoot, encoding: "utf8" });
assert(unbound.status === 0, "an unbound compiled task should pause instead of being falsely marked complete");
const unboundState = readJson(path.join(unboundDir, "orchestration", "production-orchestrator-state.json"));
assert(unboundState.status === "paused" && unboundState.tasks[0].status === "paused", "orchestrator must not treat a missing task binding as successful work");

const qaDir = path.join(runDir, "qa");
fs.mkdirSync(qaDir, { recursive: true });
fs.writeFileSync(path.join(qaDir, "qa-loop-routing-decision.json"), JSON.stringify({
  loop_decision: {
    status: "rerender_layout_only",
    primary_failure_type: "layout-unreadable",
    return_node: "layout-wireframes",
    failed_images: ["IMG-02"],
    smallest_next_action: "Rerender only IMG-02 layout.",
  },
}, null, 2));
run(skillRoot, ["scripts/run-state-transition.mjs", "--run-dir", runDir, "--event", "qa"]);
const repairedState = readJson(path.join(runDir, "run-state.json"));
assert(repairedState.roles["IMG-02"].status === "repair_required", "QA transition should mark only the failed role for repair");
assert(repairedState.loop.last_decision === "rerender_layout_only", "QA transition should preserve loop decision");
run(skillRoot, ["scripts/invalidate-run-artifacts.mjs", "--run-dir", runDir, "--from-node", "compact-blueprint", "--role", "IMG-02", "--reason", "layout correction"]);
const invalidated = readJson(path.join(runDir, "qa", "artifact-invalidation-report.json"));
assert(invalidated.preserves_files === true && invalidated.invalidated_tasks.some((item) => item.id === "role-generation"), "invalidation should preserve files and invalidate downstream generation contract");
run(skillRoot, ["scripts/record-provider-call.mjs", "--run-dir", runDir, "--role", "IMG-01", "--status", "succeeded", "--prompt-hash", "prompt-v1", "--source-hash", "source-v1", "--provider", "test", "--model", "test-image"]);
const rejectedRetry = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "record-provider-call.mjs"), "--run-dir", runDir, "--role", "IMG-01", "--status", "failed", "--prompt-hash", "prompt-v1", "--source-hash", "source-v1", "--provider", "test", "--model", "test-image"], { cwd: skillRoot, encoding: "utf8" });
assert(rejectedRetry.status !== 0, "same-evidence provider retry must be rejected");
const ledger = fs.readFileSync(path.join(runDir, "telemetry", "cost-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert(ledger.length === 2 && ledger[1].status === "blocked", "cost ledger must retain blocked retry evidence");
const dryProviderDir = path.join(temp, "provider-dry-run");
run(skillRoot, ["scripts/thinkai-image-runtime.mjs", "--run-dir", runDir, "--role", "IMG-03", "--prompt", "identity-safe dry run", "--output-dir", dryProviderDir, "--dry-run"]);
assert(readJson(path.join(dryProviderDir, "summary.json")).status === "dry_run", "provider runtime dry run should remain available without a provider call");
const ledgerAfterDryRun = fs.readFileSync(path.join(runDir, "telemetry", "cost-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert(ledgerAfterDryRun.length === ledger.length, "provider dry run must not consume provider budget or ledger events");
const missingKeyConfig = path.join(temp, "missing-key-provider.json");
fs.writeFileSync(missingKeyConfig, JSON.stringify({ third_party: { name: "Diagnostic Fixture", base_url: "https://provider.example/v1", model: "fixture-image", api_key_env: "MISSING_PROVIDER_DIAGNOSTIC_KEY" } }, null, 2));
const missingKeyRun = path.join(temp, "provider-diagnostic-run");
run(skillRoot, [compiler, "--run-dir", missingKeyRun, "--platform", "Amazon", "--category", "bag"]);
const missingKeyRuntime = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "thinkai-image-runtime.mjs"), "--run-dir", missingKeyRun, "--role", "IMG-01", "--prompt", "provider diagnostic fixture", "--output-dir", path.join(missingKeyRun, "generated-assets", "IMG-01"), "--config", missingKeyConfig], { cwd: skillRoot, encoding: "utf8" });
assert(missingKeyRuntime.status !== 0, "missing provider credentials must fail closed");
const missingKeyDiagnostic = readJson(path.join(missingKeyRun, "runtime", "provider-failure-diagnostic-img-01.json"));
assert(missingKeyDiagnostic.stage === "configuration" && missingKeyDiagnostic.error_code === "configuration_required", "provider failure diagnostic must classify missing credentials without raw transport output");
assert(!JSON.stringify(missingKeyDiagnostic).includes("provider.example") && !JSON.stringify(missingKeyDiagnostic).includes("MISSING_PROVIDER_DIAGNOSTIC_KEY"), "provider failure diagnostics must not expose endpoint or key environment details");
const nonRetryableCircuit = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "provider-instability-circuit-breaker.mjs"), "--run-dir", missingKeyRun], { cwd: skillRoot, encoding: "utf8" });
assert(nonRetryableCircuit.status !== 0, "a non-retryable provider configuration failure must open the circuit without repeated attempts");
const nonRetryableCircuitReport = readJson(path.join(missingKeyRun, "qa", "provider-instability-circuit-breaker-report.json"));
assert(nonRetryableCircuitReport.summary.non_retryable_failures === 1 && nonRetryableCircuitReport.decision.stop_provider_retries === true, "provider circuit must expose the non-retryable stop decision");

const networkDeniedRun = path.join(temp, "provider-network-denied-run");
run(skillRoot, [compiler, "--run-dir", networkDeniedRun, "--platform", "Amazon", "--category", "bag"]);
const deniedConfig = path.join(temp, "network-denied-provider.json");
fs.writeFileSync(deniedConfig, JSON.stringify({ third_party: { name: "Denied Network Fixture", base_url: "https://provider.example/v1", model: "fixture-image", api_key: "fixture-key" } }, null, 2));
const fakeCurlDir = path.join(temp, "network-denied-bin");
fs.mkdirSync(fakeCurlDir, { recursive: true });
const fakeCurl = path.join(fakeCurlDir, "curl");
fs.writeFileSync(fakeCurl, "#!/usr/bin/env node\nprocess.stderr.write('curl: (7) Failed to connect: Bad access\\n');\nprocess.exit(7);\n");
fs.chmodSync(fakeCurl, 0o755);
const networkDeniedRuntime = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "thinkai-image-runtime.mjs"), "--run-dir", networkDeniedRun, "--role", "IMG-01", "--prompt", "provider transport fixture", "--output-dir", path.join(networkDeniedRun, "generated-assets", "IMG-01"), "--config", deniedConfig], { cwd: skillRoot, encoding: "utf8", env: { ...process.env, PATH: `${fakeCurlDir}${path.delimiter}${process.env.PATH || ""}` } });
assert(networkDeniedRuntime.status !== 0, "unavailable external provider transport must fail closed");
const networkDeniedDiagnostic = readJson(path.join(networkDeniedRun, "runtime", "provider-failure-diagnostic-img-01.json"));
assert(networkDeniedDiagnostic.stage === "external_provider_transport" && networkDeniedDiagnostic.error_code === "external_provider_transport_unavailable" && networkDeniedDiagnostic.retryable === false, "unavailable external transport must be classified separately from provider failure");
assert(!JSON.stringify(networkDeniedDiagnostic).includes("provider.example") && !JSON.stringify(networkDeniedDiagnostic).includes("Bad access"), "external transport diagnostics must not expose endpoint or raw transport detail");
const networkDeniedLedger = fs.readFileSync(path.join(networkDeniedRun, "telemetry", "cost-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
assert(networkDeniedLedger.length === 1 && networkDeniedLedger[0].status === "requested", "unavailable external transport must not consume a provider failure attempt");
const authorizationCircuit = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "provider-instability-circuit-breaker.mjs"), "--run-dir", networkDeniedRun], { cwd: skillRoot, encoding: "utf8" });
assert(authorizationCircuit.status !== 0, "external provider setup requirement must block the provider path");
const authorizationCircuitReport = readJson(path.join(networkDeniedRun, "qa", "provider-instability-circuit-breaker-report.json"));
assert(authorizationCircuitReport.status === "setup_required" && authorizationCircuitReport.decision.requires_user_authorization === false && authorizationCircuitReport.decision.requires_setup_update === true && authorizationCircuitReport.decision.required_capability === null, "external transport must require setup/update rather than a user authorization pause");
const networkDeniedState = readJson(path.join(networkDeniedRun, "run-state.json"));
assert(networkDeniedState.status === "blocked" && networkDeniedState.loop.last_decision === "external_provider_setup_required", "external transport must project to a setup/update block");

const controllerJobs = path.join(temp, "controller-jobs.json");
fs.writeFileSync(controllerJobs, JSON.stringify({ jobs: [
  { id: "IMG-01", anchor: true, prompt: "anchor" },
  { id: "IMG-02", prompt: "remaining" },
] }, null, 2));
run(skillRoot, ["scripts/generation-execution-controller.mjs", "--run-dir", runDir, "--jobs", controllerJobs]);
const controllerState = readJson(path.join(runDir, "generated-assets", "execution-controller-state.json"));
const afterController = readJson(path.join(runDir, "run-state.json"));
assert(controllerState.status === "anchor_ready", "generation controller should begin with a capped anchor batch");
assert(afterController.loop.last_decision === "anchor_ready", "generation controller should project anchor state into run-state");

const nativeImage = path.join(runDir, "generated-assets", "IMG-03", "image.png");
fs.mkdirSync(path.dirname(nativeImage), { recursive: true });
fs.writeFileSync(nativeImage, Buffer.from("native image evidence"));
run(skillRoot, ["scripts/create-native-imagegen-handoff.mjs", "--run-dir", runDir, "--role", "IMG-03", "--prompt", "native evidence", "--source-hash", "source-v2", "--output-path", nativeImage]);
const nativeHandoff = path.join(runDir, "generated-assets", "native-imagegen-handoff-img-03.json");
run(skillRoot, ["scripts/record-native-imagegen-result.mjs", "--run-dir", runDir, "--role", "IMG-03", "--status", "succeeded", "--handoff", nativeHandoff, "--image-path", nativeImage, "--execution-evidence", "tool-call-fixture"]);
const nativeEvidence = readJson(path.join(runDir, "generated-assets", "native-imagegen-img-03.json"));
assert(nativeEvidence.provider === "native_codex" && nativeEvidence.image_sha256 && nativeEvidence.handoff_id, "native imagegen must leave hash-bound evidence and use the shared cost ledger");
const wrongRoleNative = spawnSync(process.execPath, [path.join(skillRoot, "scripts/record-native-imagegen-result.mjs"), "--run-dir", runDir, "--role", "IMG-04", "--status", "succeeded", "--handoff", nativeHandoff, "--image-path", nativeImage, "--execution-evidence", "tool-call-fixture"], { cwd: skillRoot, encoding: "utf8" });
assert(wrongRoleNative.status !== 0, "native result must reject a handoff that belongs to another role");
run(skillRoot, ["scripts/create-image-generation-dispatch.mjs", "--run-dir", runDir, "--role", "IMG-04", "--prompt", "native dispatch", "--provider", "native_codex"]);
assert(fs.existsSync(path.join(runDir, "generated-assets", "native-imagegen-handoff-img-04.json")), "unified dispatch must create native handoff when native mode is selected");
const hostCallback = path.join(temp, "native-host-callback.json");
fs.writeFileSync(hostCallback, JSON.stringify({ schema_version: "sellerpilot.native_imagegen_host_callback.v1", run_dir: runDir, role: "IMG-04", handoff: "generated-assets/native-imagegen-handoff-img-04.json", status: "succeeded", image_path: "generated-assets/IMG-03/image.png", tool_call_id: "host-tool-fixture" }, null, 2));
run(skillRoot, ["scripts/accept-native-imagegen-host-callback.mjs", "--callback", hostCallback]);
assert(readJson(path.join(runDir, "runtime", "native-imagegen-host-callback-img-04.json")).status === "recorded", "host callback must record through the validated native handoff path");
const thirdPartyConfig = path.join(temp, "third-party-provider.json");
fs.writeFileSync(thirdPartyConfig, JSON.stringify({ provider_mode: "third_party_proxy", third_party: { enabled: true, name: "Fixture Provider", base_url: "https://provider.example/v1", model: "fixture-image", api_key_env: "FIXTURE_IMAGE_API_KEY", api_key: "fixture-key" } }, null, 2));
run(skillRoot, ["scripts/resolve-generation-spec.mjs", "--out-dir", path.join(runDir, "generation-spec"), "--platform", "Ozon", "--category", "bag"]);
run(skillRoot, ["scripts/create-image-generation-dispatch.mjs", "--run-dir", runDir, "--role", "IMG-05", "--prompt", "third party dispatch", "--provider-config", thirdPartyConfig]);
const thirdPartyHandoff = readJson(path.join(runDir, "generated-assets", "third-party-imagegen-handoff-img-05.json"));
assert(thirdPartyHandoff.provider.model === "fixture-image" && thirdPartyHandoff.requested_size === "1920x2560" && thirdPartyHandoff.execution_capabilities.includes("outbound_network") && thirdPartyHandoff.setup_authorization.mode === "configured_provider" && thirdPartyHandoff.setup_authorization.fallback_policy === "do_not_substitute_provider" && thirdPartyHandoff.execution_requirements.some((item) => item.includes("without requesting another user authorization")) && thirdPartyHandoff.execution_requirements.some((item) => item.includes("--run-dir and --role")), "unified dispatch must pass the platform target size to the configured third-party runtime with setup-time authorization and without native fallback");
const nativeManifest = path.join(runDir, "export", "final-images-manifest.json");
fs.mkdirSync(path.dirname(nativeManifest), { recursive: true });
fs.writeFileSync(nativeManifest, JSON.stringify({ run_dir: runDir, image_dir: path.join(runDir, "final-images"), images: [{ id: "IMG-03", file: "IMG-03-native.png", lineage: { source_type: "provider_generated", provider: "native_codex", generated_asset_path: "generated-assets/IMG-03/image.png" } }] }, null, 2));
run(skillRoot, ["scripts/native-imagegen-ledger-gate.mjs", "--run-dir", runDir]);
const nativeGate = readJson(path.join(runDir, "qa", "native-imagegen-ledger-gate-report.json"));
assert(nativeGate.status === "pass", "native provider lineage must be bound to a successful evidence record and shared ledger event");
const missingNativeDir = path.join(temp, "native-missing");
fs.mkdirSync(path.join(missingNativeDir, "export"), { recursive: true });
fs.writeFileSync(path.join(missingNativeDir, "export", "final-images-manifest.json"), JSON.stringify({ images: [{ id: "IMG-01", file: "IMG-01-native.png", lineage: { provider: "native_codex", generated_asset_path: "generated-assets/IMG-01/image.png" } }] }, null, 2));
const missingNative = spawnSync(process.execPath, [path.join(skillRoot, "scripts/native-imagegen-ledger-gate.mjs"), "--run-dir", missingNativeDir], { cwd: skillRoot, encoding: "utf8" });
assert(missingNative.status !== 0, "native lineage without evidence and ledger proof must fail its delivery gate");

const progressDir = path.join(runDir, "generated-assets");
fs.writeFileSync(path.join(progressDir, "progress-IMG-02-retry1.json"), JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }, null, 2));
fs.writeFileSync(path.join(progressDir, "progress-IMG-02-retry2.json"), JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }, null, 2));
const circuit = spawnSync(process.execPath, [path.join(skillRoot, "scripts/provider-instability-circuit-breaker.mjs"), "--run-dir", runDir, "--max-failures-per-role", "2"], { cwd: skillRoot, encoding: "utf8" });
assert(circuit.status !== 0, "circuit breaker should stop repeated failed role retries");
const circuitState = readJson(path.join(runDir, "run-state.json"));
assert(circuitState.status === "blocked" && circuitState.loop.last_decision === "blocked_provider_circuit_open", "circuit breaker must project a blocking run-state decision");
run(skillRoot, ["scripts/record-asset-reuse.mjs", "--run-dir", runDir]);
const reuseState = readJson(path.join(runDir, "run-state.json"));
assert(reuseState.loop.last_decision === "approved_asset_reuse_recorded", "asset reuse recording must project into run-state without invoking a provider");

const bad = spawnSync(process.execPath, [compiler, "--run-dir", path.join(temp, "bad"), "--platform", "Amazon", "--category", "bag", "--mode", "not-a-mode"], { cwd: skillRoot, encoding: "utf8" });
assert(bad.status !== 0, "compiler must reject unknown mode");

console.log(JSON.stringify({ status: "pass", checks: 65, run_dir: runDir }, null, 2));

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function run(cwd, args) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `command failed: ${args.join(" ")}`);
  return result;
}
