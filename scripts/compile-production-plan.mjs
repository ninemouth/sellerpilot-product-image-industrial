#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { mergeArgsWithNormalizedTask, normalizeProductionTask, readNormalizedTask, resolvePlatformOverride, writeNormalizedTask } from "./lib/normalized-task.mjs";

const skillRoot = skillRootFrom(import.meta.url);
let args = parseArgs(process.argv);
const suppliedNormalizedTask = args["normalized-task"] ? readNormalizedTask(args["normalized-task"]) : null;
args = mergeArgsWithNormalizedTask(args, suppliedNormalizedTask);
if (args.help || !args["run-dir"] || !args.platform || !args.category) usage();

const contractPath = path.resolve(args.contract || path.join(skillRoot, "contracts", "production-contract.json"));
const contract = readJsonRequired(contractPath, "production contract");
validateContract(contract);
const overridesPath = path.resolve(args["platform-overrides"] || path.join(skillRoot, "contracts", "platform-overrides.json"));
const platformOverrides = readJsonRequired(overridesPath, "platform overrides");
if (platformOverrides?.schema_version !== "sellerpilot.platform_overrides.v1") fail("Unsupported platform overrides schema.");

const runDir = path.resolve(args["run-dir"]);
const priorProviderResolution = readJsonIfExists(path.join(runDir, "runtime", "image-provider-resolution.json"));
const platformOverride = resolvePlatformOverride(platformOverrides, args.platform);
const normalizedTask = suppliedNormalizedTask || normalizeProductionTask({ args, runDir, platformOverride });
args = mergeArgsWithNormalizedTask(args, normalizedTask);
const imageCount = Number(normalizedTask.request.image_count);
const effectiveLocale = String(normalizedTask.request.locale || "");
const mode = String(args.mode || inferMode({ imageCount, userText: args["user-text"], fast: args.fast, audit: args.audit, revision: args.revision }));
if (!contract.modes[mode]) fail(`Unknown production mode: ${mode}.`);

const runId = normalizedTask.run_id;
const modeContract = contract.modes[mode];
const triggers = { ...normalizedTask.signals };
const budget = buildBudget(modeContract, imageCount, triggers, mode);
const reviewRequired = requiresReviewWorkspace(modeContract, args);
const deliveryOverviewRequired = imageCount > 1 && Boolean(modeContract.requires_delivery_overview_for_multi_image);
const cacheContext = {
  normalized_task_digest: normalizedTask.content_digest,
  production_contract_digest: sha256(fs.readFileSync(contractPath)),
  platform_overrides_digest: sha256(fs.readFileSync(overridesPath)),
  policy_version: contract.policy_version,
};
const tasks = compileTasks({ contract, mode, imageCount, triggers, budget, args, normalizedTask, platformOverride, effectiveLocale, reviewRequired, deliveryOverviewRequired, cacheContext });
validateTasks(tasks, modeContract);
validateContractTaskCoverage({ contract, modeContract, tasks, triggers, reviewRequired, deliveryOverviewRequired });
validatePhaseAncestry({ contract, tasks, triggers });

const runState = {
  schema_version: "sellerpilot.run_state.v1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  run_id: runId,
  run_dir: runDir,
  status: "planned",
  mode,
  contract: {
    path: path.relative(runDir, contractPath),
    schema_version: contract.schema_version,
    policy_version: contract.policy_version,
  },
  goal: {
    platform: String(args.platform),
    category: String(args.category),
    locale: effectiveLocale,
    image_count: imageCount,
    user_text: String(args["user-text"] || ""),
    platform_override: platformOverride,
    input_resolution: normalizedTask.input_resolution,
  },
  triggers,
  budget,
  loop: {
    current_cycle: 0,
    retry_requires_evidence_delta: Boolean(contract.loop_policy.retry_requires_evidence_delta),
    delivery_closure_may_generate: Boolean(contract.loop_policy.delivery_closure_may_generate),
    statuses: {
      retry_exhausted: contract.loop_policy.retry_budget_exhaustion_status,
      provider_circuit_open: contract.loop_policy.provider_instability_status,
      human_pause: contract.loop_policy.human_pause_status,
    },
    last_decision: "compiled_plan_pending_execution",
  },
  artifacts: {
    compiled_plan: "planning/compiled-production-plan.json",
    task_dag: "orchestration/tasks.json",
    run_state: "run-state.json",
    evidence: [],
    normalized_task: "planning/normalized-task.json",
    generation_jobs: "orchestration/generation-jobs.json",
    dispatcher_registry: "orchestration/dispatcher-registry.json",
  },
  roles: createRoles(imageCount, budget.max_anchor_assets),
};
if (priorProviderResolution?.resolution_digest) {
  runState.provider_resolution = {
    path: "runtime/image-provider-resolution.json",
    digest: priorProviderResolution.resolution_digest,
    status: priorProviderResolution.status,
    selected_mode: priorProviderResolution.selected_mode,
    profile_id: priorProviderResolution.profile?.id || null,
    pinned_at: priorProviderResolution.resolved_at || null,
  };
}

const plan = {
  schema_version: "sellerpilot.compiled_production_plan.v1",
  created_at: runState.created_at,
  run_id: runId,
  run_dir: runDir,
  mode,
  contract: runState.contract,
  platform_override: platformOverride,
  goal: runState.goal,
  triggers,
  budget,
  tasks,
  next_action: tasks.find((task) => task.status === "pending")?.id || null,
  compiler_note: "This phase emits a canonical plan, class dispatcher registry, generation jobs, and dependency-validated DAG. Structured agent/native host boundaries pause with explicit handoffs; deterministic, third-party provider, and delivery commands are executable.",
};

