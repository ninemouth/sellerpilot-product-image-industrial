---
name: sellerpilot-product-image-industrial
description: Use when Codex needs to create, plan, review, or revise industrial ecommerce product image sets for SellerPilot-style workflows, including Amazon listing images, TikTok Shop images, Xiaohongshu image packs, multi-platform product image packs, competitor-reference redesigns, product image QA, localized commerce copy, store unified visual style memory, and product-fact-sheet based visual generation. Trigger for Chinese or English requests about 商品图, 产品图, 电商套图, Amazon 7 image sets, listing images, product-image generation, product-image prompts, competitor image redesign, 店铺统一风格, store style memory, or SellerPilot product image production.
---

# SellerPilot Product Image Industrial

## Purpose

Use this skill as the Codex chat/project entrypoint for SellerPilot-style ecommerce product image production. It turns product URLs, source product images, competitor references, platform targets, audience context, and style requirements into generated product images plus only the planning, QA, and review artifacts needed for the selected mode.

Actual production image generation defaults to Codex-native GPT built-in image generation. In Codex chat/project contexts, the normal execution layer is the system `imagegen` skill using the built-in `image_gen` tool. Use that native path for real raster outputs unless the user explicitly selects the ThinkAI `gpt-image-2` provider.

This skill owns the SellerPilot industrial workflow: product truth, identity locks, source-photo enhancement, platform/category research, visual strategy, photography direction, prompt layering, QA routing, review surfaces, and export rules. It may call the system `imagegen` skill / built-in `image_gen` as the default production execution layer, or the repo-local ThinkAI runtime when explicitly selected; it must not create one-off image-generation wrappers, silently switch to API/CLI fallback, or claim deterministic layout drafts as final generated product images.

The final generation prompt is a personalized production brief, not a generic fixed prompt. Build it only after product truth, market/platform context, audience, commerce strategy, creative direction, photography treatment, layout intent, and self-review have shaped the image goal. Request packs are fallback or audit artifacts, not the default user-facing deliverable.

Installed capability root:

```text
${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial
```

On Windows the default root is:

```text
%USERPROFILE%\.codex\skills\sellerpilot-product-image-industrial
```

When giving install/update instructions, do not assume a Unix path. Prefer `node scripts/codex-path-info.mjs` or `npm run paths:codex` from a development clone to report the current OS, Codex home, skills directory, both installed skill paths, and the ThinkAI local config path. Respect `CODEX_HOME` when it is set.

When developing this skill outside the installed capability root, verify the development copy first, then sync it into the installed root with the bundled release script. Do not hand-copy partial files.

Do not copy competitor visuals, invent product facts, auto-publish assets, or promise CTR, CVR, ROAS, ACOS, ranking, or sales lift.

## Production Update Gate

Every production request must start with the update check before mode routing, planning, source analysis, or generation:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/check-skill-update.mjs \
  --cache-ttl-hours 24 \
  --timeout-ms 1500
