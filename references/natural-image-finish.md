# Adaptive Natural Image Finish

Every formally generated image in the current run's `export/final-images-manifest.json` must pass this batch before the final marketing, export, lineage, artifact-integrity, and delivery gates. The purpose is to reduce over-uniform smoothing, plastic-looking texture, and excessively clean digital rendering while preserving product truth, exact text, transparency, dimensions, and upstream lineage. It is not a new generation provider and must not be described or tuned as AI-detector evasion.

## Runtime Preparation

Installation and skill updates detect and prepare the dependencies automatically:

```bash
npm run prepare:natural-image-runtime
```

The preparation script:

- detects Python 3.10 or newer.
- detects FFmpeg and attempts an OS-appropriate package-manager installation when it is missing.
- creates an isolated virtual environment under the Codex runtime root.
- installs NumPy, Pillow, headless OpenCV, and SciPy from `runtime/natural-image-finish/requirements.txt`.
- runs import, classification, alpha, text-protection, and FFmpeg self-checks.
- records requirement and processor hashes so source changes make an old runtime fail closed.

Normal production only checks readiness:

```bash
npm run check:natural-image-runtime
```

Production must never install dependencies into the global Python environment. If the isolated runtime is missing or stale, preserve all generated images, block this required stage, and prepare the runtime through the skill installation/update flow.

## Complete-Set Contract

User-facing invocation should be short. These are enough:

```text
让这批图更自然。
继续这个历史任务，只做自然质感收尾，不重生图。
独立测试自然质感能力。
```

Do not require the user to describe FFT, profiles, noise, blur, sharpening, lineage, or gate reruns. Those are internal execution details and proof fields. The natural finish is not part of the provider generation prompt; it runs after final images exist, or as an isolated processor test when explicitly requested.

Run the batch after all current final images exist and product/background consistency has passed:

```bash
npm run finish:natural-image-batch -- \
  --run-dir /abs/run
```

The batch reads only the current run manifest, or the current run's exact `final-images/` directory when a manifest has not yet been created. It must not scan a shared output directory, a date-level parent, or another run.

The processor combines structured role, title, scene, usage, and visible-copy metadata with pixel metrics. It selects one bounded profile per image:

| Profile | Typical input | Processing policy |
| --- | --- | --- |
| `photographic_scene` | lifestyle, use-case, outdoor/interior scene | signal-dependent luminance/chroma grain, restrained tone curve, bounded detail recovery, conditional periodic artifact repair |
| `studio_product` | hero, main product, clean studio or white background | lighter material-aware grain, product-edge restraint, high-threshold periodic artifact repair only |
| `macro_detail` | material, stitch, hardware, texture close-up | minimal blur, stronger detail retention, fine grain, very high-threshold artifact repair |
| `graphic_text` | parameter, comparison, instruction, infographic, text card | very conservative frame processing, detected text pixels restored, no FFmpeg grain or FFT repair over exact text |
| `transparent_asset` | transparent or partially transparent PNG | alpha retained exactly, conservative RGB processing, alpha-safe encoding, no FFT repair |
| `hybrid_commerce` | mixed product photography and graphic composition | balanced low-strength finish with role-aware protection and conservative artifact diagnostics |

The spectral layer is diagnostic-first. It records radial power samples, high-frequency roll-off, directional anisotropy, and periodic peak scores. FFT notch attenuation is allowed only for visible periodic artifacts such as banding, grid-like repetition, or ringing that exceed the current profile threshold. It must not be tuned or described as suppressing generic AI fingerprints, and the skill must not add CLIP-based adversarial perturbations or other detector-targeted changes.

`--profile auto` is the production default. Manual `--noise` and `--blur` overrides are diagnostic tools and should not replace adaptive classification across a normal set.

## Transaction And Recovery

Before processing, immutable originals are stored under:

```text
generated-assets/natural-finish-originals/
```

Every output is first written under `generated-assets/natural-finish-staging/`. The batch promotes results only after every manifest image has a passing proof and unchanged dimensions. If processing or promotion fails, the final set remains/restores to its original hashes; do not accept partial finishing and do not regenerate the provider assets merely to recover this local stage.

Re-running an unchanged completed batch returns `already_applied` and does not encode the images again. `--force` is reserved for a deliberate profile/classifier update and still reads from the preserved originals.

## Visible Text Review

Visible text does not exempt an image from the batch. `graphic_text` processing protects detected text pixels and uses a conservative full-frame restoration fallback when reliable regions cannot be isolated. Because JPEG/WebP encoding and complex raster text still need visual confirmation, the batch initializes:

```text
qa/post-natural-finish-visible-text-review.json
```

Textless batches write `status: not_required`. Batches with visible text write `status: needs_visual_review` and list the exact current hashes. After Codex visual inspection or another explicit review method, provide structured evidence:

```json
{
  "reviewer_method": "codex_visual_inspection",
  "images": [
    {
      "file": "IMG-04-parameter-card.png",
      "status": "pass",
      "reviewed_sha256": "<current-final-image-sha256>",
      "notes": "All visible text remains exact, legible, and free of artifacts."
    }
  ]
}
```

Then canonicalize and validate it:

```bash
npm run qa:post-natural-finish-text -- \
  --run-dir /abs/run \
  --evidence /abs/run/qa/post-finish-review-evidence.json
```

Every visible-text final must be present, pass, record a reviewer method, and match both the current final hash and the batch output hash. Any later image replacement invalidates the review and blocks Final Delivery Gate.

## Required Evidence

Successful processing writes:

```text
generated-assets/natural-finish-originals/backup-manifest.json
qa/natural-image-finish-batch-report.json
qa/natural-image-finish-gate-report.json
qa/natural-image-finish-<asset>.json
qa/post-natural-finish-visible-text-review.json
export/final-image-lineage.json
export/final-images-manifest.json
```

Every final lineage record must keep its upstream provider, repaired, derived, or local-text-overlay facts while adding:

```json
{
  "transformation_type": "natural_image_finish",
  "natural_finish_proof": "qa/natural-image-finish-<asset>.json",
  "natural_finish_batch_proof": "qa/natural-image-finish-batch-report.json",
  "adaptive_profile": "graphic_text",
  "contains_visible_text": true,
  "text_protection_applied": true,
  "output_sha256": "<sha256>",
  "claims_new_scene_asset": false
}
```

After the batch and any required text review, rerun identity consistency when source identity applies, final image lineage, marketing, image export, artifact integrity, and Final Delivery Gate. A full-manifest batch pass is required; a collection of individually processed subset proofs is not sufficient.
