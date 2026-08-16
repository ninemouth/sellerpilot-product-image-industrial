---
name: sellerpilot-product-image-industrial
description: Use when Codex needs to create, plan, review, or revise industrial ecommerce product image sets for SellerPilot-style workflows, including Amazon listing images, TikTok Shop images, Xiaohongshu image packs, multi-platform product image packs, competitor-reference redesigns, product image QA, localized commerce copy, store unified visual style memory, and product-fact-sheet based visual generation. Trigger for Chinese or English requests about 商品图, 产品图, 电商套图, Amazon 7 image sets, listing images, product-image generation, product-image prompts, competitor image redesign, 店铺统一风格, store style memory, or SellerPilot product image production.
---

# SellerPilot Product Image Industrial

## Purpose

Use this skill as the Codex chat/project entrypoint for SellerPilot-style ecommerce product image production. It turns product URLs, source product images, competitor references, platform targets, audience context, and style requirements into generated product images plus only the planning, QA, and review artifacts needed for the selected mode.

This is the single SellerPilot Product Image skill. Before every production execution, resolve exactly one profile with `scripts/resolve-image-provider.mjs`. `Codex Native` and `NVIDIA FLUX` are built-in profiles; third-party endpoints such as ThinkAI are explicit, named external profiles. A ThinkAI profile may use `gpt-image-2` through `scripts/thinkai-image-runtime.mjs`, but it is never the implicit default. A new profile registry defaults to `Codex Native`; a legacy ThinkAI configuration is migrated in place as an already-selected external profile so existing users are not silently rerouted. Do not infer a user's subscription status or silently change the selected profile.

This skill owns the SellerPilot industrial workflow: product truth, identity locks, source-photo enhancement, platform/category research, visual strategy, photography direction, prompt layering, QA routing, review surfaces, and export rules. It uses only the execution layer selected by the provider resolver: system `imagegen` / built-in `image_gen` for native Codex, or the repo-local OpenAI-compatible runtime for the resolved third-party provider. It must not create one-off image-generation wrappers, silently switch to API/CLI fallback, or claim deterministic layout drafts as final generated product images.

### Surface Material Transfer

For press-on nails, nail wraps, decals, tattoos, printed fabric, and other products where the supplied artwork must remain exact, use `surface_material_transfer` rather than normal reference recreation. The source artwork is canonical material: remove any source background, captions, UI, and watermarks first; lock its palette, color temperature, brightness hierarchy, gradient direction, texture, and silhouette; then project it to the named target surface/mask. The hand, skin, perspective, occlusion, and bounded environment light may be generated or integrated, but the material may not be freely redrawn. Final delivery requires a material transfer proof and per-region visual review through `surface-material-transfer-gate`; a failure revises only the affected material/region.

For bags, apparel, accessories, fabric home goods, and other physical products where a printed or woven fabric is part of the product identity, treat the visible motif as canonical material too. A green/red double-happiness cotton-poly bucket bag, for example, must preserve bucket body proportions, opening/interior lining, strap route, motif scale/grid, and woven texture. It must not become a generic tote, leather-like bag, glossy synthetic bag, or a bag with a similar-but-redrawn pattern. Final delivery must fail unless the run has a canonical surface material lock plus per-image identity review evidence for the motif and fabric texture.

```bash
node scripts/create-surface-material-lock.mjs --run-dir /abs/run --category "printed fabric bucket bag" --target-surface "bag panels" --source-images /abs/bag-front.png,/abs/bag-detail.png
node scripts/surface-material-transfer-gate.mjs --lock /abs/run/surface-material/canonical-material-lock.json --transfer-proof /abs/run/surface-material/material-transfer-proof.json --visual-review /abs/run/qa/surface-material-visual-review.json --out-dir /abs/run/qa
```

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

During installation or update, run `ensure-image-provider-configuration.mjs` after the installed copy is verified. If the current Codex configuration resolves to a third-party provider and its key is absent, automatically open the OS-native masked local key dialog (macOS, Windows, or supported Linux desktop); do not require the user to discover or type a chat command. Never prompt when the route is native or a usable third-party key already exists, never overwrite a saved key, and treat cancellation/headless installation as `configuration_required` without failing the skill install.

