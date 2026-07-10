# Test Cases

## Case 1: product naked image to Amazon set
Expected: final generated images when the Codex-native `imagegen` / `image_gen` is available, plus compact identity/blueprint/QA notes in fast mode or full Fact Sheet/Blueprint/QA artifacts in industrial audit mode.

## Case 2: competitor reference redesign
Expected: competitor analysis only, no copying, differentiated strategy.

## Case 3: multi-platform pack
Expected: platform-specific blueprints and localized copy.

## Case 3B: localized copy for ru/de/ar markets
Expected: `localized-copy-qa-gate.mjs` runs before final image generation for visible translated copy, requiring source-text traceability, review notes, back-translation or semantic review, localized market-language basis, and RTL/script direction when applicable.

## Case 4: unsupported medical-grade claim
Expected: QA warning and no unsupported claim in prompt.

## Case 5: low-quality source image
Expected: source image quality report and enhanced source image are created before product parsing or generation.

## Case 6: platform/category unknown or conversion-critical
Expected: platform-category research brief is written before visual direction and blueprint generation.

## Case 7: repeated camera angles and repeated detail crops
Expected: Visual Director gate or marketing gate fails before final export; revise shot matrix or regenerate only affected images.

## Case 8: internal-facing final image copy
Expected: final image copy containing terms like `不虚标`, `以源图为准`, `示意`, `QA`, `风险`, or `待确认` fails marketing gate and is rewritten into buyer-facing copy.

## Case 9: native infinite canvas unavailable
Expected: do not claim native widget success; create the tldraw workspace files, keep annotation/completion JSON or screenshot evidence, and report the widget/server limitation.

## Case 10: product feature and audience analysis missing
Expected: complete image generation must stop before visual direction and create `03-product-feature-analysis.yaml` and `04-audience-positioning-analysis.yaml`; shot matrix and copy must reference feature benefits, buyer motivations, objections, and scene priorities.

## Case 11: generated image drifts from source identity
Expected: create Product Identity Lock before generation; generated image must fail identity gate if silhouette, color family, hardware, closure, strap/handle, accessory, logo/marking, texture, or distinctive details do not match the source. Regenerate only the failed asset with image reference and tighter identity constraints.

## Case 12: generator cannot use image reference
Expected: produce prompt pack or layout draft only; do not label the output as final identity-preserving product imagery.

## Case 12B: Codex-native imagegen/image_gen generation is available
Expected: a normal chat request for generated ecommerce images uses the system `imagegen` skill / built-in `image_gen` tool as the execution layer, saves independent final image files, and records concise identity/QA notes. It must not stop at a request pack or claim `blocked_runtime_unavailable`.

## Case 12D: ThinkAI gpt-image-2 variant is selected
Expected: a normal chat request through `sellerpilot-product-image-industrial-thinkai`, or an explicit ThinkAI provider request, uses `scripts/thinkai-image-runtime.mjs` with model `gpt-image-2`, saves independent final image files, and records concise identity/QA notes when the ThinkAI runtime and key are available.

## Case 12C: runtime has no GPT built-in image generation / image-reference access
Expected: produce `10-generation-request-pack.yaml`, final generation prompt pack, layout draft, QA plan, and `generation_status: blocked_runtime_unavailable`. Do not claim final generated ecommerce images were produced.

## Case 13: fixed platform YAML vs category-specific run research
Expected: load the baseline platform YAML, then create `research/platform-category-profile-overlay.yaml` for current platform/category findings. Do not mutate the global platform profile unless findings are official or stable across runs.

## Case 14: bestseller design mining
Expected: collect and summarize high-performing category patterns without copying competitor assets, layouts, exact copy, model pose, brand style, or unsupported claims. Output `research/bestseller-design-mining.md` and `research/bestseller-patterns.yaml`.

## Case 15: multiple source product images
Expected: create `source-image-set-manifest.json`, enhance each user-owned source image, classify roles, fuse complementary evidence into Product Identity Lock, and stop on conflicting product sources.

## Case 16: generated image review with A-H regions
Expected: create `review/review.html` with clickable A-H editable regions and exportable revision feedback whenever actual images are generated.

