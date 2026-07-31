# SellerPilot Loop Engineering Reconstruction

## Decision

SellerPilot will evolve from a documentation-led SOP plus independent scripts into a **bounded Loop Engineering control plane**. This is an incremental reconstruction: current source-truth, identity, provider, QA, lineage, watchdog, export, and review scripts remain reusable execution nodes. The reconstruction does not authorize weaker product-fact, safety, localization, or final-delivery controls.

## Problem Statement

The current package contains valuable controls but duplicates their policy across `AGENTS.md`, `SKILL.md`, workflow YAML, router code, plans, and gates. Its generic orchestrator requires a manually created task file, so normal production still depends on an agent interpreting a long SOP and deciding which scripts to run. The result is avoidable context cost, inconsistent routing, non-provable parallelism, and retries that can repeat expensive work without a durable state transition.

## Target Operating Model

```text
intent + source evidence
  -> contract-driven plan compiler
  -> run-state + run-local DAG
  -> deterministic pre-gates
  -> bounded anchor / repair loops
  -> final-delivery closure
  -> optional human revision loop
```

There are four execution classes:

| Class | Purpose | May automatically loop? |
| --- | --- | --- |
| deterministic_pre_gate | Cheap evidence extraction and validation before a provider call | No; fail or create a precise repair task |
| agent_planning | Compact reasoning that converts evidence into a blueprint or review decision | Only when its evidence inputs changed |
| provider_generation | Billable image generation or editing | Only under per-role and run budgets |
| human_decision | Product facts, publishing, durable style memory, or subjective direction choices | Never; pause with an explicit decision contract |

## Non-Negotiable Loop Rules

1. A loop has a named target role, expected state transition, budget, and evidence inputs.
2. A provider retry requires a meaningful evidence delta: changed source, prompt, layout, role contract, provider strategy, or an explicit user decision.
3. A failure invalidates only downstream artifacts for the affected role. It must return to the earliest responsible node.
4. `final-delivery-gate` is an aggregation endpoint, never a root-cause retry target.
5. Provider circuit-breaker, retry-budget exhaustion, missing product facts, and human authorization are terminal/pause states, not auto-retry states.
6. The run is resumable from `run-state.json`; agents should not reconstruct state by rereading every artifact.
7. A gate must be classified as required-before-generation, required-before-delivery, conditional, or audit-optional. Only the contract can assign that class.

## Canonical Artifacts

```text
contracts/production-contract.json        # one machine-readable policy source
schemas/run-state.schema.json             # canonical lifecycle state
runs/<run-id>/run-state.json              # current state and budget ledger
runs/<run-id>/planning/compiled-production-plan.json
runs/<run-id>/orchestration/tasks.json    # generated DAG, not hand-authored
runs/<run-id>/telemetry/cost-ledger.jsonl # later phase: per-call cost/evidence events
```

Existing run artifacts stay as evidence owned by their current scripts. The run state records their role and validity; it does not replace source understanding, lineage, manifests, or QA reports.

## Loops

### Anchor discovery loop

Generate only the small role set needed to validate product identity, scene realism, and visual direction. A pass unlocks remaining independent roles. A failure revises only the source/prompt/shot decision implicated by evidence.

### Role repair loop

For a failed image, classify the finding, invalidate only descendants of the earliest responsible node, require evidence delta, repair that role, then run the affected regression gates. Layout/text failures must not regenerate a valid provider scene; identity drift must not recreate overview or review workspace artifacts.

### Delivery closure loop

When final images exist but package closure is incomplete, run manifest reconciliation, overview where required, review workspace where policy requires it, and final delivery gate. This loop never regenerates images.

### Human revision loop

tldraw annotations create structured repair tasks. Product-fact uncertainty, visible watermark authorization, durable store style, provider circuit opening, and subjective commercial direction become `paused_for_human_decision` rather than automatic retries.

## Migration Plan

### Phase 1 — Contract and plan compiler (this slice)

- Add a canonical production contract and run-state schema.
- Add `compile-production-plan.mjs`, which creates a run-local state, compact plan, and dependency DAG from normalized task facts.
- Add a fast dedicated verifier for contract/compiler invariants.
- Do not alter provider execution, final delivery semantics, or current run artifacts.

