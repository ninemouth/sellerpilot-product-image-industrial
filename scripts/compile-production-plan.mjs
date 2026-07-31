#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const args = parseArgs(process.argv);
if (args.help || !args["run-dir"] || !args.platform || !args.category) usage();

const contractPath = path.resolve(args.contract || path.join(skillRoot, "contracts", "production-contract.json"));
const contract = readJsonRequired(contractPath, "production contract");
validateContract(contract);
const overridesPath = path.resolve(args["platform-overrides"] || path.join(skillRoot, "contracts", "platform-overrides.json"));
const platformOverrides = readJsonRequired(overridesPath, "platform overrides");
if (platformOverrides?.schema_version !== "sellerpilot.platform_overrides.v1") fail("Unsupported platform overrides schema.");

const runDir = path.resolve(args["run-dir"]);
const platformOverride = resolvePlatformOverride(platformOverrides, args.platform);
const imageCount = positiveInteger(args["image-count"], positiveInteger(platformOverride.default_image_count, 1));
const effectiveLocale = String(args.locale || platformOverride.locale || "");
const mode = String(args.mode || inferMode({ imageCount, userText: args["user-text"], fast: args.fast, audit: args.audit, revision: args.revision }));
if (!contract.modes[mode]) fail(`Unknown production mode: ${mode}.`);

const runId = safeRunId(args["run-id"] || path.basename(runDir));
const modeContract = contract.modes[mode];
const triggers = resolveTriggers({ ...args, locale: effectiveLocale }, imageCount);
const budget = buildBudget(modeContract, imageCount);
const reviewRequired = requiresReviewWorkspace(modeContract, args);
const deliveryOverviewRequired = imageCount > 1 && Boolean(modeContract.requires_delivery_overview_for_multi_image);
const tasks = compileTasks({ contract, mode, imageCount, triggers, budget, args, platformOverride, effectiveLocale, reviewRequired, deliveryOverviewRequired });
validateTasks(tasks, modeContract);
validateContractTaskCoverage({ contract, modeContract, tasks, triggers, reviewRequired, deliveryOverviewRequired });

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
    input_resolution: {
      image_count_source: args["image-count"] ? "explicit" : platformOverride.default_image_count ? "platform_default" : "fallback",
      locale_source: args.locale ? "explicit" : platformOverride.locale ? "platform_default" : "unspecified",
    },
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
  },
  roles: createRoles(imageCount),
};

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
  compiler_note: "This phase emits a canonical plan and DAG. Provider-generation and human-review tasks remain blocked until their upstream evidence and explicit dispatcher are available.",
};

const dag = {
  schema_version: "sellerpilot.production_dag.v1",
  generated_at: runState.created_at,
  run_id: runId,
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
  })),
};

