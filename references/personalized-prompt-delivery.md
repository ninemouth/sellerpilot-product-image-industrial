# Personalized Prompt Delivery

Use this reference when creating the final personalized prompt for GPT built-in image generation. In Codex the native execution layer is the system `imagegen` skill / built-in `image_gen` tool. The user does not need to name the tool or model.

## Purpose

The final prompt is a personalized production work order for one product, one image role, one platform, one audience, and one visual strategy. It must be generated from the run artifacts, not copied from a fixed template.

## Required Inputs

Do not write final prompts until these are available or explicitly blocked:

- task goal contract
- product fact sheet
- source image quality report
- product identity lock
- platform/category/season research
- bestseller pattern mining when marketing enhancement is needed
- product feature analysis
- audience positioning analysis
- commerce strategy brief
- creative direction brief
- photography treatment
- layout wireframes or sketches
- localized copy pack
- risk/claim boundaries

## Prompt Structure

Each final prompt must include:

```yaml
prompt_delivery:
  image_index:
  output_filename:
  provider: gpt-built-in-image-generation
  source_image_refs: []
  identity_lock_ref:
  commercial_goal:
  buyer_question:
  audience:
  platform:
  locale:
  season_or_occasion:
  creative_concept:
  photography_treatment:
    camera_angle:
    lens_feel:
    crop:
    lighting:
    color_temperature:
    scene:
    props_or_model:
    product_placement:
  layout_intent:
    product_area:
    text_area:
    safe_zones:
    hierarchy:
  copy_to_include: []
  must_preserve: []
  allowed_changes: []
  forbidden_changes: []
  negative_prompt: []
  qa_expectations:
    identity:
    scene_authenticity:
    marketing:
    layout:
    platform:
  retry_policy:
```

## Personalization Standard

A prompt is not ready if:

- the product name/category can be swapped without changing the prompt.
- the scene is generic and not tied to audience, platform, occasion, or product features.
- camera, light, and product placement are vague.
- layout intent is absent for an ecommerce deliverable.
- source identity constraints are not explicit.
- final copy speaks to internal reviewers rather than shoppers.

## Final Handoff

For each image, deliver:

- prompt YAML block.
- short natural-language production brief.
- source reference paths.
- layout sketch reference.
- expected failure modes.
- retry instruction for the smallest likely failure.
- prompt personalization check showing why this prompt cannot be reused unchanged for an unrelated product.

If GPT built-in image generation / required image-reference runtime execution is unavailable, mark:

```yaml
generation_status: blocked_runtime_unavailable
handoff_status: prompt_ready_runtime_needed
```

Do not claim final generated images were produced.
