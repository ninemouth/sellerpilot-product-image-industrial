# Dynamic Platform Category Profile

Use this reference whenever platform fit matters. Platform YAML files are stable baselines, not complete live truth. For current category, season, climate, holiday, region, or marketing-language decisions, also load `references/contextual-platform-research.md`.

## Rule

Treat `platform-profiles/*.yaml` as the fixed baseline for durable platform norms. For each real production run, create a run-level overlay from current platform/category research:

```text
research/platform-category-profile-overlay.yaml
```

Do not mutate the global platform profile during a run unless the new finding is stable, sourced, and useful across future categories.

## Baseline Plus Overlay

Use three layers:

1. **Baseline platform profile**: stable constraints, tone, image roles, known risks.
2. **User-confirmed platform/category preference memory**: durable visual traits, style direction, copy tone, merchandising rhythm, and avoid notes that the user explicitly confirmed for this platform/category.
3. **Dynamic run context**: current category norms, visual tropes, buyer language, season, climate, holiday, region, common scenes, detail conventions, and trend hypotheses.
4. **Run decision**: what this product should follow, differentiate from, or avoid.

Apply platform/category preference memory with:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-preference-memory.mjs \
  --mode apply \
  --platform "Ozon" \
  --category "women bag" \
  --run-dir /abs/run
```

Remember new preferences only when the user explicitly gives or confirms a platform/category style trait:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/platform-preference-memory.mjs \
  --mode remember \
  --platform "Ozon" \
  --category "women bag" \
  --trait "3:4 portrait first image with clean marketplace readability"
```

Do not store product identity facts, private business data, supplier/customer data, unsupported claims, or one-off generation failures.

## Overlay Schema

```yaml
platform_category_profile_overlay:
  platform:
  category:
  locale:
  region:
  research_date:
  baseline_profile:
  baseline_yaml_interpretability:
    status:
    readable_as_baseline:
    missing_recommended_sections: []
  dynamic_context:
    season:
    climate:
    holiday:
    regional_trend_scope:
    marketing_trend_intent:
  research_cadence: []
  platform_preference_memory:
    overlay_file: memory/platform-preference-overlay.json
    status:
    applied_traits: []
    applied_style_direction: []
    applied_copy_tone: []
    applied_avoid: []
  web_research_required:
  query_plan: []
  official_constraints:
    dimensions:
    image_count:
    file_rules:
    prohibited_content:
  category_visual_norms:
    common_main_image_patterns: []
    common_detail_patterns: []
    common_scene_patterns: []
    common_copy_patterns: []
    common_trust_patterns: []
  category_buyer_expectations:
    buyer_questions: []
    objections: []
    price_or_value_signals: []
  trend_hypotheses:
    - finding:
      source:
      confidence: high|medium|low
      use_in_this_run: true|false
  production_implications:
    image_roles: []
    camera_angles: []
    scenes: []
    copy_voice:
    avoid:
```

## Update Policy

- Use the overlay for the current run.
- Promote a finding into `platform-profiles/*.yaml` only after it appears repeatedly across runs or comes from official platform documentation.
- Store user-confirmed recurring style preferences in platform preference memory, not in `platform-profiles/*.yaml`.
- Keep trend and category findings in the run directory so the same skill can adapt by platform, category, and date without hardcoding stale assumptions.
