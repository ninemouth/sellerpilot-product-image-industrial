# Source Image Quality

Run source-image preflight before source product understanding, product fact extraction, and scene generation.

For every source-backed compiled run, prepare the reference manifest first:

```bash
npm run prepare:source-references -- \
  --run-dir /abs/run
```

The command reads `planning/normalized-task.json` and writes `source-preflight/reference-assets-manifest.json` plus `source-reference-index.json`. It never modifies the user's files. Each input receives:

- a byte-identical run-local `analysis_path` under `source-original/`;
- a `provider_path`, which reuses that original when it already fits;
- a high-quality derivative under `source-prepared/` only when bytes, dimensions, or format require it;
- before/after bytes, dimensions, format, hash, alpha/lossy status, and preparation reason.

Standard references default to an 8 MB/4096 px preparation threshold and a 6 MB target. Detail/logo/canonical material references retain a higher 12 MB/6144 px threshold and 10 MB target. Provider capabilities still impose the final request boundary. These defaults are quality-preserving upload controls, not permission to upscale or discard originals.

## Required Checks

- Resolution and aspect ratio.
- Product visibility and cropping.
- Lighting or color cast.
- Background clutter.
- Blur or compression artifacts, by visual inspection when necessary.
- Whether the image is a product identity source, detail source, packaging source, or competitor reference.

## Deterministic Enhancement

Use the bundled enhancer for low-quality seller photos:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/enhance-source-image.mjs \
  --input /abs/source.png \
  --out-dir /abs/run/source-enhanced
```

Outputs:

```text
source-enhanced.png
source-quality-report.json
```

Use the analysis original for deep product understanding and visible-text reading. Use an enhanced image only when visual quality needs deterministic cleanup; use the prepared provider variant for provider upload. Do not treat enhancement or compression as proof of new product facts.

Do not enhance or re-encode every source by default. When multiple source images exist, inspect every original, selectively enhance only images that need it, keep role labels/evidence boundaries separate, and do not merge conflicting images into one invented product.

## Source Asset Normalization

For white cards, parameter cards, comparison cards, feature cards, and clean marketplace infographics, do not place the flattened user source image directly into a card if it carries a gray/white rectangular backdrop.

After enhancement, create a layout-safe product master:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/normalize-source-product-asset.mjs \
  --input /abs/run/source-enhanced/source-enhanced.png \
  --out-dir /abs/run/source-normalized \
  --card-color "#ffffff"
```

Outputs:

```text
source-normalized/product-cutout-transparent.png
source-normalized/product-on-card-safe.png
source-normalized/product-normalization-report.json
```

Use `product-cutout-transparent.png` for card and infographic layouts when alpha is reliable. Use `product-on-card-safe.png` only when the renderer cannot preserve alpha. Keep the original/enhanced source image for product understanding, visible-text reading, and identity evidence.

Fail or send to visual review when:

- product edges are white, reflective, transparent, hairy, perforated, blade-like, or otherwise hard to cut out.
- the source image background remains visible as a rectangle inside a card.
- the product asset has no alpha and its edge background differs from the card color.
- the panel lacks a transparent/card-safe product asset or normalization report.

## Source Product Understanding

After reference preflight, run source product understanding against every manifest `analysis_path`. The images may contain text, labels, tags, packaging, dimensions, warnings, installation callouts, model names, or scale cues that are product facts, not decorative pixels.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-source-product-understanding.mjs \
  --image /abs/run/source-enhanced/source-enhanced.png \
  --out-dir /abs/run/source-understanding \
  --category "商品类目"
```

Then complete the Codex visual read, run OCR only if text is visible or uncertain, and run the gate:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/source-product-understanding-gate.mjs \
  --understanding /abs/run/source-understanding/source-product-understanding.json \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml \
  --physical-truth /abs/run/blueprint/02b-product-physical-truth.json \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --out-dir /abs/run/qa
```

Use `references/source-product-understanding.md` for the full product-recognition and visible-text propagation rules.

## When To Generate Scene Assets

If source photos are low quality, cluttered, or handheld:

- Preserve them as evidence for shape, color, structure, and visible accessories.
- Generate or create clean product/lifestyle scene assets before final layout.
- Label generated scene assets as generated examples, not real photos.
- Ask for seller confirmation when product identity changes in generated scenes.
