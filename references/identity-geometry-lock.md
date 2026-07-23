# Identity Geometry Lock

Use this reference whenever generated images must preserve product proportions: apparel, bags, shoes, furniture, tools, industrial products, or any source product where shape/length/fit matters.

## Rule

Color and logos are not enough. Preserve source product geometry:

- garment or product length class
- hemline or bottom edge position
- collar-to-hem or top-to-bottom ratio
- shoulder/body width ratio
- sleeve length class
- neckline shape
- silhouette class
- pocket, panel, handle, strap, hardware, and opening positions
- for bags: body class, top opening shape, bottom/side curvature, strap or handle route, panel proportions, lining visibility, and source-supported scale

For apparel, never shorten a normal jersey/shirt into a crop top unless the source is already cropped or the user explicitly asks for that change.

For bags, never change the source body class. A bucket bag must not become a generic tote, clutch, hard-shell purse, leather-like luxury bag, or any other bag silhouette unless the source or user explicitly supports that change. Printed or woven fabric bags also require a surface material lock for the canonical motif and texture.

## Annotation

Create:

```text
geometry/source-geometry.json
geometry/generated-geometry.json
```

Example:

```json
{
  "geometry_lock": {
    "product_type": "sports jersey",
    "garment_length_class": "normal jersey length",
    "hem_position": "below waist / upper hip",
    "collar_to_hem_ratio": 1.0,
    "shoulder_width_to_body_length_ratio": 0.72,
    "sleeve_length_class": "short sleeve",
    "silhouette_class": "slightly fitted straight jersey",
    "forbidden_geometry_changes": [
      "shortening a normal jersey/shirt into a crop top",
      "moving hemline upward without source evidence"
    ]
  }
}
```

Run:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/identity-geometry-gate.mjs \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --generated-geometry /abs/run/geometry/generated-geometry.json \
  --out-dir /abs/run/qa
```

## Routing

If geometry fails:

- keep approved images
- regenerate only failed assets
- tighten prompt with concrete geometry fields
- prefer source-image reference and source crop/composite for detail views
- ask for extra angles only if the missing geometry cannot be inferred safely