## Case 17: LatAm and cross-border marketplace baseline profiles
Expected: SHEIN, Temu, Mercado Libre, Shopee LatAm/Brazil, and Falabella requests load the matching baseline profile and still create a run-level platform/category overlay before final generation.

## Case 18: export filename with English purpose slug
Expected: exported image files must use stable IDs plus English purpose slugs, such as `IMG-01-main-product.png`, `POSTER-01-campaign-poster.png`, and `DETAIL-03-product-solution.png`; plain `IMG-01.png` is not sufficient.

## Case 19: contact sheet or collage delivered as final
Expected: fail export gate when a contact sheet/collage is placed in `final-images`. Final ecommerce image delivery must include independent image files; the required `overview/SET-OVERVIEW-contact-sheet.png` is a separate package overview artifact only.

## Case 20: fake scene placeholder
Expected: fail marketing gate when scene images use flat silhouettes, icon people, abstract UI blocks, or background shapes instead of real product-in-context scene assets.

## Case 21: weak detail/capacity image
Expected: fail if detail crops are blank/repeated/untraceable to source evidence, or if capacity/interior claims are implied without source evidence.

## Case 22: post-upgrade scene regression
Expected: if an 8-image Pinduoduo set says `含场景图`, at least two scene roles must have true generated/photo scene assets such as wearing/outfit and cafe/street/commute. A deterministic layout that only reuses the source product cutout with scene titles must fail renderer validation and marketing gate, and be labeled layout draft rather than final scene imagery.

## Case 23: premature generic final prompt
Expected: final prompt delivery fails prompt readiness gate when commerce strategy, creative direction, photography treatment, sketches/wireframes, or personalization markers are missing. The skill must output a blocked prompt-readiness report instead of a fixed generic prompt.

## Case 24: prompt layer brain requires conditional scene layer
Expected: when the Prompt Layer Architect Brain decision basis contains scene/wearing/lifestyle intent, the prompt layer gate must require `scene_asset_layer`. If missing, it fails with return node `scene-asset-production` or `prompt-layer-stack`; final generation prompt delivery is blocked.

## Case 25: unified QA loop routing
Expected: when multiple gate reports fail, `qa-loop-router.mjs` reads the reports and writes one routing decision with `status`, `primary_failure_type`, `return_node`, `smallest_next_action`, `rerun_from`, `do_not_rerun`, `retry_budget`, and `user_input_required`. Fake scene failures return to `scene-asset-production`; export-only failures return to `export-packaging`; generic prompt failures return to `prompt-layer-stack`.

## Case 26: export pass cannot override failed marketing gate
Expected: if 8 square PNG files exist but marketing gate fails for missing scene assets, `final-delivery-gate.mjs` must fail. The run may report technical export success, but it must not be called a complete ecommerce image set.

## Case 27: layout draft images in final-images
Expected: `image-set-export-gate.mjs` fails by default when files in `final-images` contain `layout-draft`, `draft`, `placeholder`, `wireframe`, or `blocked` in the filename. Draft assets belong in layout/review artifacts, not final ecommerce exports.

## Case 28: tldraw review workspace
Expected: `create-tldraw-review-workspace.mjs` reads the current run's `export/final-images-manifest.json`, creates a React + Vite review workspace, copies only those task images into `public/imported-images`, writes `data/import-manifest.json`, and provides `data/annotations.json`, `data/canvas-state.json`, `data/review-completion.json`, and `data/generation-tasks.json` for Codex-readable review handoff. Local file URLs should not be required for browser image rendering.

## Case 29: annotation JSON to generation tasks
Expected: `parse-canvas-annotations.mjs` converts open annotations into generation tasks with `image_id`, `region`, `issue_type`, `return_node`, `action`, and `rerun_scope`. Scene feedback routes to `scene-asset-production`, copy feedback to `localized-copy-pack`, layout feedback to `layout-wireframes`, and identity feedback to `product-identity-lock`.

## Case 30: short natural request is sufficient
Expected: a user request like `请使用 $sellerpilot-product-image-industrial 为拼多多女包生成 8 图套图` or `生成一张拼多多女包主图` triggers the appropriate workflow without requiring the user to spell out source enhancement, identity lock, platform research, model/tool name, QA loop, or review-canvas policy. Those are skill responsibilities.

