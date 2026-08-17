# Loop Efficiency

Use a gated loop so generation does not waste time producing full sets before source, platform, and role assumptions are validated.

## Mode Principle

Do not make every request `fast_generation`. The goal is high-quality final ecommerce imagery with the least wasted work.

- Use `fast_generation` for single-image, low-risk, quick-turn drafts or explicit speed-first requests.
- Use `quality_production` for normal multi-image ecommerce sets, high-quality final assets, scene-heavy output, physical-function/scale-sensitive products, or conversion-critical platform/category work.
- Use `revision_repair` for user annotations, comparison screenshots, or rejected outputs.
- Use `industrial_audit` only when the user asks for full reports, migration evidence, gate records, or deep debugging.

## Quality Production Loop

Quality production mode runs the full quality-critical path without generating the full industrial artifact pack.

1. Resolve skill root and run the cache-first update awareness check.
2. Select production mode with `production-mode-router.mjs`.
3. Write `planning/production-efficiency-plan.json` with triggered work, skipped work, time budgets, and the progress update policy.
4. Run Brief Intake Gate. Ask only high-value questions; otherwise record assumptions and continue.
5. Run reference preflight: preserve immutable analysis originals and create provider upload derivatives only when bytes/dimensions/format require them.
6. Deep-read every original, write full plus per-source annotations and compact evidence, pass the compact-evidence gate, then create Product Identity Lock.
7. Build a transparent/card-safe product asset only when card/infographic composition needs it.
8. Trigger physical truth, geometry, micro-detail, URL/live research, or market research only when signals require them.
9. Create direction options for rough/open requests; otherwise continue with the harness default.
10. Build compact image-set planning with identity/truth locks, platform context, buyer question, shot matrix, copy, prompt layers, and QA criteria.
11. Pass prompt/copy gates, then generate anchors with role-specific reference selection (normally 1–2, subject to provider cap).
12. QA anchors for identity, physical truth, scene realism, copy, and direction.
13. Continue only missing/approved roles after anchor pass.
14. Run relevant identity/physics/copy/marketing/export/overview/final gates.
15. Start tldraw after export/overview and return a ready URL or blocked reason.

## Fast Loop

1. Resolve skill root and load local rules.
2. Run Brief Intake Gate. Ask only high-value questions; otherwise record assumptions and continue.
3. Preflight sources, preserving originals and preparing upload variants only if needed.
4. Deep-read every reference; keep full evidence, pass compact evidence, and build Product Identity Lock.
5. Run targeted platform/category research only when the baseline profile is stale, unclear, platform/category fit is conversion-critical, or the user requests marketing enhancement.
6. Run compact Product Feature Analysis and Audience Positioning Analysis:
   - confirmed visual traits and feature evidence
   - buyer-relevant benefits
   - detail-shot opportunities
   - scene triggers
   - primary buyer and purchase moment
   - motivations, objections, aesthetic preferences, and copy voice
7. Create Visual Direction Brief:
   - distinct buyer question per image
   - camera angle and crop matrix
   - lighting, scene, prop/model context
   - buyer-facing copy policy
8. Create compact image-set planning. This planning is still required for multi-image final sets; the optimization is to merge strategy, shot matrix, copy intent, prompt layers, and QA criteria into one executable artifact instead of separate long reports.
9. Run a focused blueprint/QA gate:
   - product facts only
   - platform fit
   - visual role diversity
   - required scene assets listed
   - no internal-facing final copy
   - no repeated detail crops
10. Generate anchors through the pinned provider, selecting only the strongest 1–2 user-owned references for each role.
11. Run a focused anchor QA against identity, scene direction, role diversity, and obvious platform mismatch.
12. Continue only missing/failed assets after anchor QA passes. Reuse approved assets; do not regenerate the full set.
13. Compose final layouts.
14. Run product-background/card consistency QA before marketing QA when card/infographic layouts use source product assets.
15. Run copy, localized final visible-text when needed, marketing diversity, export, and final delivery QA.
16. Reconcile `generated-assets/generation-progress.json` from the current run manifest only when final images exist but the progress file is stale; do not regenerate approved images just to fix bookkeeping.
17. For generated multi-image final sets, create and auto-start the run-scoped tldraw workspace after export/overview. For single-image drafts, create a review surface only when requested, when a gate fails, or when revision feedback is the next action. Prefer the shared tldraw service session over per-run dev servers.
18. Convert user annotations into Revision Brief when feedback exists.

