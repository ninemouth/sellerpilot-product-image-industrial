# Product Physical Truth

Use this reference before visual direction, prompt layers, installation/detail images, physical demonstration images, or final QA for tools, clips, fixtures, lights, cables, apparel, bags, furniture, pet/child products, and any product where real-world function or scale matters.

## Core Rule

Do not let the image model invent how the product works. A generated image may make a product look plausible while adding impossible or unsupported functions. Treat physical function as product truth, not creative freedom.

Create:

```text
blueprint/02b-product-physical-truth.json
```

Run:

```bash
node /Users/yang/.codex/skills/sellerpilot-product-image-industrial/scripts/product-physics-fact-gate.mjs \
  --fact-lock /abs/run/blueprint/02b-product-physical-truth.json \
  --panels /abs/run/blueprint/panels.json \
  --out-dir /abs/run/qa
```

## Required Lock

```json
{
  "product_physical_truth": {
    "status": "locked",
    "product_type": "string light cable clip",
    "evidence_sources": [],
    "confirmed_functions": ["holds a string light cable against a surface"],
    "confirmed_user_actions": ["screw mount to wood", "place cable under clip"],
    "allowed_use_contexts": ["outdoor patio string light routing"],
    "required_installation_or_use_sequence": [],
    "scale_reference": {
      "source_image_id": "source-01",
      "product_visual_scale_ratio": 0.42,
      "product_bbox_height_pct": 0.34,
      "product_area_pct": 0.18,
      "notes": "Use one source-backed reference scale for all generated panels unless composition explicitly changes."
    },
    "physical_constraints": [],
    "forbidden_generated_functions": [
      "press to hold",
      "snap lock",
      "magnetic hold",
      "adhesive mount",
      "waterproof electrical connector",
      "load-bearing hook"
    ],
    "unsupported_claims": []
  }
}
```

## What Must Be Locked

- Product structure: base, holes, hooks, clips, moving parts, fasteners, openings, cable path.
- Confirmed functions: what the product actually does, stated from evidence.
- Confirmed user actions: screw, slide, clip, route, tighten, press, open, close, etc. Only include actions supported by source image, URL, specs, or user facts.
- Forbidden generated functions: anything plausible but unproven, such as magnets, adhesive pads, locking tabs, waterproof electrical behavior, load-bearing capability, extra clamps, hidden hinges, or invented press mechanisms.
- Scale reference: consistent product size across the set, unless a panel intentionally changes zoom and records why.
- Unknowns: uncertain material, load rating, dimensions, included screws, waterproof rating, compatibility, and installation method.

## Image Planning Rules

- An installation image may only show confirmed installation steps. If only one screw hole is visible, do not create a multi-step mechanism that implies extra locks or pressure clamps.
- A cable/strap/handle routing image must preserve the actual path the product structure supports.
- A dimensions image and a lifestyle/detail image must not show materially different product sizes unless their role explicitly changes zoom/crop and records it.
- When exact dimensions are unknown, do not invent measurements. Use relative scale only if visually supported, or ask the user for specs when dimensions are central to conversion.
- If a source photo shows a product mounted in the real world, use that as the scale and function anchor before generating studio installation graphics.

## Prompt Layer Rule

When the shot matrix or prompt mentions installation, routing, holding, locking, clipping, screw mounting, adhesive, magnet, waterproofing, load, cable, wire, or other physical function, add `physical_function_layer` to the prompt layer stack. This layer must include:

- confirmed functions
- confirmed user actions
- forbidden generated functions
- scale reference
- negative QA instructions for unsupported mechanisms

## Failure Routing

- invented function or unsupported action -> return to `product-physical-truth-lock`
- inconsistent product scale -> return to `visual-director` and rerender layout/generation for affected images only
- unknown dimensions used as exact numbers -> return to `product-fact-sheet`
- installation sequence not evidenced -> remove the step or ask the user for evidence
