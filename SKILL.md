---
name: sellerpilot-product-image-industrial
description: Use when Codex needs to create, plan, review, or revise industrial ecommerce product image sets for SellerPilot-style workflows, including Amazon listing images, TikTok Shop images, Xiaohongshu image packs, multi-platform product image packs, competitor-reference redesigns, product image QA, localized commerce copy, and product fact-sheet based visual generation. Trigger for Chinese or English requests about 商品图, 产品图, 电商套图, Amazon 7 image sets, listing images, product-image generation, product-image prompts, competitor image redesign, or SellerPilot product image production.
---

# SellerPilot Product Image Industrial

## Purpose

Use this skill as the Codex chat/project entrypoint for SellerPilot-style ecommerce product image production. It turns product URLs, source product images, competitor references, platform targets, audience context, and style requirements into generated product images plus only the planning, QA, and review artifacts needed for the selected mode.

Actual production image generation must target Codex-native GPT built-in image generation. In Codex chat/project contexts, the normal execution layer is the system `imagegen` skill using the built-in `image_gen` tool. Use that native path for real raster outputs whenever the user asks to generate ecommerce images and the current host exposes it.

This skill owns the SellerPilot industrial workflow: product truth, identity locks, source-photo enhancement, platform/category research, visual strategy, photography direction, prompt layering, QA routing, review surfaces, and export rules. It may call the system `imagegen` skill / built-in `image_gen` as the production execution layer; it must not create one-off image-generation wrappers, silently switch to API/CLI fallback, or claim deterministic layout drafts as final generated product images.

The final generation prompt is a personalized production brief, not a generic fixed prompt. Build it only after product truth, market/platform context, audience, commerce strategy, creative direction, photography treatment, layout intent, and self-review have shaped the image goal. Request packs are fallback or audit artifacts, not the default user-facing deliverable.

Installed capability root:

```text
/Users/yang/.codex/skills/sellerpilot-product-image-industrial
```

When developing this skill outside the installed capability root, verify the development copy first, then sync it into the installed root with the bundled release script. Do not hand-copy partial files.

Do not copy competitor visuals, invent product facts, auto-publish assets, or promise CTR, CVR, ROAS, ACOS, ranking, or sales lift.

## User Request Contract

Treat short natural user requests as the ideal entrypoint. The user should be able to say:

```text
请使用 $sellerpilot-product-image-industrial 为拼多多女包生成 8 图套图。
```

or:

```text
生成一张拼多多女包主图。
```

Do not require the user to recite the industrial workflow, QA policy, generation boundary, blocked-runtime behavior, model name, tool name, or review-canvas rules. Infer the missing production steps from the product/category/platform request, then run the workflow conservatively. If the user asks for "生成图片/套图" and the task needs product-bearing generation, attempt Codex-native built-in image generation through the system `imagegen` skill / built-in `image_gen` tool when available. Only create a request pack as fallback or audit evidence when generation cannot be executed or when the user explicitly asks for it.

The long strict prompt is an internal acceptance policy, not a required user prompt.

## Brief Intake Gate

After receiving the user's text and image(s), run a brief intake judgment before planning or generation. This is a professional screening step, not a form the user must fill out.

Continue without interruption when the request already contains enough to proceed safely: product/category, source image or clear non-identity requirement, target platform or usable default, image count or platform default, and no unsupported claims.

Ask the user for 1-3 concise clarifications only when the answer would materially improve output quality or prevent a false claim. Prefer assumptions over questions for low-risk gaps. High-value clarification examples:

- target platform, country/locale, or listing context is missing and cannot be inferred.
- source image is too weak for product identity and more angles/details would materially help.
- user requests capacity, material, waterproof, genuine leather, certification, brand, price/promo, or dimensions that are not visible/provided.
- scene/model style is commercially important but ambiguous, such as commuter, cafe, gift, office, campus, luxury, low-price, or seasonal campaign.
- multiple source images appear to be different products or conflict on color/structure.

When asking, state the current working assumptions and continue automatically if the user chooses not to answer. Merge any user reply into task analysis, Product Identity Lock, visual direction, prompt layers, and QA criteria. Do not ask about internal workflow, model names, tool names, or runtime boundaries.