The shared tldraw canvas is prepared during skill installation and update at `${CODEX_HOME:-$HOME/.codex}/sellerpilot-product-image-industrial/canvas-service`. Do not run dependency installation during a product-image task. When the canvas is missing or its lockfile changes, complete preparation first; normal post-generation startup may only reuse prepared dependencies and verify the local service.

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

Do not require the user to recite the industrial workflow, QA policy, generation boundary, blocked-runtime behavior, model name, tool name, or review-canvas rules. Infer the missing production steps from the product/category/platform request, resolve the configured provider route first, then execute only that route: system `imagegen` / built-in `image_gen` for native Codex, or the resolved OpenAI-compatible runtime for any configured third-party provider. Never infer a provider from membership, never silently replace a configured third-party route with ThinkAI or native generation, and only create a request pack as fallback or audit evidence when generation cannot be executed or when the user explicitly asks for it.

The long strict prompt is an internal acceptance policy, not a required user prompt.

Never expose sandbox, DNS, network-permission, raw curl, API-key, or local-path diagnostics as a user-facing production update. Keep those only in the run diagnostic files. A user-facing failure message may state that the affected asset is blocked, that completed assets were preserved, and the smallest safe next action; it must not claim that Codex will bypass a sandbox or alter API configuration.

A configured third-party route authorizes its execution for the task. Treat provider selection plus the saved third-party configuration from skill installation/update as the one-time authorization boundary: when `third_party_proxy` resolves `ready`, upload user-provided reference images to that exact route and do not ask for another authorization during generation, asset download, retry, QA, or delivery. Never ask “是否同意把参考图发到外部生成通道/是否继续？” for this route. If the host cannot reach the provider, record `external_provider_transport_unavailable`; if the host or tenant blocks the outbound reference-image upload before the provider receives it, record `external_provider_host_policy_blocked`. In either case preserve the run, do not count a provider attempt, do not substitute another provider, and never render a local safe draft as a final product image. A host-policy block needs the same selected route enabled in the environment or organization policy, not renewed task-level consent.

When a task cannot continue because the current environment lacks permission for a necessary action, request user authorization in plain language before rerunning that action. Name the user-relevant capability, not the internal mechanism: "需要你授权我启动本地临时审核服务", "需要你授权我访问网络以检查更新", or "需要你授权我同步已安装 skill". This general rule never creates a second confirmation for user-provided reference-image upload to a ready `third_party_proxy`; report a host policy block as an environment/organization configuration need instead. Do not say "sandbox 禁止", "受控权限", "我会绕过", or paste raw permission errors. If the current session cannot request authorization, stop the affected step, preserve completed assets, write diagnostics to the run, and tell the user what authorization is needed and what will remain blocked without it.

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
- **Single-image quality production:** Use when the user asks for one high-quality hero/main/scene/detail image rather than a full set. Treat it as a valid final delivery: create one independent final image, run the relevant identity/marketing/export/final gates, write `export/final-images-manifest.json`, and auto-start tldraw before user handoff. Do not require anchor batch pacing, delivery overview contact sheet, or multi-image blueprint. Only an explicitly requested draft/file-only archive may skip the canvas.
- **Quality production mode (default for final ecommerce image sets):** Use for normal multi-image套图, high-quality final assets, scene-heavy images, product identity/proportion-sensitive goods, physical-function/scale-sensitive goods, or conversion-critical platform/category work. This is the main quality/speed balance mode: run the complete quality-critical path, use anchor batch pacing, run only relevant gates, reuse approved assets, create the required overview, and avoid full industrial audit artifacts unless needed.
- **Revision repair mode:** Use when the user provides failed outputs, comparison screenshots, tldraw annotations, or asks to modify an existing set. Parse feedback, route to the earliest failed node, and regenerate/rerender only affected assets.
- **Industrial audit mode:** Use when the user asks for 工业级完整 workflow, 可迁移到 SellerPilot, 审计, gate reports, review records, or development evidence. Produce the full run skeleton, research briefs, prompt packs, gate reports, QA routing records, review workspace, and export package.
- **Debug/development mode:** Use only while improving this skill. Keep selftests, intermediate fixtures, verbose gate JSON, and experimental work under `work/` or an explicit temp/debug directory. Do not let debug artifacts affect normal chat generation.

