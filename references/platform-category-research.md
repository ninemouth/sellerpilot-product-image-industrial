# Platform And Category Research

Use web research when platform tone, category norms, ad placement behavior, or current image constraints matter. This is required for new platforms, unclear categories, or conversion-oriented image sets.

## Research Order

1. Official platform or merchant documentation when available.
2. Marketplace help center, seller center, or policy pages.
3. Recent reputable operating guides and industry examples.
4. Competitor/category visual scan, if the user provides competitors or authorizes web/image search.

## Required Research Questions

- What image dimensions, file size, count, and white-background constraints apply?
- Which images should be clean product identity vs selling-point/scene/detail?
- What shopper context matters for this platform and category?
- What camera angles, lighting, scene tropes, and product-view conventions are common for this category on the target platform?
- What buyer-facing language patterns are natural for the platform/category, and which internal or over-technical phrases should be avoided?
- What claims or visual elements are risky?
- What common category tropes should be followed or differentiated from?

## Output

Write a compact research brief into the run directory:

```text
platform-category-research.md
platform-category-profile-overlay.yaml
```

Include:

- search date
- sources and URLs
- stable findings
- uncertain or non-official findings
- implications for the image-set blueprint
- run-level overlay fields that supplement the fixed platform YAML

## Baseline Vs Overlay

Platform YAML files are fixed baselines. They should not be treated as complete live category truth. For each production run, supplement them with `platform-category-profile-overlay.yaml`.

Only promote a finding into the global platform YAML when it is official, stable, or repeatedly observed across runs.

## Pinduoduo Notes

For 拼多多/Pinduoduo, treat "simple, direct, value-forward selling points" as a platform tone hypothesis unless confirmed by official docs or current research.

Do not claim guaranteed CTR or conversion lift. State that the work is optimized for click and conversion intent.

## Query Templates

Use platform, category, and locale-specific queries. Examples:

```text
{platform} 商品主图 规范 {category}
{platform} 商家 图片 尺寸 要求 {category}
{platform} {category} 爆款 商品图 场景图
{platform} {category} 商品图 文案 风格
{category} 电商 主图 详情图 场景图 拍摄 角度
```