## Execution Modes

Choose the lightest mode that satisfies the user's request:

- **Fast generation mode (default for chat):** Use for short requests such as "生成一张图", "做 8 图套图", or "含场景图" unless the user asks for a full audit package. Run compact product/source analysis, source-photo enhancement if needed, source product understanding/OCR pass, identity lock, platform/category baseline plus targeted research only when useful, visual shot matrix, concise prompt layer planning, Codex-native image generation, focused QA, delivery overview contact sheet, and final image export. Required user-facing outputs are final images, saved paths, concise generation summary, identity/QA notes, set overview image, and optional tldraw review session only when requested or needed for revision.
- **Industrial audit mode:** Use when the user asks for 工业级完整 workflow, 可迁移到 SellerPilot, 审计, gate reports, review records, or development evidence. Produce the full run skeleton, research briefs, prompt packs, gate reports, QA routing records, review workspace, and export package.
- **Debug/development mode:** Use only while improving this skill. Keep selftests, intermediate fixtures, verbose gate JSON, and experimental work under `work/` or an explicit temp/debug directory. Do not let debug artifacts affect normal chat generation.

For normal chat, do not create every artifact listed in the full output contract. Create only the artifacts needed to generate, QA, and deliver the requested images. Escalate from fast mode to industrial audit mode only when a gate fails repeatedly, source identity is ambiguous, runtime generation is unavailable, or the user asks for the full package.

## Execution Flow

1. Resolve the skill root to `/Users/yang/.codex/skills/sellerpilot-product-image-industrial`. Read `/Users/yang/.codex/skills/sellerpilot-product-image-industrial/AGENTS.md` before running a production image workflow. Do not search only the current workspace for `AGENTS.md`.
2. Run the Brief Intake Gate. If required information is missing, ask at most three high-value questions and record the assumptions. If no material gap exists, continue without interrupting the user.
2a. When the user request is rough or commercially open-ended, load `references/strategy-direction-routing.md`, create 2-3 production direction options, and run `strategy-direction-handoff-gate.mjs` before formal production. The first visible response to the user must include the short direction choices plus the harness-selected fallback. Do not skip this just because enough facts exist to generate. If the user has no clear preference, continue with the harness-selected `selected_option_id`, record the reason in `strategy/direction-selection.yaml`, and keep the user-visible handoff in `strategy/direction-user-handoff.md`.
3. Use `workflows/ecommerce-product-image-generation.yaml` as the default master workflow for complete product image generation. Then load the closest platform-specific workflow/profile only for extra constraints:
   - `amazon-image-set.yaml` for Amazon listing image sets, including Amazon US 7 image sets.
   - `pinduoduo-image-set.yaml` for 拼多多 7-9 图套图, user-specified image counts, and Chinese conversion image sets.
   - `competitive-redesign.yaml` when competitor references are provided for analysis or differentiation.
   - `multi-platform-image-pack.yaml` when adapting one product across Amazon, TikTok Shop, and Xiaohongshu.
   - `tiktok-shop-image-set.yaml` for international TikTok Shop mobile-first image sets.
   - `xiaohongshu-image-pack.yaml` for Xiaohongshu cover and seed image packs.
   - Other supported platform profiles such as 京东/JD, 抖音/Douyin, SHEIN, Temu, Mercado Libre, Shopee LatAm/Brazil, Falabella, Ozon, Etsy, and Wildberries/WB use the master workflow plus their `platform-profiles/*.yaml` baseline and a run-level platform/category overlay.
