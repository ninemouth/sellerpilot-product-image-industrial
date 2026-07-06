# Sketch To Final Production

Use this reference before final generation prompt delivery for complete product image sets or any scene-heavy image set.

## Core Rule

Sketch first, prompt last. A final generation prompt should be the compressed result of a production process, not a first draft.

Sketches may be textual wireframes, YAML layout specs, simple HTML drafts, contact-board notes, or region maps. They are process artifacts for quality, not final user-facing ecommerce images.

## Required Sketch Levels

### 1. Thumbnail Sketch

Purpose: decide the role and visual idea before generation.

Fields:

```yaml
thumbnail_sketch:
  image_index:
  image_role:
  buyer_question:
  primary_visual:
  product_position:
  scene_or_background:
  main_copy_zone:
  secondary_copy_zone:
  expected_viewer_action:
  reject_if:
```

### 2. Scene Sketch

Required for scene/lifestyle/wearing/model images.

```yaml
scene_sketch:
  image_index:
  scene_moment:
  environment:
  model_or_body_context:
  outfit_context:
  product_contact_or_carry_relation:
  lighting:
  camera:
  scale_cues:
  product_visibility_requirement:
  identity_risks:
```

### 3. Layout Sketch

Required for final composition.

```yaml
layout_sketch:
  image_index:
  grid:
  safe_zones:
  product_area:
  text_area:
  label_area:
  visual_hierarchy:
  mobile_thumbnail_check:
  a_h_regions:
```

## Self-Review Before Prompt

Before writing final prompts, answer:

- Does this image deserve to exist in the set?
- Which buyer objection or desire does it address?
- Is the product fact supported by source evidence?
- Is the scene real enough to generate, not just decorative?
- Is the product identity visible and protected?
- Is the prompt specific to this product/platform/audience/season?
- Would a different image in the set do the same job? If yes, merge or revise.

## Prompt Readiness Gate

Fail final prompt delivery if:

- the image has no buyer question.
- the image has no sketch or wireframe.
- scene images have no scene sketch.
- photography treatment is generic or missing.
- layout and text hierarchy are undecided.
- the prompt could apply unchanged to many unrelated products.
- the prompt asks the model to invent unsupported product features.

## Iteration Policy

Use low-cost revisions before expensive final generation:

- strategy issue -> revise commerce strategy.
- scene issue -> revise scene sketch.
- camera/light issue -> revise photography treatment.
- copy issue -> revise copy pack.
- layout issue -> revise wireframe.
- identity risk -> revise identity lock and negative prompt.

Only regenerate final assets after the smallest failed upstream artifact is fixed.
