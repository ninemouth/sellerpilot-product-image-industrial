# Product Identity Preservation

Use this reference whenever generated images must match a source/reference product image. The goal is not "same category"; it is "the same product identity".

## Core Rule

Do not treat a text prompt as enough for final product-image generation. For identity-preserving output, the production provider must be GPT model built-in image generation, and the request must include the source product image or enhanced source image as an image reference whenever the execution layer supports image references.

In Codex chat/project contexts, the system `imagegen` skill / built-in `image_gen` tool is the preferred native execution layer for real generated images. If the available runtime cannot execute GPT built-in image generation with required image references, produce only fallback/audit artifacts such as a generation request pack, prompt pack, layout draft, or concept direction. Do not label those artifacts as final identity-preserving output.

## Product Identity Lock

Create `identity-lock.yaml` after source image parsing and Source Product Understanding, before scene/detail generation:

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
  geometry_lock:
    status: pending|locked|not_applicable
    product_height_to_width_ratio:
    product_length_class:
    silhouette_class:
    apparel:
      enabled: true|false
      garment_length_class:
      hem_position:
      collar_to_hem_ratio:
      shoulder_width_to_body_length_ratio:
      sleeve_length_class:
      sleeve_length_to_body_length_ratio:
      fit_class:
      forbidden_geometry_changes: []
      source_geometry_ref: geometry/source-geometry.json
      generated_geometry_ref: geometry/generated-geometry.json
  micro_detail_lock:
    source_product_understanding_ref: source-understanding/source-product-understanding.json
    text_derived_facts_to_preserve: []
    visible_text_or_logo:
      status: clear|unclear|not_visible
      location:
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
  forbidden_changes:
    - changing color family
    - changing silhouette or size ratio
    - adding/removing straps, handles, hardware, closures, logos, charms, pockets, or compartments
    - changing material appearance
    - inventing interior, capacity, bundle items, branding, or certification
  detail_checklist:
    - item:
      expected:
      source_evidence:
      priority: high|medium|low
```

## Generation Rules

- Use source image or enhanced source image as the primary identity reference for every generated product-bearing image.
- Prepare every final product-bearing image as a GPT built-in image generation request. In Codex, execute it through the system `imagegen` skill / built-in `image_gen` tool when available; in non-Codex hosts, hand it to the host execution layer.
- Scene and model images may change background, lighting, crop, and pose, but must preserve the locked product identity.
- For apparel, preserve geometry: garment length class, hemline position, neckline shape, shoulder/body proportions, sleeve length, and fit class. Do not shorten a normal jersey/shirt into a crop top unless the source or user explicitly supports it.
- Do not generate small details from memory. Hardware, zipper, straps, accessories, texture, stitch direction, logos, and decorations must come from source evidence.
- If a detail is not visible in the source, do not invent it. Mark it unknown and avoid closeup claims.
- If a logo, trademark, product name, tag, engraving, charm face, or tiny printed text is visible but unclear, preserve its approximate placement, size, contrast, color, and shape while keeping it unreadable. Ask the user for a clearer closeup only when that micro-detail is commercially important or will be shown close.
- If source-image text reveals dimensions, installation actions, compatibility, material, package contents, weight, warnings, or certifications, propagate those facts into Product Physical Truth Lock, geometry lock, copy, and prompt layers. Generated images must preserve the factual meaning and scale; do not silently change a visible 1.08 in product into a much larger object.
- Never turn an unclear mark into a readable brand word, new monogram, new animal face, or new decorative pattern.
- For closeups, prefer crop/enhance/composite from the source image when possible. Use generation only to clean or contextualize, not to redesign the detail.
- Do not use competitor references as identity references. Competitors may inform differentiation only.

## Prompt Requirements

Every GPT built-in image generation request must include:

- `provider`: `gpt-built-in-image-generation`.
- `execution_boundary`: Codex-native imagegen/image_gen or host app executes generation.
- `identity_reference`: absolute path(s) to source/enhanced source image.
- `must_preserve`: the relevant identity-lock fields.
- `allowed_changes`: background, lighting, scene, pose, crop, props.
- `forbidden_changes`: specific product changes to avoid.
- `detail_focus`: only if supported by visible evidence.
- `identity_check`: what must be compared after generation.

## Post-Generation Identity Gate

Run identity QA before marketing QA and final export.

Fail an image if:

- silhouette, color family, material appearance, hardware, strap/handle, closure, accessory, logo, or distinctive details drift from the source image.
- the scene hides the product so much that identity cannot be verified.
- the image adds unverified details, pockets, compartments, charms, logos, patterns, capacity, or bundle items.
- closeup detail does not match the source or cannot be traced to source evidence.
- unclear micro-detail becomes invented readable text, a new logo, or a changed engraving/pattern.
- a generated product appears as a similar generic product rather than the submitted product.
- apparel length, hem position, neckline shape, sleeve length, or silhouette changes from the source geometry.

When identity fails:

- regenerate only the failed asset, not the whole set.
- tighten the prompt using identity-lock details.
- use source crop/composite for detail images when possible.
- stop after repeated identity drift and ask for a better source image or additional angles.

## Human/Codex Review

Machine checks can only provide hints. Final identity preservation requires side-by-side visual review against the source image and the detail checklist.

Use the bundled identity consistency report tool to create a review surface, then inspect the result visually before export.