4. Run source image quality preflight. If the user provides multiple images, build a source image set manifest and enhance each user-owned source image before parsing/generation. If photos are low quality, cluttered, dark, small, or handheld, enhance them with the bundled scripts before parsing/generation.
4a. Create Source Product Understanding from the original/enhanced source image before identity lock or prompt work. Use local OCR when available and Codex visual inspection to recognize product type, structure, components, material/color, physical size cues, scale references, visible text, labels, warnings, dimensions, specs, and function clues. If source text reveals size, model, compatibility, warning, certification, installation, material, quantity, or weight, record it as text-derived facts and propagate it into identity lock, physical truth lock, geometry lock, and prompt layers. Do not generate over these facts or silently drop them.
5. Create a Product Identity Lock from all source/enhanced images and Source Product Understanding before generation. Lock silhouette, proportions, color family, material appearance, hardware, closure, straps/handles, accessories, logo/markings, distinctive details, and text-derived facts that affect physical size/function. If no source image exists, do not call generated images identity-preserving.
5a. For physical products, load `references/product-physical-truth.md`. Create `blueprint/02b-product-physical-truth.json` before shot matrix or prompt work whenever the set shows installation, use steps, scale, cable/strap routing, moving parts, fixtures, fasteners, load, waterproofing, or product function. Lock confirmed functions, confirmed user actions, forbidden generated functions, and scale reference. Do not show invented use mechanisms such as unsupported press locks, adhesive/magnetic mounting, waterproof electrical behavior, extra moving parts, or inconsistent product size across images. Run `product-physics-fact-gate.mjs` before final delivery when physical function or scale appears in the image set.
6. Load only the relevant baseline platform profile from `platform-profiles/`.
7. Run platform/category research with web search when the target platform/category tone is unclear, recent, or conversion-critical. Treat platform YAML as a baseline, not complete live truth. Load `references/contextual-platform-research.md` when season, climate, holiday, region, trend, or marketing language matters. Create `research/platform-context-plan.json` and a run-level platform/category overlay from current research.
8. Run bestseller design mining when marketing enhancement, click appeal, category differentiation, or "爆品" learning is required. Borrow patterns, not assets, layouts, copy, or brand style.
9. Run Product Feature Analysis and Audience Positioning Analysis. Convert confirmed traits into buyer-relevant benefits, detail-shot opportunities, scene triggers, buyer motivations, purchase objections, aesthetic preferences, and copy voice. Keep unsupported claims out of final image copy.
9a. Load `references/copy-strategy-loop.md` before final image text or prompt delivery. Plan copy from product truth plus platform/category/season/region research, run `copy-strategy-gate.mjs`, and revise only failed copy fields before marketing QA.
10. Create a goal contract, commerce strategy brief, creative direction brief, graphic design direction brief, and photography treatment before prompt delivery. Each image needs a buyer question, commercial task, and success/failure criteria.
11. Create sketches or layout wireframes before final generation prompts. Load `references/sketch-to-final-production.md` for complete image sets, scene-heavy work, or any run where final quality matters.
12. Create a Graphic Design Direction Brief and Visual Direction Brief before full image generation. A design director must define typography hierarchy, safe zones, overlay style, text density, mobile legibility, set-level layout variation, and the visible-mark decision. Default visible-mark decision is absolute prohibition: no watermark, platform-pack label, system mark, or arbitrary corner mark unless the user explicitly requested that exact mark and the run records `watermark_authorization` with exact text, placement, purpose, and image scope before prompt/layout work. A visual director must define the shot matrix, camera angles, crops, lighting, scene logic, prop/model context, buyer-facing copy intent, and A-H editable regions for every image. Do not allow final image copy to sound like internal QA notes.
13. If the user asks for 场景图, 上身图, 模特图, lifestyle, outfit, commute, cafe, street, or `含场景图`, load `references/scene-asset-production.md`. Scene roles require real generated/photo scene assets; a product cutout on a decorative layout is not a final scene image.
14. Load `references/prompt-layering-subloop.md`, `references/personalized-prompt-delivery.md`, and `references/gpt-built-in-image-generation-policy.md` before final product-bearing image generation. Use the Prompt Layer Architect Brain to decide mandatory and conditional layers, then prepare a personalized built-in image generation request with source image references when available, identity locks, commercial intent, photography treatment, layout intent, QA expectations, and retry policy. If the current Codex/runtime surface exposes the system `imagegen` skill and built-in `image_gen` tool, execute the request through that native path. If it cannot execute required image-reference generation, stop at request pack/layout draft and mark final generation blocked.
14a. For apparel, bags, shoes, furniture, tools, and other proportion-sensitive products, load `references/identity-geometry-lock.md`. Create or update `geometry/source-geometry.json` before generation and run `identity-geometry-gate.mjs` on generated assets before final delivery. Apparel must preserve garment length, hem position, collar-to-hem ratio, sleeve length class, neckline shape, and silhouette; a normal jersey must not become a crop top unless supported by source/user input.
15. For multi-image sets, use generation pacing: generate and QA a small anchor batch first, then continue with only missing/failed assets. Do not spend a full run serially generating all images before checking identity, scene direction, and role diversity.
15a. When the user provides prior generated outputs and asks to continue, audit, optimize, or revise them, load `references/failed-output-regeneration.md` first. Classify failures such as watermark/platform-pack labels, weak graphic design, generic photography treatment, unclear micro-detail handling, identity drift, fake scenes, or repeated layouts; keep approved assets and rerun only the smallest affected upstream node.
16. Load the risk and QA references before writing final outputs:
   - `policies/risk-boundaries.md`
   - `policies/qa-checklist.md`
