---
name: sellerpilot-product-image-industrial
description: Create, plan, review, revise, and audit industrial ecommerce product-image sets with source-identity preservation, platform-aware composition, localized copy, provider-safe generation, QA routing, tldraw review, and run-scoped delivery.
---

# SellerPilot Product Image Industrial

## Purpose

Use this as the single entrypoint for SellerPilot-style ecommerce image work: source images or URLs, competitor references, platform/locale/audience constraints, final generation, QA, revision, and delivery. Optimize execution and context, never the quality floor.

## Chat commands

Use these commands in Codex chat; they are Skill request conventions, not shell executables:

```text
$sellerpilot-product-image-industrial status
$sellerpilot-product-image-industrial provider-status
$sellerpilot-product-image-industrial sync
$sellerpilot-product-image-industrial sync --set-active
```

- `status` and `provider-status` are aliases. Run `scripts/sync-marqel-image-config.mjs --status` and return only the non-secret Provider state.
- `sync` is only for a Marqel-managed installation created by the Etsy/Marqel one-click installer. Before contacting Auth or the Web control plane, run `scripts/sync-marqel-image-config.mjs --managed-only --status`. If it returns `not_managed`, stop without contacting the Web service and without writing Provider configuration; tell the user to keep using the independent-install configuration workflow described below.
- When the managed-install preflight succeeds, run the sibling `marqel-control-center-auth` helper with `sync-config --target-id sellerpilot-image`; if no reusable session exists, run `device-start --sync-target sellerpilot-image` and wait for Web approval. Then run `scripts/sync-marqel-image-config.mjs --managed-only`, followed by `--status`. Do not run the `image-proxy` synchronization hook and do not generate an image.
- `sync --set-active` performs the same managed-only refresh and passes `--set-active` only to `scripts/sync-marqel-image-config.mjs`. Never interpret plain `sync` as authority to replace an explicitly selected external profile.
- For an independent or source installation, keep the existing Provider setup unchanged: use `configure:image-provider-interactive`, `providers:upsert`, `providers:select`, or the documented environment variables. Never implicitly pull Web-managed configuration into those installations.
- Never print a Base URL, API Key, Token, shared configuration contents, or raw helper stderr. Report only the allowlisted status fields emitted by the SellerPilot status command.

The canonical control plane is:

```text
normalized-task.json
  -> production contract + platform override
  -> compiled DAG + dispatcher registry + generation jobs
  -> run-pinned provider route
  -> anchor-first generation
  -> triggered QA and smallest-scope repair
  -> manifest + overview + tldraw + final delivery gate
```

Use `scripts/compile-production-plan.mjs`; never hand-author the standard DAG or copy platform workflows. It emits the normalized task, efficiency plan, tasks, dispatcher registry, generation jobs, and run state. Downstream decisions reuse those facts instead of reparsing the request.

## First gate: update awareness