```

Handle the result as a gate:

- `current`: continue the production request silently.
- `update_available`: pause before formal production and ask the user whether to update now. Do not enter production planning, source analysis, image generation, QA, or canvas launch until the user chooses. If the user chooses update, run the verified update flow (`git pull`, `npm run verify`, then `npm run sync -- --source "$PWD"` from the development clone when available, or reinstall from GitHub if no clone exists). If the user declines or says to continue with the installed version, record that decision in the task notes and continue.
- `unknown_*`, timeout, stale cache, or missing local clone: continue the image workflow without blocking, but briefly tell the user update freshness could not be confirmed and avoid claiming the installed skill is current.

Never auto-install or overwrite a skill without explicit user authorization.

For speed-sensitive chat generation, use the lightest mode that can still protect final image quality. Do not treat `fast_generation` as the universal default for ecommerce finals. Use `quality_production` for normal multi-image sets, high-quality final assets, scene-heavy requests, physical-function/scale-sensitive products, or conversion-critical platform/category work. Quality production must keep the delivery overview contact sheet, and it should keep planning compact instead of writing separate verbose industrial reports. For generated multi-image final sets, auto-start the tldraw review workspace after final images are exported and the delivery overview is created, before final user handoff. Use cached platform/profile memory unless the platform/category/season/region/trend question is current or conversion-critical. For Ozon, use the platform profile's 3:4 portrait export baseline by default; only use 1:1 when the profile exception or current official category evidence requires it.

## User Request Contract

Treat short natural user requests as the ideal entrypoint. The user should be able to say:

```text
请使用 $sellerpilot-product-image-industrial 为拼多多女包生成 8 图套图。
```

or:

```text
生成一张拼多多女包主图。
```

Do not require the user to recite the industrial workflow, QA policy, generation boundary, blocked-runtime behavior, model name, tool name, or review-canvas rules. Infer the missing production steps from the product/category/platform request, then run the workflow conservatively. If the user asks for "生成图片/套图" and the task needs product-bearing generation, attempt Codex-native built-in image generation through the system `imagegen` skill / built-in `image_gen` tool when available, unless the user explicitly selects ThinkAI `gpt-image-2`. Only create a request pack as fallback or audit evidence when generation cannot be executed or when the user explicitly asks for it.

The long strict prompt is an internal acceptance policy, not a required user prompt.

Never expose sandbox, DNS, network-permission, raw curl, API-key, or local-path diagnostics as a user-facing production update. Keep those only in the run diagnostic files. A user-facing failure message may state that the affected asset is blocked, that completed assets were preserved, and the smallest safe next action; it must not claim that Codex will request external permissions, bypass a sandbox, or alter API configuration.

Store style memory is also a natural user request. If the user says "创建店铺 xxx 的统一风格", "保存店铺视觉风格", or similar and provides a store URL, first analyze the store/page evidence, then show 2-3 unified style directions and ask only high-value questions. Write a durable Markdown store memory only after the user confirms the final direction. Later product image requests that name the store or reuse the URL must apply that Markdown as a store/brand style layer before platform context planning and prompt layering.

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

- **Fast generation mode:** Use for single-image, low-risk, quick-turn requests, early direction tests, or draft outputs where the user explicitly prioritizes speed. It still requires source understanding, identity lock, concise visual direction, Codex-native image generation, focused QA, and export, but it skips full research briefs, full run skeletons, always-on tldraw, and verbose gate packages by default.
- **Single-image quality production:** Use when the user asks for one high-quality hero/main/scene/detail image rather than a full set. Treat it as a valid final delivery: create one independent final image, run the relevant identity/marketing/export/final gates, and write `export/final-images-manifest.json`. Do not require anchor batch pacing, delivery overview contact sheet, or multi-image blueprint for intentional single-image delivery. Start tldraw only when visual review, a gate handoff, or revision markup is next.
- **Quality production mode (default for final ecommerce image sets):** Use for normal multi-image套图, high-quality final assets, scene-heavy images, product identity/proportion-sensitive goods, physical-function/scale-sensitive goods, or conversion-critical platform/category work. This is the main quality/speed balance mode: run the complete quality-critical path, use anchor batch pacing, run only relevant gates, reuse approved assets, create the required overview, and avoid full industrial audit artifacts unless needed.
- **Revision repair mode:** Use when the user provides failed outputs, comparison screenshots, tldraw annotations, or asks to modify an existing set. Parse feedback, route to the earliest failed node, and regenerate/rerender only affected assets.
- **Industrial audit mode:** Use when the user asks for 工业级完整 workflow, 可迁移到 SellerPilot, 审计, gate reports, review records, or development evidence. Produce the full run skeleton, research briefs, prompt packs, gate reports, QA routing records, review workspace, and export package.
- **Debug/development mode:** Use only while improving this skill. Keep selftests, intermediate fixtures, verbose gate JSON, and experimental work under `work/` or an explicit temp/debug directory. Do not let debug artifacts affect normal chat generation.

For normal chat, do not create every artifact listed in the full output contract. Create only the artifacts needed to generate, QA, and deliver the requested images. Escalate from fast or quality production mode to industrial audit mode only when a gate fails repeatedly, source identity is ambiguous, runtime generation is unavailable, or the user asks for the full package.

## Execution Flow

1. Resolve the skill root to `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial`. Read `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/AGENTS.md` before running a production image workflow. Do not search only the current workspace for `AGENTS.md`.
1a. Run the Production Update Gate with `check-skill-update.mjs` as the first executable production step. If it reports `update_available`, ask the user whether to update now before any production planning or generation. If it reports `current`, continue silently. If freshness is unknown, continue with a concise note that update status could not be confirmed.
1b. Select the production mode with `production-mode-router.mjs` when the request is not explicitly a tiny single-image task. Default high-quality ecommerce套图 to `quality_production`, not `fast_generation`; use `industrial_audit` only when the user wants full evidence or migration artifacts.
1c. Run `production-efficiency-plan.mjs` before heavy planning or generation. In `quality_production`, keep planning compact by merging product facts, identity/geometry/physical locks, platform context, buyer questions, shot matrix, copy intent, prompt-layer decisions, and QA criteria into `blueprint/quality-production-blueprint.json` instead of writing every industrial report separately.
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
4a. Create a normalized product asset for card/infographic/layout use before layout planning. Use `source-normalized/product-cutout-transparent.png` when alpha is reliable, or `source-normalized/product-on-card-safe.png` when a renderer cannot preserve alpha. Do not paste a flattened source image with a gray/white rectangular backdrop into a white card. Keep the original/enhanced source image for source understanding and identity evidence.
4b. Create Source Product Understanding from the original/enhanced source image before identity lock or prompt work. Use Codex visual inspection first to recognize product type, structure, components, material/color, physical size cues, scale references, visible text, labels, warnings, dimensions, specs, and function clues. Run local OCR only when AI visual reading detects visible text, is uncertain, cannot confidently transcribe text, or the text may reveal size, model, compatibility, warning, certification, installation, material, quantity, or weight. Record verified text-derived facts and propagate them into identity lock, physical truth lock, geometry lock, and prompt layers. Do not generate over these facts or silently drop them.
5. Create a Product Identity Lock from all source/enhanced images and Source Product Understanding before generation. Lock silhouette, proportions, color family, material appearance, hardware, closure, straps/handles, accessories, logo/markings, distinctive details, and text-derived facts that affect physical size/function. If no source image exists, do not call generated images identity-preserving.
5a. For physical products, load `references/product-physical-truth.md`. Create `blueprint/02b-product-physical-truth.json` before shot matrix or prompt work whenever the set shows installation, use steps, scale, cable/strap routing, moving parts, fixtures, fasteners, load, waterproofing, or product function. Lock confirmed functions, confirmed user actions, forbidden generated functions, and scale reference. Do not show invented use mechanisms such as unsupported press locks, adhesive/magnetic mounting, waterproof electrical behavior, extra moving parts, or inconsistent product size across images. Run `product-physics-fact-gate.mjs` before final delivery when physical function or scale appears in the image set.
6. Load only the relevant baseline platform profile from `platform-profiles/`. For Ozon, the baseline export ratio is `3:4` portrait for normal categories; the Ozon Fresh food exception is `1:1` unless current official evidence says otherwise.
6a. Apply platform/category preference memory before platform context planning:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-preference-memory.mjs \
  --mode apply \
  --platform "Ozon" \
  --category "women bag" \
  --locale "ru-RU" \
  --run-dir /abs/run
```

Use `memory/platform-preference-overlay.json` only as confirmed platform/category style memory. It may influence visual traits, style direction, copy tone, merchandising rhythm, and avoid notes, but it must not override current user instructions, source product identity, official platform rules, physical truth, or fresh research. If the current user explicitly gives or confirms platform-level traits such as "Ozon 同类女包要保持 3:4、干净主图、俄语短文案", remember those traits after classification with `--mode remember`. Do not store product identity facts, private business data, supplier/customer details, unsupported claims, or one-off generation failures.