17. Use the workflow steps as a gated loop, not as decorative labels. Generate only missing assets, rerender only failed layouts, and stop early when product identity, geometry, or copy strategy drifts.
18. Run export and output-failure gates before final delivery. Do not present contact sheets, collage previews, fake scene placeholders, or visually unreadable drafts as final ecommerce images. For multi-image sets, generate a separate delivery overview contact sheet under `overview/`; it is a package review artifact and does not replace independent final images.
19. Produce the mode-appropriate Definition of Done. Fast mode should end with actual generated images and a concise QA summary; industrial audit mode should produce the full artifact package.

## Bundled Scripts

Use bundled scripts for deterministic support work. They do not replace Codex-native image generation.

For skill development and release hygiene:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/verify-skill.mjs
```

Use this before shipping skill changes. It validates frontmatter, script syntax, JSON/YAML, legacy provider naming, tldraw dependency lock, gate behavior, renderer scene boundaries, export failures, marketing failures, and review workspace creation.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/sync-to-codex-skill.mjs \
  --source /abs/development-copy
```

Use this after verification when a development copy must update the installed Codex skill. It backs up the installed skill, rsyncs the source with safe excludes, and verifies the installed copy matches the source.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/brief-intake-gate.mjs \
  --out-dir /abs/run/brief-intake \
  --platform "拼多多" \
  --category "女包" \
  --image-count 8 \
  --has-source-image true \
  --scene-requested true
```

Use the brief intake gate to decide whether to ask high-value user questions before planning/generation. It should not block low-risk requests.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-gate.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣" \
  --season "summer"
```

Use the strategy direction gate when the user request is rough. It creates 2-3 production directions, records the selected direction, and allows the harness to continue autonomously when the user has no explicit preference.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-handoff-gate.mjs \
  --run-dir /abs/run
```

Use the strategy direction handoff gate immediately after `strategy-direction-gate.mjs`. It writes `strategy/direction-user-handoff.md` and `strategy/direction-user-handoff.json`; the Markdown contains the first user-visible message that must be sent before formal production for rough/open requests.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/platform-context-planner.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣" \
  --region "华南" \
  --season "summer" \
  --climate "hot-humid"
```

Use the platform context planner before conversion-oriented planning and copy. It reads the baseline platform YAML, reports whether it is sufficient as stable memory, creates a freshness/query plan, and writes dynamic platform/category/season/region context into the run overlay.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/build-source-image-set.mjs \
  --images "/abs/front.png,/abs/detail.png,/abs/side.png" \
  --out-dir /abs/run \
  --category "女包"
```

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-run-skeleton.mjs \
  --out-dir /abs/runs/run-id \
  --platform "拼多多" \
  --category "女包" \
  --product-name "商品名"
```

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/enhance-source-image.mjs \
  --input /abs/source.png \
  --out-dir /abs/run/source-enhanced
```

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-source-product-understanding.mjs \
  --image /abs/run/source-enhanced/source-enhanced.png \
  --out-dir /abs/run/source-understanding \
  --category "线夹"
```