if (!args["dry-run"]) {
  writeJson(path.join(runDir, "run-state.json"), runState);
  writeJson(path.join(runDir, "planning", "compiled-production-plan.json"), plan);
  fs.writeFileSync(path.join(runDir, "planning", "compiled-production-plan.md"), toMarkdown(plan));
  writeJson(path.join(runDir, "orchestration", "tasks.json"), dag);
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
    inputs: [],
    outputs: [],
    command: [],
    loop: null,
    ...task,
  });

  add({
    id: "brief-intake",
    phase: "intake",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "always_required",
    outputs: ["brief-intake/brief-intake-gate-report.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "brief-intake-gate.mjs"), "--out-dir", "brief-intake", "--platform", String(ctx.args.platform), "--category", String(ctx.args.category), "--image-count", String(ctx.imageCount)],
  });
  add({
    id: "provider-resolution",
    phase: "provider",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "always_required_before_generation",
    depends_on: ["brief-intake"],
    outputs: ["provider/provider-resolution.json"],
    command: [process.execPath, path.join(skillRoot, "scripts", "resolve-image-provider.mjs"), "--run-dir", "."],
  });
  const generationSpecCommand = [
    process.execPath,
    path.join(skillRoot, "scripts", "resolve-generation-spec.mjs"),
    "--out-dir", "generation-spec",
    "--platform", String(ctx.args.platform),
    "--category", String(ctx.args.category),
  ];
  if (ctx.platformOverride.required_ratio) generationSpecCommand.push("--required-ratio", String(ctx.platformOverride.required_ratio));
  add({
    id: "generation-spec",
    phase: "provider",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "platform_ratio_required_before_generation",
    depends_on: ["provider-resolution"],
    outputs: ["generation-spec/generation-spec.json"],
    command: generationSpecCommand,
  });
  if (ctx.triggers.has_source_image) {
    add({
      id: "source-understanding",
      phase: "source",
      execution_class: "agent_planning",
      trigger_reason: "has_source_image",
      depends_on: ["brief-intake"],
      outputs: ["source-understanding/source-product-understanding.json"],
      command: [],
      blocked_reason: "Requires the compiler caller to bind a source image path before deterministic execution.",
    });
    add({
      id: "identity-lock",
      phase: "identity",
      execution_class: "agent_planning",
      trigger_reason: "has_source_image",
      depends_on: ["source-understanding"],
      inputs: ["source-understanding/source-product-understanding.json"],
      outputs: ["blueprint/02-identity-lock.yaml"],
    });
  }
  if (ctx.triggers.competitor_reference) {
    add({
      id: "competitor-pattern-analysis",
      phase: "research",
      execution_class: "agent_planning",
      trigger_reason: "competitor_reference",
      depends_on: ["brief-intake"],
      outputs: ["research/competitor-pattern-analysis.json"],
      blocked_reason: "Competitor references are analysis-only and must not be copied into final imagery.",
    });
  }
  if (ctx.triggers.physical_function_risk) addGatePair(tasks, "physical-truth-lock", "product-physics-gate", "physical_function_risk", [ctx.triggers.has_source_image ? "identity-lock" : "brief-intake"]);
  if (ctx.triggers.surface_material_canonical) addGatePair(tasks, "surface-material-lock", "surface-material-transfer-gate", "surface_material_canonical", [ctx.triggers.has_source_image ? "identity-lock" : "brief-intake"]);
  add({
    id: "compact-blueprint",
    phase: "planning",
    execution_class: "agent_planning",
    trigger_reason: "always_required",
    depends_on: unique(["brief-intake", ctx.triggers.has_source_image ? "identity-lock" : null, ctx.triggers.competitor_reference ? "competitor-pattern-analysis" : null, ctx.triggers.physical_function_risk ? "physical-truth-lock" : null]),
    outputs: ["blueprint/quality-production-blueprint.json"],
  });
  if (ctx.triggers.visible_copy) {
    add({ id: "text-layout-proof", phase: "copy", execution_class: "deterministic_pre_gate", trigger_reason: "visible_copy", depends_on: ["compact-blueprint"], outputs: ["qa/text-layout-proof-gate-report.json"] });
  }
  if (ctx.triggers.localized_copy) {
    add({ id: "localized-copy-qa", phase: "copy", execution_class: "agent_planning", trigger_reason: "localized_copy", depends_on: ["compact-blueprint"], outputs: ["qa/localized-copy-qa-report.json"] });
  }
  add({
    id: "prompt-contract",
    phase: "prompt",
    execution_class: "agent_planning",
    trigger_reason: "always_required_before_generation",
    depends_on: unique(["compact-blueprint", ctx.triggers.visible_copy ? "text-layout-proof" : null, ctx.triggers.localized_copy ? "localized-copy-qa" : null]),
    outputs: ["prompt-pack/12-prompt-layer-stack.json", "qa/prompt-layer-gate-report.json"],
  });
  const generationDependency = ["generation-spec", "prompt-contract"];
  if (ctx.triggers.multi_image_set) {
    add({
      id: "anchor-generation",
      phase: "generation",
      execution_class: "provider_generation",
      trigger_reason: "multi_image_set",
      depends_on: generationDependency,
      outputs: ["generated-assets/anchor-batch/"],
      loop: loop("anchor_discovery", ctx.budget.max_anchor_assets, "anchor-qa"),
      blocked_reason: "Requires an approved provider dispatcher and source/prompt evidence binding.",
    });
    add({
      id: "anchor-qa",
      phase: "qa",
      execution_class: "agent_planning",
      trigger_reason: "multi_image_set",
      depends_on: ["anchor-generation"],
      outputs: ["generated-assets/anchor-batch-qa-decision.json"],
      loop: loop("anchor_discovery", ctx.budget.max_provider_attempts_per_role, "anchor-generation"),
    });
  }
  add({
    id: "role-generation",
    phase: "generation",
    execution_class: "provider_generation",
    trigger_reason: ctx.triggers.multi_image_set ? "anchor_pass_required" : "single_image_final",
    depends_on: ctx.triggers.multi_image_set ? ["anchor-qa"] : generationDependency,
    outputs: ["generated-assets/", "final-images/"],
    loop: loop("role_repair", ctx.budget.max_provider_attempts_per_role, "qa-loop-routing"),
    blocked_reason: "Requires an approved provider dispatcher and per-role evidence binding.",
  });
  add({
    id: "final-qa",
    phase: "qa",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "required_before_delivery",
    depends_on: ["role-generation"],
    outputs: ["qa/marketing-quality-gate-report.json", "qa/image-set-export-gate-report.json"],
  });
  if (ctx.triggers.scene_requested) add({ id: "scene-realism-review", phase: "qa", execution_class: "agent_planning", trigger_reason: "scene_requested", depends_on: ["role-generation"], outputs: ["qa/final-scene-realism-review.json"] });
  if (ctx.triggers.visible_copy || ctx.triggers.localized_copy) add({ id: "final-visible-text-review", phase: "qa", execution_class: "agent_planning", trigger_reason: "visible_or_localized_copy", depends_on: ["role-generation"], outputs: ["qa/final-visible-text-review.json"] });
  add({
    id: "qa-loop-routing",
    phase: "qa",
    execution_class: "deterministic_pre_gate",
    trigger_reason: "required_before_delivery",
    depends_on: unique(["final-qa", ctx.triggers.scene_requested ? "scene-realism-review" : null, (ctx.triggers.visible_copy || ctx.triggers.localized_copy) ? "final-visible-text-review" : null]),
    outputs: ["qa/qa-loop-routing-decision.json"],
    loop: loop("role_repair", ctx.budget.max_provider_attempts_per_role, "role-generation"),
  });
  add({ id: "native-imagegen-ledger-gate", phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: "required_when_native_lineage_claimed", depends_on: ["qa-loop-routing"], outputs: ["qa/native-imagegen-ledger-gate-report.json"], command: [process.execPath, path.join(skillRoot, "scripts", "native-imagegen-ledger-gate.mjs"), "--run-dir", "."] });
  if (ctx.deliveryOverviewRequired) add({ id: "delivery-overview", phase: "delivery", execution_class: "delivery_closure", trigger_reason: "mode_contract_multi_image", depends_on: ["native-imagegen-ledger-gate"], outputs: ["overview/SET-OVERVIEW-contact-sheet.png"] });
  if (ctx.reviewRequired) add({ id: "review-workspace", phase: "delivery", execution_class: "delivery_closure", trigger_reason: "mode_contract", depends_on: [ctx.deliveryOverviewRequired ? "delivery-overview" : "native-imagegen-ledger-gate"], outputs: ["qa/post-generation-tldraw-launch-report.json"] });
  add({
    id: "final-delivery",
    phase: "delivery",
    execution_class: "delivery_closure",
    trigger_reason: "required_before_handoff",
    depends_on: [ctx.reviewRequired ? "review-workspace" : (ctx.deliveryOverviewRequired ? "delivery-overview" : "native-imagegen-ledger-gate")],
    outputs: ["qa/final-delivery-gate-report.json"],
    loop: loop("delivery_closure", 1, null),
  });
  return tasks;
}