Every production request must start with the update check:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/check-skill-update.mjs --cache-ttl-hours 24 --timeout-ms 1500
```

- `current`: continue silently.
- `update_available`: ask whether to update. Do not enter production planning, source analysis, image generation, QA, or canvas launch until the user chooses. Never overwrite the installed skill without authorization.
- `local_ahead_of_remote`: the installed bytes match a clean local commit, so local work may continue, but do not claim the configured remote distribution is current until that commit is reviewed and pushed.
- `installed_content_mismatch`, `unknown_local_integrity`, or `dirty_source_install`: stop production and repair the installed Skill from a clean reviewed release. These are local provenance failures, not ordinary network uncertainty.
- `divergent_revision`: stop and reconcile the local and remote histories. `revision_mismatch` requires review because ancestry could not be proven; do not guess which side is newer.
- `unknown_remote_revision` or timeout: continue, state that remote freshness was not confirmed, and do not claim the install is current.

Update/sync diagnostics are internal. Never expose local absolute paths, usernames, caches, raw remotes, network errors, or credentials in the user-facing message.

## Execution modes

- `fast_generation`: explicit quick/draft, single low-risk image. Keep fact, identity, prompt, generation, focused QA, and export controls.
- `single_image_quality_production`: one formal final image. Require manifest, relevant gates, final delivery, and tldraw; no anchor batch or overview.
- `quality_production`: default formal multi-image set. Use compact blueprint, risk-adaptive anchor batch, bounded remaining concurrency, overview, tldraw, and final delivery.
- `revision_repair`: parse prior output or annotations, return to the earliest failed node, keep approved assets, and repair only affected roles/regions.
- `industrial_audit`: full evidence package, migration/development audit, or explicitly requested gate reports.
- `debug_development`: repository validation only; debug artifacts stay under a temp or `work/` scope.

Choose the lightest mode that protects final quality. Do not route ordinary final multi-image work to fast mode, and do not expand normal production into a verbose audit package.

## Provider route and generation boundary

First inspect the current Codex runtime capability. This check is authoritative for `auto` routing:

- If the built-in `image_gen` / system `imagegen` capability is available, resolve with `--native-imagegen available` (or `SELLERPILOT_NATIVE_IMAGEGEN_AVAILABLE=1`). Use `native_codex`; do **not** fetch or require a third-party Base URL or API Key, even if a stale external profile remains locally active.
- Only when built-in `image_gen` is unavailable and the runtime is intentionally using a third-party proxy, resolve with `--provider third_party_proxy --native-imagegen unavailable`. Then, and only then, synchronize the Web-managed `sellerpilot-image` target when that target is the selected proxy source.
- An explicit `third_party_proxy` selection remains authoritative. `unknown` preserves the existing explicit profile selection and must not be presented as proof that native generation is available.

When the selected route is the Marqel Web-managed third-party proxy, refresh the shared target before resolving the provider route:

For a first-time authorization, the explicit target can be synchronized immediately after the human approval:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/marqel-control-center-auth/scripts/manage-session.mjs device-start --sync-target sellerpilot-image
```

For an existing valid device session, use the refresh-and-import sequence:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/marqel-control-center-auth/scripts/manage-session.mjs sync-config --target-id sellerpilot-image
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/sync-marqel-image-config.mjs
```

The managed one-click installer performs this import for both `image-proxy` and this SellerPilot Skill, verifies that both consumers hold the same delivery digest, and reports their states separately. Check this Skill's non-secret local provider state with:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/sync-marqel-image-config.mjs --status
```

An `applied` result means the managed third-party profile and key are available to SellerPilot; `profileActive: false` is valid when `codex-native` remains intentionally active. Never infer SellerPilot readiness solely from `image-proxy` status.

The sync adds or updates a named `marqel-sellerpilot-image` provider profile without deleting existing local profiles. It auto-activates only when the local active profile is still `codex-native`; an explicitly selected local external profile remains authoritative. Use `--set-active` only when the operator intentionally wants the Web-managed profile to become active. The API Key is never printed, placed in a run artifact, or sent to a browser page. If the shared target is missing, local Codex provider configuration remains the fallback and the Skill must report the configuration state honestly. Never run this Web sync merely because the target exists: native `image_gen` needs neither its Base URL nor its API Key.

Resolve one provider route per run. Treat its `selected_mode` as the sole execution authority. The resolver pins a digest into `runtime/image-provider-resolution.json` and `run-state.json`; every role reuses it. A per-role config change or silent fallback is forbidden.

- `native_codex`: create the validated native handoff, call only system `imagegen` / `image_gen`, then record the host callback and image evidence.
- `third_party_proxy`: call only the resolved runtime/profile/model/endpoint. A ready configured route already covers reference upload, request, download, retry, QA, and delivery; never ask again whether to send references.
- A saved ThinkAI external profile may use `gpt-image-2` through `scripts/thinkai-image-runtime.mjs`; it remains an explicit profile, not the implicit default.
- If unavailable, preserve the run/assets, record the transport or host-policy status, and never switch provider or present a local draft as final.

Do not invent one-off wrappers. `scripts/create-image-generation-dispatch.mjs`, the native handoff scripts, and the resolved third-party runtime are the only generation execution boundaries.

For a blocked necessary capability, request user authorization using the capability name. Do not say "sandbox 禁止", expose raw errors, or promise a bypass. A ready third-party route never needs a second upload-consent prompt.