Fast mode should not create the full industrial run skeleton, every research artifact, every gate JSON, or a tldraw workspace by default. Escalate to industrial audit mode only when the user asks for evidence, migration artifacts, debug traces, or a repeated failure needs deeper routing.

## Retry Budget

- Maximum 2 generation attempts per scene role unless the user asks to continue.
- `qa-loop-router.mjs` must enforce retry budgets through `qa/qa-loop-state.json`; retry budgets are not advisory prose.
- Stop early when product identity drifts too far from the source image.
- If identity fails, regenerate only the failed product-bearing asset with a tighter identity lock. Do not regenerate approved assets.
- Do not regenerate text-heavy infographics when only scene imagery failed.
- Reuse approved assets across revisions.
- Do not regenerate a full set when only the shot matrix or buyer-facing copy fails; fix the brief and rerun the smallest affected assets.
- If the same QA failure signature exceeds its budget, stop automatic generation and request better source evidence, product fact confirmation, or a changed direction before continuing.

## Generation Pacing

For image sets with more than three outputs, avoid serially generating the full set before checking quality.

Risk-adaptive anchor batch (bounded by the production contract):

- fast/low-risk: one main identity/hero image
- normal quality: two anchors, including the highest-risk scene or scale role
- high identity, physical-truth, or surface-material risk: up to three anchors, adding a detail/texture/material-transfer role

The compiler records both `anchor_limit` and `anchor_selection_reason` in `orchestration/generation-jobs.json`; the controller must not silently collapse a high-risk three-anchor plan to two. After approval, remaining independent roles still use at most two concurrent provider calls.

Continue only after anchor QA decides:

- `continue`: identity and visual direction are good enough; generate remaining roles only.
- `revise_prompt`: prompt/shot matrix needs adjustment; regenerate the failed anchor only.
- `ask_user`: a missing preference or source-detail gap is causing likely rework.
- `blocked`: runtime or source identity is insufficient.

For long-running generation, write a visible progress marker after each generated asset:

```text
generated-assets/generation-progress.json
```

Include completed images, pending images, failed images, next action, and whether user feedback can improve the next batch. This prevents an unfinished run from looking like a silent failure.

Before final delivery, `final-delivery-gate.mjs` must reject stale progress such as `planned` or `not_started` with empty completed images when final images already exist. If the current run manifest is correct, run `reconcile-generation-progress.mjs` to update the progress file from the manifest. This is a bookkeeping repair, not a quality shortcut and not a substitute for anchor QA.

For image sets with more than three outputs, final delivery must see an anchor batch decision of `continue`, `pass`, `approved`, or equivalent before the remaining set is accepted. Missing anchor evidence means the workflow skipped the pacing guard and should return to anchor QA rather than presenting a finished set.

If wall-clock time exceeds 15 minutes, do not continue silently. Report the current progress marker to the user, identify whether the delay is from network/image generation or local planning/gates, and continue only the smallest pending scope.

If a user gives feedback on an anchor image, merge it directly into the remaining image prompts instead of restarting the whole plan.

## Failure Handling

If a gate fails, report the failing gate and the smallest next action:

- source image too weak -> enhance or ask for better source image
- platform research missing -> browse and create research brief
- scene assets weak -> regenerate only scene assets
- product identity drift -> regenerate only failed assets using stronger source-image reference, or ask for more source angles
- repeated angle/detail/copy -> revise Visual Direction Brief and rerun only affected images
- blank/empty final visual module -> rerender or regenerate only that image/layout section
- product background/card mismatch -> run source asset normalization and rerender only affected card/infographic layouts
- localized final raster contains source-language or non-target-language residue -> rerender/regenerate affected localized image text/layout only
- text/layout issue -> rerender layout only
- review widget unavailable -> use tldraw workspace JSON/completion payload/screenshot evidence and state widget limitation

Do not treat `final-delivery-gate-report.json` as the root-cause report for another QA routing pass. Final delivery is an aggregator; fix the underlying upstream gate or existing QA loop decision instead.
