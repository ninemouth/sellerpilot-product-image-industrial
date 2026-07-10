# Output Contract

Use mode-scoped outputs so normal chat generation stays fast.

Fast generation mode must include:

```text
final-images/  # independent generated image files
export/final-images-manifest.json  # required run-scoped membership list for final images
overview/SET-OVERVIEW-contact-sheet.png  # required package overview for multi-image sets
generation-summary.md  # concise product identity, visual strategy, prompt, and QA notes
brief-intake/brief-intake-gate-report.json  # only when clarifications or assumptions are material
generated-assets/generation-progress.json  # for multi-image sets and long-running generation
generated-assets/anchor-batch-qa-decision.json  # required for 4+ image quality production pacing
memory/store-style-memory.md  # conditional saved store style overlay when a named store is applied
memory/store-style-overlay.json  # conditional apply status and source path for store style memory
source-normalized/product-cutout-transparent.png  # card/infographic product master when source image is used in layout
source-normalized/product-on-card-safe.png  # fallback when alpha cannot be preserved
source-normalized/product-normalization-report.json
planning/production-efficiency-plan.json  # triggered/skipped work and stage budgets
blueprint/quality-production-blueprint.json  # compact image-set planning for quality production multi-image finals
qa/qa-loop-state.json                     # persisted retry signatures and loop guard state
review-workspace/  # required after generated multi-image final sets; otherwise only when review/revision is requested or needed
```

Fast mode may keep compact internal notes for source quality, identity lock, shot matrix, and QA, but it should not create the full industrial artifact tree unless needed. Quality production should keep image-set planning compact by using `blueprint/quality-production-blueprint.json` as the executable combined artifact rather than separate verbose industrial reports.

Industrial audit mode must include these artifacts:

```text
00-task-context.yaml
brief-intake/brief-intake-gate-report.json
01-goal-contract.yaml
01-product-fact-sheet.yaml
02-identity-lock.yaml
source-understanding/source-product-understanding.json
blueprint/02b-product-physical-truth.json
03-product-feature-analysis.yaml
04-audience-positioning-analysis.yaml
05-commerce-strategy-brief.yaml
06-creative-direction-brief.yaml
06-graphic-design-direction.yaml
05-source-image-quality-report.json
06-platform-category-research.md
07-visual-direction-brief.yaml
08-photography-treatment.yaml
08-image-set-blueprint.yaml
layout-drafts/09-layout-wireframes.yaml
layout-drafts/09-sketch-self-review.md
09-localized-copy-pack.md
qa/localized-copy-qa-report.md
qa/final-visible-text-review.json  # conditional post-export localized raster text review evidence
qa/product-background-card-consistency-gate-report.md
10-generation-request-pack.yaml
10-final-generation-prompts.md
11-final-personalized-prompt-delivery.md
prompt-pack/12-prompt-layer-stack.json
qa/prompt-layer-gate-report.md
qa/product-physics-fact-gate-report.md
qa/qa-loop-routing-decision.yaml
qa/final-delivery-gate-report.md
review-workspace/data/import-manifest.json
review-workspace/data/annotations.json
review-workspace/data/canvas-state.json
review-workspace/data/generation-tasks.json
11-generated-images/  # only when Codex-native imagegen/image_gen, host app GPT generation, or deterministic rendering was requested
generated-assets/generation-progress.json
generated-assets/anchor-batch-qa-decision.json
12-identity-consistency-report.json
14-marketing-quality-gate-report.md
15-image-set-export-gate-report.md
overview/SET-OVERVIEW-contact-sheet.png
overview/delivery-overview-report.json
16-qa-report.md
17-revision-history.md
18-export-package-summary.md
```

Conditional artifacts:

```text
source-image-set-manifest.json
memory/store-style-draft.md
memory/store-style-memory.md
memory/store-style-overlay.json
research/platform-category-profile-overlay.yaml
research/bestseller-design-mining.md
research/bestseller-patterns.yaml
review/review.html
review-workspace/  # React + Vite + tldraw workspace after generated multi-image final sets or when visual review is needed
qa/image-set-export-gate-report.json
qa/image-set-export-gate-report.md
export/final-images-manifest.json
qa/prompt-readiness-gate-report.md
qa/prompt-layer-gate-report.json
qa/product-physics-fact-gate-report.json
qa/source-product-understanding-gate-report.json
qa/localized-copy-qa-report.json
qa/final-visible-text-review.json
qa/product-background-card-consistency-gate-report.json
qa/qa-loop-routing-decision.json
qa/qa-loop-state.json
qa/final-delivery-gate-report.json
failed-output-review.yaml
```

Use package templates where useful:

```text
templates/product-fact-sheet-template.yaml
templates/image-set-blueprint-template.yaml
templates/quality-production-blueprint-template.yaml
templates/commerce-strategy-brief-template.yaml
templates/creative-direction-brief-template.yaml
templates/graphic-design-direction-template.yaml
templates/photography-treatment-template.yaml
templates/layout-wireframes-template.yaml
templates/gpt-built-in-image-generation-prompt-template.md
templates/final-prompt-delivery-template.md
templates/prompt-layer-stack-template.yaml
templates/revision-brief-template.yaml
```

Minimum Goal Contract fields:

```yaml
goal_contract:
  run_goal:
  commercial_objective:
    primary:
    secondary:
  target_image_count:
  deliverable_type: []
  success_criteria: []
  stop_conditions: []
```

Minimum Product Fact Sheet fields:

```yaml
product_name:
category:
source_images: []
confirmed_visual_traits: []
confirmed_features: []
confirmed_materials: []
confirmed_dimensions: []
package_contents: []
use_cases: []
target_users: []
certifications: []
uncertain_facts: []
prohibited_claims: []
evidence_refs: []
```

Minimum Product Identity Lock fields:

```yaml
identity_lock:
  source_images: []
  enhanced_source_image:
  product_category:
  must_preserve:
    silhouette:
    proportions:
    primary_color:
    material_appearance:
    texture:
    hardware:
    closure:
    strap_or_handle:
    accessory_or_decoration:
    logo_or_markings:
    distinctive_details: []
  micro_detail_lock:
    visible_text_or_logo:
      status: clear|unclear|not_visible
      preserve_as: exact_text|unreadable_mark|shape_only
      ask_user_for_closeup: true|false
    product_name_or_trademark:
      status: clear|unclear|not_visible
      preserve_as: exact_text|unreadable_mark|shape_only
    hardware_marks:
      status: clear|unclear|not_visible
      preserve_as: exact_shape|unreadable_mark|shape_only
    stitching_pattern:
    zipper_teeth:
    charm_face:
    edge_shape:
  flexible:
    background:
    lighting:
    model_or_props:
    camera_angle:
    crop:
  forbidden_changes: []
  detail_checklist: []
```

Minimum Product Feature Analysis fields:

```yaml
product_feature_analysis:
  confirmed_core_traits: []
  visual_features: {}
  buyer_relevant_benefits: []
  detail_shot_opportunities: []
  scene_triggers: []
  differentiation_angles: []
  uncertain_or_unverified: []
```

Minimum Audience Positioning Analysis fields:

```yaml
audience_positioning_analysis:
  primary_buyer: {}
  secondary_buyers: []
  buying_motivations: []
  purchase_objections: []
  aesthetic_preferences: {}
  platform_behavior_hypotheses: []
  scene_priority: []
  copy_voice: {}
  conversion_intent: {}
```

Minimum Commerce Strategy Brief fields:

```yaml
commerce_strategy_brief:
  run_goal:
  product_category:
  platform:
  locale:
  season_or_occasion:
  commercial_objective: {}
  buyer_path: {}
  image_set_architecture:
    - image_index:
      image_role:
      buyer_question:
      conversion_intent:
      required_evidence:
      success_criteria:
      reject_if:
  unsupported_or_risky_claims: []
```

Minimum Quality Production Blueprint fields:

```yaml
quality_production_blueprint:
  mode: quality_production
  run_id:
  product_truth:
    confirmed_source_facts: []
    ocr_or_visible_text_facts: []
    uncertain_facts: []
    prohibited_claims: []
  identity_locks:
    product_identity_lock_ref:
    physical_truth_lock_ref:
    geometry_lock_ref:
    micro_detail_notes: []
  platform_context:
    baseline_profile:
    live_research_status: skipped|targeted|required
    season_climate_holiday_region_notes: []
  image_set:
    - image_index:
      image_role:
      buyer_question:
      conversion_task:
      shot_direction:
      scene_or_background:
      copy_intent:
      prompt_layers: []
      required_evidence: []
      qa_acceptance_criteria: []
      rerun_scope_if_failed:
  anchor_batch:
    selected_indexes: []
    qa_decision: pending|continue|revise_prompt|ask_user|blocked
  progress:
    progress_file: generated-assets/generation-progress.json
```

Minimum Creative Direction Brief fields:

```yaml
creative_direction_brief:
  creative_goal:
  single_minded_proposition:
  visual_concept:
  mood_keywords: []
  price_band_signal:
  differentiation_angle:
  color_system: {}
  visual_memory_points: []
  do: []
  do_not: []
```

Minimum Graphic Design Direction fields:

```yaml
graphic_design_direction:
  platform:
  category:
  audience:
  design_goal:
  design_quality_bar:
    concept_before_layout:
    product_first_rule:
    hierarchy_grade_target:
    layout_rhythm:
    set_variation_rule:
    mobile_feed_readability:
    premium_finish_notes:
  set_layout_system:
    typography_hierarchy:
    safe_zones:
    overlay_style:
    text_density:
    color_and_contrast:
    mobile_thumbnail_rule:
  per_image_design:
    - image_index:
      role:
      layout_intent:
      text_hierarchy:
      safe_zone_notes:
      allowed_badges: []
      forbidden_marks: []
      visual_difference_from_previous:
  no_watermark_policy:
    default_visible_mark_decision: prohibited_unless_user_explicitly_requests_exact_mark
    visible_platform_pack_label_allowed: false
    internal_system_mark_allowed: false
    corner_label_allowed: false
    watermark_authorization:
      status: none|user_explicitly_requested
      source_user_request:
      exact_visible_text:
      placement:
      purpose:
      allowed_images: []
    allowed_visible_marks: []
    forbidden_visible_marks: []
```

Minimum Photography Treatment fields:

```yaml
photography_treatment:
  overall_style:
  selected_master_archetypes: []
  product_truth_constraints: []
  shots:
    - image_index:
      image_role:
      final_asset_type:
      photography_style_archetype:
      why_it_fits_product_and_audience:
      camera_angle:
      lens_feel:
      crop:
      camera_height:
      lighting_direction:
      color_temperature:
      background_or_scene:
      model_or_body_context:
      outfit_context:
      props:
      product_placement:
      scale_cues:
      audience_fit:
      product_truth_constraints: []
      identity_risks:
      must_preserve_micro_details: []
      must_preserve: []
      forbidden_changes: []
```

Minimum Layout Wireframe fields:

```yaml
layout_wireframes:
  design_system:
    canvas:
    grid:
    margins:
    safe_zones:
    typography:
    color_tokens:
    mobile_thumbnail_minimums:
  frames:
    - image_index:
      filename:
      image_role:
      thumbnail_sketch:
      product_area:
      scene_area:
      title_area:
      subtitle_area:
      label_area:
      proof_area:
      a_h_regions: {}
      hierarchy_check:
      reject_if:
```

Minimum Prompt Layer Stack fields:

```yaml
prompt_layer_stack:
  image_index:
  output_filename:
  prompt_layer_architect:
    decision_basis: {}
    mandatory_layers: []
    conditional_layers: []
    omitted_layers: []
    layer_order: []
    locked_layers: []
    conflict_notes: []
  layers:
    execution_contract_layer: {}
    product_identity_layer: {}
    fact_boundary_layer: {}
    commerce_goal_layer: {}
    context_layer: {}
    creative_concept_layer: {}
    photography_treatment_layer: {}
    layout_copy_layer: {}
    negative_qa_layer: {}
  conditional_layer_payloads: {}
  layer_review:
    status:
    missing_layers: []
    conflict_notes: []
    generic_prompt_risk:
    blocked_reason:
  iteration_history: []
```

Minimum QA Loop Routing Decision fields:

```yaml
loop_decision:
  status:
  primary_failure_type:
  failure_category:
  return_node:
  failed_gate:
  failed_images: []
  smallest_next_action:
  rerun_from: []
  do_not_rerun: []
  retry_budget:
  retry_attempts_used:
  retry_attempts_remaining:
  retry_signature:
  blocked_reason:
  user_input_required:
loop_guard:
  status:
  signature:
  attempt_count:
  max_attempts:
  remaining_attempts:
  state_path:
```

Minimum Image Set Blueprint fields:

```yaml
image_index:
asset_id:
filename:
image_role:
final_asset_type:
platform:
aspect_ratio:
buyer_question:
main_message:
secondary_message:
visual_composition:
product_view:
camera_angle:
crop_type:
focal_subject:
background_or_scene:
lighting:
props_or_model_context:
scene_asset_requirement:
scene_asset_status:
required_copy:
buyer_facing_message:
editable_regions:
  A:
  B:
  C:
  D:
  E:
  F:
  G:
  H:
forbidden_elements: []
identity_constraints: []
localization_notes: []
```

Filename rule:

```text
<stable-id>-<english-purpose-slug>.<ext>
```

Examples: `IMG-01-main-product.png`, `POSTER-01-campaign-poster.png`, `DETAIL-03-product-solution.png`. The English purpose slug is required.

Minimum Revision Brief fields:

```yaml
target_image_index:
target_region:
issue_type:
current_problem:
requested_change:
keep_unchanged:
priority:
```

For GPT built-in image generation, separate:

- Final personalized prompts with `provider: gpt-built-in-image-generation`.
- Request packs only when fallback/audit evidence is needed.
- Execution boundary: Codex chat/project should execute through the system `imagegen` skill / built-in `image_gen` tool by default; ThinkAI installs or explicit ThinkAI provider selections execute through `scripts/thinkai-image-runtime.mjs` with `gpt-image-2`. Non-Codex hosts may execute through SellerPilot or another explicit host runtime.
- Forbidden execution shortcuts: ad-hoc one-off SDK wrappers, silent CLI/API fallback, and deterministic layout renderers masquerading as final scene generation.
- Final prompts ready for runtime/host-app image generation. These prompts must be personalized production handoffs created after strategy, sketches, photography treatment, layout intent, and self-review.
- Prompt layer stack with Prompt Layer Architect Brain decision, mandatory layers, conditional layers, layer order, locked layers, and conflict notes.
- Prompt layer gate showing whether the layer stack is ready, ready with warnings, or blocked.
- Identity reference image paths and product identity lock.
- Scene roles and their generated/photo scene asset paths. Final scene roles require scene-asset evidence; deterministic layout-only scene panels are drafts, not final images.
- Claims that are supported by evidence.
- Claims that need user confirmation.
- Claims that must be removed.
- Assets actually generated, if Codex-native imagegen/image_gen or the runtime/host app executed GPT built-in image generation.
- Independent rendered/generated image files.
- Identity consistency report and side-by-side review artifact.
- Review canvas or annotation export JSON when review is requested or expected by the workflow.
- Region-based `review.html` with A-H editable regions when actual images are generated.
- Prompt readiness gate showing whether final prompt delivery is blocked, ready with risks, or ready.
- QA loop routing decision showing the return node, smallest next action, rerun scope, do-not-rerun scope, retry budget, blocked reason, and user-input-required state.
- QA loop state showing persisted retry signatures; once the same failure exceeds budget, final delivery must stay blocked until the user supplies better evidence, confirms facts, or changes direction.
