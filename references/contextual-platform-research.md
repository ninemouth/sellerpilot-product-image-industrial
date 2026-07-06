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

## Research Cadence

- Official platform rules: refresh every 30-90 days, and before compliance-sensitive work.
- Category visual norms: refresh every production run when conversion quality matters.
- Season, climate, holiday, and region: refresh every production run when any of these signals exist.
- Marketing hot words and search language: refresh every production run before final copy strategy.

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

## Output

Write:

```text
research/platform-context-plan.json
research/platform-context-plan.md
research/platform-category-profile-overlay.yaml
```

When `web_research_required: true`, perform current web/search research before final copy and image-set blueprint. If browsing is unavailable, mark the run as research-limited and avoid hotword/search-volume claims.
