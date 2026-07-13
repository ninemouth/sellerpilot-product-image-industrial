# QA Loop Routing

Use this reference after any gate report fails or warns. The QA loop router turns multiple gate reports into one production routing decision.

## Goal

Do not respond to failed QA by regenerating everything. Classify the failure, return to the earliest responsible node, fix the smallest artifact, rerun downstream gates only, and stop when retry budget or required input blocks progress.

`qa-loop-router.mjs` is the executable loop guard. It writes `qa/qa-loop-state.json`, counts repeated failure signatures, and changes the routing decision to `blocked_retry_budget_exhausted` once the signature exceeds its retry budget. A failure signature is based on return node, failure type, failed gate, and failed image indexes.

## Gate Standards

Each gate report should emit:

```yaml
gate_report:
  gate_id:
  status: pass | ready | pass_with_warnings | ready_with_warnings | warn | fail | blocked | needs_visual_review
  findings:
    - severity: info | warn | fail | critical
      type:
      image_index:
      file:
      message:
      return_node:
      user_input_required:
```

## Failure Taxonomy

```yaml
failure_taxonomy:
  source_quality:
    examples: [weak-source-image, low-resolution-source, blur, clutter, color-cast]
  product_truth:
    examples: [missing-product-truth, unsupported-claim, capacity-unsupported, invented-feature]
  identity:
    examples: [identity-drift, source-cutout-used-as-scene, missing-identity-lock]
  surface_material:
    examples: [material-source-contamination, material-palette-drift, material-lightness-drift, material-color-temperature-drift, gradient-direction-drift, material-shape-drift, surface-material-transfer-drift]
  prompt_readiness:
    examples: [prompt-readiness-marker-missing, final-prompt-not-written, generic-prompt-risk]
  prompt_layer:
    examples: [missing-mandatory-layer, missing-conditional-layer, unresolved-layer-conflict, thin-layer]
  platform_market:
    examples: [platform-fit-missing, platform-profile-missing, research-overlay-missing]
  strategy:
    examples: [no-commercial-task, repeated-buyer-question, weak-image-architecture]
  creative:
    examples: [weak-visual-concept, wrong-audience-tone, generic-product-look, weak-graphic-design-system, repeated-template-card-layout]
  photography_scene:
    examples: [fake-scene, missing-scene-asset, scene-is-layout-placeholder, thin-scene-direction, generic-photography-style]
  layout_copy:
    examples: [internal-copy, watermark-or-platform-pack-label, unreadable-text, layout-unreadable, text-too-small]
  micro_detail:
    examples: [unclear-micro-detail, invented-logo-or-trademark, invented-readable-micro-text]
  marketing_diversity:
    examples: [repeated-camera-angle, repeated-crop-or-composition, repeated-primary-image]
  export:
    examples: [wrong-image-count, single-file-delivery, bad-filename, not-square, contact-sheet-or-banner-ratio, draft-exported-as-final]
  runtime:
    examples: [blocked-runtime-unavailable, image-reference-unavailable]
  delivery:
    examples: [upstream-gate-not-passed, qa-loop-not-closed]
```

Delivery failures are final aggregation symptoms, not root production failures. `qa-loop-router.mjs` must ignore `final-delivery-gate-report.json` when selecting the primary root cause. If final delivery fails, route from the underlying upstream gate report or the existing QA loop decision, not from `final-delivery-gate-report.json` itself.

## Return Node Matrix