## Quality-critical contract

Always preserve these lower bounds:

1. Do not invent facts, certifications, materials, dimensions, functions, safety claims, compatibility, prices, or performance promises.
2. Keep competitor references analysis-only; never copy their brand, product identity, text, or visual composition.
3. Preserve source product identity: silhouette, color, material, structure, components, hardware, geometry, micro-details, and source-supported scale.
4. Source-backed runs preserve byte-identical analysis originals, prepare upload derivatives only when required, deep-read every reference into full plus compact source-ID evidence, and select at most 1–2 relevant user-owned references per role. Never attach everything or send competitor/unknown sources as product identity.
5. Read source-visible text with AI first. Use OCR only for uncertain/small/risk-bearing text. Propagate confirmed facts and uncertainty into locks, copy, prompts, and QA.
6. For physical/function/installation/scale-sensitive products, create the physical-truth lock and pass the fact gate before provider generation. Never generate unsupported mechanisms or actions.
7. Printed/woven motifs, nail art, decals, tattoos, and equivalent surface products use canonical `surface_material_transfer`; preserve palette, temperature, lightness, gradient, texture, shape, and placement. The final per-region transfer gate runs after generation.
8. Visible copy requires copy strategy and low-cost text-layout proof before expensive generation. Non-zh/non-en localization requires pre-generation translation QA and final raster-visible text review, including RTL/script consistency.
9. Usage/lifestyle roles require real generated or photographic scene evidence. Vector decoration, repeated patterns, or a product card pasted over a fake background cannot pass as a scene.
10. Cards/infographics use transparent or card-safe product masters. Visible rectangular residue or background mismatch blocks only the affected composition.
11. No implicit watermarks, platform-pack labels, `SellerPilot`, `Codex`, `AI生成`, or other non-buyer marks. An exact visible watermark needs explicit text/position/purpose/image authorization.
12. Multi-image production is anchor-first. Use 1 anchor for fast low risk, 2 for normal quality, and up to 3 for high-risk identity/physical/surface combinations. After anchor pass, remaining independent roles use concurrency no greater than 2.
13. Retry only after evidence changes. Respect role/run budgets and the provider circuit breaker. Never regenerate approved assets or restart a full set to hide stale progress, lineage, or a closure failure.
14. Every run has a unique `run_id`, run-local manifest, lineage, progress, QA state, overview for multi-image sets, and final gate. Never scan a shared/parent output directory as production input.
15. Final delivery never acts as a retry root cause and delivery closure may not generate images. Route failures to the earliest responsible node.
16. Do not auto-publish or promise CTR, CVR, ROAS, ACOS, rankings, or sales lift.

The detailed, trigger-routed contract is in [quality-critical-contract.md](references/quality-critical-contract.md). Gate schemas and artifacts are in [output-contract.md](references/output-contract.md) and [qa-loop-routing.md](references/qa-loop-routing.md).

## Production flow

1. Read the installed `AGENTS.md`, run the update gate, and normalize once.
2. Compile the plan. Initial efficiency/brief/provider work may run in parallel; truth, prompt, anchor QA, and final delivery are convergence points.
3. Brief intake asks at most three high-value questions; low-risk gaps become assumptions. Source-backed runs retain `has_source_image`, then preflight, deep-read, and compact evidence before planning.
4. If the commercial direction is rough/open, show 2–3 directions and the harness default before formal generation; proceed with the recorded default if the user does not choose.
5. Load only trigger-relevant references. Create a compact blueprint with roles, buyer questions, camera/lens/light/scene, copy intent, prompt layers, and QA criteria.
6. Bind every execution class:
   - deterministic tasks execute commands;
   - agent planning writes a task-specific context pack/handoff and resumes when declared outputs exist;
   - provider generation consumes `generation-jobs.json` and the pinned route;
   - delivery closure runs only non-generation commands;
   - human decisions pause explicitly.
7. Generate the risk-adaptive anchor batch, record anchor QA, then continue only missing/failed roles.
8. Run triggered post-generation visual reviews and deterministic gates, QA loop routing, lineage/ledger gates, export, overview, tldraw, and final delivery.

