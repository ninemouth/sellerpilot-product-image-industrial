# Production Runtime Runbook

Load this reference only after the main skill router determines that exact runtime commands, provider setup, telemetry, canvas mechanics, or script-level operating details are needed. It is intentionally separated from `SKILL.md` to keep ordinary product-image planning compact.

## Bundled Scripts

Use bundled scripts for deterministic support work. They do not replace Codex-native image generation.

## Automatic Provider Routing

Run this before provider execution and save the result in the current run:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/resolve-image-provider.mjs \
  --run-dir /abs/current-run
```

The resolver checks the shared SellerPilot provider configuration and the local Codex `config.toml`. The user's product-image generation request authorizes the route it resolves for the run; do not ask again before invoking that selected provider. It returns one of:

- `native_codex`: use the system `imagegen` / `image_gen` capability. Do not silently substitute a proxy if that capability is unavailable.
- `third_party_proxy`: use the resolved OpenAI-compatible `base_url`, model, and key environment variable through the runtime below.
- `configuration_required`: pause only because the required local key is absent. This is a technical configuration requirement, not a need for renewed generation authorization. The default ThinkAI endpoint and `gpt-image-2` model are already known unless the user explicitly requests a different endpoint/model.

Configure the third-party profile once, without exposing the key:

```bash
npm run configure:image-provider -- --api-key "<API_KEY>"
```

Installation and update run `ensure-image-provider-configuration.mjs` automatically after the installed copy is verified. When the resolver detects `third_party_proxy` but no usable key, it opens the OS-native masked local input dialog automatically; users do not need to know or type a special chat command. It supports macOS (AppleScript hidden answer), Windows (password-masked WinForms dialog), and Linux desktop when Zenity or KDialog is available. Native routing and already configured third-party routing never prompt or overwrite a key. Headless/CI installs and user cancellation retain the installed skill and return the safe `configuration_required` state.

The standalone dialog remains available for repair or a key rotation:

```bash
npm run configure:image-provider-interactive
```

It forwards the key to the local configurator through stdin and prints only configuration status. A user who explicitly pastes a key into a local Codex conversation may authorize local configuration, but the password dialog is the default because chat transcripts can retain pasted text.

Use `--base-url`, `--model`, `--name`, or `--api-key-env` only when the current third-party proxy differs from ThinkAI.

The old ThinkAI/Proxy names are repository migration templates only and are not installed by default, so Codex shows one SellerPilot skill. New and updated users should invoke only `$sellerpilot-product-image-industrial`.

For resolved third-party provider runs:

```bash
THINKAI_IMAGE_API_KEY="<key>" \
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/thinkai-image-runtime.mjs \
  --prompt "<final personalized prompt>" \
  --image /abs/source-product.png \
  --size 2k \
  --quality hd \
  --output-dir /abs/run/generated-assets/anchor-01
```

When the resolver returns a non-default endpoint, model, key environment variable, or capability profile, pass its exact `provider.base_url`, `provider.model`, `provider.api_key_env`, and resolver report to the runtime. Never replace those values with an inferred provider. For a selected third-party route, a key saved in the local provider configuration has priority over a same-name or legacy environment variable; the environment variable is only a fallback when the local configuration has no key. The runtime defaults to the resolved provider's declared `quality`, `size`, and `response_format` capabilities; an unknown OpenAI-compatible provider uses the conservative `auto` profile until its supported values are configured and verified.

The runtime reads the resolver output or the shared `${CODEX_HOME:-$HOME/.codex}/sellerpilot-product-image-industrial/image-provider.json`. It still recognizes old `.thinkai-image-runtime.json` files for migration, but new configuration must use the shared provider file. Keep all local provider configuration uncommitted.

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
After copy/verification, sync invokes the automatic local provider configuration check. Pass `--no-provider-config-prompt` only for headless release automation or an intentionally deferred configuration flow; it does not change the resolver route or overwrite any existing provider key.
The sync script writes `.sellerpilot-skill-release.json` into the installed skill. It records the current git upstream branch, or the current local branch when no upstream exists, as `remote_branch`; pass `--remote-branch <branch>` only when installing a build artifact that should track a specific GitHub branch.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/check-skill-update.mjs \
  --cache-ttl-hours 24 \
  --timeout-ms 1500
```