6b. If the request names a saved store or includes a matching store URL, apply store style memory before platform context planning, audience positioning, visual direction, prompt layering, and QA. If the user asks to create or update a store's unified style, analyze the store URL/page evidence, show 2-3 directions, ask only high-value questions, and save the durable Markdown only after confirmation. Use `memory/store-style-memory.md` as a store/brand style layer only; it must not override current user instructions, source product identity, physical truth, official platform constraints, safety/compliance boundaries, or fresh category research.

7. Run platform/category research with web search only when the target platform/category tone is unclear, recent, or conversion-critical, or when season/climate/holiday/region/hotword copy materially affects conversion. Treat platform YAML as a baseline, not complete live truth. Load `references/contextual-platform-research.md` when season, climate, holiday, region, trend, or marketing language matters. Create `research/platform-context-plan.json` and a run-level platform/category overlay from current research. If no trigger exists, use the platform profile baseline and record `skip_use_platform_yaml_baseline` in the efficiency plan.
7a. When the task is conversion-critical, dwell-time-sensitive, category-competitive, or the user asks for "爆品/提升销售/停留/点击", run the commerce design research planner before audience positioning, shot matrix, copy, and prompt layers:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/commerce-design-research-planner.mjs \
  --run-dir /abs/run \
  --platform "Ozon" \
  --category "women bag" \
  --locale "ru-RU" \
  --goal both \
  --research-depth compact
```

The planner is a budgeted research contract, not a competitor-copy license. Extract click hooks, dwell-time mechanisms, trust cues, buyer objections, category gallery sequence, and copy rhythm; then update `blueprint/quality-production-blueprint.json` fields such as buyer question, conversion task, shot direction, copy intent, prompt-layer needs, and QA acceptance criteria.
8. Run bestseller design mining only when marketing enhancement, click appeal, category differentiation, or "爆品" learning is required. Borrow patterns, not assets, layouts, copy, or brand style. Do not run full market research by default in quality production.
9. Run Product Feature Analysis and Audience Positioning Analysis. Convert confirmed traits into buyer-relevant benefits, detail-shot opportunities, scene triggers, buyer motivations, purchase objections, aesthetic preferences, and copy voice. Keep unsupported claims out of final image copy.
9a. Load `references/copy-strategy-loop.md` before final image text or prompt delivery. Plan copy from product truth plus platform/category/season/region research, run `copy-strategy-gate.mjs`, then run `localized-copy-qa-gate.mjs` for locales such as ru-RU, de-DE, ar-SA, and revise only failed copy fields before marketing QA.
9b. For any final image with visible buyer-facing text, run `text-layout-proof-gate.mjs` before expensive final image generation or final raster export. Use low-cost layout proof images, screenshots, or canvas review to validate wrapping, hierarchy, safe zones, and complex-language text fit. Do not use final high-cost image generation as the first place to discover that Russian, German, Arabic, or dense claim text does not fit.
10. In quality production, create or update compact image-set planning instead of separate verbose strategy documents. The plan must still include each image's buyer question, commercial task, shot role, copy intent, required evidence, prompt-layer needs, and success/failure criteria. In industrial audit mode, keep the full separate goal contract, commerce strategy brief, creative direction brief, graphic design direction brief, and photography treatment.
11. Create sketches or layout wireframes before final generation prompts when the set is complete, scene-heavy, layout-heavy, or final quality depends on composition. In quality production, use compact wireframe notes inside the image-set plan unless a separate layout artifact is needed. Load `references/sketch-to-final-production.md` for complete image sets, scene-heavy work, or any run where final quality matters.
12. Create a Graphic Design Direction Brief and Visual Direction Brief before full image generation. A design director must define typography hierarchy, safe zones, overlay style, text density, mobile legibility, set-level layout variation, and the visible-mark decision. Default visible-mark decision is absolute prohibition: no watermark, platform-pack label, system mark, or arbitrary corner mark unless the user explicitly requested that exact mark and the run records `watermark_authorization` with exact text, placement, purpose, and image scope before prompt/layout work. A visual director must define the shot matrix, camera angles, crops, lighting, scene logic, prop/model context, buyer-facing copy intent, and A-H editable regions for every image. Do not allow final image copy to sound like internal QA notes.
13. If the user asks for 场景图, 上身图, 模特图, lifestyle, outfit, commute, cafe, street, or `含场景图`, load `references/scene-asset-production.md`. Scene and use-case roles require real generated/photo scene assets or an explicit final scene realism review. A product cutout on a decorative layout, repeated vector background, white product card pasted onto a fake environment, or Pillow/deterministic composite is a layout proof at most, not a final scene image.
14. Load `references/prompt-layering-subloop.md`, `references/personalized-prompt-delivery.md`, and `references/gpt-built-in-image-generation-policy.md` before final product-bearing image generation. Use the Prompt Layer Architect Brain to decide mandatory and conditional layers, then prepare a personalized built-in image generation request with source image references when available, identity locks, commercial intent, photography treatment, layout intent, QA expectations, and retry policy. If the current Codex/runtime surface exposes the system `imagegen` skill / built-in `image_gen` tool, execute the request through that native path. If it cannot execute required image-reference generation, stop at request pack/layout draft and mark final generation blocked.
14b. Before provider execution, resolve the platform/category target ratio into `generation-spec/generation-spec.json` using `resolve-generation-spec.mjs`. Use its size in the final provider request. For multi-image production, use `generation-execution-controller.mjs` to record anchor-only execution first; do not schedule remaining roles until `anchor-batch-qa-decision.json` is `continue`, `pass`, or `approved`, then cap independent remaining-role concurrency at 2.
14a. For apparel, bags, shoes, furniture, tools, and other proportion-sensitive products, load `references/identity-geometry-lock.md`. Create or update `geometry/source-geometry.json` before generation and run `identity-geometry-gate.mjs` on generated assets before final delivery. Apparel must preserve garment length, hem position, collar-to-hem ratio, sleeve length class, neckline shape, and silhouette; a normal jersey must not become a crop top unless supported by source/user input.
15. For multi-image sets, use generation pacing: generate and QA a small anchor batch first, then continue with only missing/failed assets. Do not spend a full run serially generating all images before checking identity, scene direction, and role diversity. For intentional single-image delivery, generate the one final image after identity, prompt-layer, and relevant QA checks; do not force an anchor batch.
15a. When the user provides prior generated outputs and asks to continue, audit, optimize, or revise them, load `references/failed-output-regeneration.md` first. Classify failures such as watermark/platform-pack labels, weak graphic design, generic photography treatment, unclear micro-detail handling, identity drift, fake scenes, or repeated layouts; keep approved assets and rerun only the smallest affected upstream node.
15b. For long-running generation, update `generated-assets/generation-progress.json` after each generated asset and give the user a concise status update at least every 5 minutes. If a run exceeds 15 minutes, or after final export before QA loop/final handoff, run `runtime-watchdog.mjs` to classify the delay as active generation/network wait, gate churn, ready-but-not-closed, or stalled no progress. Do not silently restart the whole set to appear busy.
16. Load the risk and QA references before writing final outputs:
   - `policies/risk-boundaries.md`
   - `policies/qa-checklist.md`
17. Use the workflow steps as a gated loop, not as decorative labels. Generate only missing assets, rerender only failed layouts, and stop early when product identity, geometry, or copy strategy drifts.
18. Run export and output-failure gates before final delivery. Do not present contact sheets, collage previews, fake scene placeholders, or visually unreadable drafts as final ecommerce images. Intentional single-image delivery is allowed when `--expected-count 1` or equivalent task context is used; it still needs a run-scoped manifest and final delivery gate. For multi-image sets, generate a separate delivery overview contact sheet under `overview/`; it is a package review artifact and does not replace independent final images.
18a. Enforce task-level image isolation. Each run must have a unique `run_id` and a run-local `export/final-images-manifest.json`. Overview, tldraw, export gates, A-H review, and identity review must read the current run manifest or exactly `/abs/run/final-images`; do not point them at a date-level directory, shared `outputs/`, parent folder, or another task's folder. `outputs/` can receive copies for user-facing delivery, but it is not an internal production source.
18b. After final images are exported and the delivery overview exists, run `post-generation-tldraw-launcher.mjs` for generated multi-image final sets. For intentional single-image deliveries, run the same launcher when the user requested review, a gate needs visual handoff, or revision markup is expected; it does not require an overview contact sheet. This must create `/abs/run/review-workspace`, register the run-scoped manifest images, start or reuse the shared tldraw service by default, and write `qa/post-generation-tldraw-launch-report.json` with a ready URL or blocked reason before final user handoff. Use `--no-auto-start` only for selftests or explicit file-only archives.
19. Produce the mode-appropriate Definition of Done. Fast mode should end with actual generated images and a concise QA summary; industrial audit mode should produce the full artifact package.

## Bundled Scripts

Use bundled scripts for deterministic support work. They do not replace Codex-native image generation.

For explicit ThinkAI provider runs or for the ThinkAI variant:

```bash
THINKAI_API_KEY="<key>" \
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/thinkai-image-runtime.mjs \
  --prompt "<final personalized prompt>" \
  --image /abs/source-product.png \
  --size 2k \
  --quality hd \
  --output-dir /abs/run/generated-assets/anchor-01