Use this after source enhancement and before identity lock. It creates `source-product-understanding.json` with image metadata, local OCR text when available, text-derived fact candidates, and fields for Codex visual product recognition. Complete the visual/OCR read before generation whenever visible text, size, installation, function, compatibility, material, warnings, or labels affect the product.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/source-product-understanding-gate.mjs \
  --understanding /abs/run/source-understanding/source-product-understanding.json \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml \
  --physical-truth /abs/run/blueprint/02b-product-physical-truth.json \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --out-dir /abs/run/qa
```

Use this before prompt delivery and final delivery when a source image has product facts or visible text. It blocks missing product recognition, unstructured OCR text, and size/function/spec text facts that were not propagated into downstream locks.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/render-commerce-image-set.mjs \
  --source-image /abs/product.png \
  --out-dir /abs/output-dir \
  --product-name "商品名" \
  --dimensions "28 x 8 x 20cm" \
  --platform "拼多多"
```

This renders independent `1200x1200` PNG layout assets. It does not create an HTML review canvas. It is a deterministic layout/composition tool, not a replacement for GPT built-in image generation scene imagery. When the user asks for 场景图, 上身图, 模特图, or lifestyle images, generate those scene assets through Codex-native `imagegen` / `image_gen` when available, then use this renderer only for final text/layout composition. For scene roles, pass a panel-specific `image`, `image_path`, `generated_asset_path`, or `scene_asset_path`; do not render a final scene from the source cutout alone.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/marketing-gate-check.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

Use the marketing gate before final export to catch repeated camera angles, repeated source images, thin scene direction, and internal-facing copy such as `不虚标`, `以源图为准`, `QA`, or `风险` in final image text.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/copy-strategy-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --platform-context /abs/run/research/platform-context-plan.json \
  --out-dir /abs/run/qa
```

Use the copy strategy gate before marketing QA. It blocks thin buyer strategy, unsupported claims, unverified hot words, and copy that ignores required season/climate/holiday/regional context.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/product-physics-fact-gate.mjs \
  --fact-lock /abs/run/blueprint/02b-product-physical-truth.json \
  --panels /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

Use the product physics fact gate before final delivery whenever images show physical function, installation, use steps, routing, scale, dimensions, fixtures, fasteners, or mechanisms. It blocks unsupported function claims, invented product actions, and product scale drift across the image set.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/identity-geometry-gate.mjs \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --generated-geometry /abs/run/geometry/generated-geometry.json \
  --out-dir /abs/run/qa
```

Use the identity geometry gate for apparel and other proportion-sensitive products. It catches product length, hem position, sleeve length, neckline, silhouette, and ratio drift such as turning a normal jersey into a crop top.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/prompt-readiness-gate.mjs \
  --run-dir /abs/run
```

Use the prompt readiness gate before final prompt/request delivery. It blocks generic or premature prompt handoff when strategy, sketches, photography treatment, layout intent, or personalization markers are missing.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/prompt-layer-gate.mjs \
  --stack /abs/run/prompt-pack/12-prompt-layer-stack.json \
  --out-dir /abs/run/qa
```

Use the prompt layer gate before final prompt/request delivery. It checks the Prompt Layer Architect Brain decision, mandatory base layers, conditional layers, layer conflicts, and generic prompt risk.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/image-set-export-gate.mjs \
  --image-dir /abs/run/final-images \
  --out-dir /abs/run/qa \
  --expected-count 8 \
  --require-square
```

Use the export gate before final delivery to catch contact-sheet-only outputs, non-independent images, missing English purpose slugs in filenames, low resolution, and wrong aspect ratios.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-delivery-overview.mjs \
  --image-dir /abs/run/final-images \
  --out-dir /abs/run/overview \
  --title "商品套图总览"
```

For every multi-image set, create `overview/SET-OVERVIEW-contact-sheet.png` and `overview/delivery-overview-report.json` before final delivery. This 总览图 is for package review and conversation handoff only; it must not be placed in `final-images` or used as a substitute for independent ecommerce images.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/final-delivery-gate.mjs \
  --run-dir /abs/run