Use this as the mandatory first gate for production requests. It compares the installed release metadata or local git commit against the configured GitHub branch when the cache is stale. `current` continues silently. `update_available` must pause formal production and ask the user whether to update before continuing. Unknown freshness should not block production, but it must not be presented as current.

The default update-check output is intentionally user-safe: it must not include `skill_root`, `source_path`, `dest_path`, backup/cache paths, temporary build directories, development clone paths, raw remote URLs, raw network errors, or local usernames. Use `--include-diagnostics` only for internal debugging and never quote those diagnostic fields in a user-facing production/update message. If a check or sync fails, summarize only the safe status, preserved work, and next action.

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

### Loop Engineering plan compiler (Phase 1)

For development and new control-plane integrations, compile task facts into the canonical policy, run state, and run-local DAG before dispatching work. Do not hand-author a standard production `tasks.json`:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/compile-production-plan.mjs \
  --run-dir /abs/run \
  --platform "Amazon" \
  --category "shoulder bag" \
  --image-count 7 \
  --has-source-image true
```

The compiler writes `run-state.json`, `planning/compiled-production-plan.json`, and `orchestration/tasks.json`. Explicit `--image-count` / `--locale` win; otherwise it applies the matching platform default and records the source under `goal.input_resolution`. It always compiles `generation-spec` before any provider-generation node, and mode contracts compile the required overview/review workspace as final-delivery dependencies. It classifies every task as a deterministic pre-gate, agent planning, provider generation, delivery closure, or human decision. In this migration phase, only deterministic tasks may execute through the generic orchestrator; provider, agent, and human-boundary tasks must pause rather than being treated as completed. See `docs/loop-engineering-reconstruction.md` for the full migration plan and loop budget rules.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/production-orchestrator.mjs \
  --run-dir /abs/run \
  --tasks /abs/run/orchestration/tasks.json \
  --execute \
  --concurrency 4
```

Use this when independent pre-generation work should run as a real DAG instead of a written plan. The task file may include source preflight, AI visual text read, platform profile load, provider resolve, brief assumptions, compact copy/visual notes, and post-export workspace preparation. Tasks declare `depends_on`, `inputs`, `outputs`, and `command`; the orchestrator writes `orchestration/production-orchestrator-state.json`, reuses unchanged outputs by task hash, honors `orchestration/cancel`, and leaves identity, physical-truth, prompt, anchor-QA, and final-delivery gates as explicit convergence points.

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

When final export has not happened but per-job provider progress files already exist, reconcile from child progress instead:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/reconcile-generation-progress.mjs \
  --run-dir /abs/run \
  --from-child-progress
```

This preserves completed provider assets, failed job ids, pending jobs, and anchor QA evidence in the main progress file without creating final delivery claims.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/production-artifact-integrity-gate.mjs \
  --run-dir /abs/run
```

Use this before final delivery, after retry/revision repair, and whenever a run was continued after an interruption. It validates machine JSON artifacts such as `generation-progress.json`, `anchor-batch-qa-decision.json`, `final-images-manifest.json`, overview reports, QA loop state, and QA reports. If it finds patch markers, merge-conflict text, invalid JSON, or stale progress after final images exist, repair only the corrupted artifact or reconcile progress from current-run evidence. Do not trigger provider regeneration to hide a local artifact write error.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/record-asset-reuse.mjs \
  --run-dir /abs/run \
  --write-progress
```

Use this in revision repair mode whenever the run reuses approved provider/base assets from a prior run or earlier stage. It writes `generated-assets/asset-reuse-manifest.json` plus `progress-reused-*.json` synthetic progress records in the current run. These records must identify the current copied asset, the original source path/run when known, the reuse reason, approving evidence, and linked final images. Do not leave copied `summary.json` paths from an older run as the only provenance evidence.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/production-phase-tracer.mjs \
  --run-dir /abs/run
```