```

The runtime also reads `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/.thinkai-image-runtime.json` when an environment key is not set. Keep that local config uncommitted.

For skill development and release hygiene:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/verify-skill.mjs
```

Use this before shipping skill changes. It validates frontmatter, script syntax, JSON/YAML, legacy provider naming, tldraw dependency lock, gate behavior, renderer scene boundaries, export failures, marketing failures, and review workspace creation.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/codex-path-info.mjs
```

Use this before giving install, update, sync, or ThinkAI key-configuration paths. It auto-detects macOS, Linux, and Windows Codex directories, honors `CODEX_HOME`, and prints both installed skill paths plus the ThinkAI `.thinkai-image-runtime.json` path.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/sync-to-codex-skill.mjs \
  --source /abs/development-copy
```

Use this after verification when a development copy must update the installed Codex skill. It backs up the installed skill, copies the source with safe excludes, and verifies the installed copy matches the source. The sync is implemented in Node and does not require Unix `rsync`, `diff`, or Bash command substitution, so it works on macOS, Linux, and Windows.
The sync script writes `.sellerpilot-skill-release.json` into the installed skill. It records the current git upstream branch, or the current local branch when no upstream exists, as `remote_branch`; pass `--remote-branch <branch>` only when installing a build artifact that should track a specific GitHub branch.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/check-skill-update.mjs \
  --cache-ttl-hours 24 \
  --timeout-ms 1500
```

Use this as the mandatory first gate for production requests. It compares the installed release metadata or local git commit against the configured GitHub branch when the cache is stale. `current` continues silently. `update_available` must pause formal production and ask the user whether to update before continuing. Unknown freshness should not block production, but it must not be presented as current.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/production-mode-router.mjs \
  --out-dir /abs/run/mode \
  --user-text "为拼多多女包生成8图高质量套图" \
  --image-count 8 \
  --quality-target high \
  --has-source-image true
```

Use this before substantial production to choose `fast_generation`, `quality_production`, `revision_repair`, `industrial_audit`, or `debug_development`. The router optimizes for final image quality first, then removes artifacts and services that are not needed for that mode.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/production-efficiency-plan.mjs \
  --run-dir /abs/run \
  --mode-report /abs/run/mode/production-mode-router-report.json \
  --image-count 8 \
  --has-source-image true
