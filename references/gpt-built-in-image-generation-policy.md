# GPT Built-In Image Generation Policy

Use this reference whenever a run reaches final product-bearing image generation.

## Provider Boundary

The required production generation provider for this skill is GPT model built-in image generation. In Codex chat/project contexts, the exposed native execution layer is the system `imagegen` skill using the built-in `image_gen` tool. Do not require the user to name the tool or model.

This skill prepares the research, identity locks, visual direction, copy, final generation prompts, QA expectations, review surfaces, and any audit artifacts requested by the user. When running inside Codex and the system `imagegen` skill / built-in `image_gen` tool is available, use that native path to execute real raster image generation. Outside Codex, the host runtime, SellerPilot app, or an explicitly available execution layer performs the actual GPT built-in image generation step.

Do not create ad-hoc SDK/API wrappers, silently use CLI fallback, or treat deterministic renderers as model generation. CLI/API fallback requires explicit user request or confirmation according to the system `imagegen` skill rules.

If the current runtime cannot execute GPT built-in image generation with required image references, stop before final identity-preserving production and output only:

- generation request pack
- personalized prompt pack
- layout draft
- review plan
- blocked-generation note

Do not label those outputs as final generated ecommerce images.

## Required Capability

Final identity-preserving product images require all of:

- GPT built-in image generation execution capability.
- image-reference input support.
- source image references from user-owned or user-provided product images.
- Product Identity Lock from source/enhanced images.
- post-generation identity consistency review.

Text-only generation is allowed only for non-product backgrounds, abstract helper assets, or early concepts. It is not allowed for final product-bearing ecommerce images.

## Generation Request Schema

Every generated image request should include the fields needed by the selected mode. Fast mode may keep a compact per-image request summary plus the final prompt actually sent to `imagegen` / `image_gen`. Industrial audit mode should keep the complete schema below as audit evidence.

Complete schema:

```yaml
provider: gpt-built-in-image-generation
execution_boundary: codex_native_imagegen_or_host_runtime_executes_generation
allowed_execution_layers:
  - system imagegen skill
  - built-in image_gen tool
  - host app GPT built-in image generation
forbidden_execution_layers:
  - ad-hoc one-off SDK wrapper
  - silent CLI/API fallback
  - deterministic layout renderer as final scene generation
image_role:
final_asset_type:
output_filename:
source_image_refs: []
enhanced_source_image_refs: []
identity_lock_ref:
identity_lock_summary:
platform:
locale:
buyer_question:
scene_asset_requirement:
scene_asset_type:
scene:
  setting:
  moment:
  model_or_body_context:
  outfit_context:
  product_placement:
  scale_relationship:
composition:
  camera_angle:
  crop:
  product_view:
  background_or_scene:
  lighting:
  props_or_model_context:
copy:
  required_text: []
  forbidden_text: []
allowed_changes: []
forbidden_changes: []
negative_prompt: []
qa_expectations:
  identity_check: []
  marketing_check: []
  platform_check: []
retry_policy:
  max_attempts:
  regenerate_only_failed_asset: true
  stop_on_repeated_identity_drift: true
```

## Execution Result Contract

After Codex or the host app executes generation, record:

- executed_by: Codex `imagegen` / `image_gen`, SellerPilot app, or named external execution layer.
- provider: `gpt-built-in-image-generation`.
- generation prompt or request-pack path.
- generated image file path.
- source image refs used.
- any blocked or failed request.
- retry count.
- identity consistency result.
- marketing/export gate result.

If execution is unavailable, record `generation_status: blocked_runtime_unavailable` and keep the run auditable.