Use this after long-running generation, after provider failures, and before performance tuning. It writes `telemetry/phase-trace.json` and `.md` with source/preflight, planning, provider, asset reuse, local compositor, QA, export, canvas spans plus provider total, first-byte, response, and download p50/p95 metrics. Use the trace data before changing timeout, concurrency, or quality gates. In revision repair, `provider_runtime_ms` must represent only current-run provider jobs; approved asset reuse belongs in `asset_reuse_ms`, and local typography/embroidery overlays belong in `local_compositor_ms`.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/provider-telemetry-summary.mjs \
  --runs-root /abs/runs \
  --min-runs 3 \
  --min-meaningful-jobs 10 \
  --out-dir /abs/runs/telemetry
```

Use this before changing global provider timeout, concurrency, retry, or pacing defaults. It aggregates multiple run-local `telemetry/phase-trace.json` files and writes `provider-telemetry-summary.json`; if the status is `insufficient_sample`, keep any fix run-local, collect more traced production runs, and do not tune global provider defaults from a single incident.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/provider-instability-circuit-breaker.mjs \
  --run-dir /abs/run
```

Use this after repeated provider failures or before deciding to keep retrying scene-heavy roles. It reads `generated-assets/progress-*.json` plus `qa/failed-asset-repair-map.json`, stops automatic provider retries when unresolved repeated failures exceed the threshold, and tells the workflow to preserve approved assets, downgrade unstable scenes, derive from approved assets when allowed, or ask the user before more high-cost retries.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/personalized-text-compositor-contract.mjs \
  --run-dir /abs/run \
  --name "Olivia" \
  --date "06.16.2026" \
  --font-family "Snell Roundhand" \
  --visible-text-status pass
```

Use this for Etsy personalized products, wedding gifts, monograms, names, dates, and any exact buyer-specific visible text. The default production contract is provider-generated blank/weak-text base imagery plus local exact typography overlay, followed by text-layout proof and final raster visible-text review. Do not rely on provider-rendered exact names/dates unless the user explicitly accepts the accuracy risk.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/final-image-lineage-gate.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json
```

Use this after export when final images include derived crops, repaired roles, local text overlays, or imported/externally provided assets. The final manifest must declare each image's `lineage.source_type`, approved source asset, transformation type, repair IDs, and text overlay proof as applicable. Derived assets may be valid final images, but they must not be presented as fresh provider scene generations.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/identity-consistency-gate.mjs \
  --run-dir /abs/run \
  --manifest /abs/run/export/final-images-manifest.json \
  --source /abs/source-product.png \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml \
  --review /abs/run/qa/identity-consistency-visual-review.json
```

Use this before final delivery for every source-backed product image set and for any final image with `legacy_fallback`, `derived`, `repaired`, `local_overlay`, `text_overlay`, or `needs_identity_review` lineage. It requires explicit per-image source-vs-generated review evidence. Check silhouette, proportions, color, material, hardware, closure/opening, strap/handle, accessories, logos/markings, and micro-details against the source product and identity lock. `needs_visual_review`, missing per-image review, fallback without an explicit pass, or any identity drift must block final delivery and route only the affected image/role back through QA.

For printed/woven fabric bags, the review cannot be a single generic `pass`. Each product-bearing final image must explicitly pass bucket/body silhouette and proportions, opening/interior lining, strap/handle route, canonical motif/pattern, and woven/cotton-poly texture. Missing evidence or notes describing motif drift, material drift, tote/structured-bag drift, glossy/plastic/leather-like texture, or similar-product substitution must fail.

After all current-run final images exist and product/background consistency has passed, apply the adaptive natural finish to the complete manifest in one transactional batch:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/natural-image-finish-batch.mjs \
  --run-dir /abs/run
```

