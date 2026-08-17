# SellerPilot Product Image Industrial

**English** | [简体中文](README.md)

Industrial-grade product-image production for Codex. This is not a one-shot prompt pack. It is a production skill that carries product understanding, platform constraints, buyer-facing creative direction, image generation, evidence-aware QA, delivery overview, and tldraw review through one controlled run.

## What changed

The current release consolidates the production system around a contract-driven Loop Engineering control plane. Source-backed runs now preserve byte-identical analysis originals, prepare upload derivatives only when byte/dimension/format limits require them, deeply annotate every reference, and expose a compact semantic evidence summary to ordinary downstream tasks. Each generation role selects only the strongest one or two user-owned references (or a provider's lower cap); competitor and unclassified references never enter product-generation requests.

- A single production contract, platform overrides, and a run-local DAG replace copied platform workflows.
- Provider attempts, retries, QA routes, delivery closure, image lineage, and cost evidence share one run state.
- The skill starts with a small anchor batch, validates identity and direction, then generates only approved missing roles. It does not spend an entire multi-image budget before reviewing direction.
- A non-retryable provider refusal opens a circuit breaker immediately. The skill preserves completed assets and routes only the smallest affected repair instead of repeating the same prompt.

## What it does

- Plans and produces ecommerce product-image sets from source images, product URLs, competitor references, platform, locale, audience, and style requirements.
- Supports Amazon, TikTok Shop, Xiaohongshu, Pinduoduo, Douyin, Temu, Shopee/Lazada, Etsy, Mercado Libre, SHEIN, Ozon, Wildberries, and other profile-driven workflows.
- Extracts product identity, visible source text, material, proportions, components, and supported physical facts before generation.
- Uses source-normalized transparent or card-safe product masters for white cards, comparison panels, and information graphics.
- Keeps user-confirmed platform/category preferences and confirmed store-style memory without allowing those memories to override current product facts, platform rules, or user instructions.
- Uses commerce-design research when the request is conversion-, bestseller-, click-, or dwell-time-oriented; it writes buyer questions, trust cues, gallery narrative, and constraints back into the blueprint.
- Applies identity, geometry, physical-truth, visible-text, source-background/card consistency, export, lineage, and final-delivery gates.
- Creates a run-scoped delivery contact sheet for multi-image sets and launches a shared tldraw review workspace for every formal final delivery, including a single-image final.

## What it does not do

- It does not promise CTR, CVR, ROAS, ACOS, ranking, sales, or conversion lift.
- It does not publish, upload, or list products automatically.
- It does not invent certifications, safety claims, waterproof/fireproof/medical/child/pet claims, unsupported compatibility, mechanisms, or dimensions.
- It does not treat a competitor image as the user's source product or copy competitor visuals.
- It does not present a deterministic layout draft as a provider-generated final image.

## Requirements

- Codex Desktop or another Codex environment with local skills.
- Node.js 20+ and a detected lockfile-compatible package manager (npm for this repository’s `package-lock.json`; pnpm when a `pnpm-lock.yaml` is supplied).
- Optional: Tesseract for conditional local OCR when visual reading is uncertain.
- Optional: Chrome, Edge, or Playwright for review rendering.
- Optional but required for third-party image routing: an OpenAI-compatible image API key.

## One skill, one provider route

Call only the main skill:

```text
Use $sellerpilot-product-image-industrial to create seven Amazon US listing images from these product photos.
```

Before generation the skill resolves exactly one provider route from actual local configuration:

| Resolved mode | Execution path |
|---|---|
| `native_codex` | Codex built-in `imagegen` / `image_gen` |
| `third_party_proxy` | The configured OpenAI-compatible image endpoint |
| `configuration_required` | The selected third-party route lacks a usable local key; configuration is needed, not renewed generation authorization |

`Codex Native` and `NVIDIA FLUX` are built-in profiles. ThinkAI is an explicit external profile (it may use `https://www.thinkai.tv/v1` with `gpt-image-2`), never the main skill's implicit default. Legacy ThinkAI configuration is migrated as an already-selected external profile to preserve existing routing. The skill never guesses a user's subscription or silently switches providers.

An image-generation request already authorizes the resolved provider route for that run. For a ready third-party route this includes uploading user-provided reference images; the skill must not ask again before every native or third-party provider call, or ask the user whether reference images may be sent externally. If the host/tenant blocks that upload before the provider receives it, record `external_provider_host_policy_blocked`, preserve the run and retry budget, and require the same selected route to be allowed by the environment or organization policy. Do not substitute a provider or present a local deterministic draft as a final image.

## Automatic third-party key setup

After a skill installation or update, the installer resolves the current provider configuration.

```text
third-party proxy + usable key       → continue silently
native Codex route                   → continue silently
third-party proxy + missing key      → automatically open a masked local key dialog
CI/headless install or dialog cancel → install succeeds; route remains configuration_required
```

The secure local dialog is supported on:

- **macOS:** native hidden-answer dialog.
- **Windows:** native WinForms dialog with password masking.
- **Linux desktop:** Zenity password dialog, then KDialog when available.

The entered key is passed to the local configurator through standard input. It is not placed in a command-line argument, terminal output, Git, skill logs, or provider failure diagnostics. Existing saved keys are never overwritten by automatic setup.

For a deliberate key rotation, run the local dialog manually:

```bash
npm run configure:image-provider-interactive
```

Directly pasting a key into a local Codex conversation is a user-selected fallback. The task must never echo, commit, or write it into diagnostics, but a conversation transcript may retain pasted content, so the native dialog is preferred.

## Install in Codex

### Install from a Codex conversation

Ask Codex to install this repository as the root skill:

```text
Use skill-installer to install this Codex skill from:
https://github.com/ninemouth/sellerpilot-product-image-industrial

The main skill is at repository root. Install it as sellerpilot-product-image-industrial,
verify SKILL.md exists, and remove the legacy sellerpilot-product-image-industrial-thinkai
and sellerpilot-product-image-industrial-proxy migration installations. The independent
image-proxy skill can be installed alongside the main skill when explicitly needed.
```

Restart Codex after installation if the skill picker has not reloaded.

### Standalone third-party proxy skill

When you only need to call an explicitly configured OpenAI-compatible image endpoint, without the main skill's product understanding, platform planning, QA, delivery overview, or tldraw workspace, install the standalone proxy skill from this repository:

```text
Use skill-installer to install this Codex skill from GitHub:

https://github.com/ninemouth/sellerpilot-product-image-industrial

Use --path standalone/image-proxy and set the installed skill name to image-proxy.
```

Then invoke it explicitly:

```text
Use $image-proxy to generate one image through the configured third-party image provider; run a dry-run before the real request.
```

This independent skill is unrelated to the SellerPilot product-image skill. It defaults to ThinkAI `https://www.thinkai.tv/v1` + `gpt-image-2` and accepts an explicitly selected alternative OpenAI-compatible endpoint. It proves only that the provider returned decodable image bytes; it does not provide product identity, physical-truth, marketing, or platform QA, and it never silently falls back to native Codex image generation.

### Install or update from a development clone

```bash
git clone https://github.com/ninemouth/sellerpilot-product-image-industrial.git
cd sellerpilot-product-image-industrial
npm install
npm run verify
npm run sync:codex
```

`sync:codex` runs the release baseline (static contracts, Loop Engineering unit tests, and skill-package validation), backs up the previous installation, copies the single main skill, verifies source/destination parity, prepares the tldraw runtime with the lockfile-compatible package manager, and then performs the automatic provider configuration check. The expensive legacy verifier is not a default installation tax.

For headless release automation, defer only the local dialog:

```bash
npm run sync:codex -- --no-provider-config-prompt
```

This does not change the selected provider route and does not overwrite any existing key.

For an explicit release-audit run that also executes the full legacy verifier:

```bash
npm run sync:codex -- --full-verify
```

### Locate platform-aware Codex paths

```bash
npm run paths:codex
```

The command reports the current platform and its Codex skill/configuration locations. It supports macOS, Linux, Windows, and an overridden `CODEX_HOME`.

## Production workflow

For ordinary high-quality multi-image production, the skill uses a compact quality workflow:

```text
Update check
→ normalize request
→ select production mode
→ compile run contract and DAG
→ brief gate and direction handoff when needed
→ source preflight, product understanding, identity/physical/geometry locks
→ targeted platform and commerce context
→ compact set blueprint and prompt-layer plan
→ resolve generation specification and provider
→ anchor batch
→ identity/direction QA decision
→ only missing approved roles, at most two independent provider calls at once
→ focused QA, manifest, overview, tldraw workspace, final delivery gate
```

For open-ended commercial requests, the first handoff presents two or three visual directions plus the harness-selected default. If the user does not choose, the recorded default proceeds; the workflow does not stall on low-risk ambiguity.

For industrial audit, localization-sensitive, function-sensitive, or complex revision work, the skill expands only the required evidence and gates. See [SKILL.md](SKILL.md) and [the Chinese README](README.md) for the full contract.

## Production modes

| Mode | Use it for | Output scope |
|---|---|---|
| `fast_generation` | Explicit drafts, speed-first work, or a simple single image | Minimal valid evidence and focused QA |
| `quality_production` | Default for customer-facing multi-image sets and quality finals | Compact blueprint, anchor QA, overview, review workspace, final delivery gate |
| `revision_repair` | A focused correction to a prior run | Reuse approved assets and invalidate only affected downstream work |
| `industrial_audit` | Full auditability, migration, or complex evidence requirements | Full fact, strategy, prompt, QA, review, and revision package |
| `debug_development` | Script/runtime diagnosis | No false claim of a completed production delivery |

## Example request

```text
Use $sellerpilot-product-image-industrial to create an Ozon product-image set
for this shoulder bag. Target Russian buyers, preserve the supplied woven pattern,
use a 3:4 vertical ratio, include one clean main image, one material detail, one
realistic lifestyle image, and localized buyer-facing copy. Do not make unsupported
waterproof or capacity claims.
```

The skill will preserve the pattern as canonical product material, use Ozon's ordinary-category 3:4 baseline unless an exception is evidenced, verify Russian copy before and after export, and block delivery if the bag silhouette, pattern scale, material, hardware, or visible text drifts.

## Key safeguards

- **Product identity:** shape, color, material, structure, components, geometry, and source-supported micro-details stay locked. Unclear branding, labels, engraving, texture, or small print is not invented.
- **Surface materials:** printed nails, tattoo transfers, stickers, textiles, patterned bags, apparel, accessories, and home textiles preserve the supplied material as canonical rather than freely redrawn visual inspiration.
- **Text:** final visible text gets a layout proof before expensive final generation. Russian, German, Arabic, and other localization-sensitive output receives source traceability, translation review, script/RTL checks, and final raster text review.
- **Scenes:** a product cutout on a decorative layout is not passed off as a lifestyle scene. Use/context roles require a real generated or photographic scene asset and a realism review.
- **Lineage:** derived, repaired, local-text-overlay, and reused final assets record their source, transformation, and relevant gate evidence.
- **No watermark by default:** platform labels, system marks, `SellerPilot`, `Codex`, AI labels, and arbitrary marks are prohibited unless the user explicitly authorizes exact visible text, placement, purpose, and image scope.

## Verification and release checks

Run the fast release baseline:

```bash
npm run verify
npm run verify:skill-package
node scripts/verify-skill.mjs
git diff --check
```

`npm run verify` covers static contracts and Loop Engineering unit checks. The full skill verifier additionally exercises package metadata, provider routing, safe stdin configuration, automatic headless provider-setup detection, workflow invariants, and historical production gates.

Run integration suites only when their domain is affected:

```bash
npm run verify:integration -- --suite control-plane
npm run verify:integration -- --suite canvas-review
npm run verify:integration -- --suite delivery
```

## Repository map

```text
SKILL.md                         Core agent instructions and routing
contracts/                       Production-mode and platform contracts
schemas/                         Contract and run-state schemas
scripts/                         Deterministic compiler, QA, runtime, and release tools
references/                      On-demand operating guides
workflows/                       Master compatibility workflow and compact platform pointers
platform-profiles/               Platform/category constraints
assets/tldraw-review-workspace/  Review workspace template
docs/                            Architecture and Loop Engineering design
```

## Security and compliance

- Keep API keys in local configuration or secure local input only; never commit them.
- Do not expose provider endpoints, key values, request/response bodies, raw network errors, local paths, or sandbox diagnostics in user-facing production results.
- Do not auto-publish, make consequential marketplace changes, or bypass authentication/CAPTCHA/policy controls.
- Treat product URLs and competitor images as research evidence, not as authorization to copy brand assets, creative layouts, or product claims.

## Troubleshooting

| Situation | Safe next action |
|---|---|
| Third-party provider is selected but no key is configured | Complete the automatic masked dialog; if it was cancelled, run `npm run configure:image-provider-interactive` when ready. |
| Provider returns a non-retryable refusal | Correct account, key, billing, endpoint, or model entitlement. Do not repeat the same prompt; the circuit breaker preserves completed work. |
| A final image exists but delivery is not closed | Run the runtime watchdog and complete only missing overview, tldraw, manifest, or final-gate artifacts; do not regenerate approved images. |
| A card has a visible source-photo rectangle | Return only affected panels to source-asset normalization and layout composition. |
| Localized final text is uncertain | Return to localized-copy/text-layout proof and final visible-text review; do not rely on provider text rendering for exact personalized text. |

## License

MIT. See [LICENSE](LICENSE).