```

Use this before heavy planning or generation. It writes `planning/production-efficiency-plan.json`, keeps compact image-set planning, records triggered vs skipped work, sets pre-generation/research/QA budgets, and initializes `generated-assets/generation-progress.json`. This is the guard against quality production drifting into full industrial audit mode.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/brief-intake-gate.mjs \
  --out-dir /abs/run/brief-intake \
  --platform "拼多多" \
  --category "女包" \
  --image-count 8 \
  --has-source-image true \
  --scene-requested true
```

Use the brief intake gate to decide whether to ask high-value user questions before planning/generation. It should not block low-risk requests.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-gate.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣" \
  --season "summer"
```

Use the strategy direction gate when the user request is rough. It creates 2-3 production directions, records the selected direction, and allows the harness to continue autonomously when the user has no explicit preference.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-handoff-gate.mjs \
  --run-dir /abs/run
```

Use the strategy direction handoff gate immediately after `strategy-direction-gate.mjs`. It writes `strategy/direction-user-handoff.md` and `strategy/direction-user-handoff.json`; the Markdown contains the first user-visible message that must be sent before formal production for rough/open requests.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-context-planner.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣" \
  --region "华南" \
  --season "summer" \
  --climate "hot-humid"
```

Use the platform context planner before conversion-oriented planning and copy. It reads the baseline platform YAML, reports whether it is sufficient as stable memory, creates a freshness/query plan, and writes dynamic platform/category/season/region context into the run overlay.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-preference-memory.mjs \
  --mode remember \
  --platform "Ozon" \
  --category "women bag" \
  --locale "ru-RU" \
  --trait "3:4 portrait first image with clean marketplace readability" \
  --style "minimal premium detail gallery" \
  --copy-tone "short Russian benefit phrasing" \
  --source-note "user_confirmed_platform_style_trait"
```

Use platform preference memory only for durable platform/category visual, copy, and merchandising preferences that the user explicitly gives or confirms. Apply it at the start of later same-platform/same-category runs with `--mode apply --run-dir /abs/run`. The store lives outside task runs at `${SELLERPILOT_IMAGE_SKILL_MEMORY:-$HOME/.codex/sellerpilot-product-image-industrial}/platform-preference-memory.json`; run overlays are copied into `memory/platform-preference-overlay.json`.

Use store style memory when the user asks to create/update a store's unified style or when a later generation request names a saved store. For creation/update, analyze the store URL/page evidence first, create a run-local draft, show 2-3 directions, and do not save durable memory until the user confirms:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/store-style-memory.mjs \
  --mode draft \
  --store-name "Luna Bridal" \
  --store-url "https://example.com/store" \
  --platform "Amazon" \
  --category "bridal clutch" \
  --analysis "Store reads as soft bridal, pearl detail, warm neutral styling." \
  --recommendation "Elegant warm ivory bridal system with restrained typography." \
  --run-dir /abs/run
```

After user confirmation, save the durable Markdown:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/store-style-memory.mjs \
  --mode remember \
  --store-name "Luna Bridal" \
  --store-url "https://example.com/store" \
  --confirmed true \
  --confirmed-by user \
  --positioning "soft premium bridal accessories" \
  --visual-trait "warm ivory backgrounds with pearl-detail closeups" \
  --palette "ivory, champagne gold, soft shadow gray" \
  --typography "thin elegant serif for headlines, simple sans for specs" \
  --photography "macro pearl texture, hand-held bridal scene, clean tabletop hero" \
  --layout "airy composition with product dominant and small trust details" \
  --copy-tone "short graceful bridal wording" \
  --avoid "no loud discount badges or unrelated party props" \
  --prompt-directive "apply store style as a brand layer after product identity lock" \
  --evidence "confirmed after store URL review and user approval"
```

For later generation requests that name a saved store or include a matching store URL, apply store style memory before platform context planning, audience/visual direction, prompt layering, and QA:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/store-style-memory.mjs \
  --mode apply \
  --store-name "Luna Bridal" \
  --run-dir /abs/run
```

Use `memory/store-style-memory.md` only as a durable store/brand visual layer. It may shape palette, typography, photography direction, layout rhythm, copy tone, avoid notes, and prompt directives, but it must not override current user instructions, source product identity, physical truth, official platform constraints, compliance boundaries, or fresh category research. The durable Markdown lives under `${SELLERPILOT_IMAGE_SKILL_MEMORY:-$HOME/.codex/sellerpilot-product-image-industrial}/store-style-memory/`.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/commerce-design-research-planner.mjs \
  --run-dir /abs/run \
  --platform "Ozon" \
  --category "women bag" \
  --locale "ru-RU" \
  --goal both \
  --research-depth compact
```

Use the commerce design research planner when sales intent, click appeal, dwell time, category differentiation, or bestseller pattern learning matters. It creates `research/commerce-design-research-plan.json` and `.md` with a bounded query plan, reference budget, extraction framework, pass criteria, and blueprint fields that must be updated before visual director and copy strategy.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/build-source-image-set.mjs \
  --images "/abs/front.png,/abs/detail.png,/abs/side.png" \
  --out-dir /abs/run \
  --category "女包"
```

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-run-skeleton.mjs \
  --out-dir /abs/runs/run-id \
  --platform "拼多多" \
  --category "女包" \
  --product-name "商品名" \
  --run-id "run-unique-task-id"
```

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/enhance-source-image.mjs \
  --input /abs/source.png \
  --out-dir /abs/run/source-enhanced
```

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/normalize-source-product-asset.mjs \
  --input /abs/run/source-enhanced/source-enhanced.png \
  --out-dir /abs/run/source-normalized \
  --card-color "#ffffff"
```