function addGatePair(tasks, lockId, gateId, triggerReason, dependencies) {
  tasks.push({ id: lockId, phase: "truth", execution_class: "agent_planning", trigger_reason: triggerReason, status: "pending", depends_on: dependencies, inputs: [], outputs: [`blueprint/${lockId}.json`], command: [], loop: null });
  tasks.push({ id: gateId, phase: "qa", execution_class: "deterministic_pre_gate", trigger_reason: triggerReason, status: "pending", depends_on: [lockId], inputs: [`blueprint/${lockId}.json`], outputs: [`qa/${gateId}-report.json`], command: [], loop: null });
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

function resolvePlatformOverride(overrides, platform) {
  const key = String(platform || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return { ...(overrides.default || {}), ...(overrides.platforms?.[key] || {}), platform_key: key, matched: Boolean(overrides.platforms?.[key]) };
}

function buildBudget(mode, imageCount) {
  return {
    max_provider_attempts_per_role: Number(mode.max_provider_attempts_per_role),
    max_anchor_assets: imageCount > 1 ? Number(mode.max_anchor_assets) : 0,
    max_provider_calls: imageCount > 1 ? imageCount + Number(mode.max_anchor_assets) + imageCount : Number(mode.max_provider_attempts_per_role),
    evidence_delta_required_before_retry: true,
  };
}

function createRoles(count) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const id = `IMG-${String(index + 1).padStart(2, "0")}`;
    return [id, { status: "planned", attempts: 0, evidence_hash: null, approved_asset: null }];
  }));
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
    for (const dependency of task.depends_on || []) if (!ids.has(dependency)) fail(`Task ${task.id} depends on a later or missing task: ${dependency}.`);
  }
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
    source_understanding: ["source-understanding"],
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
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function asBool(value) { return typeof value === "boolean" ? value : /^(1|true|yes|y)$/i.test(String(value || "")); }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function safeRunId(value) { return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"; }
function readJsonRequired(file, label) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { fail(`Could not read ${label}: ${error.message}`); } }
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
