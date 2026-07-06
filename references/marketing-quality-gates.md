# Marketing Quality Gates

Use this reference before finalizing any ecommerce image set, especially for Pinduoduo and other conversion-heavy platforms.

## Core Rule

Do not count the same product photo with different headings as a complete image set. A valid set must create different shopper decision moments.

Final image copy must be buyer-facing. Internal QA, platform notes, uncertainty labels, or workflow reminders belong in reports and blueprints, not on the exported image.

Final images must not contain arbitrary watermark-like marks or platform-pack labels. The default decision before design is no visible watermark/mark. `拼多多女包套图`, `拼多多套图`, `女包套图`, `PDD`, `SellerPilot`, `Codex`, `AI生成`, `样图`, `示例图`, and `仅供参考` are hard failures unless the user explicitly asks to add that exact mark and the run records `watermark_authorization.status: user_explicitly_requested` with exact text, placement, purpose, and image scope.

## Minimum Visual Diversity

For an 8-image Pinduoduo set, require these distinct roles:

1. Main product image: clean product identity.
2. Size and scale image: clear measurement or relative scale.
3. Detail image: closeups or cropped detail panels.
4. Outfit or wearing scene: product on/near a person or realistic styling setup.
5. Capacity/use-case image: daily items or use context without overstating capacity.
6. Commute scene: office, subway, workday, campus, or daily travel context.
7. Weekend/date/shopping scene: coffee shop, street, casual outing, or warm lifestyle context.
8. Decision summary: color, size, carrying style, details, and unresolved confirmations.

## Failure Conditions

Fail the image set if:

- The final delivery is a contact sheet, collage preview, or multi-panel overview instead of independent image files.
- More than three images use the same white-background product cutout as the primary visual.
- Product subject is too small to inspect in main, scene, or decision images.
- Scene images only show the same product cutout with a scene-related title.
- Scene roles do not have a panel-specific generated/photo scene asset from Codex/runtime execution or an approved real photo.
- Scene roles are rendered by the deterministic layout renderer from the source cutout alone.
- Scene images use flat silhouettes, generic icon people, placeholder mockups, or abstract UI blocks as if they were real scenes.
- The set lacks true visual role separation between main image, detail, capacity, scene, and summary.
- Most images use the same camera angle or product orientation.
- Detail grids repeat the same crop while changing only labels, or include blank/irrelevant crops.
- Scene images do not show any environmental context, human styling, outfit context, or realistic placement.
- Text is too small or low contrast for mobile thumbnail reading.
- Final image copy includes internal-facing terms such as `不虚标`, `以源图为准`, `示意`, `QA`, `风险`, `待确认`, or `证据不足`.
- Final image contains watermark-like or platform-pack labels such as `拼多多女包套图`, `拼多多套图`, `女包套图`, `PDD`, `SellerPilot`, `Codex`, `AI生成`, `样图`, `示例图`, or `仅供参考` without exact user authorization.
- Any `watermark`, `visible_mark`, `visible_corner_mark`, `platform_pack_label`, `system_mark`, `internal_mark`, `ai_mark`, or `watermark_text` field is populated without exact user authorization.
- Most images reuse the same large translucent rounded text card, badge layout, or decorative corner label instead of role-specific graphic design.
- Photography direction is generic and does not specify distinct camera angles, lens feel, light direction, color temperature, scene/body relationship, and product placement for each role.
- Closeup or scene images invent readable logos, trademarks, tag text, engraving, charm faces, or decorative micro-patterns not clearly visible in source images.
- Capacity images imply unverified oversized capacity.
- Capacity or storage images imply opened/interior structure when no source image shows the product interior.
- Measurement images omit confirmed numeric dimensions when dimensions were provided.
- Claims exceed the Product Fact Sheet.

## Visual Director Gate

Before generation, require a shot matrix with:

- one buyer question per image
- camera angle
- crop type
- focal subject
- lighting
- scene or background
- prop/model context
- buyer-facing message
- graphic-design intent and safe zone
- photography style archetype and lens/light notes
- micro-detail preservation notes when closeups or logos/marks are visible

Reject the blueprint if this matrix is missing or if it cannot explain why each image deserves to exist.

## Generation Policy

When the user asks for actual images and includes scene images:

- Use GPT built-in image generation prompts for the lifestyle/wearing/scene assets, then execute them through Codex-native image generation or the host app when available.
- Use deterministic rendering only for text-heavy infographics, size charts, QA-safe summaries, and final layout composition.
- If image generation is unavailable, clearly label the output as wireframe/layout draft and do not call it final scene imagery.
- Do not use flat vector people, generic body silhouettes, placeholder UI blocks, or icon scenes as final lifestyle imagery.
- For scene roles, final export requires `scene_asset_type`, `generation_status`, and a panel-specific generated/photo asset path. Missing scene assets fail the marketing gate.

## Review Surface

Render a review widget when a current-session widget tool is available. The Creative Production moodboard review widget is acceptable as a gallery review surface, but it is not the same as a native infinite-canvas annotation tool.

Always create the bundled local `review-canvas.html` as a durable fallback.
