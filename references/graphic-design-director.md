# Graphic Design Director

Use this reference before final image prompts, layout composition, or image-set export. The goal is to make the final flat design look intentional, commercial, and mobile-readable instead of a repeated template with new headings.

## Core Rule

The target platform is a design constraint, not a watermark. The default decision is absolute prohibition: do not place watermarks, platform-pack labels, internal labels, system marks, pseudo-brand marks, or arbitrary corner marks on final images.

Only allow a visible watermark/mark when the user explicitly asks for that exact visible mark. Treat this as a pre-design authorization decision, not a QA afterthought. If there is no explicit user request, the graphic design brief, visual director brief, prompt, renderer, and final image must all keep visible watermark/mark fields empty.

Forbidden final-image marks include:

- `拼多多女包套图`
- `拼多多套图`
- `女包套图`
- `PDD`
- `SellerPilot`
- `Codex`
- `AI生成`
- `样图`
- `示例图`
- `仅供参考`

## Required Brief

Create a compact `graphic-design-direction.yaml` before final generation or layout composition:

```yaml
graphic_design_direction:
  platform:
  category:
  audience:
  design_goal:
  design_quality_bar:
    concept_before_layout:
    product_first_rule:
    hierarchy_grade_target:
    layout_rhythm:
    set_variation_rule:
    mobile_feed_readability:
    premium_finish_notes:
  set_layout_system:
    typography_hierarchy:
    safe_zones:
    overlay_style:
    text_density:
    color_and_contrast:
    mobile_thumbnail_rule:
  per_image_design:
    - image_index:
      role:
      layout_intent:
      text_hierarchy:
      safe_zone_notes:
      allowed_badges: []
      forbidden_marks: []
      visual_difference_from_previous:
  no_watermark_policy:
    default_visible_mark_decision: prohibited_unless_user_explicitly_requests_exact_mark
    visible_platform_pack_label_allowed: false
    internal_system_mark_allowed: false
    corner_label_allowed: false
    watermark_authorization:
      status: none|user_explicitly_requested
      source_user_request:
      exact_visible_text:
      placement:
      purpose:
      allowed_images: []
    allowed_visible_marks: []
    forbidden_visible_marks: []
  rejection_triggers: []
```

## Visible Mark Authorization

Before writing prompts or layouts, decide whether a visible watermark/mark is authorized:

- Default: `watermark_authorization.status: none`.
- Authorized only when the user explicitly requests a visible mark or watermark, with exact text or logo source.
- Platform names such as Pinduoduo, Amazon, TikTok Shop, or internal workflow labels are never added just because they are the target channel.
- Product brand/trademark marks may be preserved only when they are already part of the source product identity or the user supplies authorized brand assets.
- Buyer-facing copy, benefit badges, and detail labels are allowed only when they communicate product value; they must not behave like platform watermarks, system marks, or pack labels.
- If authorization exists, record exact text, placement, purpose, and image scope. Do not generalize the authorization to other marks or images.

## Design Standards

- Start with the commercial design concept, not the text box. Decide what the buyer should feel or understand in the first second, then choose crop, typography, overlays, and labels.
- Each image needs a clear visual hierarchy: one dominant subject, one main message, optional support copy, and restrained detail labels.
- Use overlays only when they protect readability without hiding the product. Avoid repeating the same translucent rounded card across most images.
- Keep enough negative space around product edges, straps, handles, charms, and model-body contact points.
- Text must be legible in a mobile feed thumbnail. If it needs too many words, rewrite it or move the information to another image.
- Detail grids need distinct crops and a purposeful rhythm. Do not create four similar tiles with different captions.
- Conversion-heavy platforms can use bolder copy and tighter selling points, but should still feel like buyer-facing commerce design, not an internal QA board.
- Do not add decorative stickers, platform labels, or pseudo-brand marks to fill empty corners.

## Design Quality Bar

A final ecommerce image set should pass all of these before prompt delivery or layout rendering:

- Concept: each image has a role-specific visual idea, not just a new headline over the same photo.
- Hierarchy: product remains the dominant subject; copy and labels support the product instead of competing with it.
- Craft: typography, spacing, alignment, color contrast, and crop feel deliberately designed at 1200x1200 and in mobile thumbnail.
- Rhythm: the set alternates clean hero, detail proof, scale/use, and real lifestyle context instead of repeating one card template.
- Restraint: no watermark-like marks, no platform-pack corner labels, no internal production tags, no arbitrary badges unless `watermark_authorization.status` is `user_explicitly_requested` for that exact mark.
- Evidence: detail labels and close crops map to visible source evidence or to confirmed facts.
- Consistency: color system, typography, and spacing feel like one listing while each image still has a distinct job.

## Gate Conditions

Fail before final delivery when:

- a final image contains a watermark, platform-pack label, AI/system mark, internal production mark, or arbitrary visible mark without explicit recorded user authorization.
- `design_quality_bar` is missing, vague, or not reflected in per-image design.
- most images use the same heading-card layout without role-specific composition.
- text hierarchy competes with the product subject or covers important identity details.
- mobile readability depends on tiny text, low contrast, or crowded labels.
- design elements imply unsupported claims, prices, ranking, platform affiliation, or brand authorization.
- layout decoration hides or changes locked product details.