For normal chat, do not create every artifact listed in the full output contract. Create only the artifacts needed to generate, QA, and deliver the requested images. Escalate from fast or quality production mode to industrial audit mode only when a gate fails repeatedly, source identity is ambiguous, runtime generation is unavailable, or the user asks for the full package.

## Execution Flow

1. Resolve the skill root to `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial`. Read `${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/AGENTS.md` before running a production image workflow. Do not search only the current workspace for `AGENTS.md`.
1a. Run the Production Update Gate with `check-skill-update.mjs` as the first executable production step. If it reports `update_available`, ask the user whether to update now before any production planning or generation. If it reports `current`, continue silently. If freshness is unknown, continue with a concise note that update status could not be confirmed.
1aa. Before any image-generation planning or execution, run `resolve-image-provider.mjs` exactly once for the current run. Treat its `selected_mode` as the sole execution authority: `native_codex` uses only native `imagegen` / `image_gen`; `third_party_proxy` uses only the resolved OpenAI-compatible runtime and its local provider configuration. Do not choose a route from a remembered subscription, a stale environment variable, or the runtime filename.
1b. Select the production mode with `production-mode-router.mjs` when the request is not explicitly a tiny single-image task. Default high-quality ecommerce套图 to `quality_production`, not `fast_generation`; use `industrial_audit` only when the user wants full evidence or migration artifacts.
1c. Run `production-efficiency-plan.mjs` before heavy planning or generation. In `quality_production`, keep planning compact by merging product facts, identity/geometry/physical locks, platform context, buyer questions, shot matrix, copy intent, prompt-layer decisions, and QA criteria into `blueprint/quality-production-blueprint.json` instead of writing every industrial report separately.
2. Run the Brief Intake Gate. If required information is missing, ask at most three high-value questions and record the assumptions. If no material gap exists, continue without interrupting the user.
2a. When the user request is rough or commercially open-ended, load `references/strategy-direction-routing.md`, create 2-3 production direction options, and run `strategy-direction-handoff-gate.mjs` before formal production. The first visible response to the user must include the short direction choices plus the harness-selected fallback. Do not skip this just because enough facts exist to generate. If the user has no clear preference, continue with the harness-selected `selected_option_id`, record the reason in `strategy/direction-selection.yaml`, and keep the user-visible handoff in `strategy/direction-user-handoff.md`.
3. For new Loop Engineering runs, use `compile-production-plan.mjs` plus `contracts/production-contract.json` and `contracts/platform-overrides.json` as the canonical execution control plane. The compiler emits the run-local DAG and applies platform deltas without copying the master workflow. `workflows/ecommerce-product-image-generation.yaml` is the sole master compatibility workflow. Legacy platform workflow files are now compact compatibility pointers only: when an existing run names one, resolve its `platform_override` / `route_defaults` and compile the master flow; do not attempt to restore a copied step list.
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
14b. Before provider execution, resolve the platform/category target ratio into `generation-spec/generation-spec.json` using `resolve-generation-spec.mjs`. For a new production run, first compile the run-local contract/DAG; use `generation-execution-controller.mjs` to record anchor-only execution, and do not schedule remaining roles until `anchor-batch-qa-decision.json` is `continue`, `pass`, or `approved`. Remaining independent roles are capped at concurrency 2.

14c. Every actual provider attempt must leave a shared cost/evidence ledger event under `telemetry/cost-ledger.jsonl`. `thinkai-image-runtime.mjs --run-dir ... --role ...` records this automatically. For native Codex `imagegen` / `image_gen`, first create `create-native-imagegen-handoff.mjs`; it performs the budget/evidence preflight and creates a prompt/source/role-bound dispatch contract. After the real host call, record its saved output with `record-native-imagegen-result.mjs --handoff ... --execution-evidence ...`. Do not record a deterministic layout draft as a native-generated image. Before final delivery, run `native-imagegen-ledger-gate.mjs`; any final manifest that claims `lineage.provider: native_codex` must match the handoff, succeeded hash-bound output evidence, and shared ledger event. If the ledger rejects a retry because the prompt/source/provider evidence is unchanged, stop that retry and use QA routing or an explicit user decision instead.

