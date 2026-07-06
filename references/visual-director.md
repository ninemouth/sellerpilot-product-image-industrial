# Visual Director

Use this reference whenever the output includes generated or rendered product images. The visual director is responsible for image design, photography details, camera angle, lighting, scene, prop logic, and shopper-facing copy fit.

## Role Boundary

The visual director does not invent product facts. It turns confirmed facts, product feature analysis, audience positioning, platform/category research, and product positioning into a shot plan that can be generated, rendered, reviewed, and revised.

## Required Visual Direction Brief

Create `04-visual-direction-brief.yaml` before full image generation:

```yaml
visual_strategy:
  platform:
  category:
  audience:
  tone:
  conversion_intent:
shot_matrix:
  - image_index:
    image_role:
    final_asset_type:
    buyer_question:
    camera_angle:
    crop_type:
    focal_subject:
    background_or_scene:
    lighting:
    props_or_model_context:
    product_orientation:
    required_detail_difference:
    buyer_facing_message:
    graphic_design_intent:
    photography_style_archetype:
    micro_detail_preservation:
    scene_asset_requirement:
    scene_asset_status:
    forbidden_internal_language: []
copy_policy:
  voice:
  banned_internal_phrases: []
  claim_boundaries: []
generation_notes:
  generate_first:
  reuse_allowed:
  rerender_only:
  stop_conditions:
```

## Shot Matrix Rules

- Every image needs a distinct buyer question, such as "What does it look like?", "How big is it?", "How does it match outfits?", "Can it hold my daily items?", or "What detail makes it feel worth buying?".
- Every detail shot should map to a product feature analysis item, and every scene shot should map to an audience positioning scene trigger or purchase objection.
- Do not repeat the same camera angle for most of the set without a commercial reason. Same-angle product photography is acceptable when each image changes environment, surface, prop/model context, lighting, placement, occasion, buyer question, or commercial task, such as a consistent front 3/4 bag angle across white studio, warm tabletop, hand-held commute, and evening outfit scenes.
- Detail grids must not reuse the same crop four times. Each detail tile needs a different focal subject and crop: zipper pull, hardware connection, stitching edge, strap attachment, interior opening, texture, bottom/side profile, accessory, etc.
- Scene images need actual scene logic: setting, surface, outfit or model context, lighting, and product placement. A white-background cutout with a scene title is not a scene image.
- Scene images need a final scene asset plan. Use `final_asset_type: generated_scene_asset` or another real photo/generated scene asset type; do not mark a layout-only panel as a final scene.
- For women bags, scene images should show believable styling contexts such as cafe/date, commute/street, shop-window, campus, office, or warm tabletop use. Include outfit, body/hand/shoulder relationship, strap direction, product scale, and lighting.
- Flat silhouettes, icon people, abstract rounded UI blocks, or generic placeholders do not count as final scene imagery.
- Use lighting intentionally: soft daylight, clean studio, warm indoor, commuting daylight, storefront light, vanity/tabletop light, etc.
- Select a photography style archetype for each image from `references/commercial-photography-master-styles.md` or an equivalent master-level archetype. Do not use generic labels only.
- Props must support scale or use context and must not imply unverified bundle contents or capacity.
- Graphic design must be role-specific. Do not reuse the same translucent rounded heading card or corner badge across most images.
- Final outputs must not include platform-pack labels, arbitrary watermarks, AI/system marks, or internal production labels.
- If the source image does not show product interior, do not direct an interior/capacity-open-bag shot as if it were factual. Use beside-product scale items or request interior source images.
- When dimensions are provided, measurement shots must use numeric labels rather than vague arrows alone.
- For logos, tags, engravings, charm faces, or tiny text, use the `micro_detail_lock`. If the detail is unclear, direct the generator to preserve placement/shape/contrast as an unreadable mark, not to invent readable text.

## Buyer-Facing Copy

Final image text is for shoppers, not internal staff.

Do not use internal review language in final images:

- "不虚标"
- "功能待确认"
- "以源图为准"
- "示意"
- "平台要求"
- "合规"
- "QA"
- "风险"
- "证据不足"
- "未验证"

Keep internal notes in the blueprint, QA report, or revision history. Convert them into buyer-facing language only when the fact is supported:

```text
Internal: 拉链 / 五金 / 走线 / 小熊挂件
Buyer-facing: 顺滑开合，细节更耐看

Internal: 不夸大材质
Buyer-facing: 质感细节近看也清楚

Internal: 容量展示仅作示意
Buyer-facing: 日常小物轻松收纳
```

## Gate Conditions

Fail the blueprint before generation when:

- The shot matrix has repeated camera angles without a reason, environment/prop/light variation, or distinct commercial task.
- Several detail tiles name different details but use the same crop or image.
- Scene roles have no environment, lighting, outfit/model, tabletop, or prop plan.
- Scene roles have no `scene_asset_requirement`, `scene_asset_status`, or executable scene-generation prompt.
- Scene roles rely on placeholder silhouettes or abstract graphics rather than real scene assets.
- Scene roles rely on the same source product cutout inside a decorative layout and have no approved generated/photo scene asset.
- Detail roles cannot name source-backed detail evidence for each crop.
- Final copy talks to internal reviewers instead of shoppers.
- Final image design includes watermark-like platform-pack labels or internal system marks.
- The set relies on repeated translucent-card layout instead of image-role-specific design.
- Photography treatment is generic and lacks camera/lens/light/scene/body relationship details.
- Micro-detail prompts would invent readable logos, tag text, engravings, or new patterns from unclear source evidence.
- Any message depends on facts not present in the Product Fact Sheet.