```

Use the final delivery gate after all QA gates and before telling the user a set is complete. It aggregates upstream gate reports, blocks delivery when required generation is unavailable, requires a delivery overview contact sheet for multi-image sets, and rejects draft/placeholder/wireframe assets in `final-images`. A technical export pass is not enough for ecommerce image acceptance.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/qa-loop-router.mjs \
  --run-dir /abs/run
```

Use the QA loop router after any gate failure or warning. It reads gate reports from `/abs/run/qa`, outputs one routing decision, and tells the workflow which upstream node to return to, what to rerun, what not to rerun, whether user input is required, and what retry budget applies.

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-identity-consistency-review.mjs \
  --source /abs/source.png \
  --generated-dir /abs/run/generated-assets \
  --out-dir /abs/run/qa \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml
```

Use the identity consistency review before final export. It creates side-by-side source-vs-generated review artifacts for checking product silhouette, color, material appearance, hardware, closure, strap/handle, accessories, logos/markings, and distinctive details. Machine checks are not enough; inspect the generated images visually against the source image and identity lock.

For existing images, create a local infinite-canvas style review board:

Preferred rich local workspace:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-tldraw-review-workspace.mjs \
  --out-dir /abs/run/review-workspace \
  --image-dir /abs/run/final-images \
  --run-dir /abs/run \
  --title "商品图审核工作台"
```

This creates a React + Vite review workspace with copied image assets, `data/import-manifest.json`, `data/annotations.json`, `data/canvas-state.json`, `data/review-completion.json`, and `data/generation-tasks.json`. By default it also starts or reuses the shared tldraw service and returns a ready session URL. The review plane must render generated product images as the bottom floor layer, with A-H standards, issue markers, and revision annotations floating above the images. Do not use a left sidebar. Put the image file list in the top dropdown, keep the review board from zooming independently, and if any scaling is introduced it must scale images and standards together.

The workspace and shared canvas service are started automatically when visual review is needed. Use `--no-auto-start` only for selftests, file-only artifact generation, or explicitly non-interactive audit archives.

When interactive review or revision markup is the next step, ensure the shared service is ready before final delivery with the one-step launcher. This is also the fallback command if automatic startup from workspace creation is blocked:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/open-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

This registers the workspace, starts or reuses the shared localhost service, waits until the URL responds, and returns the ready session URL. If automatic startup or this launcher fails, report the blocked reason and keep the tldraw workspace files plus annotation JSON as the durable artifact instead of claiming the canvas is available.

Preferred shared service for multiple chats/runs:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/register-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/start-tldraw-shared-service.mjs \
  --session-id run-or-chat-id
```

This starts or reuses one shared localhost canvas service and opens each chat/run as `/?session=<session-id>`. Use this mode for normal Codex App usage so parallel chats do not each need their own Vite server.

Isolated fallback server for one workspace:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/start-tldraw-review-workspace.mjs \
  --workspace-dir /abs/run/review-workspace
```

This writes `data/server-state.json` with the selected localhost URL. It starts at most one server per workspace directory. Use it only when the shared service is undesirable, unavailable, or isolation is explicitly required.

After the user exports or saves annotations, convert them into generation tasks:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/parse-canvas-annotations.mjs \
  --annotations /abs/run/review-workspace/data/annotations.json \
  --out /abs/run/review-workspace/data/generation-tasks.json \
  --run-dir /abs/run
```

After the user clicks `Complete Review`, capture the current browser session when Codex needs screenshot evidence back in the conversation:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/capture-review-session.mjs \
  --url http://127.0.0.1:5190/?session=run-or-chat-id \
  --out-dir /abs/run/review-workspace/captures
```

The completion button creates a screenshot-oriented `review-completion.json` browser payload and PNG. Parse either `annotations.json` or the completion payload with `parse-canvas-annotations.mjs`, then continue only the affected revision tasks.

If a native Codex/Sites, Creative Production, Figma/FigJam, or app widget review surface is available in the current session and can actually render the image assets, render that review surface too; still keep the tldraw workspace files or annotation JSON as the durable artifact. Do not render a widget with local paths when it only shows placeholders.

For image sets that need precise revision feedback, also create a clickable A-H region review page:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/create-region-review-html.mjs \
  --image-dir /abs/run/final-images \
  --out /abs/run/review/review.html