**Acceptance:** a normal run no longer needs a hand-authored `tasks.json`; all compiled tasks have an execution class, trigger reason, dependencies, and a bounded loop policy.

### Phase 2 — State transitions and deterministic dispatch

- Make deterministic pre-gates executable from the compiled DAG.
- Add `advance-run-state` and artifact invalidation helpers.
- Make anchor approval, provider circuit breaker, QA router, and watchdog write contract-validated state transitions.

**Acceptance:** resume and retry decisions can be made from run state plus current evidence, without reinterpreting a full SOP.

Current implementation status: `run-state-transition.mjs` projects QA, watchdog, delivery, generation-controller, circuit-breaker, and approved-asset-reuse reports into canonical state. `invalidate-run-artifacts.mjs` records the smallest downstream invalidation set without deleting approved assets. `qa-loop-router.mjs`, `runtime-watchdog.mjs`, `final-delivery-gate.mjs`, `generation-execution-controller.mjs`, `provider-instability-circuit-breaker.mjs`, and `record-asset-reuse.mjs` automatically project to run state when a compiled run is present.

### Phase 3 — Cost ledger and bounded provider loop

- Centralize provider-call dispatch and record role, prompt/source hashes, attempts, timing, tokens when available, estimated cost, and state transition.
- Enforce per-run and per-role budgets before provider calls.
- Require evidence delta before retry.

**Acceptance:** `provider_attempts_per_delivered_image`, anchor reject rate, and cost/token per final role are measurable.

Current implementation status: `record-provider-call.mjs` writes `telemetry/cost-ledger.jsonl`, updates per-role attempts and aggregate cost/token fields, enforces the run and role attempt budgets, and rejects a retry whose provider/prompt/source evidence fingerprint is unchanged. The native adapter `record-native-imagegen-result.mjs` records hash-bound native Codex outputs in that same ledger, so native and third-party calls use the same budget/evidence contract. `native-imagegen-ledger-gate.mjs` closes the bypass: a final manifest claiming `native_codex` must match both its native output evidence and a successful ledger event before delivery can pass.

The existing OpenAI-compatible `thinkai-image-runtime.mjs` is now bound to this policy whenever it receives `--run-dir` and `--role`: it records a preflight request before the network call and the final success/failure result afterward. A blocked preflight prevents the provider request.

### Phase 4 — Policy consolidation and workflow deltas

- Generate or validate mode requirements from the canonical contract.
- Replace copied platform workflows with master flow plus platform/category deltas.
- Shrink duplicated prose in `AGENTS.md` and `SKILL.md` to principles and user-facing operation.

**Acceptance:** a global gate change has one policy definition and platform variation is declarative.

Current implementation status: `contracts/platform-overrides.json` is compiler-consumed for Amazon, Pinduoduo, Ozon, Etsy, TikTok Shop, Xiaohongshu, multi-platform, and competitive-redesign routes. It carries only marketplace variation (role template, default image count, ratio, locale, copy density, and platform-specific capability flags); explicit CLI facts override platform defaults, otherwise the compiler writes the resolved source to `run-state.json.goal.input_resolution`. Every compiled plan contains a provider-preceding `generation-spec` task, and contract-required overview/review tasks are explicit Final Delivery dependencies. Contract trigger requirements are checked against generated DAG task coverage during compilation, so adding a policy requirement without its executable gate fails closed. Competitor references compile into an analysis-only task, never a copy permission. New-run routing defaults to the compiler. The six former platform workflow copies are now compact compatibility pointers that resolve `platform_override` / `route_defaults` into the master compiler; the master workflow is the only remaining canonical step list.

### Phase 5 — Verification and release hardening

- Split verification into static, unit, integration, and explicit end-to-end suites.
- Add timeout, child-process ownership, cleanup, and per-suite reports.
- Make release verification fail if a process/service remains alive after a suite.

**Acceptance:** fast checks complete predictably; slow canvas/Python tests are observable, bounded, and isolated.

