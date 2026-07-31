# Architecture

## Layering

L0 Harness Foundation:
- image read / parse
- URL read
- canvas preview
- evidence capture
- version history
- export packaging

L1 Infrastructure Skills:
- input-normalizer
- product-url-reader
- product-image-parser
- infinite-canvas-interaction

L1.5 Business Asset Skills:
- product-fact-sheet
- platform-spec-profile
- audience-persona
- visual-template-library

L2 Commerce Visual Skills:
- market-research
- product-positioning
- visual-strategy
- copy-localization
- localized-copy-qa
- gpt-built-in-image-generation-execution
- generation-runtime-execution-boundary
- qa-compliance
- revision
- export-packaging

L2.5 Generation Control:
- provider-compatible platform ratio resolution before each request
- run-scoped execution state and heartbeat progress
- anchor-first quality checkpoint
- bounded concurrency only for independent remaining roles after anchor approval
- provider diagnostic isolation from user-facing messages

## Loop Engineering Control Plane

The package is migrating from documentation-led orchestration to a bounded Loop Engineering control plane. The canonical policy is `contracts/production-contract.json`; each run receives a generated `run-state.json`, compiled production plan, and run-local DAG.

```text
User Request + Evidence
  -> Contract-driven Plan Compiler
  -> Deterministic Pre-gates
  -> Bounded Anchor / Role Repair Loops
  -> Delivery Closure (no generation)
  -> Optional Human Review / Revision
```

Provider generation is never an open retry loop. A retry must have a role-specific evidence delta and remain within the run and role budget. Provider circuit failures, retry exhaustion, missing product facts, and consequential user decisions are terminal/pause states. The final delivery gate aggregates evidence; it cannot be used as a root-cause retry target.

See `docs/loop-engineering-reconstruction.md` for the migration plan, canonical artifacts, loop definitions, and acceptance criteria.
