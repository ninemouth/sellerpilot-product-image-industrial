# Loop Efficiency

Use a gated loop so generation does not waste time producing full sets before source, platform, and role assumptions are validated.

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
8. Create a compact Image Set Blueprint.
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
15. Create a review surface only when requested, when a gate fails, or when revision feedback is the next action. Prefer the shared tldraw service session over per-run dev servers.
16. Convert user annotations into Revision Brief when feedback exists.

Fast mode should not create the full industrial run skeleton, every research artifact, every gate JSON, or a tldraw workspace by default. Escalate to industrial audit mode only when the user asks for evidence, migration artifacts, debug traces, or a repeated failure needs deeper routing.

## Retry Budget

- Maximum 2 generation attempts per scene role unless the user asks to continue.
- Stop early when product identity drifts too far from the source image.
- If identity fails, regenerate only the failed product-bearing asset with a tighter identity lock. Do not regenerate approved assets.
- Do not regenerate text-heavy infographics when only scene imagery failed.
- Reuse approved assets across revisions.
- Do not regenerate a full set when only the shot matrix or buyer-facing copy fails; fix the brief and rerun the smallest affected assets.

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

If a user gives feedback on an anchor image, merge it directly into the remaining image prompts instead of restarting the whole plan.

## Failure Handling

If a gate fails, report the failing gate and the smallest next action:

- source image too weak -> enhance or ask for better source image
- platform research missing -> browse and create research brief
- scene assets weak -> regenerate only scene assets
- product identity drift -> regenerate only failed assets using stronger source-image reference, or ask for more source angles
- repeated angle/detail/copy -> revise Visual Direction Brief and rerun only affected images
- text/layout issue -> rerender layout only
- review widget unavailable -> use local review canvas and state widget limitation
