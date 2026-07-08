# Data Contracts

## Product Fact Sheet

```yaml
product_name:
category:
source_images: []
confirmed_visual_traits: []
confirmed_features: []
confirmed_materials: []
confirmed_dimensions: []
package_contents: []
use_cases: []
target_users: []
certifications: []
uncertain_facts: []
prohibited_claims: []
evidence_refs: []
```

## Image Set Blueprint

```yaml
image_index:
image_role:
platform:
aspect_ratio:
main_message:
secondary_message:
visual_composition:
product_view:
required_copy:
forbidden_elements: []
identity_constraints: []
localization_notes: []
```

## Platform Preference Overlay

```yaml
schema_version: sellerpilot.platform_preference_overlay.v1
status: applied|no_memory|not_run
platform:
category:
locale:
memory_path:
matches: []
merged_preferences:
  visual_traits: []
  style_direction: []
  avoid: []
  copy_tone: []
  merchandising_notes: []
use_policy: >
  Use as platform/category style memory only. Do not override current user
  instructions, product identity, official platform constraints, or fresh research.
```

## Commerce Design Research Plan

```yaml
schema_version: sellerpilot.commerce_design_research_plan.v1
status: ready
platform:
category:
locale:
goal: conversion|dwell|both
research_depth: compact|standard|deep
research_budget:
  required_reference_count:
  minimum_distinct_patterns:
  max_live_queries:
query_plan: []
extraction_framework:
  first_second_click_hook: []
  dwell_time_mechanisms: []
  trust_and_objection_handlers: []
  conversion_copy: []
output_contract:
  research_file: research/commerce-design-research.md
  patterns_file: research/bestseller-patterns.yaml
  blueprint_fields_to_update: []
pass_criteria: []
```

## Revision Brief

```yaml
target_image_index:
target_region:
issue_type:
current_problem:
requested_change:
keep_unchanged:
priority:
```
