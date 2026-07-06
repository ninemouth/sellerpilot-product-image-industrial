# Strategy Direction Routing

Use this reference after Brief Intake Gate and before formal production whenever the user request is rough, ambiguous, or commercially open-ended.

## Rule

Generate 2-3 production directions before final prompt/image production. For rough, ambiguous, or commercially open-ended requests, the first visible response must present these directions briefly to the user plus the harness-selected fallback route. If the user has no clear preference or does not answer, let the harness select the best route and record the decision.

Use:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-gate.mjs \
  --run-dir /abs/run \
  --platform "拼多多" \
  --category "球衣"
```

Then create the user-visible handoff:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/strategy-direction-handoff-gate.mjs \
  --run-dir /abs/run
```

## Direction Types

- `conversion_direct`: best for rough requests, value-forward platforms, fast decision images, and short benefit copy.
- `seasonal_lifestyle`: best when season, climate, holiday, region, or lifestyle context matters.
- `premium_identity`: best when product structure, material, apparel fit, brand feel, or source-image identity risk matters.

## User Interaction

Show directions as buyer-facing choices, not workflow jargon. Keep options short and send them before formal production:

1. What each direction tries to sell.
2. What the image set will feel like.
3. What risk or tradeoff it has.

If the user does not choose, continue with `selected_option_id` from `strategy/direction-selection.yaml`.

## Gate Output

Write:

```text
strategy/direction-options.json
strategy/direction-options.md
strategy/direction-selection.yaml
strategy/direction-user-handoff.json
strategy/direction-user-handoff.md
```

Downstream commerce strategy, visual direction, copy strategy, prompt layers, and QA should reference the selected direction.