Current implementation status: default `npm run verify` now runs isolated static and unit suites. The legacy suite is exposed as `npm run verify:integration`, supports `--filter <name fragment>` and named `--suite control-plane|natural-finish|canvas-review|delivery` probes from a versioned registry, and has a process-group timeout, heartbeat, output-tail report, and forced cleanup. It is still a compatibility suite rather than the sole release signal; its remaining checks should be extracted into independently owned files over subsequent slices.

## Current Operational Commands

```bash
# Compile a run-local state and DAG from request facts.
npm run plan:compile -- --run-dir /abs/run --platform Amazon --category "shoulder bag" --image-count 7 --has-source-image true

# Project an existing QA/watchdog/final-gate result into run state.
npm run state:transition -- --run-dir /abs/run --event qa
npm run state:transition -- --run-dir /abs/run --event watchdog
npm run state:transition -- --run-dir /abs/run --event delivery

# Record an affected downstream scope without deleting approved artifacts.
npm run state:invalidate -- --run-dir /abs/run --from-node layout-wireframes --role IMG-03 --reason "localized visible text overflow"

# Record a completed provider attempt. Identical prompt/source/provider retries are rejected.
npm run telemetry:record-provider-call -- --run-dir /abs/run --role IMG-03 --status failed --prompt-hash <hash> --source-hash <hash> --provider thinkai --model gpt-image-2

# Immediately after a real native Codex imagegen call, bind its saved output to the same ledger.
npm run telemetry:record-native-imagegen -- --run-dir /abs/run --role IMG-03 --status succeeded --prompt "<final prompt>" --source-hash <hash> --image-path /abs/run/generated-assets/IMG-03/image.png --execution-evidence <native-tool-call-id>

# Validate native provider lineage before final delivery. It is not required for third-party-only runs.
npm run qa:native-imagegen-ledger -- --run-dir /abs/run
```

## Success Metrics

- No provider call before all required pre-generation gates pass.
- No repeated provider call without a recorded evidence delta.
- No hand-authored production DAG for standard runs.
- No full-set regeneration for a single-role repair.
- Every final role has a lineage and cost/evidence record.
- Token and provider spend are attributable to a state transition, not just a script invocation.

## Deliberately Remaining Migration Work

1. The copied platform workflow lists have been removed. Historical run metadata still needs a versioned importer if it stored only an opaque legacy workflow ID instead of platform/category facts; until then, the compact compatibility pointers preserve the explicit platform override and route defaults.
2. Native Codex image generation now uses a two-stage delivery-gated handoff: `create-native-imagegen-handoff.mjs` records budget/evidence preflight and binds prompt/source/role, then `record-native-imagegen-result.mjs --handoff` binds the true output hash and host evidence ID. A local Node script still cannot intercept the host-native `imagegen` tool call itself; the next host integration should invoke those two actions automatically, removing the remaining conversational handoff.
3. The legacy verifier can now run bounded filtered probes with cleanup, but its individual checks are still located in one large compatibility file. The next extraction should move canvas, natural-finish, and provider-mock probes into independently owned suite files without changing their fixtures.
4. Agent-planning tasks intentionally pause until real source/brief/prompt evidence is bound. That is a truth boundary, not an execution failure; a later UI/host binder can make these handoffs structured instead of conversational.

## Closure Assessment

The original architecture/token-efficiency objective is complete at the skill/repository layer: new runs compile one canonical contract into run-local state and a DAG; platform workflow copies have been removed; provider calls are bounded by evidence and cost ledger rules; anchor/repair/delivery loops have explicit stop conditions; deterministic execution cannot fabricate completion; and third-party OpenAI-compatible dispatch is a first-class route for environments without native Codex image generation.

Two boundaries remain, neither of which should be described as an unresolved image-production capability:

1. **Host callback integration.** Native Codex `imagegen` is not intercepted by Node. The repository now creates a preflight handoff, requires a result record, and blocks final delivery without proof. A future Codex host callback can automate those already-defined two actions. Accounts without native capability use `third_party_proxy` and do not depend on this callback.
2. **Legacy verifier source layout.** Named suites, process isolation, lifecycle budgets, and focused execution are active. Some historical fixtures remain in `verify-skill.mjs`; extracting them into separate source modules is maintainability work, not a missing production-control or token-spend safeguard.
