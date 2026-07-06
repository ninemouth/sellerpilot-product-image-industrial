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
5. Build Source Product Understanding with AI visual text reading first, run OCR only when visual text is visible/uncertain/important, then create Product Identity Lock before visual planning.
6. Trigger physical truth, geometry, micro-detail, product URL reading, live platform research, or market research only when the product/request contains those risk signals.
7. Create strategy direction options when the user request is rough/open, then continue with the harness-selected option if the user has no preference.
8. Build compact image-set planning: source facts, identity/physical locks, platform baseline/triggered research, buyer question per image, Visual Director shot matrix, copy intent, prompt layers, and QA criteria.
9. Run prompt-layer planning and copy strategy checks before image generation.
10. Generate an anchor batch through Codex-native `imagegen` / `image_gen`: main identity/hero, highest-risk scene or scale shot, and one detail when identity risk is high.
11. QA the anchor batch for identity, physical truth, scene realism, copy, and visual direction.
12. Continue only missing/approved remaining assets after anchor QA passes.
13. Run relevant final gates only: identity, geometry/physics when triggered, copy, marketing, export, overview, final delivery.
14. For generated multi-image final sets, run `post-generation-tldraw-launcher.mjs` after export and overview so the final handoff includes a ready tldraw URL or a blocked startup reason.

## Fast Loop

1. Resolve skill root and load local rules.
2. Run Brief Intake Gate. Ask only high-value questions; otherwise record assumptions and continue.
3. Preflight source images and enhance if needed.
4. Build a compact Product Fact Sheet and Product Identity Lock.
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
10. Generate an anchor batch through Codex-native `imagegen` / `image_gen` when available, using source image references when possible.
11. Run a focused anchor QA against identity, scene direction, role diversity, and obvious platform mismatch.
12. Continue only missing/failed assets after anchor QA passes. Reuse approved assets; do not regenerate the full set.
13. Compose final layouts.
14. Run marketing diversity gate and QA.
15. For generated multi-image final sets, create and auto-start the run-scoped tldraw workspace after export/overview. For single-image drafts, create a review surface only when requested, when a gate fails, or when revision feedback is the next action. Prefer the shared tldraw service session over per-run dev servers.
16. Convert user annotations into Revision Brief when feedback exists.

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

Default anchor batch:

- one main identity/hero image
- one highest-risk scene or scale image
- one detail/texture image when identity risk is high

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

If wall-clock time exceeds 15 minutes, do not continue silently. Report the current progress marker to the user, identify whether the delay is from network/image generation or local planning/gates, and continue only the smallest pending scope.

If a user gives feedback on an anchor image, merge it directly into the remaining image prompts instead of restarting the whole plan.

## Failure Handling

If a gate fails, report the failing gate and the smallest next action:

- source image too weak -> enhance or ask for better source image
- platform research missing -> browse and create research brief
- scene assets weak -> regenerate only scene assets
- product identity drift -> regenerate only failed assets using stronger source-image reference, or ask for more source angles
- repeated angle/detail/copy -> revise Visual Direction Brief and rerun only affected images
- text/layout issue -> rerender layout only
- review widget unavailable -> use tldraw workspace JSON/completion payload/screenshot evidence and state widget limitation

Do not treat `final-delivery-gate-report.json` as the root-cause report for another QA routing pass. Final delivery is an aggregator; fix the underlying upstream gate or existing QA loop decision instead.
