# Brief Intake

Use this reference immediately after receiving the user's text and image(s), before full planning or generation.

## Goal

Decide whether the current input is sufficient to start production, or whether asking 1-3 concise questions would materially improve quality or prevent false claims. This gate is a professional judgment step, not a user-facing form.

## Continue Without Asking

Continue when these are sufficiently known or safely inferable:

- product category
- source image or a clear non-identity-preserving request
- target platform or platform default
- image count or platform default
- scene intent or a safe platform/category default
- no unsupported claims are required

Record assumptions in task analysis and make them visible in the concise summary.

## Ask Only High-Value Questions

Ask at most three questions when the answer affects commercial direction, legal/factual risk, or product identity:

- platform, country, language, or channel is missing and cannot be inferred.
- source image is too weak, too small, or missing important sides/details; ask for extra angles only if identity/detail preservation is important.
- logo, trademark, product name, tag, charm face, hardware engraving, or tiny product text is visible but too blurry to preserve as exact readable detail.
- multiple product images conflict on color, shape, hardware, logo, or accessories.
- user requests claims not visible/provided: material, genuine leather, waterproof, dimensions, capacity, certification, brand authorization, price/promotion, ranking, or sales claims.
- scene/model style is ambiguous and commercially important: commuter, cafe, office, campus, date, gift, luxury, budget, seasonal, festival, UGC, studio, or lifestyle.
- target audience/price band changes the visual strategy materially.

## Question Style

Keep questions short and production-oriented:

```text
我可以先按这些假设继续：平台=拼多多，风格=通勤/咖啡/周末，卖点=棕色软皮感+小熊挂件。为了减少返工，只想确认 2 点：
1. 是否有更多角度/细节图，尤其背面、底部、内里？
2. 场景更偏通勤咖啡，还是约会逛街？
如果不补充，我会按默认假设继续。
```

Do not ask about model names, tool names, runtime boundaries, prompt layers, QA gate names, or internal workflow.

## Merge User Replies

Treat replies as structured production inputs:

- product facts -> Product Fact Sheet and claim boundaries
- extra images -> Source Image Set Manifest and Product Identity Lock
- scene preference -> Visual Direction Brief and Prompt Layer Stack
- audience/price band -> Audience Positioning and copy voice
- platform/locale -> platform profile and localized copy
- negative preferences -> forbidden scene/style/copy constraints
- unclear micro-details -> Product Identity Lock `micro_detail_lock` and either a closeup request or an explicit `preserve_as: unreadable_mark|shape_only` constraint

## Blocking vs Non-Blocking

Blocking:

- no usable source image for identity-preserving generation
- conflicting product sources
- requested factual claim cannot be supported and user insists on it
- required platform/legal constraints are unknown for a high-risk category

Non-blocking:

- missing brand name
- missing exact dimensions when dimensions are not used in copy
- missing audience when platform/category default is adequate
- missing scene preference when a safe default exists
- missing copy slogans when buyer-facing default copy can be generated