Use this after source enhancement and before card/infographic layout composition. It creates `product-cutout-transparent.png`, `product-on-card-safe.png`, and `product-normalization-report.json`. Use the transparent/card-safe product asset for white cards, feature cards, comparison panels, parameter cards, and clean marketplace infographics. Do not use it as the only source for product understanding; original/enhanced images still carry evidence such as labels, scale cues, shadows, and visible text.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-source-product-understanding.mjs \
  --image /abs/run/source-enhanced/source-enhanced.png \
  --out-dir /abs/run/source-understanding \
  --category "线夹" \
  --ocr-mode auto
```

Use this after source enhancement and before identity lock. It creates `source-product-understanding.json` with image metadata, AI-visual-text-first policy, conditional OCR status, text-derived fact candidates when OCR runs, and fields for Codex visual product recognition. Prefer Codex visual text recognition first. If `--text-visibility` is omitted, OCR is skipped until Codex completes the visual text precheck. Pass `--text-visibility no` when visual inspection confidently sees no text, `--text-visibility yes` when text is visible, and `--text-visibility uncertain` when text may exist or is too small/blurred. Complete the AI visual read plus conditional OCR fallback before generation whenever visible text, size, installation, function, compatibility, material, warnings, or labels affect the product.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/source-product-understanding-gate.mjs \
  --understanding /abs/run/source-understanding/source-product-understanding.json \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml \
  --physical-truth /abs/run/blueprint/02b-product-physical-truth.json \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --out-dir /abs/run/qa
```

Use this before prompt delivery and final delivery when a source image has product facts or visible text. It blocks missing product recognition, unstructured OCR text, and size/function/spec text facts that were not propagated into downstream locks.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/render-commerce-image-set.mjs \
  --source-image /abs/product.png \
  --out-dir /abs/output-dir \
  --product-name "商品名" \
  --dimensions "28 x 8 x 20cm" \
  --platform "拼多多"
```

This renders independent `1200x1200` PNG layout assets. It does not create an HTML review canvas. It is a deterministic layout/composition tool, not a replacement for GPT built-in image generation scene imagery. When the user asks for 场景图, 上身图, 模特图, or lifestyle images, generate those scene assets through Codex-native `imagegen` / `image_gen` when available, then use this renderer only for final text/layout composition. For scene roles, pass a panel-specific `image`, `image_path`, `generated_asset_path`, or `scene_asset_path`; do not render a final scene from the source cutout alone.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/marketing-gate-check.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

Use the marketing gate before final export to catch unjustified repeated camera angles, repeated source images, thin scene direction, and internal-facing copy such as `不虚标`, `以源图为准`, `QA`, or `风险` in final image text.

It also blocks fake scene/use-case images: flat vector backgrounds, repeated decorative patterns, product-on-white-card pasteups, source cutouts, renderer-only/Pillow composites, and other deterministic layout substitutes cannot be marked final for scene/use images unless a true generated/photo scene asset or `final_scene_realism_review.status=pass/not_required` is recorded.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/product-background-card-consistency-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --run-dir /abs/run \
  --out-dir /abs/run/qa
```

Run this before marketing QA and final delivery for panels that place products on white cards, parameter cards, comparison cards, feature cards, or infographic layouts. It blocks visible gray/white source-image rectangles, product edge backgrounds that differ from the card color, and missing transparent/card-safe product asset evidence. Fix by rerunning source asset normalization and rerendering only the affected layout images.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/copy-strategy-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --platform-context /abs/run/research/platform-context-plan.json \
  --out-dir /abs/run/qa
```

Use the copy strategy gate before marketing QA. It blocks thin buyer strategy, unsupported claims, unverified hot words, and copy that ignores required season/climate/holiday/regional context.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/localized-copy-qa-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --locale ru-RU \
  --source-locale zh-CN \
  --platform-context /abs/run/research/platform-context-plan.json \
  --out-dir /abs/run/qa
```

Use the localized copy QA gate when the visible copy is translated or localized for ru/de/ar class markets. It checks source-text traceability, review notes, back-translation or semantic review, translation confidence, localized keyword basis, and RTL direction when applicable before final prompt/layout work.

After localized final images are exported, rerun the same gate with the current run manifest and a structured final visible-text review when text may appear in the raster output:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/localized-copy-qa-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --locale ru-RU \
  --source-locale zh-CN \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json \
  --final-visible-text-review /abs/run/qa/final-visible-text-review.json \
  --out-dir /abs/run/qa
```

The final visible-text review is conditional: prefer Codex visual inspection or structured review evidence first, and use OCR only when text is uncertain, small, script-sensitive, or risk-bearing. For localized final delivery, Chinese/source-language residue, non-target-language residue, or target-script drift in the final raster must block delivery.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/text-layout-proof-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

Use this before formal final generation/export whenever visible image text exists. It is a cheap proof gate for line fit, safe zones, dense localized text, and long buyer-facing claims. Long visible copy must either fit declared text boxes or record `text_layout_proof.status=pass/not_required` from a low-cost screenshot/canvas proof. If it fails, shorten/wrap the copy or revise the layout first; do not spend another full image-generation pass just to test typography.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/reconcile-generation-progress.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json
```

Use this after image export when `generated-assets/generation-progress.json` is stale but the current run-scoped final-images manifest is correct. It updates progress evidence without regenerating approved images. It does not replace anchor batch QA.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/runtime-watchdog.mjs \
  --run-dir /abs/run
```

Use this when a run exceeds 15 minutes and after final export before QA loop/final handoff. It reads the current run's production efficiency plan, `generated-assets/generation-progress.json`, final manifest, overview, QA loop state, and final gate reports. It writes `qa/runtime-watchdog-report.json` and classifies the run as `active_generation_wait`, `gate_churn_detected`, `ready_but_not_closed`, `local_planning_or_gate_stall`, or `blocked_stalled_no_progress`. If it says to stop automatic regeneration, do not restart the full set; report the status and run only the smallest next action.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/product-physics-fact-gate.mjs \
  --fact-lock /abs/run/blueprint/02b-product-physical-truth.json \
  --panels /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

Use the product physics fact gate before final delivery whenever images show physical function, installation, use steps, routing, scale, dimensions, fixtures, fasteners, or mechanisms. It blocks unsupported function claims, invented product actions, and product scale drift across the image set.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/identity-geometry-gate.mjs \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --generated-geometry /abs/run/geometry/generated-geometry.json \
  --out-dir /abs/run/qa
```

