# Workflow Routing

Installed capability root:

```text
${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial
```

Always read:

```text
${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/AGENTS.md
${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/agents/product-image-orchestrator.yaml
```

Do not infer that `AGENTS.md` should exist in the current project or chat working directory.

For complete product-image generation, always start with the platform-agnostic master workflow:

```text
workflows/ecommerce-product-image-generation.yaml
```

Then read one platform-specific workflow file only for additional platform constraints:

```text
workflows/amazon-image-set.yaml
workflows/pinduoduo-image-set.yaml
workflows/competitive-redesign.yaml
workflows/multi-platform-image-pack.yaml
workflows/tiktok-shop-image-set.yaml
workflows/xiaohongshu-image-pack.yaml
```

Platform-specific workflow selection:

- Amazon listing, Amazon US, 7 image set, main image plus A+ style support images -> `amazon-image-set.yaml`.
- 拼多多, Pinduoduo, Chinese conversion image set, 7-9 图套图, or user-specified image count -> `pinduoduo-image-set.yaml`.
- Competitor references, redesign based on competitor images, improve against competitors -> `competitive-redesign.yaml`.
- One product adapted to several marketplaces -> `multi-platform-image-pack.yaml`.
- TikTok Shop international marketplaces, mobile-first commerce imagery, short-video-shop visual style -> `tiktok-shop-image-set.yaml`.
- Douyin/抖音/抖店 requests use the platform-agnostic master workflow plus `platform-profiles/douyin.yaml`; do not route them to TikTok Shop by default.
- Xiaohongshu, cover image, seeding image pack, lifestyle/content-native direction -> `xiaohongshu-image-pack.yaml`.

Platform profiles:

```text
platform-profiles/amazon.yaml
platform-profiles/douyin.yaml
platform-profiles/etsy.yaml
platform-profiles/falabella.yaml
platform-profiles/jd.yaml
platform-profiles/mercado-libre.yaml
platform-profiles/ozon.yaml
platform-profiles/pinduoduo.yaml
platform-profiles/shein.yaml
platform-profiles/shopee-latam.yaml
platform-profiles/tiktok-shop.yaml
platform-profiles/temu.yaml
platform-profiles/wildberries.yaml
platform-profiles/xiaohongshu.yaml
platform-profiles/shopee-lazada.yaml
platform-profiles/taobao-tmall.yaml
```

Skill prompts live under:

```text
skills/infrastructure/*/prompt.md
skills/business-assets/*/prompt.md
skills/commerce-visual/*/prompt.md
```

Load individual skill prompts only when that step is active or when the user asks for that specific artifact. Avoid loading every prompt for a small partial task.

Load `references/visual-director.md` before image generation. This is required even when the platform workflow is Pinduoduo, Amazon, TikTok Shop, Xiaohongshu, or multi-platform.

Load `references/product-feature-and-audience-analysis.md` before visual direction. This is required for complete image-set generation because product features and audience positioning drive the shot matrix, scene choices, and buyer-facing copy.

Load `references/product-identity-preservation.md` before image generation whenever source images are used. This is required for all final product-bearing generated images, including scene, model, detail, and infographic assets.

Load `references/multi-source-image-fusion.md` when the user provides more than one source image.

Load `references/dynamic-platform-category-profile.md` whenever platform/category fit affects the output.

Load `references/bestseller-design-mining.md` when the user asks for marketing enhancement, 爆品 learning, competitive inspiration, or conversion-oriented differentiation.

Load `references/main-detail-production-structure.md` when producing Chinese ecommerce main images, posters, detail pages, or region-based review feedback.

Load `references/failed-output-regeneration.md` when the user rejects an output, says the result is unsatisfactory, or provides original-vs-generated comparison screenshots.
