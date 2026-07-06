# Main Image And Detail Page Production Structure

Use this reference when the user asks for Chinese ecommerce main images, posters, detail pages, or a complete product visual pack.

## Confirmation Gate

If the product, platform, market, image count, or usage surface is unclear, first output a concise Product Information Confirmation Table. Do not invent missing product facts.

Proceed when the user confirms, supplies missing facts, or explicitly says to decide defaults.

## Numbering

For main-image plus detail-page production, use stable IDs:

- `IMG-01-main-product`: first/click image
- `IMG-02-core-benefits`: core selling-point image
- `IMG-03-use-scene`: use-scene image
- `IMG-04-detail-quality`: detail-quality image
- `IMG-05-decision-summary`: decision-push image
- `POSTER-01-campaign-poster`: marketing poster
- `DETAIL-01-benefit-hero`: detail page first-screen benefit
- `DETAIL-02-user-pain-points`: user pain point
- `DETAIL-03-product-solution`: product solution
- `DETAIL-04-benefit-breakdown`: core benefit breakdown
- `DETAIL-05-usage-scenes`: usage scenes
- `DETAIL-06-detail-quality`: detail quality
- `DETAIL-07-trust-comparison`: comparison/trust enhancement
- `DETAIL-08-purchase-summary`: purchase-reason summary

User-specified platform image counts may override this set, but exported files still need stable IDs.

## File Naming

Every exported image filename must include:

```text
<stable-id>-<english-purpose-slug>.<ext>
```

The description after the stable ID must be English words in lowercase kebab-case. Do not use only `IMG-01.png`, `POSTER-01.png`, or `DETAIL-01.png`.

Examples:

```text
IMG-01-main-product.png
IMG-02-core-benefits.png
IMG-03-lifestyle-use-scene.png
IMG-04-hardware-details.png
IMG-05-decision-summary.png
POSTER-01-campaign-poster.png
DETAIL-01-benefit-hero.png
DETAIL-02-user-pain-points.png
DETAIL-03-product-solution.png
DETAIL-04-benefit-breakdown.png
DETAIL-05-usage-scenes.png
DETAIL-06-detail-quality.png
DETAIL-07-trust-comparison.png
DETAIL-08-purchase-summary.png
```

For platform-specific sets with more than five listing images, continue the same pattern:

```text
IMG-06-size-scale.png
IMG-07-package-contents.png
IMG-08-brand-trust-summary.png
```

Chinese copy may appear inside the image when appropriate, but filenames and asset IDs must use English slugs for portability across tools, review pages, and SellerPilot migration.

## Main Image Rules

- Each main image is independent, not a contact sheet unless requested.
- Default square size: 1080x1080 or higher.
- Product should be visually dominant on `IMG-01`, typically 50-70% of the canvas when platform allows.
- Keep titles short and buyer-facing.
- Avoid dense small text inside generated images; add complex Chinese copy during deterministic layout when possible.

## A-H Editable Regions

Every generated image should have editable region metadata:

- A: product subject
- B: background
- C: main title
- D: subtitle
- E: selling-point labels
- F: decoration
- G: people/scene
- H: overall style

Use these regions for review feedback and revision briefs.

## Revision Principles

- Modify only the specified image or module.
- Product inconsistency: revise A region first and preserve Product Identity Lock.
- Copy issue: revise C/D/E regions.
- Style issue: preserve product and copy; adjust B/F/H.
- Scene issue: revise G and B while preserving product identity.
- Clutter issue: reduce F/E, increase whitespace, and keep buyer-readable hierarchy.
