# Source Product Understanding

Use this after source image quality/enhancement and before Product Identity Lock, Product Physical Truth Lock, geometry lock, shot matrix, copy, or prompt layers.

The source image is not only a photo to clean up. It is product evidence. Codex must understand what the product is, how it is built, what visible text says, and which facts must remain consistent in later generation.

## Required Read

Create a source understanding artifact:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/create-source-product-understanding.mjs \
  --image /abs/source-or-enhanced.png \
  --out-dir /abs/run/source-understanding \
  --category "商品类目"
```

The script records image metadata, runs local OCR through `tesseract` when available, extracts candidate dimensions/spec/function facts from text, and creates fields for Codex visual review. OCR is a starter, not final truth.

Codex must then visually inspect the original/enhanced image and complete:

- product identity summary
- observed product type
- observed components and structure
- material/finish/color family
- visible function/use mechanism
- physical size cues and scale references
- visible text items, including labels, packaging, tags, warnings, model names, dimensions, count, material, compatibility, installation, weight, certification, or other specs
- uncertain text or micro-detail that needs a closeup

If text is visible but unclear, preserve its placement/shape as unreadable unless a closeup or user facts make it reliable. Do not turn unclear marks into readable brands, model names, certifications, or decorative patterns.

## Text-Derived Facts

Visible source-image text can change the whole image plan. Treat these as product facts when verified:

- dimensions: length, width, height, diameter, inner height/width, closed height
- weight: grams, kg, ounces, pounds
- installation or actions: screw, clip, route, press, slide, mount, drill, adhesive, magnet
- compatibility: cable diameter, device model, fixture type, surface type, package contents
- material: metal, plastic, silicone, leather, cotton, polyester, nylon, ABS, PVC
- safety/compliance claims: waterproof, fireproof, UL, CE, FCC, RoHS, child/pet safety
- warnings and limits: load, voltage, use environment, age restriction
- product identity text: logo, model, size tag, flavor/color name, SKU

Do not use unsupported text claims in buyer-facing copy. Certification, waterproof, safety, medical, fire, child/pet, and load-bearing claims require clear evidence; otherwise mark them as risk or omit.

## Propagation

After completing `source-product-understanding.json`, propagate facts into downstream locks:

- Product Identity Lock: product type, components, material/color, visible text/logo policy, micro-detail lock.
- Product Physical Truth Lock: functions, installation actions, forbidden invented actions, dimensions, weight, scale references, unsupported claims.
- Geometry Lock: dimensions, proportions, apparel length/fit cues, object scale cues.
- Prompt Layer Stack: fact boundary layer, physical function layer, negative QA layer, and forbidden changes.
- Copy Strategy: only use verified buyer-facing facts.

Run the gate:

```bash
node ${CODEX_HOME:-$HOME/.codex}/skills/sellerpilot-product-image-industrial/scripts/source-product-understanding-gate.mjs \
  --understanding /abs/run/source-understanding/source-product-understanding.json \
  --identity-lock /abs/run/blueprint/02-identity-lock.yaml \
  --physical-truth /abs/run/blueprint/02b-product-physical-truth.json \
  --source-geometry /abs/run/geometry/source-geometry.json \
  --out-dir /abs/run/qa
```

If the gate fails, return to source understanding, identity lock, physical truth, or geometry lock. Do not continue by “prompting harder” while the product facts are still missing.

## Failure Conditions

Block or reroute when:

- Codex did not record product type, structure, components, material/color, and function/use.
- OCR/raw visible text exists but is not transcribed into visible text items.
- visible text suggests dimensions, function, installation, compatibility, material, warning, certification, or weight but `text_derived_facts` is empty.
- text-derived dimensions are missing from geometry lock.
- text-derived function/use/install facts are missing from physical truth lock.
- source text is unclear but later prompts ask for closeup readable text or exact certification.
- final generated images alter visible dimensions, size relationship, label meaning, physical mechanism, or micro-detail placement.