const dag = {
  schema_version: "sellerpilot.production_dag.v1",
  generated_at: runState.created_at,
  run_id: runId,
  cache_context: cacheContext,
  tasks: tasks.map((task) => ({
    id: task.id,
    phase: task.phase,
    execution_class: task.execution_class,
    depends_on: task.depends_on,
    inputs: task.inputs,
    outputs: task.outputs,
    command: task.command,
    status: task.status,
    trigger_reason: task.trigger_reason,
    loop: task.loop,
    dispatcher: task.dispatcher,
    context_rules: task.context_rules,
    cache_key: task.cache_key,
  })),
};

const generationJobs = createGenerationJobs({ imageCount, budget, normalizedTask });
const dispatcherRegistry = createDispatcherRegistry();

if (!args["dry-run"]) {
  writeNormalizedTask(path.join(runDir, "planning", "normalized-task.json"), normalizedTask);
  writeJson(path.join(runDir, "run-state.json"), runState);
  writeJson(path.join(runDir, "planning", "compiled-production-plan.json"), plan);
  fs.writeFileSync(path.join(runDir, "planning", "compiled-production-plan.md"), toMarkdown(plan));
  writeJson(path.join(runDir, "orchestration", "tasks.json"), dag);
  writeJson(path.join(runDir, "orchestration", "generation-jobs.json"), generationJobs);
  writeJson(path.join(runDir, "orchestration", "dispatcher-registry.json"), dispatcherRegistry);
}

console.log(JSON.stringify({
  status: "compiled",
  run_id: runId,
  mode,
  task_count: tasks.length,
  triggers,
  next_action: plan.next_action,
  run_state: path.join(runDir, "run-state.json"),
  dry_run: Boolean(args["dry-run"]),
}, null, 2));

