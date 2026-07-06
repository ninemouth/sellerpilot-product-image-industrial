# Product Feature And Audience Analysis

Use this reference before visual direction, copy localization, prompt generation, or final image rendering. The purpose is to turn raw product facts into buyer-relevant selling angles without inventing unsupported claims.

## Required Artifacts

Create these two files in the run directory:

```text
02-product-feature-analysis.yaml
03-audience-positioning-analysis.yaml
```

If the source image or product facts are incomplete, keep the analysis conservative and list unknowns.

## Product Feature Analysis

The product feature analysis must separate observable evidence from inferred selling angles:

```yaml
product_feature_analysis:
  category:
  confirmed_core_traits:
    - trait:
      evidence:
      visual_priority:
  visual_features:
    shape:
    color:
    material_appearance:
    structure:
    hardware:
    closure:
    strap_or_handle:
    accessories:
    texture:
    size:
  buyer_relevant_benefits:
    - benefit:
      supported_by:
      confidence: high|medium|low
      image_role_fit: []
  detail_shot_opportunities:
    - focal_subject:
      reason_to_show:
      crop_suggestion:
      forbidden_claims: []
  scene_triggers:
    - use_context:
      why_it_matches:
      props_or_model_context:
      risk_note:
  differentiation_angles:
    - angle:
      support:
      visual_expression:
  uncertain_or_unverified:
    - claim:
      why_uncertain:
      safe_rewrite:
```

Rules:

- Confirm only what is visible or supported by URL/spec evidence.
- Convert traits into shopper-relevant implications, but never overclaim material, capacity, durability, waterproofing, brand, certification, or included accessories.
- Feature analysis must feed the Visual Director shot matrix. If a feature cannot be visualized, do not force it into final image copy.
- For physical products, separate "observable structure" from "confirmed function". Do not turn a visible clip, screw hole, strap, hook, button, cable, or opening into a use claim unless `blueprint/02b-product-physical-truth.json` supports that action.
- Installation, routing, holding, locking, pressing, clamping, waterproofing, load-bearing, magnet, adhesive, and compatibility claims must be backed by product facts or marked as forbidden/unknown before prompt work.

## Audience Positioning Analysis

The audience analysis must identify who the image set is talking to and why the product matters to them:

```yaml
audience_positioning_analysis:
  primary_buyer:
    description:
    shopping_moment:
    price_sensitivity:
    decision_style:
  secondary_buyers: []
  buying_motivations:
    - motivation:
      visual_implication:
      copy_implication:
  purchase_objections:
    - objection:
      image_to_answer:
      safe_response:
  aesthetic_preferences:
    colors:
    styling:
    scene_mood:
    model_or_no_model:
    lighting:
  platform_behavior_hypotheses:
    - hypothesis:
      source_or_reason:
      implication:
  scene_priority:
    - scene:
      target_buyer_question:
      why_this_scene:
  copy_voice:
    tone:
    phrase_patterns:
    avoid:
  conversion_intent:
    click_reason:
    trust_reason:
    comparison_reason:
```

Rules:

- Tie audience assumptions to platform/category research, product category, price band if known, and visual evidence.
- Do not invent demographic certainty. Use "likely", "hypothesis", or "needs confirmation" in analysis files when needed.
- Final image copy should speak to the buyer's buying moment, not to internal workflow needs.

## Gate Conditions

Fail the blueprint before generation if:

- The image set has no explicit target buyer.
- The visual direction does not answer buyer motivations or objections.
- Detail shots are selected only because the feature name exists, not because they support a buyer decision.
- Scene images do not map to audience use contexts.
- Copy tone is generic and not platform/category/audience aware.