The user-facing request for this step should stay simple, for example "让这批图更自然" or "继续这个 run，只做自然质感收尾，不重生图". Internally, the batch does not use one parameter set for every image. It combines structured role/panel metadata with pixel inspection and selects `photographic_scene`, `studio_product`, `macro_detail`, `graphic_text`, `transparent_asset`, or `hybrid_commerce`. The processor then runs a visual-state camera/Photoshop realism check rather than a product-category recipe: high-key, low-key, flat render, glossy, matte/smooth, macro, graphic, transparent, lifestyle camera scene, and studio clean product states can receive bounded white-balance and color-temperature correction, filmic highlight shoulder and shadow toe, Photoshop-style local contrast/clarity, material microtexture, surface mottle, chroma drift, signal-dependent sensor grain, subtle lens edge softness, and highlight bloom. Each asset proof includes a camera/Photoshop A/B naturalness review comparing before/after luminance variation, local contrast, saturation shift, white-balance drift, and mean pixel movement; blocked reviews stop the transaction before replacing final images, while warnings remain human-review signals. The processor writes spectral diagnostics and may apply restrained FFT notch attenuation only when a concrete periodic artifact is detected above the selected profile threshold; it does not run generic "AI frequency" suppression. Visible-text assets use conservative processing plus text-region restoration and then require `post-natural-finish-visible-text-review.mjs` evidence bound to each final file hash. Transparent assets preserve their alpha channel. Originals remain in `generated-assets/natural-finish-originals/`, all outputs are staged before promotion, and a failed batch preserves/restores the complete original set. Successful processing writes batch/gate/per-asset proofs and preserves upstream provider/text-overlay lineage under `natural_image_finish`. This is a natural-quality finish, not AI-detector evasion; do not add CLIP-detector adversarial perturbations or describe the output as detector-resistant. Read `references/natural-image-finish.md` for the full execution and review contract.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/backfill-final-image-lineage.mjs \
  --run-dir /abs/run \
  --font-family "recorded_from_existing_final_export"
```

Use this only for historical runs that already have final images and supporting evidence but whose manifest was created before explicit lineage was required. After backfill, rerun the personalized text compositor contract when text items are present, rerun `image-set-export-gate.mjs` so the manifest embeds lineage, then rerun `final-image-lineage-gate.mjs` and `final-delivery-gate.mjs`. Do not regenerate the full set merely to hide missing lineage metadata.

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/runtime-watchdog.mjs \
  --run-dir /abs/run \
  --auto-close-ready
```

Use this when a run exceeds 15 minutes and after final export before QA loop/final handoff. It reads the current run's production efficiency plan, `generated-assets/generation-progress.json`, final manifest, overview, QA loop state, and final gate reports. It writes `qa/runtime-watchdog-report.json` and classifies the run as `active_generation_wait`, `gate_churn_detected`, `ready_but_not_closed`, `local_planning_or_gate_stall`, or `blocked_stalled_no_progress`. Use `--auto-close-ready` after final export: if final images already exist but closure is incomplete, it creates any missing overview, launches/reuses tldraw, runs `final-delivery-gate.mjs`, and writes `qa/ready-run-auto-close-report.json` without regenerating images. If it says to stop automatic regeneration, do not restart the full set; report the status and run only the smallest next action.

After final images land, give a user-visible status update immediately: how many final images exist, whether overview/tldraw/final gate is running, and that the workflow is not regenerating already completed images.

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

For multi-image sets it also checks `00-task-context.yaml`, stale generation progress, anchor batch QA evidence, product-background/card consistency evidence, artifact integrity, and identity consistency evidence. If final images exist but progress is still `planned`/`not_started` with no completed images, reconcile progress from the current run manifest before final delivery. If a 4+ image set lacks an anchor batch decision of `continue`/`pass`, generate and review the anchor batch before continuing the full set. If product/card background consistency fails, normalize the source product asset and rerender only affected card/infographic layouts. If final images include source-backed product identity or fallback/derived/repaired lineage, run `identity-consistency-gate.mjs`; do not count fallback images as final until per-image identity review passes.

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

For every generated final delivery, use the post-generation launcher so the workspace and shared canvas service are started automatically after export; multi-image sets start after their overview. Explicit single-image drafts or non-final planning artifacts may skip it unless review is requested. Use `--no-auto-start` only for selftests, file-only artifact generation, or explicitly non-interactive audit archives.

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