function compileTasks(ctx) {
  const tasks = [];
  const add = (task) => tasks.push({
    status: "pending",
    depends_on: [],
    inputs: [],
    outputs: [],
    command: [],
    loop: null,
    dispatcher: null,
    context_rules: [],
    cache_key: ctx.cacheContext,
    ...task,
  });
  const direct = { strategy: "direct_command" };
  const agent = (instructions) => ({ strategy: "artifact_handoff", instructions });
  const provider = (stage) => ({ strategy: "generation_controller", stage, jobs: "orchestration/generation-jobs.json" });
  const providerResolutionCommand = [process.execPath, path.join(skillRoot, "scripts", "resolve-image-provider.mjs"), "--run-dir", "."];
  const providerRequest = ctx.normalizedTask.provider_request || {};
  if (providerRequest.mode && providerRequest.mode !== "auto") providerResolutionCommand.push("--provider", providerRequest.mode);
  if (providerRequest.profile_id) providerResolutionCommand.push("--profile", providerRequest.profile_id);
  if (providerRequest.provider_config) providerResolutionCommand.push("--config", providerRequest.provider_config);
  if (providerRequest.codex_config) providerResolutionCommand.push("--codex-config", providerRequest.codex_config);
  if (providerRequest.native_imagegen) providerResolutionCommand.push("--native-imagegen", providerRequest.native_imagegen);

  add({
    id: "efficiency-plan",
    phase: "planning_control",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "always_required_before_heavy_work",
    inputs: ["planning/normalized-task.json"],
    outputs: ["planning/production-efficiency-plan.json", "generated-assets/generation-progress.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "production-efficiency-plan.mjs"), "--run-dir", ".", "--mode", ctx.mode, "--normalized-task", "planning/normalized-task.json"],
    dispatcher: direct,
    context_rules: ["loop-efficiency", "token-context-budget"],
  });

  add({
    id: "brief-intake",
    phase: "intake",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "always_required",
    inputs: ["planning/normalized-task.json"],
    outputs: ["brief-intake/brief-intake-gate-report.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "brief-intake-gate.mjs"), "--out-dir", "brief-intake", "--normalized-task", "planning/normalized-task.json"],
    dispatcher: direct,
    context_rules: ["brief-intake"],
  });
  add({
    id: "provider-resolution",
    phase: "provider",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "always_required_before_generation",
    inputs: ["planning/normalized-task.json"],
    outputs: ["runtime/image-provider-resolution.json"],
    command: providerResolutionCommand,
    dispatcher: direct,
    context_rules: ["provider-route-pin"],
  });
  const generationSpecCommand = [
    process.execPath,
    path.join(skillRoot, "scripts", "resolve-generation-spec.mjs"),
    "--out-dir", "generation-spec",
    "--platform", String(ctx.args.platform),
    "--category", String(ctx.args.category),
    "--provider-resolution", path.join("runtime", "image-provider-resolution.json"),
  ];
  if (ctx.platformOverride.required_ratio) generationSpecCommand.push("--required-ratio", String(ctx.platformOverride.required_ratio));
  add({
    id: "generation-spec",
    phase: "provider",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "platform_ratio_required_before_generation",
    depends_on: ["provider-resolution"],
    inputs: ["runtime/image-provider-resolution.json", "planning/normalized-task.json"],
    outputs: ["generation-spec/generation-spec.json"],
    command: generationSpecCommand,
    dispatcher: direct,
    context_rules: ["platform-ratio-before-provider"],
  });
  if (ctx.triggers.has_source_image) {
    add({
      id: "source-reference-preflight",
      phase: "source",
      execution_class: "deterministic_pre_gate",
      trigger_reason: "has_source_image",
      depends_on: ["brief-intake"],
      inputs: ["planning/normalized-task.json"],
      outputs: ["source-preflight/reference-assets-manifest.json", "source-preflight/source-reference-index.json", "source-original/", "source-prepared/"],
      command: [process.execPath, path.join(skillRoot, "scripts", "prepare-source-references.mjs"), "--run-dir", ".", "--normalized-task", "planning/normalized-task.json"],
      dispatcher: direct,
      context_rules: ["conditional-reference-compression", "original-analysis-evidence", "provider-upload-budget"],
    });
    add({
      id: "source-understanding",
      phase: "source",
      execution_class: "agent_planning",
      trigger_reason: "has_source_image",
      depends_on: ["source-reference-preflight"],
      inputs: ["planning/normalized-task.json", "source-preflight/source-reference-index.json"],
      outputs: ["source-understanding/source-product-understanding.json", "source-understanding/source-reference-annotations.json", "source-understanding/source-evidence-summary.json"],
      dispatcher: agent("Deeply inspect every analysis_path original listed in the source reference index. For each source, classify product ownership/membership and confirmed role; extract product type, silhouette, geometry, material, color, structure, components, hardware, micro-details, visible text, physical-use evidence, unique contribution, conflicts, and uncertainty. Use AI visual reading first and OCR only when text is small, uncertain, specification-bearing, or risk-bearing. Preserve the full audit evidence in source-product-understanding.json using sellerpilot.source_product_understanding.v1 with a complete aggregate codex_visual_product_read plus one complete source_reads row per source_id; every row needs visual_summary, observed_facts, visible_text status/items, and uncertainty_notes. Write complete per-source routing records to source-reference-annotations.json using sellerpilot.source_reference_annotations.v1; then semantically compress only confirmed facts and source-ID routing into source-evidence-summary.json using sellerpilot.source_evidence_summary.v1, with product_identity, physical_truth, visible_text, per_source_contributions, reference_routing, unknowns, prompt_constraints, and qa_focus. Keep the compact summary below 12 KB and never embed image bytes or repeat file paths."),
      context_rules: ["source-product-understanding", "deep-multi-reference-read", "semantic-evidence-compression", "no-invented-facts", "micro-detail-lock"],
    });
    add({
      id: "source-evidence-summary-gate",
      phase: "source",
      execution_class: "deterministic_pre_gate",
      trigger_reason: "has_source_image",
      depends_on: ["source-understanding"],
      inputs: ["source-preflight/reference-assets-manifest.json", "source-understanding/source-product-understanding.json", "source-understanding/source-reference-annotations.json", "source-understanding/source-evidence-summary.json"],
      outputs: ["qa/source-evidence-summary-gate-report.json"],
      command: [process.execPath, path.join(skillRoot, "scripts", "source-evidence-summary-gate.mjs"), "--run-dir", ".", "--out-dir", "qa"],
      dispatcher: direct,
      context_rules: ["deep-multi-reference-read", "semantic-evidence-compression", "owned-product-reference-only"],
    });
    add({
      id: "identity-lock",
      phase: "identity",
      execution_class: "agent_planning",
      trigger_reason: "has_source_image",
      depends_on: ["source-evidence-summary-gate"],
      inputs: ["source-understanding/source-product-understanding.json", "source-understanding/source-evidence-summary.json", "source-understanding/source-reference-annotations.json"],
      outputs: ["blueprint/02-identity-lock.yaml"],
      dispatcher: agent("Create the product identity and geometry lock from source-understanding evidence; do not add unsupported details."),
      context_rules: ["product-identity-preservation", "identity-geometry-lock"],
    });
  }
  if (ctx.triggers.competitor_reference) {
    add({
      id: "competitor-pattern-analysis",
      phase: "research",
      execution_class: "agent_planning",
      trigger_reason: "competitor_reference",
      depends_on: [ctx.triggers.has_source_image ? "source-evidence-summary-gate" : "brief-intake"],
      inputs: unique(["planning/normalized-task.json", ctx.triggers.has_source_image ? "source-understanding/source-evidence-summary.json" : null]),
      outputs: ["research/competitor-pattern-analysis.json"],
      dispatcher: agent("Extract reusable commerce patterns only. Do not copy competitor composition, text, branding, or product identity."),
      context_rules: ["competitor-analysis-only", "bestseller-design-mining"],
    });
  }
  if (ctx.triggers.physical_function_risk) add({
    id: "physical-truth-lock", phase: "truth", execution_class: "agent_planning", trigger_reason: "physical_function_risk",
    depends_on: [ctx.triggers.has_source_image ? "identity-lock" : "brief-intake"],
    inputs: ["planning/normalized-task.json", ...(ctx.triggers.has_source_image ? ["blueprint/02-identity-lock.yaml"] : [])],
    outputs: ["blueprint/physical-truth-lock.json"],
    dispatcher: agent("Lock confirmed functions, actions, use contexts, unsupported claims, forbidden mechanisms, dimensions, and scale before prompt work."),
    context_rules: ["product-physical-truth"],
  });
  if (ctx.triggers.surface_material_canonical) add({
    id: "surface-material-lock", phase: "truth", execution_class: "agent_planning", trigger_reason: "surface_material_canonical",
    depends_on: [ctx.triggers.has_source_image ? "identity-lock" : "brief-intake"],
    inputs: ["planning/normalized-task.json", ...(ctx.triggers.has_source_image ? ["blueprint/02-identity-lock.yaml"] : [])],
    outputs: ["surface-material/canonical-material-lock.json"],
    dispatcher: agent("Treat the supplied motif or surface artwork as canonical material; record palette, lightness, temperature, gradient, texture, silhouette, contamination removal, and target surface."),
    context_rules: ["surface-material-transfer"],
  });
  add({
    id: "compact-blueprint",
    phase: "planning",
    execution_class: "agent_planning",
    trigger_reason: "always_required",
    depends_on: unique(["efficiency-plan", "brief-intake", ctx.triggers.has_source_image ? "identity-lock" : null, ctx.triggers.competitor_reference ? "competitor-pattern-analysis" : null, ctx.triggers.physical_function_risk ? "physical-truth-lock" : null, ctx.triggers.surface_material_canonical ? "surface-material-lock" : null]),
    inputs: unique(["planning/normalized-task.json", ctx.triggers.has_source_image ? "blueprint/02-identity-lock.yaml" : null, ctx.triggers.has_source_image ? "source-understanding/source-evidence-summary.json" : null, ctx.triggers.physical_function_risk ? "blueprint/physical-truth-lock.json" : null, ctx.triggers.surface_material_canonical ? "surface-material/canonical-material-lock.json" : null]),
    outputs: ["blueprint/quality-production-blueprint.json", "blueprint/panels.json"],
    dispatcher: agent("Produce one compact quality blueprint plus panels.json. Preserve roles, buyer questions, camera/lens/light/scene, copy intent, prompt layers, QA criteria, and all triggered truth locks."),
    context_rules: ["compact-quality-blueprint", "visual-director", "graphic-design-director", "scene-realism"],
  });
  add({
    id: "copy-strategy-gate", phase: "copy", execution_class: "deterministic_pre_gate", trigger_reason: "buyer_facing_copy_contract",
    depends_on: ["compact-blueprint"], inputs: ["blueprint/panels.json"], outputs: ["qa/copy-strategy-gate-report.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "copy-strategy-gate.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa"], dispatcher: direct,
    context_rules: ["copy-strategy-loop", "unsupported-claims"],
  });
  if (ctx.triggers.physical_function_risk) add({
    id: "product-physics-gate", phase: "qa_pre_generation", execution_class: "deterministic_pre_gate", trigger_reason: "physical_function_risk",
    depends_on: ["compact-blueprint"], inputs: ["blueprint/physical-truth-lock.json", "blueprint/panels.json"], outputs: ["qa/product-physics-fact-gate-report.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "product-physics-fact-gate.mjs"), "--fact-lock", "blueprint/physical-truth-lock.json", "--panels", "blueprint/panels.json", "--out-dir", "qa"], dispatcher: direct,
    context_rules: ["product-physical-truth"],
  });
  if (ctx.triggers.visible_copy) {
    add({ id: "text-layout-proof", phase: "copy", execution_class: "deterministic_pre_gate", trigger_reason: "visible_copy", depends_on: ["compact-blueprint"], inputs: ["blueprint/panels.json"], outputs: ["qa/text-layout-proof-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "text-layout-proof-gate.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa"], dispatcher: direct, context_rules: ["text-layout-proof"] });
  }
  if (ctx.triggers.localized_copy) {
    add({ id: "localized-copy-qa", phase: "copy", execution_class: "deterministic_pre_gate", trigger_reason: "localized_copy", depends_on: ["compact-blueprint"], inputs: ["blueprint/panels.json", "planning/normalized-task.json"], outputs: ["qa/localized-copy-qa-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "localized-copy-qa-gate.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa", "--locale", ctx.effectiveLocale], dispatcher: direct, context_rules: ["localized-copy-qa"] });
  }
  add({
    id: "prompt-contract",
    phase: "prompt",
    execution_class: "agent_planning",
    trigger_reason: "always_required_before_generation",
    depends_on: unique(["copy-strategy-gate", ctx.triggers.physical_function_risk ? "product-physics-gate" : null, ctx.triggers.visible_copy ? "text-layout-proof" : null, ctx.triggers.localized_copy ? "localized-copy-qa" : null]),
    inputs: unique(["blueprint/quality-production-blueprint.json", "blueprint/panels.json", "runtime/image-provider-resolution.json", "generation-spec/generation-spec.json", ctx.triggers.has_source_image ? "source-understanding/source-evidence-summary.json" : null, ctx.triggers.surface_material_canonical ? "surface-material/canonical-material-lock.json" : null]),
    outputs: ["prompt-pack/12-prompt-layer-stack.json", "prompt-pack/final-prompts.json", "qa/prompt-layer-gate-report.json"],
    dispatcher: agent("Create role-specific final prompts from locked product facts and the compact blueprint. Include mandatory and triggered layers; never invent product facts or visible marks."),
    context_rules: ["prompt-layering-subloop", "personalized-prompt-delivery", "provider-route-pin"],
  });
  const generationDependency = ["generation-spec", "prompt-contract"];
  if (ctx.triggers.multi_image_set) {
    add({
      id: "anchor-generation",
      phase: "generation",
      execution_class: "provider_generation",
      trigger_reason: "multi_image_set",
      depends_on: generationDependency,
      inputs: unique(["orchestration/generation-jobs.json", "prompt-pack/final-prompts.json", "runtime/image-provider-resolution.json", "generation-spec/generation-spec.json", ctx.triggers.has_source_image ? "source-preflight/reference-assets-manifest.json" : null, ctx.triggers.has_source_image ? "source-understanding/source-reference-annotations.json" : null, ctx.triggers.has_source_image ? "source-understanding/source-evidence-summary.json" : null]),
      outputs: ["generated-assets/execution-controller-state.json"],
      command: [process.execPath, path.join(skillRoot, "scripts", "generation-execution-controller.mjs"), "--run-dir", ".", "--jobs", "orchestration/generation-jobs.json", "--anchor-limit", String(ctx.budget.max_anchor_assets), "--execute"],
      dispatcher: provider("anchor"),
      loop: loop("anchor_discovery", ctx.budget.max_anchor_assets, "anchor-qa"),
      context_rules: ["anchor-first", "provider-route-pin", "identity-preservation"],
    });
    add({
      id: "anchor-qa",
      phase: "qa",
      execution_class: "agent_planning",
      trigger_reason: "multi_image_set",
      depends_on: ["anchor-generation"],
      outputs: ["generated-assets/anchor-batch-qa-decision.json"],
      loop: loop("anchor_discovery", ctx.budget.max_provider_attempts_per_role, "anchor-generation"),
      dispatcher: agent("Review only the capped anchor batch for identity, geometry, physical truth, surface material, scene direction, layout, and copy. Record continue/pass or the earliest repair node."),
      context_rules: ["anchor-qa", "identity-consistency", "qa-loop-routing"],
    });
  }
  add({
    id: "role-generation",
    phase: "generation",
    execution_class: "provider_generation",
    trigger_reason: ctx.triggers.multi_image_set ? "anchor_pass_required" : "single_image_final",
    depends_on: ctx.triggers.multi_image_set ? ["anchor-qa"] : generationDependency,
    inputs: unique(["orchestration/generation-jobs.json", "prompt-pack/final-prompts.json", "runtime/image-provider-resolution.json", "generation-spec/generation-spec.json", ctx.triggers.has_source_image ? "source-preflight/reference-assets-manifest.json" : null, ctx.triggers.has_source_image ? "source-understanding/source-reference-annotations.json" : null, ctx.triggers.has_source_image ? "source-understanding/source-evidence-summary.json" : null]),
    outputs: ["generated-assets/execution-controller-state.json", "final-images/"],
    command: [process.execPath, path.join(skillRoot, "scripts", "generation-execution-controller.mjs"), "--run-dir", ".", "--jobs", "orchestration/generation-jobs.json", ...(ctx.triggers.multi_image_set ? ["--continue-after-anchor-pass", "--anchor-limit", String(ctx.budget.max_anchor_assets)] : ["--anchor-limit", "1"]), "--execute"],
    dispatcher: provider(ctx.triggers.multi_image_set ? "remaining" : "single"),
    loop: loop("role_repair", ctx.budget.max_provider_attempts_per_role, "qa-loop-routing"),
    context_rules: ["bounded-generation-concurrency", "provider-route-pin", "evidence-delta-retry"],
  });
  if (ctx.triggers.has_source_image) {
    add({ id: "identity-visual-review", phase: "qa_review", execution_class: "agent_planning", trigger_reason: "source_identity_present", depends_on: ["role-generation"], inputs: ["final-images/", "blueprint/02-identity-lock.yaml"], outputs: ["qa/identity-consistency-visual-review.json"], dispatcher: agent("Compare every product-bearing final image with the source and identity lock. Review shape, color, material, structure, hardware, micro-details, geometry, and motif; record per-image pass/fail."), context_rules: ["identity-consistency", "identity-geometry-lock"] });
  }
  if (ctx.triggers.scene_requested) add({ id: "scene-realism-review", phase: "qa_review", execution_class: "agent_planning", trigger_reason: "scene_requested", depends_on: ["role-generation"], inputs: ["final-images/", "blueprint/panels.json"], outputs: ["qa/final-scene-realism-review.json"], dispatcher: agent("Review final usage/lifestyle roles for a real generated or photographic scene; reject vector decoration, repeated pattern backgrounds, and card pasteups."), context_rules: ["scene-asset-production", "scene-realism"] });
  if (ctx.triggers.visible_copy || ctx.triggers.localized_copy) add({ id: "final-visible-text-review", phase: "qa_review", execution_class: "agent_planning", trigger_reason: "visible_or_localized_copy", depends_on: ["role-generation"], inputs: ["final-images/", "blueprint/panels.json"], outputs: ["qa/final-visible-text-review.json"], dispatcher: agent("Review actual raster-visible text. Check exact buyer-facing copy, target language, source-language residue, script direction, readability, and unsafe claims."), context_rules: ["final-visible-text-review", "localized-copy-qa"] });
  if (ctx.triggers.surface_material_canonical) add({ id: "surface-material-visual-review", phase: "qa_review", execution_class: "agent_planning", trigger_reason: "surface_material_canonical", depends_on: ["role-generation"], inputs: ["surface-material/canonical-material-lock.json", "final-images/"], outputs: ["surface-material/material-transfer-proof.json", "qa/surface-material-visual-review.json"], dispatcher: agent("Create per-material transfer proof and independent final visual review for palette, lightness, color temperature, gradient direction, shape, texture, target region, mask, orientation, and source contamination."), context_rules: ["surface-material-transfer"] });

  add({ id: "marketing-quality-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_before_delivery", depends_on: unique(["role-generation", ctx.triggers.scene_requested ? "scene-realism-review" : null]), inputs: ["blueprint/panels.json", "final-images/"], outputs: ["qa/marketing-quality-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "marketing-gate-check.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa"], dispatcher: direct, context_rules: ["marketing-quality-gates"] });
  add({ id: "product-background-card-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_before_delivery", depends_on: ["role-generation"], inputs: ["blueprint/panels.json", "final-images/"], outputs: ["qa/product-background-card-consistency-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "product-background-card-consistency-gate.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa", "--run-dir", "."], dispatcher: direct, context_rules: ["source-asset-normalization", "card-background-consistency"] });
  const exportCommand = [process.execPath, path.join(skillRoot, "scripts", "image-set-export-gate.mjs"), "--run-dir", ".", "--image-dir", "final-images", "--out-dir", "qa", "--expected-count", String(ctx.imageCount), "--platform", String(ctx.args.platform), "--category", String(ctx.args.category)];
  if (ctx.platformOverride.required_ratio) exportCommand.push("--required-ratio", String(ctx.platformOverride.required_ratio));
  add({ id: "image-set-export-gate", phase: "export", execution_class: "deterministic_pre_gate", trigger_reason: "required_before_delivery", depends_on: ["role-generation"], inputs: ["final-images/", "planning/normalized-task.json"], outputs: ["qa/image-set-export-gate-report.json", "export/final-images-manifest.json"], command: exportCommand, dispatcher: direct, context_rules: ["run-isolation", "platform-export-ratio", "lineage"] });
  if (ctx.triggers.has_source_image) add({ id: "identity-consistency-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "source_identity_present", depends_on: ["identity-visual-review", "image-set-export-gate"], inputs: ["export/final-images-manifest.json", "qa/identity-consistency-visual-review.json", "blueprint/02-identity-lock.yaml"], outputs: ["qa/identity-consistency-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "identity-consistency-gate.mjs"), "--run-dir", ".", "--out-dir", "qa"], dispatcher: direct, context_rules: ["identity-consistency"] });
  if (ctx.triggers.surface_material_canonical) add({ id: "surface-material-transfer-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "surface_material_canonical", depends_on: ["surface-material-visual-review", "image-set-export-gate"], inputs: ["surface-material/canonical-material-lock.json", "surface-material/material-transfer-proof.json", "qa/surface-material-visual-review.json"], outputs: ["qa/surface-material-transfer-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "surface-material-transfer-gate.mjs"), "--lock", "surface-material/canonical-material-lock.json", "--transfer-proof", "surface-material/material-transfer-proof.json", "--visual-review", "qa/surface-material-visual-review.json", "--out-dir", "qa"], dispatcher: direct, context_rules: ["surface-material-transfer"] });
  if (ctx.triggers.localized_copy) add({ id: "localized-final-raster-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "localized_copy", depends_on: ["final-visible-text-review", "image-set-export-gate"], inputs: ["blueprint/panels.json", "qa/final-visible-text-review.json", "export/final-images-manifest.json"], outputs: ["qa/localized-copy-qa-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "localized-copy-qa-gate.mjs"), "--copy-json", "blueprint/panels.json", "--out-dir", "qa", "--locale", ctx.effectiveLocale, "--run-dir", ".", "--manifest", "export/final-images-manifest.json", "--final-visible-text-review", "qa/final-visible-text-review.json", "--require-final-visible-text-review"], dispatcher: direct, context_rules: ["localized-final-raster-review"] });
  add({
    id: "qa-loop-routing",
    phase: "qa",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "required_before_delivery",
    depends_on: unique(["marketing-quality-gate", "product-background-card-gate", "image-set-export-gate", ctx.triggers.has_source_image ? "identity-consistency-gate" : null, ctx.triggers.surface_material_canonical ? "surface-material-transfer-gate" : null, ctx.triggers.localized_copy ? "localized-final-raster-gate" : ((ctx.triggers.visible_copy) ? "final-visible-text-review" : null), ctx.triggers.physical_function_risk ? "product-physics-gate" : null]),
    inputs: ["qa/"],
    outputs: ["qa/qa-loop-routing-decision.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "qa-loop-router.mjs"), "--run-dir", ".", "--out-dir", "qa"],
    dispatcher: direct,
    loop: loop("role_repair", ctx.budget.max_provider_attempts_per_role, "role-generation"),
    context_rules: ["qa-loop-routing", "retry-budget"],
  });
  add({ id: "final-image-lineage-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_before_delivery", depends_on: ["qa-loop-routing"], inputs: ["export/final-images-manifest.json"], outputs: ["qa/final-image-lineage-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "final-image-lineage-gate.mjs"), "--run-dir", "."], dispatcher: direct, context_rules: ["final-image-lineage"] });
  add({ id: "native-imagegen-ledger-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_when_native_lineage_claimed", depends_on: ["final-image-lineage-gate"], inputs: ["export/final-images-manifest.json", "telemetry/cost-ledger.jsonl"], outputs: ["qa/native-imagegen-ledger-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "native-imagegen-ledger-gate.mjs"), "--run-dir", "."], dispatcher: direct, context_rules: ["provider-lineage"] });
  add({ id: "production-artifact-integrity-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_before_delivery_closure", depends_on: ["native-imagegen-ledger-gate"], inputs: ["generated-assets/generation-progress.json", "export/final-images-manifest.json", "qa/"], outputs: ["qa/production-artifact-integrity-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "production-artifact-integrity-gate.mjs"), "--run-dir", ".", "--out-dir", "qa"], dispatcher: direct, context_rules: ["artifact-integrity", "run-isolation"] });
  if (ctx.deliveryOverviewRequired) add({ id: "delivery-overview", phase: "delivery", execution_class: "delivery_closure", trigger_reason: "mode_contract_multi_image", depends_on: ["production-artifact-integrity-gate"], inputs: ["export/final-images-manifest.json"], outputs: ["overview/SET-OVERVIEW-contact-sheet.png", "overview/delivery-overview-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "create-delivery-overview.mjs"), "--run-dir", ".", "--manifest", "export/final-images-manifest.json", "--out-dir", "overview"], dispatcher: direct, context_rules: ["delivery-overview"] });
  if (ctx.reviewRequired) add({ id: "review-workspace", phase: "delivery", execution_class: "delivery_closure", trigger_reason: "mode_contract", depends_on: [ctx.deliveryOverviewRequired ? "delivery-overview" : "production-artifact-integrity-gate"], inputs: ["export/final-images-manifest.json"], outputs: ["qa/post-generation-tldraw-launch-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "post-generation-tldraw-launcher.mjs"), "--run-dir", ".", "--manifest", "export/final-images-manifest.json"], dispatcher: direct, context_rules: ["review-canvas"] });
  add({
    id: "final-delivery",
    phase: "delivery",
    execution_class: "delivery_closure",
    trigger_reason: "required_before_handoff",
    depends_on: [ctx.reviewRequired ? "review-workspace" : (ctx.deliveryOverviewRequired ? "delivery-overview" : "production-artifact-integrity-gate")],
    outputs: ["qa/final-delivery-gate-report.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "final-delivery-gate.mjs"), "--run-dir", ".", "--out-dir", "qa"],
    dispatcher: direct,
    loop: loop("delivery_closure", 1, null),
    context_rules: ["final-delivery-gate", "no-generation-in-delivery-closure"],
  });
  return tasks;
}

function resolveTriggers(input, imageCount) {
  const text = String(input["user-text"] || "");
  const locale = String(input.locale || "").toLowerCase();
  return {
    has_source_image: asBool(input["has-source-image"]),
    visible_copy: asBool(input["visible-copy"]) || /(文案|标题|卖点|文字|copy|text)/i.test(text),
    localized_copy: asBool(input["localized-copy"]) || /^(ru|de|ar)(-|_|$)/.test(locale),
    scene_requested: asBool(input["scene-requested"]) || /(场景|上身|模特|lifestyle|outfit|commute|cafe|street)/i.test(text),
    physical_function_risk: asBool(input["physical-function-risk"]) || /(安装|使用步骤|承重|防水|固定|尺寸|scale|function|installation)/i.test(text),
    surface_material_canonical: asBool(input["surface-material-canonical"]) || /(印花|织物|提花|纹身贴|贴纸|穿戴甲|nail wrap|printed fabric|woven)/i.test(text),
    competitor_reference: asBool(input["competitor-reference"]) || /(竞品|竞争对手|competitor reference|competitive redesign)/i.test(text),
    multi_image_set: imageCount > 1,
  };
}

function buildBudget(mode, imageCount, triggers, selectedMode) {
  const configuredMax = Math.max(0, Number(mode.max_anchor_assets || 0));
  const highRisk = Boolean(triggers.surface_material_canonical)
    || (Boolean(triggers.physical_function_risk) && Boolean(triggers.scene_requested));
  const desiredAnchors = imageCount <= 1 ? 0
    : selectedMode === "fast_generation" ? 1
      : highRisk || selectedMode === "industrial_audit" ? 3
        : 2;
  const maxAnchorAssets = Math.min(imageCount, configuredMax, desiredAnchors);
  return {
    max_provider_attempts_per_role: Number(mode.max_provider_attempts_per_role),
    max_anchor_assets: maxAnchorAssets,
    anchor_selection_reason: imageCount <= 1 ? "single_image_no_anchor" : selectedMode === "fast_generation" ? "fast_low_risk_one_anchor" : highRisk ? "high_risk_identity_or_physical_surface_three_anchors" : selectedMode === "industrial_audit" ? "industrial_audit_three_anchors" : "quality_default_two_anchors",
    max_provider_calls: imageCount > 1 ? imageCount + maxAnchorAssets + imageCount : Number(mode.max_provider_attempts_per_role),
    evidence_delta_required_before_retry: true,
  };
}

function createRoles(count, anchorLimit) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `IMG-${String(index + 1).padStart(2, "0")}`;
    return [id, { status: "planned", anchor: index < anchorLimit, attempts: 0, evidence_hash: null, approved_asset: null }];
  }));
}

function createGenerationJobs({ imageCount, budget, normalizedTask }) {
  const jobs = Array.from({ length: imageCount }, (_, index) => {
    const id = `IMG-${String(index + 1).padStart(2, "0")}`;
    return {
      id,
      anchor: index < budget.max_anchor_assets,
      prompt_ref: { path: "prompt-pack/final-prompts.json", role: id },
      ...(normalizedTask.facts.has_source_image ? {
        source_manifest: "source-preflight/reference-assets-manifest.json",
        source_annotations: "source-understanding/source-reference-annotations.json",
        source_evidence_summary: "source-understanding/source-evidence-summary.json",
        reference_policy: { strategy: "role_specific_deep_evidence", max_images: 2 },
      } : {}),
      generation_spec: "generation-spec/generation-spec.json",
      provider_resolution: "runtime/image-provider-resolution.json",
      output_dir: `generated-assets/${id}`,
      progress_file: `generated-assets/progress-${id.toLowerCase()}.json`,
    };
  });
  return {
    schema_version: "sellerpilot.generation_jobs.v2",
    created_at: new Date().toISOString(),
    normalized_task_digest: normalizedTask.content_digest,
    anchor_limit: budget.max_anchor_assets,
    remaining_concurrency: 2,
    jobs,
  };
}

function createDispatcherRegistry() {
  return {
    schema_version: "sellerpilot.execution_class_dispatchers.v1",
    created_at: new Date().toISOString(),
    classes: {
      deterministic_pre_gate: { strategy: "direct_command", missing_command: "fail" },
      agent_planning: { strategy: "artifact_handoff", context_pack: true, missing_outputs: "awaiting_agent" },
      provider_generation: { strategy: "generation_controller", missing_outputs: "awaiting_provider_or_native_host" },
      delivery_closure: { strategy: "direct_command", may_generate: false, missing_command: "fail" },
      human_decision: { strategy: "human_pause" },
      audit_optional: { strategy: "artifact_handoff", context_pack: true, missing_outputs: "awaiting_agent" },
    },
  };
}

function loop(name, maxAttempts, returnNode) {
  return { name, max_attempts: maxAttempts, return_node: returnNode, retry_requires_evidence_delta: true };
}

function inferMode(input) {
  const text = String(input.userText || "");
  if (asBool(input.audit) || /(工业级|审计|audit)/i.test(text)) return "industrial_audit";
  if (asBool(input.revision) || /(修改|修图|标注|revision)/i.test(text)) return "revision_repair";
  if (asBool(input.fast) && input.imageCount <= 1) return "fast_generation";
  return input.imageCount <= 1 ? "single_image_quality_production" : "quality_production";
}

function validateContract(value) {
  if (value?.schema_version !== "sellerpilot.production_contract.v1") fail("Unsupported production contract schema.");
  if (!value.modes?.[value.default_mode]) fail("Contract default_mode is absent from modes.");
  if (value.loop_policy?.final_delivery_is_root_cause !== false) fail("Contract must forbid final delivery as a root-cause retry target.");
}

function validateTasks(tasks, mode) {
  const ids = new Set();
  for (const task of tasks) {
    if (ids.has(task.id)) fail(`Duplicate compiled task: ${task.id}.`);
    ids.add(task.id);
    if (!mode.allowed_execution_classes.includes(task.execution_class)) fail(`Task ${task.id} has disallowed execution class ${task.execution_class}.`);
    if (!task.dispatcher?.strategy) fail(`Task ${task.id} has no execution dispatcher binding.`);
    if (["deterministic_pre_gate", "delivery_closure", "provider_generation"].includes(task.execution_class) && !task.command.length) fail(`Executable task ${task.id} is missing its command binding.`);
    for (const dependency of task.depends_on || []) if (!ids.has(dependency)) fail(`Task ${task.id} depends on a later or missing task: ${dependency}.`);
  }
}

function validatePhaseAncestry({ contract, tasks, triggers }) {
  const aliases = {
    source_understanding: "source-understanding", source_reference_preflight: "source-reference-preflight", source_evidence_summary_gate: "source-evidence-summary-gate", identity_lock: "identity-lock",
    text_layout_proof: "text-layout-proof", localized_copy_qa: "localized-copy-qa",
    final_visible_text_review: "final-visible-text-review", scene_realism_review: "scene-realism-review",
    physical_truth_lock: "physical-truth-lock", product_physics_gate: "product-physics-gate",
    surface_material_lock: "surface-material-lock", surface_material_transfer_gate: "surface-material-transfer-gate",
    delivery_overview: "delivery-overview",
  };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const generationTargets = tasks.filter((task) => task.execution_class === "provider_generation").map((task) => task.id);
  for (const [trigger, enabled] of Object.entries(triggers)) {
    if (!enabled) continue;
    const policy = contract.triggers?.[trigger];
    if (!policy) continue;
    for (const requirement of policy.requires_before_generation || []) {
      const requiredId = aliases[requirement] || requirement.replaceAll("_", "-");
      for (const target of generationTargets) if (!isAncestor(requiredId, target, byId)) fail(`Contract trigger ${trigger} requires ${requiredId} to be an ancestor of provider task ${target}.`);
    }
    for (const requirement of policy.requires_before_delivery || []) {
      const requiredId = aliases[requirement] || requirement.replaceAll("_", "-");
      if (!isAncestor(requiredId, "final-delivery", byId)) fail(`Contract trigger ${trigger} requires ${requiredId} to be an ancestor of final-delivery.`);
    }
  }
  for (const gateId of ["surface-material-transfer-gate", "identity-consistency-gate", "localized-final-raster-gate"].filter((id) => byId.has(id))) {
    if (!isAncestor("role-generation", gateId, byId)) fail(`${gateId} must run after role-generation.`);
  }
}

function isAncestor(ancestorId, targetId, byId, seen = new Set()) {
  if (ancestorId === targetId) return true;
  if (seen.has(targetId)) return false;
  seen.add(targetId);
  const target = byId.get(targetId);
  return Boolean(target?.depends_on?.some((dependency) => dependency === ancestorId || isAncestor(ancestorId, dependency, byId, new Set(seen))));
}

function requiresReviewWorkspace(modeContract, input) {
  const requirement = modeContract.requires_review_workspace_for_final_delivery;
  if (requirement === true) return true;
  if (requirement === "when_annotations_present") return asBool(input["annotations-present"]);
  return false;
}

function validateContractTaskCoverage({ contract, modeContract, tasks, triggers, reviewRequired, deliveryOverviewRequired }) {
  const ids = new Set(tasks.map((task) => task.id));
  const aliases = {
    source_reference_preflight: ["source-reference-preflight"],
    source_understanding: ["source-understanding"],
    source_evidence_summary_gate: ["source-evidence-summary-gate"],
    identity_lock: ["identity-lock"],
    text_layout_proof: ["text-layout-proof"],
    localized_copy_qa: ["localized-copy-qa"],
    final_visible_text_review: ["final-visible-text-review"],
    scene_realism_review: ["scene-realism-review"],
    physical_truth_lock: ["physical-truth-lock"],
    product_physics_gate: ["product-physics-gate"],
    surface_material_lock: ["surface-material-lock"],
    surface_material_transfer_gate: ["surface-material-transfer-gate"],
    anchor_batch: ["anchor-generation", "anchor-qa"],
    delivery_overview: ["delivery-overview"],
  };
  for (const [trigger, enabled] of Object.entries(triggers)) {
    if (!enabled || !contract.triggers?.[trigger]) continue;
    for (const requirement of contract.triggers[trigger].requires || []) {
      const requiredTasks = aliases[requirement] || [requirement.replaceAll("_", "-")];
      for (const id of requiredTasks) if (!ids.has(id)) fail(`Contract trigger ${trigger} requires compiled task ${id}.`);
    }
  }
  if (deliveryOverviewRequired && !ids.has("delivery-overview")) fail("Mode contract requires delivery overview for this multi-image plan.");
  if (reviewRequired && !ids.has("review-workspace")) fail("Mode contract requires a review workspace before final delivery.");
  if (modeContract.requires_review_workspace_for_final_delivery === true && !reviewRequired) fail("Mode contract review workspace requirement was not projected.");
  if (!ids.has("generation-spec")) fail("Every compiled production plan must resolve a generation spec before provider execution.");
}

function parseArgs(argv) {
  const result = { "source-image": [] };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (key === "source-image") {
      if (!next || next.startsWith("--")) fail("--source-image requires a path.");
      result[key].push(next); index += 1;
    } else if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function asBool(value) { return typeof value === "boolean" ? value : /^(1|true|yes|y)$/i.test(String(value || "")); }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function safeRunId(value) { return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"; }
function readJsonRequired(file, label) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`Could not read ${label}: ${error.message}`); } }
function readJsonIfExists(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/compile-production-plan.mjs --run-dir /abs/run --platform <platform> --category <category> [--mode <mode>] [--image-count <n>] [--locale <locale>] [--annotations-present true] [--has-source-image true] [--visible-copy true] [--scene-requested true]"); process.exit(2); }
function toMarkdown(plan) {
  const lines = ["# Compiled Production Plan", "", `- Run: ${plan.run_id}`, `- Mode: ${plan.mode}`, `- Tasks: ${plan.tasks.length}`, "", "## Triggers", ...Object.entries(plan.triggers).map(([key, value]) => `- ${key}: ${value}`), "", "## Execution DAG", ...plan.tasks.map((task) => {
    const dependencies = Array.isArray(task.depends_on) ? task.depends_on : [];
    return `- ${task.id} (${task.execution_class}) — depends on: ${dependencies.length ? dependencies.join(", ") : "none"}; reason: ${task.trigger_reason}`;
  }), "", "## Budget", ...Object.entries(plan.budget).map(([key, value]) => `- ${key}: ${value}`), ""];
  return `${lines.join("\n")}\n`;
}
