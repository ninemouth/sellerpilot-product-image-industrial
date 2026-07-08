# Source Image Quality

Run source-image preflight before source product understanding, product fact extraction, and scene generation.

If multiple source images are provided, first build a source image set manifest:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/build-source-image-set.mjs \
  --images "/abs/front.png,/abs/detail.png,/abs/side.png" \
  --out-dir /abs/run \
  --category "商品类目"
```

Use `references/multi-source-image-fusion.md` to classify each image role and fuse complementary evidence into the Product Identity Lock.

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

Use the enhanced image for product parsing, deterministic layouts, and GPT built-in image generation references. Do not treat enhancement as proof of new product facts.

When multiple source images exist, enhance each user-owned source image, but keep role labels and evidence boundaries separate. Do not merge conflicting images into one invented product.

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

After enhancement, run source product understanding. The image may contain text, labels, tags, packaging, dimensions, warnings, installation callouts, model names, or scale cues that are product facts, not decorative pixels.

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