## Case 30B: fast generation mode keeps normal chat lightweight
Expected: short generation requests default to fast generation mode. The skill outputs final images, concise generation summary, compact identity/visual/QA notes, and only creates review canvas artifacts when requested or needed. It does not create the full industrial audit tree by default.

## Case 30C: explicit industrial audit mode
Expected: when the user asks for 工业级完整 workflow, audit package, gate reports, or SellerPilot migration evidence, the skill creates the full run skeleton, research artifacts, prompt packs, gate reports, QA routing decision, review workspace, and export package.

## Case 31: tldraw server launch policy
Expected: creating a tldraw workspace for visual review automatically starts or reuses the shared service and returns one ready URL like `http://127.0.0.1:5190/?session=<session-id>`. Selftests and file-only archives may pass `--no-auto-start`. `start-tldraw-review-workspace.mjs` remains an isolated fallback that starts at most one server per workspace.

## Case 32: brief intake asks only high-value questions
Expected: after user text and images arrive, the skill runs Brief Intake Gate. If target platform, category, source image, count, and safe scene defaults are enough, it continues without interrupting. If source identity is weak, claims are unsupported, scenes are commercially ambiguous, or sources conflict, it asks at most three concise questions and records assumptions.

## Case 33: user clarification is merged into task analysis
Expected: when the user replies with scene preference, extra product facts, audience, platform, dimensions, or negative constraints, the skill updates task analysis, Product Identity Lock, visual direction, prompt layers, and QA criteria before generating or continuing remaining images.

## Case 34: generation pacing for multi-image sets
Expected: an 8-image set first generates an anchor batch of about three assets: main identity/hero, one high-risk scene or scale image, and one detail image. The skill runs focused identity/scene QA before generating remaining images. It then continues only missing or failed assets, not the full set.

## Case 35: unfinished long-running generation has progress state
Expected: after each generated asset, the run records progress with completed, pending, failed, next action, and whether user feedback can improve the next batch. A partial run with 3 of 8 images should be resumable from pending roles, not restarted.

## Case 36: watermark or platform-pack label in final image
Expected: final image text or layout fields containing `拼多多女包套图`, `拼多多套图`, `女包套图`, `PDD`, `SellerPilot`, `Codex`, `AI生成`, `样图`, `示例图`, or `仅供参考` fail marketing gate with `watermark-or-platform-pack-label`. The QA router returns to `graphic-design-direction` and rerenders affected layout only.

## Case 37: graphic design direction is required
Expected: before final prompts or layout composition, the skill creates a Graphic Design Direction Brief with typography hierarchy, safe zones, overlay style, text density, color/contrast, mobile thumbnail rule, per-image layout intent, and no-watermark policy. A set that repeats the same translucent rounded-card layout across most images fails as `repeated-template-card-layout` or `weak-graphic-design-system`.

## Case 38: commercial photography style archetype is required
Expected: each image role has a photography style archetype plus camera angle, lens feel, crop, camera height, lighting direction, color temperature, scene/body relation, product placement, props/scale cues, and identity risks. Generic labels such as only `高级商拍` or `电商风` fail as `generic-photography-style`.

## Case 39: unclear micro-detail asks or locks
Expected: when source images show unclear logos, product names, tags, engravings, charm faces, or tiny printed text, Brief Intake Gate asks for a clearer closeup only if it materially improves the output. If the user does not provide it, Product Identity Lock records `micro_detail_lock` and final prompts preserve placement/shape/contrast as unreadable marks instead of readable invented text.

## Case 40: no invented brand or readable micro text
Expected: generated or planned closeups fail identity/marketing QA if they invent a readable logo, trademark, tag text, hardware engraving, charm face, or decorative micro-pattern that is not clearly visible in the source image. The QA router returns to `product-identity-lock` and regenerates only affected assets.

## Case 41: verified tldraw shared service launcher
Expected: after `create-tldraw-review-workspace.mjs` creates a review workspace, `open-tldraw-review-session.mjs` registers the workspace, starts or reuses the shared tldraw service, waits until the session URL responds, and returns `status: ready` plus a clean URL like `http://127.0.0.1:5190/?session=<id>`. If npm install emits logs before JSON, the launcher must still parse the final JSON response. If an old PID is alive but the URL is unreachable, the launcher must restart instead of returning a dead canvas URL.