```

Use A-H region feedback for revision briefs: A product subject, B background, C main title, D subtitle, E selling-point labels, F decoration, G people/scene, H overall style.

## Input Handling

Classify every input as one of:

- Source product image: user-owned or primary product identity reference.
- Product URL: factual product evidence source.
- Competitor reference: analysis-only visual reference.
- Platform target: Amazon, TikTok Shop, Douyin/抖音, JD/京东, SHEIN, Temu, Mercado Libre/Mercado Livre, Shopee LatAm/Brazil, Falabella, Ozon, Etsy, Wildberries/WB, Xiaohongshu, Shopee/Lazada, Taobao/Tmall, Pinduoduo, or multi-platform.
- Locale and audience: language, country, buyer persona, tone, and marketplace expectations.
- Style direction: desired visual feel, constraints, examples, or brand requirements.

If source product identity is missing, continue only with a planning/request-pack draft and clearly flag that generated images cannot be identity-preserving yet.

## Mode-Scoped Outputs

Fast generation mode should provide:

- Independent final image files when image generation is requested
- Exported image filenames with stable IDs and English purpose slugs, such as `IMG-01-main-product-cafe-commute.png`
- Delivery overview image at `overview/SET-OVERVIEW-contact-sheet.png` for multi-image sets
- Selected strategy direction when the user request was rough, including whether the user chose it or the harness selected it
- First user-visible direction handoff when the request was rough/open, before formal production begins
- Concise product identity notes and source-image quality/enhancement note
- Concise Source Product Understanding note, including visible text/OCR facts that were locked or marked uncertain
- Concise product physical truth notes when function, installation, use steps, dimensions, or scale affected the image set
- Concise visual strategy / shot matrix summary
- Concise platform/category/season/region context summary when it affected strategy or copy
- Final prompt/request summary sufficient for review
- Focused QA summary covering product identity, scene reality, visual diversity, platform fit, and buyer-facing copy
- tldraw review session only when the user asks for review, a gate fails, or revision feedback is expected

Industrial audit mode should provide the complete workflow artifacts:

- Product Fact Sheet
- Source Image Set Manifest when multiple source images are provided
- Source Product Understanding with visible text/OCR facts when a source image is provided
- Product Identity Lock
- Product Physical Truth Lock for function/use/scale-sensitive products
- Product Feature Analysis
- Audience Positioning Analysis
- Goal Contract
- Strategy Direction Options and Direction Selection when the request is rough or open-ended
- Commerce Strategy Brief
- Creative Direction Brief
- Graphic Design Direction Brief
- Commercial Photography Treatment
- Layout Wireframes or Sketch Pack
- Image Set Blueprint
- Visual Direction Brief
- Localized Copy Pack
- GPT built-in image generation request pack when fallback/audit evidence is needed
- Prompt Layer Stack
- Final Personalized Prompt Delivery
- Generation execution result summary only when Codex/runtime/host actually executed generation
- Independent image files when image rendering/generation is requested
- Exported image filenames with stable IDs and English purpose slugs, such as `IMG-01-main-product.png`
- Delivery Overview contact sheet for multi-image sets
- tldraw Review Workspace or annotation surface
- tldraw Review Workspace and parsed Generation Tasks when visual review is needed
- Source Image Quality Report
- Source Product Understanding Gate Report
- Platform/Category Research Brief when research is required
- Platform Context Plan with freshness cadence, season, climate, holiday, region, and trend query plan when relevant
- Platform/Category Profile Overlay
- Bestseller Design Mining Report when marketing enhancement is requested
- Copy Strategy Gate Report
- Product Physics Fact Gate Report for physical function/use/scale-sensitive products
- Marketing Quality Gate Report
- Identity Geometry Gate Report for apparel or proportion-sensitive products
- Prompt Readiness Gate Report
- Prompt Layer Gate Report
- QA Loop Routing Decision
- Image Set Export Gate Report
- Delivery Overview Report
- Final Delivery Gate Report
- Failed Output Review when a prior output is rejected
- Identity Consistency Report
- QA Report
- Revision History
- Export Package Summary

When writing files in a Codex project, store run artifacts under a dated `runs/<run-id>/` directory and keep final user-facing exports in `outputs/` if such directories exist.

## References

Read these skill references as needed:

- `references/workflow-routing.md` for package file routing and workflow selection.
- `references/output-contract.md` for required artifacts and compact schemas.
- `references/strategy-direction-routing.md` for rough user requests, direction options, and harness autonomous selection.
- `references/product-physical-truth.md` for physical product functions, installation/use steps, scale consistency, and forbidden generated mechanisms.
- `references/industrial-upgrade-goal-plan.md` for the goal-driven industrial upgrade model, role collaboration, phases, and Definition of Done.
- `references/sketch-to-final-production.md` for thumbnail sketches, scene sketches, layout wireframes, and prompt-readiness gates.
- `references/prompt-layering-subloop.md` for the Prompt Layer Architect Brain, mandatory base layers, conditional layers, and prompt-layer failure routing.
- `references/personalized-prompt-delivery.md` for final personalized generation prompt standards and handoff format.
- `references/gpt-built-in-image-generation-policy.md` for the Codex-native imagegen/image_gen execution boundary, request schema, fallback limits, and blocked-generation behavior.
- `references/contextual-platform-research.md` for platform YAML memory, refresh cadence, season/climate/holiday/region, and trend query planning.
- `references/copy-strategy-loop.md` for buyer-facing copy planning, hotword evidence, and copy QA loops.
- `references/identity-geometry-lock.md` for apparel/product geometry locks and proportion drift routing.
- `references/risk-and-qa.md` for non-negotiable safety, compliance, and review rules.
- `references/review-canvas.md` for annotation canvas behavior and native-widget fallback policy.
- `references/main-detail-production-structure.md` for IMG/POSTER/DETAIL numbering, main image/detail page structure, and A-H editable region revision.
- `references/product-identity-preservation.md` for source-image identity locks, detail preservation, image-reference generation requirements, and post-generation identity gates.
- `references/marketing-quality-gates.md` for visual diversity, platform fit, and ecommerce marketing failure conditions.
- `references/graphic-design-director.md` for typography, layout system, overlay restraint, mobile legibility, and no-watermark final image rules.
- `references/commercial-photography-master-styles.md` for master-level commercial photography archetypes, lens/light/scene choices, and category-audience fit.
- `references/failed-output-regeneration.md` for diagnosing and regenerating failed outputs without repeating the same mistakes.
- `references/scene-asset-production.md` for true scene asset requirements, women-bag scene defaults, renderer boundaries, and hard failures for fake scenes.
- `references/product-feature-and-audience-analysis.md` for product trait analysis, buyer motivation, audience positioning, objections, scene triggers, and copy voice.
- `references/dynamic-platform-category-profile.md` for fixed platform baseline plus run-level category overlay.
- `references/bestseller-design-mining.md` for market/爆品 pattern extraction without copying competitor creative.
- `references/multi-source-image-fusion.md` for multi-image source classification, complementary enhancement, and identity-lock fusion.
- `references/visual-director.md` for photography, camera angle, lighting, scene, detail-crop, and buyer-facing-copy direction.
- `references/source-image-quality.md` for source-photo preflight and enhancement.
- `references/source-product-understanding.md` for source-image product recognition, OCR/text fact extraction, and propagation into locks.
- `references/platform-category-research.md` for web-search backed platform/category tone research.
- `references/loop-efficiency.md` for gated generation loops and retry budgets.
- `references/brief-intake.md` for input completeness judgment, clarification policy, and how user replies enter task analysis.
- `references/qa-loop-routing.md` for gate standards, failure taxonomy, return node matrix, retry budgets, blocked states, and user-input-required states.

Primary bundled resources:

- `workflows/` for executable workflow routing.
- `platform-profiles/` for marketplace visual guidance.
- `skills/*/*/prompt.md` for step-specific prompts.
- `templates/` for structured outputs.
- `policies/` for QA and risk checks.
- `scripts/` for rendering, source understanding, QA gates, delivery overview, and review tools.
- `assets/tldraw-review-workspace/` for the reusable React + Vite + tldraw review workspace template.