14d. Always start final generation with `create-image-generation-dispatch.mjs`, which resolves the current profile into exactly one run-local execution route. `native_codex` produces the native handoff in 14c. An external profile produces a third-party handoff and resolved runtime command; execute only that resolved runtime with `--run-dir`, `--role`, a run-local progress file, and the run-local provider deadline so it records the same provider budget/evidence ledger. Dispatch must pass `generation-spec/generation-spec.json.requested_size` unchanged as the default request size; provider capability metadata may not silently replace a platform target. ThinkAI is only an explicit OpenAI-compatible external profile; NVIDIA FLUX is a built-in profile using its dedicated `nvidia_nim_flux` runtime, never an automatic fallback. A ready configured third-party route already authorizes its reference-image upload and must execute directly; do not ask for another authorization during the task. If the host cannot establish the connection, preserve the run and record `external_provider_transport_unavailable`; if the host/tenant blocks external reference upload, record `external_provider_host_policy_blocked`. Neither status is a remote provider request, neither may retry native imagegen, Gamma, another provider, or a local safe draft as final. `configuration_required` remains a technical configuration pause, not a request for renewed generation authorization.

14e. A native-capable host can finish the native route without conversational parsing by writing `sellerpilot.native_imagegen_host_callback.v1` containing `run_dir`, `role`, run-relative `handoff`, `status`, `image_path`, and `tool_call_id`, then invoking `accept-native-imagegen-host-callback.mjs`. The receiver validates and records the callback through the same handoff/ledger path; it rejects wrong run, role, handoff, status, or missing success evidence.
14a. For apparel, bags, shoes, furniture, tools, and other proportion-sensitive products, load `references/identity-geometry-lock.md`. Create or update `geometry/source-geometry.json` before generation and run `identity-geometry-gate.mjs` on generated assets before final delivery. Apparel must preserve garment length, hem position, collar-to-hem ratio, sleeve length class, neckline shape, and silhouette; a normal jersey must not become a crop top unless supported by source/user input. Bags must preserve body class, top opening, bottom/side curvature, strap/handle route, panel proportions, lining visibility, and source-supported scale; a bucket bag must not drift into a generic tote, clutch, structured leather bag, or unsupported hard-shell silhouette.
15. For multi-image sets, use generation pacing: generate and QA a small anchor batch first, then continue with only missing/failed assets. Do not spend a full run serially generating all images before checking identity, scene direction, and role diversity. For intentional single-image delivery, generate the one final image after identity, prompt-layer, and relevant QA checks; do not force an anchor batch.
15a. When the user provides prior generated outputs and asks to continue, audit, optimize, or revise them, load `references/failed-output-regeneration.md` first. Classify failures such as watermark/platform-pack labels, weak graphic design, generic photography treatment, unclear micro-detail handling, identity drift, fake scenes, or repeated layouts; keep approved assets and rerun only the smallest affected upstream node.
15b. For long-running generation, update `generated-assets/generation-progress.json` after each generated asset and give the user a concise status update at least every 5 minutes. External dispatch also writes a per-role progress file. The run-local plan defaults to a 15-minute request deadline and a 10-minute meaningful-progress stale threshold; these are not global provider tuning. Heartbeats are not meaningful provider progress. If a run exceeds 15 minutes, or after final export before QA loop/final handoff, run `runtime-watchdog.mjs` to classify the delay as active generation/network wait, `provider_wait_stale`, gate churn, ready-but-not-closed, or stalled no progress. Preserve completed assets and repair only the affected role; do not silently restart the whole set to appear busy.
16. Load the risk and QA references before writing final outputs:
   - `policies/risk-boundaries.md`
   - `policies/qa-checklist.md`
