# Prompt Layering Subloop

Use this reference before final generation prompt delivery and after commerce strategy, creative direction, photography treatment, and layout sketches exist.

## Core Idea

The final generation prompt should be built by a Prompt Layer Architect Brain. The brain decides which layers are required for the specific product, platform, audience, scene, risk, and image role. It must always include mandatory base layers, then add optional layers only when the product/run needs them.

Do not make prompts better by simply making them longer. Make prompts better by separating layers, checking layer conflicts, and revising only the failed layer.

## Prompt Layer Architect Brain

The brain owns:

- deciding the layer count for each image role.
- selecting mandatory and conditional layers.
- ordering layers by priority.
- compressing layer outputs into a final request.
- detecting conflicts across layers.
- locking approved layers.
- routing failures back to the responsible layer or upstream artifact.

The brain must record its decision:

```yaml
prompt_layer_architect:
  decision_basis:
    product_category:
    platform:
    image_role:
    audience:
    scene_complexity:
    identity_risk:
    claim_risk:
    layout_complexity:
    runtime_generation_available:
  mandatory_layers: []
  conditional_layers: []
  omitted_layers:
    - layer:
      reason:
  layer_order: []
  locked_layers: []
  conflict_notes: []
```

## Mandatory Base Layers

Every product-bearing final request must include:

1. `execution_contract_layer`
   - provider, model capability, execution boundary, output filename, image role.

2. `product_identity_layer`
   - source image references, identity lock, must-preserve fields, forbidden product changes.

3. `fact_boundary_layer`
   - supported claims, uncertain facts, prohibited claims, required user confirmations.

4. `commerce_goal_layer`
   - buyer question, conversion-intent task, success criteria, reject-if criteria.

5. `context_layer`
   - platform, locale, category, audience, price band, season/occasion, marketplace tone.

6. `creative_concept_layer`
   - visual concept, mood, differentiation, color system, memory point.

7. `photography_treatment_layer`
   - camera, crop, lens feel, lighting, color temperature, scene/model/prop/product placement.

8. `layout_copy_layer`
   - layout intent, text policy, copy to include, safe zones, mobile readability.

9. `negative_qa_layer`
   - negative prompt, QA expectations, retry policy, failure routing hints.

## Conditional Layers

Add these only when needed:

- `scene_asset_layer`: required for scene, model, lifestyle, wearing, commute, cafe, street, date, travel, or tabletop scene roles.
- `detail_evidence_layer`: required for macro/detail/craft/material/hardware/texture images.
- `capacity_truth_layer`: required for capacity or storage images; block unsupported interior/capacity implications.
- `physical_function_layer`: required for installation, routing, holding, locking, clipping, screw mounting, adhesive, magnet, waterproofing, load, cable, wire, fixtures, moving parts, or other physical function/use-step images.
- `comparison_layer`: required for competitor-informed redesign, but must borrow patterns only.
- `season_event_layer`: required for seasonal, holiday, gift, back-to-school, summer/winter, or campaign images.
- `compliance_layer`: required for safety, children, pets, medical, certification, waterproof, fireproof, food-contact, or regulated claims.
- `localization_layer`: required for cross-border, multilingual, or platform-specific copy density.
- `brand_vi_layer`: required when a brand/VI/color/font system is supplied.

## Layer Design Principles

- Identity and fact layers override creative layers.
- Platform and compliance layers override copy/layout desires.
- Photography layer controls generated scene realism; layout layer controls ecommerce composition.
- Copy layer should not ask the image model to render dense Chinese text; add complex text during layout.
- Negative QA layer should prevent the most likely failures, not list every imaginable bad output.
- Conditional layers must be justified. Do not include unused layers.
- Approved layers should be locked across retries.

## Subloop

```text
1. Build prompt layer stack.
2. Run prompt layer gate.
3. If layer stack fails, revise the failed layer or upstream artifact.
4. Compress layers into final personalized generation prompt.
5. Execute through Codex-native imagegen/image_gen when available.
6. Run post-generation gates.
7. If output fails, route failure back to layer or upstream node.
8. Revise only the failed layer and regenerate only affected image.
```

## Failure-To-Layer Routing

```yaml
failure_to_prompt_layer:
  surface_material_transfer_drift:
    revise_layer: surface_material_transfer_layer
    return_node: surface-material-transfer
  identity_drift:
    revise_layer: product_identity_layer
    return_node: product-identity-lock
  unsupported_claim:
    revise_layer: fact_boundary_layer
    return_node: product-fact-sheet
  invented_product_function:
    revise_layer: physical_function_layer
    return_node: product-physical-truth-lock
  product_scale_drift:
    revise_layer: physical_function_layer
    return_node: visual-director
  no_commercial_task:
    revise_layer: commerce_goal_layer
    return_node: commerce-strategy-brief
  wrong_audience_or_platform_tone:
    revise_layer: context_layer
    return_node: audience-positioning-analysis
  weak_visual_concept:
    revise_layer: creative_concept_layer
    return_node: creative-direction-brief
  fake_scene_or_cutout:
    revise_layer: scene_asset_layer
    return_node: scene-asset-production
  weak_photography:
    revise_layer: photography_treatment_layer
    return_node: commercial-photography-treatment
  unreadable_or_bad_layout:
    revise_layer: layout_copy_layer
    return_node: layout-wireframes
  prompt_too_generic:
    revise_layer: prompt_layer_architect
    return_node: personalized-prompt-delivery
```

## Readiness

Final prompt delivery is blocked when:

- mandatory base layers are missing.
- a conditional layer is required but absent.
- two layers conflict without a recorded resolution.
- identity/fact layers are overridden by creative/photography language.
- the request can be reused unchanged for an unrelated product.
- layer revision history is absent after a failed generation.
