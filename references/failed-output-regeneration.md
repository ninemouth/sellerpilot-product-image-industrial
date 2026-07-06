# Failed Output Regeneration

Use this reference when a generated image set looks repetitive, contact-sheet-like, fake, unreadable, or visually weaker than the source product photo.

## Failure Diagnosis

Do not defend a poor output. First classify the failure:

```yaml
failed_output_review:
  status: fail
  failure_types:
    - contact_sheet_used_as_final
    - product_subject_too_small
    - fake_or_placeholder_scene
    - repeated_cutout
    - weak_detail_crops
    - unreadable_or_generic_copy
    - watermark_or_platform_pack_label
    - weak_graphic_design_system
    - generic_photography_style
    - unclear_micro_detail_or_invented_mark
    - unsupported_capacity_or_dimension
    - platform_fit_weak
  keep_assets: []
  regenerate_assets: []
  rerender_only: []
  stop_conditions: []
```

## Non-Negotiable Rejection Rules

Fail the output if any of these are true:

- The delivered "image" is a contact sheet, collage preview, or multi-panel overview instead of independent export files.
- A lifestyle/wearing scene uses a flat silhouette, icon person, placeholder body, or generic illustration instead of a real generated/photographed scene asset.
- Product subject is too small to inspect in a main, scene, or decision image.
- Detail panels are blank, cropped from unrelated whitespace, or show the same area with different labels.
- Text is too small to read at mobile thumbnail size.
- Final image contains arbitrary watermark-like text, platform-pack corner labels, `拼多多女包套图`, `拼多多套图`, `女包套图`, `PDD`, `SellerPilot`, `Codex`, `AI生成`, `样图`, `示例图`, or `仅供参考`, unless the user explicitly requested that exact visible mark and the run recorded `watermark_authorization.status: user_explicitly_requested`.
- Most images reuse the same flat design device, translucent heading card, badge layout, or corner label without role-specific visual design.
- Photography direction is only `高级商拍`, `电商风`, or another generic label instead of a master-level archetype with lens, light, crop, scene/body relation, and audience fit.
- A closeup or scene image turns unclear source details into readable brand text, new logo marks, new charm faces, invented engravings, or unsupported decorative micro-patterns.
- Scene images are just the source cutout with background shapes, icons, or labels.
- Capacity images imply an opened/interior bag when no source evidence shows interior structure.
- Measurement images use vague arrows without confirmed numeric dimensions when dimensions are available.
- The set only changes headings while keeping essentially the same product composition.

## Regeneration Strategy

Regenerate the smallest failing unit:

- Contact sheet failure -> export independent images and optionally a separate preview contact sheet.
- Fake scene failure -> generate or source real scene asset first; then compose text/layout.
- Product too small -> rerender layout with minimum product coverage.
- Detail failure -> use source-evidence crops or request better detail images; do not invent details.
- Copy failure -> rewrite copy before rerendering layout.
- Watermark/platform-pack label failure -> return to `graphic-design-direction`, remove visible marks, or record exact user authorization before design only if the user explicitly requested the mark; then rerender affected layouts only.
- Weak graphic design failure -> return to `graphic-design-direction` and `layout-wireframes`, rebuild hierarchy, safe zones, layout rhythm, and set variation before rerendering.
- Generic photography failure -> return to `commercial-photography-treatment`, choose a master-level archetype and specify lens/light/body/scene/product placement before regenerating affected assets.
- Unclear micro-detail failure -> return to `product-identity-lock`; ask for a closeup only when commercially important, otherwise preserve placement/shape/contrast as an unreadable mark.
- Identity drift -> tighten Product Identity Lock and regenerate only the failed image.

## Product Coverage Heuristic

Use these minimums unless the platform/category overlay says otherwise:

- Main product image: product should occupy about 50-70% of canvas height/visual area.
- Size/scale image: product should remain large enough to inspect; measurement arrows must not dominate.
- Detail image: each crop should visibly show a different source-backed detail.
- Scene image: product must remain clearly visible and recognizable, not just decorative.
- Decision summary: product plus key callouts must be readable on mobile.

## Scene Authenticity

For scene images, "scene" means environment plus product placement:

- person wearing or holding the product
- tabletop, entryway, commute, shopping, office, coffee shop, or other real context
- lighting and perspective matching the environment
- product identity preserved

Icons, rounded rectangles, flat silhouettes, mock UI shapes, or abstract blocks do not count as final scene images.