17. Use the workflow steps as a gated loop, not as decorative labels. Generate only missing assets, rerender only failed layouts, and stop early when product identity, geometry, or copy strategy drifts.
18. Run export and output-failure gates before final delivery. Do not present contact sheets, collage previews, fake scene placeholders, or visually unreadable drafts as final ecommerce images. Intentional single-image delivery is allowed when `--expected-count 1` or equivalent task context is used; it still needs a run-scoped manifest and final delivery gate. For multi-image sets, generate a separate delivery overview contact sheet under `overview/`; it is a package review artifact and does not replace independent final images.
18a. Enforce task-level image isolation. Each run must have a unique `run_id` and a run-local `export/final-images-manifest.json`. Overview, tldraw, export gates, A-H review, and identity review must read the current run manifest or exactly `/abs/run/final-images`; do not point them at a date-level directory, shared `outputs/`, parent folder, or another task's folder. `outputs/` can receive copies for user-facing delivery, but it is not an internal production source.
18b. After final images are exported, run `post-generation-tldraw-launcher.mjs` for every generated final delivery, including intentional single-image deliveries; only multi-image deliveries require an overview contact sheet first. This must create `/abs/run/review-workspace`, register the run-scoped manifest images, start or reuse the shared tldraw service by default, and write `qa/post-generation-tldraw-launch-report.json` with a ready URL or blocked reason before final user handoff. The user-facing review surface must use thumbnail navigation with one large active image, explain that unmarked images stay approved, provide common-error shortcuts, and make `提交修改给 AI` the clear completion action. Use `--no-auto-start` only for selftests or explicit draft/file-only archives.
19. Produce the mode-appropriate Definition of Done. Fast mode should end with actual generated images and a concise QA summary; industrial audit mode should produce the full artifact package.

## Runtime Operations and Progressive Disclosure

Use the compiler and contracts as the production control plane; do not hand-author a standard task DAG or treat this skill as a long script catalog. Load one reference only when its trigger applies. The scripts named there are the authoritative deterministic execution path; never replace them with one-off wrappers.

- **Provider routing or a non-native Codex account:** read [gpt-built-in-image-generation-policy.md](references/gpt-built-in-image-generation-policy.md). Resolve exactly one route with `resolve-image-provider.mjs`; use a native handoff or the resolved OpenAI-compatible runtime, never a silent fallback.
- **New run / platform behavior / DAG:** read [workflow-routing.md](references/workflow-routing.md) and [loop-efficiency.md](references/loop-efficiency.md). Compile first, resolve generation spec before provider execution, pace multi-image work through anchor QA, and make only evidence-changing retries.
- **Source identity, printed material, geometry, product facts, or physical claims:** read the matching identity, source-understanding, surface-material, geometry, or physical-truth reference before prompt generation.
- **Visible copy, localization, personalized text, or graphic layout:** read [copy-strategy-loop.md](references/copy-strategy-loop.md), [prompt-layering-subloop.md](references/prompt-layering-subloop.md), and [personalized-prompt-delivery.md](references/personalized-prompt-delivery.md) as applicable.
- **Scenes, commercial photography, buyer positioning, platform/category research, or conversion work:** load only the applicable scene, photography, visual-director, audience, platform, or bestseller reference.
- **Generated images, export, delivery, canvas review, or revision:** read [marketing-quality-gates.md](references/marketing-quality-gates.md), [output-contract.md](references/output-contract.md), [review-canvas.md](references/review-canvas.md), and [qa-loop-routing.md](references/qa-loop-routing.md) only for the gates in scope.

Use [production-runtime-runbook.md](references/production-runtime-runbook.md) for exact CLI invocations, provider setup, native callback recording, telemetry, watchdog, lineage backfill, canvas service, and review completion mechanics. It is intentionally not loaded for ordinary planning.

Two policy reminders remain in the entrypoint because they protect costly decisions:

- Use `provider-telemetry-summary.mjs` across multiple run traces before changing global timeout, concurrency, or retry defaults; an `insufficient_sample` result permits only run-local repair or additional sampling.
- For older outputs lacking final lineage, run `backfill-final-image-lineage.mjs` before personalized-text, export, lineage, and final-delivery gates. Never regenerate an entire set merely to hide missing historical progress/lineage evidence.
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
- `references/production-runtime-runbook.md` for exact CLI operations, provider setup, native callback evidence, telemetry, watchdog, lineage recovery, and review-service mechanics.

Primary bundled resources:

- `workflows/` for executable workflow routing.
- `platform-profiles/` for marketplace visual guidance.
- `skills/*/*/prompt.md` for step-specific prompts.
- `templates/` for structured outputs.
- `policies/` for QA and risk checks.
- `scripts/` for rendering, source understanding, QA gates, delivery overview, and review tools.
- `assets/tldraw-review-workspace/` for the reusable React + Vite + tldraw review workspace template.
