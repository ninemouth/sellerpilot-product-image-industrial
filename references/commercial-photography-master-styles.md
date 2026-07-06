# Commercial Photography Master Styles

Use this reference when selecting photography treatment for ecommerce product images, especially scene images, model/wearing shots, detail macros, and premium-looking product assets.

## Core Rule

Choose master-level style archetypes, not named living-photographer imitation. The photography direction must define usable production choices: lens feel, camera height, crop, lighting direction, color temperature, product placement, scene logic, audience fit, and identity risks.

Do not write prompts such as "in the style of [living photographer]". Translate the desired quality into production language: editorial street, catalog clarity, leather macro, soft natural window light, fashion ecommerce crop discipline, realistic buyer-body relationship, and source-backed product detail preservation.

## Archetype Menu

- **Warm Editorial Street**: soft side daylight, shallow background separation, natural walking or storefront posture, suitable for commuter bags, apparel, accessories, and lifestyle conversion.
- **Clean Marketplace Studio**: crisp product outline, gentle shadow, controlled reflection, high product inspectability, suitable for main product and size images.
- **Premium Leather Goods Macro**: close lens, grazing light, tactile surface, stitching/hardware emphasis, suitable for zipper, hardware, texture, charm, and edge details.
- **Korean/Japanese Minimal Fashion Ecommerce**: restrained palette, calm body crop, clean outfit styling, lots of breathing room, suitable for women bags, apparel, beauty, and everyday lifestyle.
- **Cafe/Commute Natural Moment**: warm window light, table or shoulder interaction, controlled props, realistic buyer scenario, suitable for daily-use and giftable products.
- **Mobile Commerce Detail Clarity**: simplified background, high contrast detail focus, clear scale cue, suitable for platforms where buyers decide quickly in-feed.
- **Soft Luxury Leather Still Life**: controlled warm key light, elegant shadow falloff, low-clutter prop styling, premium material tactility, suitable for leather-like bags, wallets, jewelry, and gift positioning.
- **Contemporary Asian Street Fashion**: natural outdoor daylight, cropped face or body anonymity, clean city storefronts, outfit-first styling, suitable for commuter bags and younger mobile shoppers.
- **Quiet Office Commute Editorial**: practical workday scene, laptop/notebook/coffee scale cues, neutral clothing, moderate depth of field, suitable for office, campus, and daily carry use cases.
- **Boutique Window Natural Light**: soft reflected light, glass/storefront cues, warm street background, product visible on shoulder or hand, suitable for affordable fashion that needs an upgraded feel.
- **High-Inspectability Macro Grid**: multiple controlled close crops with consistent light, each crop focused on a different evidence-backed detail, suitable for material, stitching, zipper, handle, and charm proof images.
- **Truthful Capacity Tabletop**: overhead or three-quarter tabletop view, everyday objects placed beside or partially near the bag only when source facts support the claim, suitable for capacity/use-case images without inventing interior structure.
- **Soft Social Commerce Lifestyle**: content-native but polished, gentle color contrast, human moment without heavy posing, suitable for Xiaohongshu, Douyin, TikTok Shop, and Pinduoduo scene images.

## Required Treatment Fields

Each image role should carry:

```yaml
photography_style:
  archetype:
  why_it_fits_product_and_audience:
  camera_angle:
  lens_feel:
  crop:
  camera_height:
  lighting_direction:
  color_temperature:
  background_or_scene:
  product_placement:
  model_or_hand_context:
  props_and_scale_cues:
  identity_risks:
  audience_fit:
  product_truth_constraints:
  must_preserve_micro_details:
  forbidden_changes:
```

## Women Bag Defaults

For a Pinduoduo women-bag set, prefer a balanced mix:

- Main identity: Clean Marketplace Studio or Korean/Japanese Minimal Fashion Ecommerce.
- Detail/hardware: Premium Leather Goods Macro.
- Wearing scale: Warm Editorial Street or Korean/Japanese Minimal Fashion Ecommerce.
- Cafe/weekend scene: Cafe/Commute Natural Moment.
- Capacity/use case: Mobile Commerce Detail Clarity with truthful daily objects beside or near the bag, not invented interior structure.
- Premium material/value lift: Soft Luxury Leather Still Life or Boutique Window Natural Light.
- Younger commuter/street use: Contemporary Asian Street Fashion or Quiet Office Commute Editorial.
- Detail proof: Premium Leather Goods Macro or High-Inspectability Macro Grid.
- Capacity/use case: Truthful Capacity Tabletop or Mobile Commerce Detail Clarity, with no unsupported interior/capacity claim.

## Gate Conditions

Fail photography treatment when:

- most images use the same front angle, same crop, or same product orientation.
- scene roles do not specify light, camera/body relationship, background, and product placement.
- detail roles do not identify different focal subjects.
- style language is generic, such as only saying `高级商拍` or `电商风`.
- style language imitates a named living photographer instead of translating the look into production choices.
- props or scenes add unsupported capacity, brand, material, or bundle claims.
- micro-details are shown close without source-backed preservation instructions.