```yaml
return_node_matrix:
  weak-source-image: source-image-enhancement
  low-resolution-source: source-image-enhancement
  missing-product-truth: product-fact-sheet
  unsupported-claim: product-fact-sheet
  capacity-unsupported: product-fact-sheet
  missing-identity-lock: product-identity-lock
  identity-drift: personalized-prompt-delivery
  material-source-contamination: surface-material-extraction
  material-palette-drift: surface-material-transfer
  material-lightness-drift: surface-material-transfer
  material-color-temperature-drift: surface-material-transfer
  gradient-direction-drift: surface-material-transfer
  material-shape-drift: surface-material-transfer
  surface-material-transfer-drift: surface-material-transfer
  prompt-readiness-marker-missing: prompt-readiness-gate
  final-prompt-not-written: personalized-prompt-delivery
  generic-prompt-risk: prompt-layer-stack
  missing-mandatory-layer: prompt-layer-stack
  missing-conditional-layer: prompt-layer-stack
  unresolved-layer-conflict: prompt-layer-stack
  thin-layer: prompt-layer-stack
  platform-fit-missing: platform-category-web-research
  research-overlay-missing: platform-category-profile-overlay
  no-commercial-task: commerce-strategy-brief
  weak-image-architecture: image-set-architecture
  weak-visual-concept: creative-direction-brief
  weak-graphic-design-system: graphic-design-direction
  repeated-template-card-layout: graphic-design-direction
  wrong-audience-tone: audience-positioning-analysis
  generic-photography-style: commercial-photography-treatment
  fake-scene: scene-asset-production
  missing-scene-asset: scene-asset-production
  source-cutout-used-as-scene: scene-asset-production
  scene-is-layout-placeholder: scene-asset-production
  thin-scene-direction: commercial-photography-treatment
  repeated-camera-angle: visual-director
  repeated-crop-or-composition: visual-director
  repeated-primary-image: visual-director
  internal-copy: localized-copy-pack
  watermark-or-platform-pack-label: graphic-design-direction
  unclear-micro-detail: product-identity-lock
  invented-logo-or-trademark: product-identity-lock
  invented-readable-micro-text: product-identity-lock
  unreadable-text: layout-wireframes
  layout-unreadable: layout-wireframes
  wrong-image-count: export-packaging
  single-file-delivery: export-packaging
  bad-filename: export-packaging
  not-square: export-packaging
  contact-sheet-or-banner-ratio: export-packaging
  draft-exported-as-final: export-packaging
  upstream-gate-not-passed: qa-loop-router
  qa-loop-not-closed: qa-loop-router
  blocked-runtime-unavailable: generation-runtime-execution-boundary
```

## Retry Budget

```yaml
retry_budget_defaults:
  source-image-enhancement: 1
  product-fact-sheet: 2
  product-identity-lock: 2
  surface-material-extraction: 1
  surface-material-transfer: 2
  platform-category-web-research: 1
  commerce-strategy-brief: 2
  creative-direction-brief: 2
  graphic-design-direction: 2
  commercial-photography-treatment: 2
  prompt-layer-stack: 3
  personalized-prompt-delivery: 3
  scene-asset-production: 2
  generation-request-pack: 2
  layout-wireframes: 3
  localized-copy-pack: 2
  export-packaging: 2
```

## Status Semantics

- `continue`: no blocking findings; proceed to next workflow node.
- `return_to_node`: fix a specific upstream node, then rerun downstream gates.
- `regenerate_failed_assets_only`: generation asset failed; keep approved assets locked.
- `rerender_layout_only`: layout/copy/export failed; do not regenerate scene/product assets.
- `blocked_user_input_required`: more source images, product facts, or user confirmation needed.
- `blocked_runtime_unavailable`: GPT built-in generation runtime or required image-reference capability missing.
- `blocked_retry_budget_exhausted`: repeated attempts failed; stop and report required next input.

When `blocked_retry_budget_exhausted` appears, do not regenerate more assets automatically. Ask for the missing source image/detail, product fact confirmation, direction change, or human acceptance of a blocked state.

## User Input Required

Set `user_input_required: true` when:

- source image is too weak for identity preservation after enhancement.
- required product fact is absent but needed for the concept.
- certification/safety/medical/waterproof/brand claim lacks evidence.
- conflicting product sources cannot be reconciled.
- runtime cannot execute required image-reference generation.
- retry budget is exhausted.

## Rerun Scope

The router must output:

```yaml
loop_decision:
  status:
  primary_failure_type:
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
```

The router should also output `loop_guard` with the state path, signature, attempt count, max attempts, and remaining attempts.

Approved upstream artifacts should not be regenerated unless the router names them as affected.