Use the identity geometry gate for apparel and other proportion-sensitive products. It catches product length, hem position, sleeve length, neckline, silhouette, and ratio drift such as turning a normal jersey into a crop top.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/prompt-readiness-gate.mjs \
  --run-dir /abs/run
```

Use the prompt readiness gate before final prompt/request delivery. It blocks generic or premature prompt handoff when strategy, sketches, photography treatment, layout intent, or personalization markers are missing.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/prompt-layer-gate.mjs \
  --stack /abs/run/prompt-pack/12-prompt-layer-stack.json \
  --out-dir /abs/run/qa
```

Use the prompt layer gate before final prompt/request delivery. It checks the Prompt Layer Architect Brain decision, mandatory base layers, conditional layers, layer conflicts, and generic prompt risk.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/image-set-export-gate.mjs \
  --run-dir /abs/run \
  --image-dir /abs/run/final-images \
  --out-dir /abs/run/qa \
  --expected-count 8 \
  --required-ratio 3:4
```

Use the export gate before final delivery to catch contact-sheet-only outputs, non-independent images, missing English purpose slugs in filenames, low resolution, wrong aspect ratios, and cross-task image scope risk. This writes `export/final-images-manifest.json`; use that manifest for overview and review surfaces. When `--run-dir` has a known platform context and no explicit `--required-ratio` is provided, the gate may infer the required ratio from the platform profile, such as Ozon `3:4` portrait for normal categories.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-delivery-overview.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json \
  --out-dir /abs/run/overview \
  --title "商品套图总览"
```

For every multi-image set, create `overview/SET-OVERVIEW-contact-sheet.png` and `overview/delivery-overview-report.json` before final delivery. This 总览图 is for package review and conversation handoff only; it must not be placed in `final-images` or used as a substitute for independent ecommerce images. Do not create it from a shared `outputs/` directory.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/post-generation-tldraw-launcher.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json \
  --title "商品图审核工作台"
```

Use this after generated final images are exported and the delivery overview exists. It creates `review-workspace/`, imports the current run manifest images as locked bottom-floor tldraw shapes, starts or reuses the shared tldraw service by default, and writes `qa/post-generation-tldraw-launch-report.json`. Present the ready URL in the final handoff. If it cannot start, report the blocked reason and keep the workspace files as durable review artifacts. Use `--no-auto-start` only for selftests or explicit non-interactive archives.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/final-delivery-gate.mjs \
  --run-dir /abs/run
```

Use the final delivery gate after all QA gates and before telling the user a set is complete. It aggregates upstream gate reports, blocks delivery when required generation is unavailable, requires a delivery overview contact sheet for multi-image sets, allows intentional single-image final delivery with a run manifest, and rejects draft/placeholder/wireframe assets in `final-images`. A technical export pass is not enough for ecommerce image acceptance.

For multi-image sets it also checks `00-task-context.yaml`, stale generation progress, anchor batch QA evidence, and product-background/card consistency evidence. If final images exist but progress is still `planned`/`not_started` with no completed images, reconcile progress from the current run manifest before final delivery. If a 4+ image set lacks an anchor batch decision of `continue`/`pass`, generate and review the anchor batch before continuing the full set. If product/card background consistency fails, normalize the source product asset and rerender only affected card/infographic layouts.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/qa-loop-router.mjs \
  --run-dir /abs/run
```

Use the QA loop router after any gate failure or warning. It reads gate reports from `/abs/run/qa`, outputs one routing decision, and tells the workflow which upstream node to return to, what to rerun, what not to rerun, whether user input is required, and what retry budget applies.

The router is also the executable loop guard. It persists repeated failure signatures in `qa/qa-loop-state.json`, ignores `final-delivery-gate-report.json` as a root-cause input, and changes the decision to `blocked_retry_budget_exhausted` when the same failure exceeds its retry budget. When this happens, stop automatic regeneration and ask for better source evidence, user confirmation, or a changed production direction before any more image generation.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-identity-consistency-review.mjs \
  --source /abs/source.png \
  --generated-dir /abs/run/generated-assets \
  --out-dir /abs/run/qa \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml
```

Use the identity consistency review before final export. It creates side-by-side source-vs-generated review artifacts for checking product silhouette, color, material appearance, hardware, closure, strap/handle, accessories, logos/markings, and distinctive details. Machine checks are not enough; inspect the generated images visually against the source image and identity lock.

For existing images, create a local infinite-canvas style review board:

Preferred rich local workspace:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-tldraw-review-workspace.mjs \
  --out-dir /abs/run/review-workspace \
  --manifest /abs/run/export/final-images-manifest.json \
  --run-dir /abs/run \
  --title "商品图审核工作台"
```

This creates a React + Vite review workspace from the current run manifest with copied image assets, `data/import-manifest.json`, `data/annotations.json`, `data/canvas-state.json`, `data/review-completion.json`, `data/review-completion-ready.json`, and `data/generation-tasks.json`. By default it also starts or reuses the shared tldraw service and returns a ready session URL. The review plane must use native tldraw as the actual drawing canvas: generated product images are imported as locked bottom-floor tldraw image shapes, while tldraw pen, arrow, shape, note, text, A-H standards, issue markers, and revision annotations live above those images in the same canvas coordinate system. Do not use a left sidebar or an HTML image-card overlay above the tldraw canvas. Put the image file list in the top dropdown; tldraw zoom/pan is allowed because images and annotations scale together inside the same canvas. The session id should be the run id unless an explicit unique session id is provided.

For generated multi-image final sets, use the post-generation launcher so the workspace and shared canvas service are started automatically after export and overview. For single-image drafts or non-final planning artifacts, create the workspace only when visual review is requested or a gate fails. Use `--no-auto-start` only for selftests, file-only artifact generation, or explicitly non-interactive audit archives.

When interactive review or revision markup is the next step, ensure the shared service is ready before final delivery with the one-step launcher. This is also the fallback command if automatic startup from workspace creation is blocked:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/open-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

This registers the workspace, starts or reuses the shared localhost service, waits until the URL responds, and returns the ready session URL. If automatic startup or this launcher fails, report the blocked reason and keep the tldraw workspace files plus annotation JSON as the durable artifact instead of claiming the canvas is available.

Preferred shared service for multiple chats/runs:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/register-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/start-tldraw-shared-service.mjs \
  --session-id run-or-chat-id
```

