# Scene Asset Production

Use this reference whenever the user requests 场景图, 上身图, 模特图, lifestyle, outfit, commute, street, cafe, date, travel, or other product-in-context images.

## Core Rule

A scene image is not a product cutout placed on a styled layout. A final scene image must show the product integrated into a believable environment, outfit, surface, hand-held moment, model styling, or product-use situation.

For product-bearing scenes, prepare a GPT built-in image generation prompt with source image references and the Product Identity Lock. In Codex chat/project contexts, execute the prompt through the system `imagegen` skill / built-in `image_gen` tool when available. If runtime execution is unavailable, output the scene request pack as fallback evidence and mark the scene as blocked, not final.

## Minimum Scene Pack

When a Pinduoduo 8-image set says `含场景图`, include at least two true scene roles:

- wearing/outfit scene: on-body, shoulder, crossbody, hand-held, mirror, dressing, or styled outfit context.
- lifestyle environment scene: cafe, commute, shopping street, campus, office, weekend outing, date, travel, or tabletop use moment.

For women bags, a good default scene mix is:

- coffee shop/date scene with warm daylight, soft outfit, seated or walking pose, bag visible at natural scale.
- commute/street/shop-window scene with coat, knitwear, skirt, or casual outfit, bag carried naturally.
- optional daily-carry tabletop scene only when it shows real props and does not imply unsupported capacity.

## Scene Request Fields

Each scene request must include:

```yaml
scene_asset_requirement: true_scene_asset
scene_asset_type: gpt_built_in_product_in_scene
source_image_refs: []
identity_lock_ref:
scene:
  setting:
  moment:
  model_or_body_context:
  outfit_context:
  lighting:
  camera:
  product_placement:
  scale_relationship:
  props:
must_preserve_product_identity: []
allowed_scene_changes: []
forbidden_scene_changes: []
final_delivery_allowed_only_if:
  - runtime_generated_scene_asset_exists
  - source_image_reference_was_used
  - identity_consistency_gate_passed
  - scene_is_not_layout_placeholder
```

## Hard Failures

Fail the blueprint, generation prompt, or marketing gate if:

- a scene role has no generated or photographed scene asset.
- a scene role only reuses the source product cutout on a beige/card layout.
- a scene role uses abstract rectangles, icon people, silhouettes, fake UI cards, or plain background blocks as the scene.
- the product floats unnaturally without contact, scale, strap tension, hand/shoulder relation, tabletop contact, or environmental interaction.
- all scene roles use the same product angle.
- scene copy says the scene is generated, illustrative, draft, or internal QA.

## Renderer Boundary

The deterministic renderer may add text, crop, frame, and export independent image files. It must not fabricate a final scene by itself.

For scene roles, the renderer needs a panel-specific `image`, `image_path`, `generated_asset_path`, or `scene_asset_path` that points to an approved generated/photo scene asset. Without that asset, the renderer should fail or output only a layout draft.
