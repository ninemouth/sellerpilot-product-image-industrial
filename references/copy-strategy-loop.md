# Copy Strategy Loop

Use this reference before final image text, prompt delivery, and marketing QA.

## Rule

Final ecommerce image copy is a sales mechanism, not decoration. It must come from product truth plus platform/category/season/region context. Do not use hot words, ranking claims, price claims, material claims, certification claims, or performance claims without evidence.

Run:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/copy-strategy-gate.mjs \
  --copy-json /abs/run/blueprint/panels.json \
  --platform-context /abs/run/research/platform-context-plan.json \
  --out-dir /abs/run/qa
```

## Copy Planning Inputs

Each panel should record:

- `buyer_question`
- `conversion_intent`
- `purchase_objection`
- `buyer_facing_message`
- `copy_strategy`
- `research_basis` or `platform_context_ref`
- `source_evidence` or `fact_sheet_ref` for factual claims
- `seasonal_relevance` or `regional_relevance` when dynamic context matters

## Loop

1. Draft copy from Product Fact Sheet and selected strategy direction.
2. Pull platform/category/season/region language from current research when required.
3. Run `copy-strategy-gate`.
4. Revise only failed copy fields.
5. Run `marketing-gate-check`.
6. Continue to final prompt/layout only after copy and marketing gates are clean or explicitly accepted with documented warnings.

## Failures

Fail or route back when:

- copy has no buyer benefit or decision reason
- hot words are used without research basis
- risky claims lack evidence
- seasonal/holiday/region context exists but copy ignores it without a reason
- copy sounds like QA notes, internal policy, or workflow text