## Case 42: project-level default entrypoint
Expected: a Codex Project that wants SellerPilot product image work can keep an `AGENTS.md` at the project root pointing to `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial`. Natural language requests inside that Project should use this skill by default, store run artifacts under `runs/<run-id>/`, keep production/QA reads scoped to that run's `final-images` and `export/final-images-manifest.json`, copy final deliverables to `outputs/` only after QA, and launch the tldraw review canvas with `open-tldraw-review-session.mjs` when visual revision is next.

## Case 42B: cross-task image isolation
Expected: if three product-image tasks write or copy files into one shared `outputs/` directory, overview/review/export scripts must not scan that shared directory. They should fail unless given the exact current `run-dir/final-images` or `export/final-images-manifest.json`. The generated overview and tldraw manifest must include only the current task's images.

## Case 43: rough user request gets strategy options
Expected: a broad request like `帮我把这件球衣做一套商品图` creates `strategy/direction-options.json`, `strategy/direction-options.md`, and `strategy/direction-selection.yaml` with 2-3 buyer-facing directions. If the user does not choose, the harness records `selected_option_id` and continues from that route.

## Case 44: platform profile memory is baseline only
Expected: platform YAML is treated as stable baseline memory, not complete live truth. `platform-context-planner.mjs` writes baseline interpretability, refresh cadence, dynamic season/climate/holiday/region fields, `web_research_required`, and query plan into `research/platform-context-plan.json` and `research/platform-category-profile-overlay.yaml`.

## Case 45: marketing copy uses current context and evidence
Expected: copy strategy records buyer question, conversion intent, purchase objection, platform/category/season/region basis, and evidence for risky claims or hot words. `copy-strategy-gate.mjs` fails unsupported claims, unverified hot words, and copy that ignores required dynamic context.

## Case 45B: localized copy QA blocks unreviewed translation
Expected: ru/de/ar class visible copy cannot pass into final generation without `localized-copy-qa-gate.mjs`. The gate should fail missing source-text traceability, missing review notes, missing back-translation or semantic review, low confidence, missing localized market basis, and RTL direction or mixed-script issues when relevant.

## Case 46: apparel geometry drift catches shortened jersey
Expected: for a source jersey with normal length and lower hem, a generated model image marked cropped/above-waist fails `identity-geometry-gate.mjs` with `apparel-length-shortened` or `geometry-class-drift`. The QA router should regenerate only the failed image with stricter geometry lock, not the full set.

## Case 47: review workspace layer and completion contract
Expected: the review workspace has no left sidebar. Generated images are the bottom `image-floor-layer`; A-H standards and annotation markers are the upper `standard-overlay-layer`; the image file list is a top dropdown; the direct modification form uses image standard fields; the board has a locked no-independent-zoom policy; `Complete Review` creates a screenshot-oriented completion payload that Codex can capture with `capture-review-session.mjs`.

## Case 48: rough request must show direction handoff first
Expected: a rough request such as `帮我把这件球衣做一套商品图` or `帮我把这个灯串固定夹做一套商品图` runs `strategy-direction-gate.mjs` and then `strategy-direction-handoff-gate.mjs` before formal production. The first visible response includes 2-3 buyer-facing directions plus the harness-selected fallback. If the user does not choose, the selected route is recorded in `strategy/direction-selection.yaml` and the handoff message is saved to `strategy/direction-user-handoff.md`.

## Case 49: physical function and scale gate blocks invented use
Expected: for a physical product such as a cable/string-light clip, the skill creates `blueprint/02b-product-physical-truth.json` before installation/use/dimension images. `product-physics-fact-gate.mjs` fails if panels invent functions like unsupported `Press to Hold`, snap locks, adhesive/magnetic mounting, waterproof electrical behavior, or if the same product appears materially larger/smaller across images without explicit zoom/crop rationale.

## Case 50: prompt stack requires physical function layer
Expected: when prompt layer decision basis mentions installation, cable routing, screw mounting, holding, pressing, locking, clipping, waterproofing, load, or similar physical function, `prompt-layer-gate.mjs` requires a non-thin `physical_function_layer` with confirmed functions, confirmed user actions, forbidden generated functions, scale reference, and negative QA.
