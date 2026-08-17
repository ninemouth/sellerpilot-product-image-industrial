# Multi Source Image Fusion

Use this reference when the user provides multiple product images. Multiple images should complement each other instead of being treated as duplicates.

## Goal

Build a more complete product identity and more faithful enhancement by assigning each source image an evidence role:

- primary identity image
- front view
- side view
- back view
- top/bottom view
- detail evidence
- packaging/logo evidence
- scale/capacity evidence
- lifestyle/user-provided scene evidence
- low-quality duplicate
- competitor/reference only

## Workflow

1. Run `prepare-source-references.mjs`. It fingerprints every input, preserves a run-local byte-identical original, inspects dimensions/format/alpha, and creates a provider upload derivative only when the file exceeds the applicable byte/dimension policy or needs format normalization.
2. Deeply inspect every `analysis_path` original. Do not use a compressed provider variant as the only product-understanding evidence.
3. Classify each image by product membership and evidence role. A filename classification is provisional until visual review confirms it.
4. Write three bounded artifacts:
   - `source-product-understanding.json`: full visual/text/physical audit evidence;
   - `source-reference-annotations.json`: one complete record per `source_id`, including membership, confirmed role, unique contribution, confidence, micro-detail risk, and conflicts;
   - `source-evidence-summary.json`: compact confirmed facts, unknowns, prompt/QA constraints, per-source contributions, and role routing by `source_id` only.
5. Pass `source-evidence-summary-gate.mjs`. Missing source coverage, unresolved conflicts, competitor routing, embedded image bytes/paths, or a summary over 12 KB blocks prompt work.
6. Build or update `02-identity-lock.yaml` using all user-owned source evidence.
7. At generation time, select the best source image(s) for that single output role:
   - main image: primary identity/front image
   - detail image: detail evidence image or source crop
   - packaging/logo image: packaging/logo evidence
   - scene image: primary identity image plus relevant side/detail references
   The default cap is two references per request; a provider/runtime may lower it to one. Never attach all source images merely because they exist.
8. If source images conflict, resolve the conflict or ask for confirmation before final generation.

## Fusion Manifest Schema

```json
{
  "schema_version": "sellerpilot.reference_assets_manifest.v1",
  "sources": [
    {
      "source_id": "SRC-01",
      "product_membership": "user_owned_product|competitor_reference|unknown",
      "provisional_role": "primary_identity|front|side|back|top|bottom|interior|detail|packaging|logo|scene|surface_material|competitor_reference|unknown",
      "analysis_path": "source-original/SRC-01-original.jpg",
      "provider_path": "source-original/SRC-01-original.jpg",
      "provider_variant": {
        "decision": "reuse_original|prepared_derivative",
        "bytes": 0,
        "lossy": false
      }
    }
  ]
}
```

Every generation role also writes `generated-assets/reference-selection-img-xx.json`. This is the auditable proof of which prepared references were sent, why they were selected, which inputs were excluded, and which count/byte limits applied.

## Realistic Enhancement Policy

Reference upload preparation is not aesthetic enhancement. A compatible input inside its threshold is reused without re-encoding. When preparation is required, preserve alpha for transparent/canonical material sources and use high-quality 4:4:4 JPEG for opaque sources. The original remains the evidence source. Separate aesthetic enhancement may clean lighting, orientation, sharpness, resolution, and color balance, but it must not invent missing structure, material, logo, hardware, or accessories.

When several images show complementary details, use them as reference evidence; do not blend them into one impossible product if they conflict.

## Stop Conditions

Stop and ask for user confirmation when:

- images appear to show different products
- color/material differs across images in a way that affects final output
- logo/packaging conflicts
- key details are hidden in all images
- only competitor images are available
