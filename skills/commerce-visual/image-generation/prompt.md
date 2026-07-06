# GPT Built-In Image Generation Execution

Prepare provider-ready requests for GPT model built-in image generation. In Codex chat/project contexts, execute real raster generation through the system `imagegen` skill / built-in `image_gen` tool when available.

Use the source image or enhanced source image as the primary identity reference for every final product-bearing image. Do not rely on text-only prompts when the output must match the submitted product.

Every prompt must include:

- provider: gpt-built-in-image-generation
- execution_boundary: codex_native_imagegen_or_host_app_executes_generation
- identity_reference: absolute path(s) to source/enhanced source image
- identity_lock: must-preserve details
- allowed_changes: background, lighting, scene, model/props, crop, camera angle
- forbidden_changes: product color, silhouette, proportions, hardware, closure, straps/handles, accessories, logos/markings, texture, pockets, compartments, capacity, bundle items
- detail_focus: only if visible in the source evidence
- identity_check: what must be compared after generation

Do not copy competitors. Do not create ad-hoc image-generation wrappers or silently use CLI/API fallback. If the current runtime cannot execute GPT built-in image generation with required image references, return a request pack, prompt pack, or layout draft and clearly mark that final identity-preserving generation is blocked.

Return structured outputs. Label uncertainty clearly. Do not exceed the Skill boundary.