This starts or reuses one shared localhost canvas service and opens each chat/run as `/?session=<session-id>`. Use this mode for normal Codex App usage so parallel chats do not each need their own Vite server.

Isolated fallback server for one workspace:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/start-tldraw-review-workspace.mjs \
  --workspace-dir /abs/run/review-workspace
```

This writes `data/server-state.json` with the selected localhost URL. It starts at most one server per workspace directory. Use it only when the shared service is undesirable, unavailable, or isolation is explicitly required.

After the user exports or saves annotations, convert them into generation tasks:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/wait-for-review-completion.mjs \
  --workspace-dir /abs/run/review-workspace \
  --run-dir /abs/run \
  --session-id run-or-chat-id
```

This waits for the user to click `Complete Review`, detects `data/review-completion-ready.json`, parses `data/review-completion.json` into `data/generation-tasks.json`, writes `qa/review-completion-wakeup-report.json`, and lets Codex continue only the affected revision tasks.

If the user manually provides an annotations or completion JSON file, parse it directly:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/parse-canvas-annotations.mjs \
  --annotations /abs/run/review-workspace/data/review-completion.json \
  --out /abs/run/review-workspace/data/generation-tasks.json \
  --run-dir /abs/run
```

After the user clicks `Complete Review`, capture the current browser session when Codex needs screenshot evidence back in the conversation:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/capture-review-session.mjs \
  --url http://127.0.0.1:5190/?session=run-or-chat-id \
  --out-dir /abs/run/review-workspace/captures
```

The completion button posts the tldraw snapshot and structured annotation payload to the local review service, which writes `data/review-completion.json` and `data/review-completion-ready.json` back into the run workspace. It also keeps the JSON download fallback for browser-only failure cases. When visual screenshot evidence is needed, capture the browser session, then continue only the affected revision tasks.

If a native Codex/Sites, Creative Production, Figma/FigJam, or app widget review surface is available in the current session and can actually render the image assets, render that review surface too; still keep the tldraw workspace files or annotation JSON as the durable artifact. Do not render a widget with local paths when it only shows placeholders.

For image sets that need precise revision feedback, also create a clickable A-H region review page:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-region-review-html.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json \
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
- Run-scoped `export/final-images-manifest.json` for multi-image sets
- Delivery overview contact sheet for multi-image sets
- Compact image-set planning for multi-image sets when final quality depends on role planning
- Selected strategy direction when the user request was rough, including whether the user chose it or the harness selected it
- First user-visible direction handoff when the request was rough/open, before formal production begins
- Concise product identity notes and source-image quality/enhancement note
- Concise Source Product Understanding note, including AI-read visible text and OCR fallback facts that were locked or marked uncertain
- Concise product physical truth notes when function, installation, use steps, dimensions, or scale affected the image set
- Concise visual strategy / shot matrix summary
- Concise platform/category/season/region context summary when it affected strategy or copy
- Platform/category preference overlay when matching user-confirmed memory exists
- Commerce design research plan when conversion, click appeal, dwell time, or bestseller learning is required
- Final prompt/request summary sufficient for review
- Focused QA summary covering product identity, scene reality, visual diversity, platform fit, and buyer-facing copy
- tldraw review session URL after generated multi-image final sets are exported; single-image/draft fast mode may skip unless review is requested or a gate fails

Quality production mode should provide:

- Independent final image files when image generation is requested
- Required delivery overview image at `overview/SET-OVERVIEW-contact-sheet.png` for multi-image sets
- Run-scoped `export/final-images-manifest.json`
- Selected strategy direction when the request was rough/open
- Source Product Understanding facts that affect identity, scale, function, or copy, with OCR fallback only when AI visual text reading is uncertain or insufficient
- Product Identity Lock and physical/geometry locks when triggered
- Compact feature/audience/commerce strategy sufficient to drive shot choices
- Compact image-set planning at `blueprint/quality-production-blueprint.json`, preserving role planning without full industrial reports
- Visual director shot matrix and prompt-layer decisions
- Anchor batch QA decision before continuing the full set
- Relevant QA reports only: identity, physical/geometry if triggered, copy, marketing, export, final delivery
- tldraw review session URL after generated multi-image final sets are exported, with blocked reason if service startup fails

Industrial audit mode should provide the complete workflow artifacts:

- Product Fact Sheet
- Source Image Set Manifest when multiple source images are provided
- Source Product Understanding with AI-read visible text and conditional OCR facts when a source image is provided
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
- Final Images Manifest proving task-scoped image membership
- tldraw Review Workspace or annotation surface
- tldraw Review Workspace and parsed Generation Tasks after generated multi-image final sets, or when visual review/revision is needed
- Source Image Quality Report
- Source Product Understanding Gate Report
- Platform/Category Research Brief when research is required
- Platform Context Plan with freshness cadence, season, climate, holiday, region, and trend query plan when relevant
- Platform/Category Profile Overlay
- Platform Preference Overlay when matching user-confirmed memory exists
- Commerce Design Research Plan when conversion, click appeal, dwell time, or bestseller learning is required
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
- `references/source-product-understanding.md` for source-image product recognition, AI-first text reading, conditional OCR fallback, text fact extraction, and propagation into locks.
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
