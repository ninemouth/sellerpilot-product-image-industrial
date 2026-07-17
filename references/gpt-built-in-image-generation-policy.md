# GPT Built-In Image Generation Policy

Use this reference whenever a run reaches final product-bearing image generation.

## Provider Boundary

The required production generation provider for this skill defaults to GPT model built-in image generation. In Codex chat/project contexts, the exposed native execution layer is the system `imagegen` skill using the built-in `image_gen` tool. Do not require the user to name the tool or model. If the user explicitly selects the ThinkAI provider or installs the ThinkAI variant, use the repo-local `scripts/thinkai-image-runtime.mjs` runtime with model `gpt-image-2`.

This skill prepares the research, identity locks, visual direction, copy, final generation prompts, QA expectations, review surfaces, and any audit artifacts requested by the user. When running inside Codex and the system `imagegen` skill / built-in `image_gen` tool is available, use that native path to execute real raster image generation. Outside Codex, the host runtime, SellerPilot app, or an explicitly available execution layer performs the actual GPT built-in image generation step.

Do not create ad-hoc SDK/API wrappers, silently use CLI fallback, or treat deterministic renderers as model generation. Codex `imagegen` / `image_gen` is the default execution layer; ThinkAI `gpt-image-2` is allowed only when explicitly selected by the user or by the installed ThinkAI variant. If the selected runtime cannot execute the request, stop with `blocked_runtime_unavailable` or emit the request pack as audit evidence.

If the current runtime cannot execute GPT built-in image generation with required image references, stop before final identity-preserving production and output only:

- generation request pack
- personalized prompt pack
- layout draft
- review plan
- blocked-generation note

Do not label those outputs as final generated ecommerce images.

## Runtime Interaction Boundary

Provider diagnostics are run evidence, not user-facing product copy. Never show sandbox, DNS, network-permission, raw transport, API-key, or local filesystem errors to a shopper or skill user. Never promise to bypass sandboxing or modify API configuration. Preserve completed assets and report only the affected asset status plus the smallest safe next action.

If the selected runtime fails because a necessary capability is not authorized, ask the user for authorization before rerunning the affected step. Use the user-facing capability name, such as local review service startup, network access for update checks, installed skill sync, or provider generation call. Do not expose the internal permission mechanism or raw error text. If authorization cannot be requested in the current session, mark only that step blocked, keep completed outputs, and tell the user which authorization is needed to continue.

Before execution, resolve the platform-required ratio and provider request size with `scripts/resolve-generation-spec.mjs`. The export gate remains a final check, not the first place a wrong ratio may be discovered. For multi-image runs, record anchor-only scheduling with `scripts/generation-execution-controller.mjs`; only after approved anchor QA may independent remaining roles use bounded concurrency of two.

## Required Capability

Final identity-preserving product images require all of:

- GPT built-in image generation execution capability.
- image-reference input support.
- source image references from user-owned or user-provided product images.
- Product Identity Lock from source/enhanced images.
- post-generation identity consistency review.

Text-only generation is allowed only for non-product backgrounds, abstract helper assets, or early concepts. It is not allowed for final product-bearing ecommerce images.

## Generation Request Schema

Every generated image request should include the fields needed by the selected mode. Fast mode may keep a compact per-image request summary plus the final prompt actually sent to Codex-native `imagegen` / `image_gen`. Industrial audit mode should keep the complete schema below as audit evidence.

Complete schema:

```yaml
provider: gpt-built-in-image-generation
execution_boundary: codex_native_imagegen_or_host_app_executes_generation
allowed_execution_layers:
  - system imagegen skill
  - built-in image_gen tool
  - scripts/thinkai-image-runtime.mjs when ThinkAI provider is explicitly selected
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

After Codex, ThinkAI, or the host app executes generation, record:

- executed_by: Codex-native `imagegen` / `image_gen`, ThinkAI `gpt-image-2` runtime, SellerPilot app, or named external execution layer.
- provider: `gpt-built-in-image-generation`.
- generation prompt or request-pack path.
- generated image file path.
- source image refs used.
- any blocked or failed request.
- retry count.
- identity consistency result.
- marketing/export gate result.

If execution is unavailable, record `generation_status: blocked_runtime_unavailable` and keep the run auditable.
