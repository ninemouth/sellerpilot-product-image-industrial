# Contextual Platform Research

Use this reference when platform fit, category trend, season, climate, holiday, region, or marketing language can affect image strategy or copy.

## Rule

Treat `platform-profiles/*.yaml` as stable platform memory, not complete live truth. It is enough for durable constraints and baseline style, but not enough for current category language, seasonal demand, holiday scenes, regional preferences, or hot words.

Run:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-context-planner.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣" \
  --season "summer" \
  --region "华南"
```

When user-confirmed platform/category style memory may exist, apply it before final platform context decisions:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-preference-memory.mjs \
  --mode apply \
  --platform "Ozon" \
  --category "women bag" \
  --run-dir /abs/run
```

The memory overlay is a preference layer, not a fact source. Use it for recurring visual traits, copy tone, merchandising rhythm, and avoid notes only when it does not conflict with the current user request, product identity, official platform rules, or fresh research.

## Research Cadence

- Official platform rules: refresh every 30-90 days, and before compliance-sensitive work.
- Category visual norms: refresh every production run when conversion quality matters.
- Season, climate, holiday, and region: refresh every production run when any of these signals exist.
- Marketing hot words and search language: refresh every production run before final copy strategy.
- User-confirmed platform/category style memory: apply at the start of every same-platform/same-category production run; update only when the user explicitly confirms a durable platform preference.

## Required Context Dimensions

For each run, decide whether the product needs:

- platform constraints and listing image count
- category visual norms
- regional buyer preferences
- local climate and season
- holidays, gifting occasions, school/work/sports calendars
- current platform/category hot words
- competitor or bestseller visual pattern mining
- risk boundaries and prohibited claims
- remembered platform/category preferences that should remain consistent across similar products

## Conversion And Dwell-Time Trigger

When the goal is sales impact, click appeal, user dwell time, category differentiation, or bestseller learning, create a commerce design research plan:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/commerce-design-research-planner.mjs \
  --run-dir /abs/run \
  --platform "Ozon" \
  --category "women bag" \
  --goal both \
  --research-depth compact
```

Use the plan to extract:

- first-second click hook
- dwell-time mechanism across the gallery sequence
- trust cues and buyer objection handlers
- platform-native copy rhythm
- product truth boundaries
- patterns to borrow as principles and patterns not to copy

## Output

Write:

```text
research/platform-context-plan.json
research/platform-context-plan.md
research/platform-category-profile-overlay.yaml
memory/platform-preference-overlay.json
research/commerce-design-research-plan.json
```

When `web_research_required: true`, perform current web/search research before final copy and image-set blueprint. If browsing is unavailable, mark the run as research-limited and avoid hotword/search-volume claims.
