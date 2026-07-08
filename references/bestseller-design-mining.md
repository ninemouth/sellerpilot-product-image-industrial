# Bestseller Design Mining

Use this reference during market research and marketing enhancement. The goal is to learn what high-performing category images do well without copying competitor creative.

Before live mining, create a bounded commerce design research plan when conversion, click appeal, dwell time, or bestseller learning is the goal:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/commerce-design-research-planner.mjs \
  --run-dir /abs/run \
  --platform "Ozon" \
  --category "women bag" \
  --goal both \
  --research-depth compact
```

## Core Rule

Borrow patterns, not assets. Do not copy competitor layout, exact copy, brand style, model pose, background, image composition, or claims. Extract reusable design principles and adapt them to the user's product identity and facts.

## Research Sources

Use the best available sources for the target platform/category:

- platform search results and category pages
- bestseller/ranking pages if visible
- seller ads and sponsored listings
- user review images when appropriate for pain points
- official platform guidance
- reputable operator guides
- user-provided competitor references

If current web/image search is available and the category/platform is conversion-critical, search live. Otherwise, state the limitation and create a research plan.

## What To Extract

For each reference, record:

```yaml
bestseller_reference:
  source_url_or_note:
  platform:
  category:
  product_type:
  visible_design_pattern:
  hook_or_first_screen:
  product_scale_strategy:
  scene_or_context:
  detail_or_trust_builder:
  copy_style:
  color_and_layout:
  buyer_question_answered:
  what_to_borrow_as_principle:
  what_not_to_copy:
  risk_or_uncertainty:
```

## Pattern Library

Convert examples into reusable patterns:

- click hook: what makes the first image readable in one second
- dwell-time mechanism: what makes the shopper keep swiping, zooming, or reading the gallery
- proof pattern: detail, comparison, scale, before/after, use-case, trust cue
- scene pattern: where the product lives and why the buyer believes it
- copy pattern: short phrase rhythm, benefit framing, objection handling
- layout pattern: product scale, whitespace, typography density, label count
- gallery sequence: how hero, proof, detail, scale, scene, comparison, and summary build a confidence path

## Sufficient Borrowing Criteria

A design direction can use market learning when:

- at least 3 references support the pattern, or there is an official source
- the pattern is expressed in new composition and copy
- the user's product facts support the benefit
- no competitor-owned brand, model, layout, text, or distinctive styling is copied
- the final image still passes Product Identity Lock

## Output

Write:

```text
research/bestseller-design-mining.md
research/bestseller-patterns.yaml
```

Include:

- references reviewed
- extracted patterns
- platform/category implications
- which patterns are used in the image blueprint, with updated `buyer_question`, `conversion_task`, `shot_direction`, `copy_intent`, `prompt_layer_needs`, and `qa_acceptance_criteria`
- rejected patterns and why

## Hard Boundaries

- Do not copy competitor assets, exact layout, exact copy, model pose, brand style, background, image composition, or claims.
- Do not use a "bestseller" claim in buyer-facing copy unless the user provides evidence that the user's product is a bestseller.
- Do not add unsupported superiority language such as "top seller", "best", "No.1", or guaranteed conversion language.