Example compiler entry:

```bash
node scripts/compile-production-plan.mjs \
  --run-dir /abs/run \
  --platform Ozon \
  --category "printed fabric bag" \
  --image-count 6 \
  --locale ru-RU \
  --has-source-image true \
  --visible-copy true \
  --surface-material-canonical true

node scripts/production-orchestrator.mjs \
  --run-dir /abs/run \
  --tasks /abs/run/orchestration/tasks.json \
  --execute
```

An `awaiting_agent`, `awaiting_native_host`, or other structured wait is not success. Complete its handoff artifact/callback, then rerun the orchestrator; cache and dependency hashes preserve completed work.

## Context and performance policy

- Use task-specific context packs with rule IDs and only dependency evidence. Never load every prompt/reference for a small task.
- `planning/production-efficiency-plan.json` defines run-local time and context budgets. It must not apply a crude output-token cap or weaken quality schemas.
- Record context bytes, estimated/actual agent tokens, cache hits, input/output bytes, and state transitions. Host-reported usage goes through `record-agent-usage.mjs`.
- Real timing comes from `telemetry/phase-events.jsonl` and provider progress events. `production-phase-tracer.mjs` labels file-mtime reconstruction as estimate-only.
- Before global timeout/concurrency/retry changes, aggregate multiple runs with `provider-telemetry-summary.mjs`. `insufficient_sample` permits only run-local repair or more sampling.
- For historical outputs without explicit lineage, run `backfill-final-image-lineage.mjs`; do not regenerate the set merely to reconstruct metadata.

## Canvas and delivery

After export (and set overview), formal delivery reuses the prewarmed tldraw service. A run workspace copies only tracked app files, links/copies images, reuses the same fingerprinted session, and never installs/copies `node_modules`.

The review image is the stable DOM floor; tldraw owns annotations. Unmarked images remain approved. `提交修改给 AI` writes structured completion/annotation artifacts, which route revision to the smallest affected scope.

Single-image delivery requires its final image, manifest, relevant QA/final gate, and tldraw result. A set additionally requires independent finals, anchor decision, reconciled progress, overview, and run-local manifest; overview never replaces finals.

## Progressive disclosure

Load only what the trigger needs:

- New run, DAG, cache, pacing: [workflow-routing.md](references/workflow-routing.md), [loop-efficiency.md](references/loop-efficiency.md).
- Exact commands, provider setup, callbacks, telemetry, watchdog, lineage, canvas: [production-runtime-runbook.md](references/production-runtime-runbook.md).
- Provider/native boundary: [gpt-built-in-image-generation-policy.md](references/gpt-built-in-image-generation-policy.md).
- Source preflight/multi-reference/identity/text/geometry: [source-image-quality.md](references/source-image-quality.md), [multi-source-image-fusion.md](references/multi-source-image-fusion.md), [source-product-understanding.md](references/source-product-understanding.md), [product-identity-preservation.md](references/product-identity-preservation.md), [identity-geometry-lock.md](references/identity-geometry-lock.md).
- Physical or surface truth: [product-physical-truth.md](references/product-physical-truth.md), [surface-material-transfer.md](references/surface-material-transfer.md).
- Copy/localization/layout/prompt: [copy-strategy-loop.md](references/copy-strategy-loop.md), [prompt-layering-subloop.md](references/prompt-layering-subloop.md), [personalized-prompt-delivery.md](references/personalized-prompt-delivery.md).
- Buyer/platform/scene/design: [visual-director.md](references/visual-director.md), [scene-asset-production.md](references/scene-asset-production.md), [contextual-platform-research.md](references/contextual-platform-research.md), [bestseller-design-mining.md](references/bestseller-design-mining.md).
- Final QA/review/revision: [marketing-quality-gates.md](references/marketing-quality-gates.md), [output-contract.md](references/output-contract.md), [review-canvas.md](references/review-canvas.md), [qa-loop-routing.md](references/qa-loop-routing.md), [failed-output-regeneration.md](references/failed-output-regeneration.md).

Use `npm run paths:codex` for OS-correct installed roots. Verify the development copy, then use the bundled sync script; never hand-copy a partial release.
