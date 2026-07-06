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

1. Classify each image by evidence role.
2. Enhance every user-owned source image deterministically.
3. Build a `source-image-set-manifest.json`.
4. Build or update `02-identity-lock.yaml` using all user-owned source evidence.
5. Prefer the best source image for each generated image role:
   - main image: primary identity/front image
   - detail image: detail evidence image or source crop
   - packaging/logo image: packaging/logo evidence
   - scene image: primary identity image plus relevant side/detail references
6. If source images conflict, mark the conflict and ask for confirmation before final generation.

## Fusion Manifest Schema

```json
{
  "source_images": [
    {
      "path": "...",
      "enhanced_path": "...",
      "role": "primary_identity|front|side|back|detail|packaging|logo|scene|duplicate|competitor_reference|unknown",
      "quality_findings": {},
      "identity_evidence": [],
      "use_for": []
    }
  ],
  "primary_identity_image": "...",
  "best_detail_sources": [],
  "best_packaging_sources": [],
  "conflicts": [],
  "missing_angles": []
}
```

## Realistic Enhancement Policy

Enhancement may clean lighting, orientation, sharpness, resolution, and color balance. It must not invent missing structure, material, logo, hardware, or accessories.

When several images show complementary details, use them as reference evidence; do not blend them into one impossible product if they conflict.

## Stop Conditions

Stop and ask for user confirmation when:

- images appear to show different products
- color/material differs across images in a way that affects final output
- logo/packaging conflicts
- key details are hidden in all images
- only competitor images are available
