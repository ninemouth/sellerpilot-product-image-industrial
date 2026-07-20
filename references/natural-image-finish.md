# Natural Image Finish

Use this optional stage to reduce overly uniform smoothing in an approved photographic plate or scene. It is a restrained local finishing pass, not a new generation provider and not an AI-detector evasion feature.

## Runtime Preparation

Installation and skill updates must detect and prepare the dependencies:

```bash
npm run prepare:natural-image-runtime
```

The preparation script:

- detects Python 3.10 or newer.
- detects FFmpeg and attempts an OS-appropriate package-manager installation when it is missing.
- creates an isolated virtual environment under the Codex runtime root.
- installs NumPy, Pillow, and headless OpenCV from `runtime/natural-image-finish/requirements.txt`.
- runs an import and FFmpeg self-check and records the requirement hash and versions.

Normal production must only run the readiness check. It must not install packages while an image task is active:

```bash
npm run check:natural-image-runtime
```

If the runtime is missing or stale, stop this optional stage with a blocked reason and preserve the approved source asset. Prepare it through the skill install/update flow before retrying.

Blocked attempts write `qa/natural-image-finish-attempt.json`, not a passing gate report or lineage record. Because the stage is optional, an ineligible asset may continue unchanged after the attempt is recorded; do not let a skipped finish invalidate an otherwise approved image.

## Eligibility Gate

Allowed inputs:

- approved provider-generated or real photographic scenes.
- approved text-free product hero/detail photos with no alpha channel.
- run-local assets whose product identity has already been visually reviewed when source identity applies.

Blocked inputs:

- any image with visible buyer-facing, localized, personalized, label, model, warning, packaging, or logo text.
- transparent or partially transparent product cutouts.
- infographics, comparison cards, parameter cards, typography layouts, or white-card composites.
- unapproved generation output or an asset outside the current run scope.
- canonical surface material that has not completed its transfer review.

Run the finish before local typography. If an image needs exact text, finish the blank photographic plate first, then apply the exact text compositor and run the normal text-layout and final visible-text reviews.

## Execution

```bash
npm run finish:natural-image -- \
  --run-dir /abs/run \
  --input /abs/run/generated-assets/approved-scene.png \
  --output /abs/run/final-images/IMG-01-lifestyle-scene.png \
  --role lifestyle_scene \
  --approved-source true \
  --contains-visible-text false \
  --preset light
```

`light` is the default production preset. Use `medium` only after a visual comparison shows that the image remains sharp and commercially clean. `strong` requires explicit visual review and should be rare.

The Python processor uses a deterministic seed derived from the approved input unless `--seed` is supplied. It applies bounded Gaussian sensor noise, restrained micro blur, unsharp detail recovery, micro contrast/brightness, and a light FFmpeg grain/encode pass. It never overwrites the approved source.

## Required Evidence

The runner writes:

```text
qa/natural-image-finish-<asset>.json
qa/natural-image-finish-gate-report.json
export/final-image-lineage.json
```

The lineage record must use:

```json
{
  "source_type": "derived_from_approved_generated_asset",
  "transformation_type": "natural_image_finish",
  "render_method": "local_photographic_finish",
  "natural_finish_proof": "qa/natural-image-finish-<asset>.json",
  "claims_new_scene_asset": false,
  "requires_identity_review": true
}
```

After the final image is selected, rerun identity consistency when source identity applies, final visible-text review when any later compositor adds text, image export, final image lineage, artifact integrity, and Final Delivery Gate.
