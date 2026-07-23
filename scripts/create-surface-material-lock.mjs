#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) args[key.slice(2)] = true;
    else { args[key.slice(2)] = value; i += 1; }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.category || !args["source-images"]) {
  console.error("Usage: node scripts/create-surface-material-lock.mjs --run-dir /abs/run --category 'printed fabric bag' --source-images /abs/a.png,/abs/b.png [--mode canonical-material-projection] [--target-surface 'bag panels']");
  process.exit(2);
}

const runDir = path.resolve(args["run-dir"]);
const outDir = path.join(runDir, "surface-material");
fs.mkdirSync(outDir, { recursive: true });
const sources = String(args["source-images"]).split(",").map((item) => path.resolve(item.trim())).filter(Boolean);
const missing = sources.filter((item) => !fs.existsSync(item));
if (missing.length) {
  console.error(`Source images do not exist: ${missing.join(", ")}`);
  process.exit(2);
}

const categoryText = String(args.category || "").toLowerCase();
const targetSurface = args["target-surface"] || defaultTargetSurface(categoryText);
const materialPreserve = defaultPreserveList(categoryText);
const forbiddenChanges = defaultForbiddenChanges(categoryText);

// This creates the evidence contract. Visual extraction/masking is reviewed separately;
// metadata alone must never be treated as proof of pixel-identical material transfer.
const materials = sources.map((sourceImage, index) => ({
  id: `material-${String(index + 1).padStart(2, "0")}`,
  source_image: sourceImage,
  extraction_status: "requires_visual_mask_review",
  source_region_description: "Describe the exact product material region; exclude backdrop, UI, captions and watermarks.",
  source_contamination_removal: {
    status: "required",
    excluded: ["source background", "captions", "web UI", "watermarks", "non-product pixels"],
    evidence_ref: null,
  },
  source_gradient_direction: "must_be_visually_recorded",
  target_gradient_direction: `must_map_to_${slugify(targetSurface)}_orientation`,
  shape_class: "must_be_visually_recorded",
  preserve: materialPreserve,
  forbidden_changes: forbiddenChanges,
}));

const lock = {
  schema_version: 1,
  gate_id: "surface-material-transfer",
  category: args.category,
  transfer_mode: args.mode || "canonical-material-projection",
  target_surface: targetSurface,
  source_material_is_authoritative: true,
  created_at: new Date().toISOString(),
  allowed_adaptations: [`${targetSurface} perspective`, `${targetSurface} curvature or fold`, "physical occlusion", "bounded environment light overlay", `size and orientation needed to fit the ${targetSurface} mask`],
  forbidden_adaptations: forbiddenChanges.concat(["source background or watermark transfer"]),
  visual_proof_required: true,
  visual_review_required: true,
  per_material: materials,
};
const plan = {
  transfer_mode: lock.transfer_mode,
  source_material_lock_ref: path.join(outDir, "canonical-material-lock.json"),
  steps: [
    "Visually isolate canonical product material and record a source mask/cutout without backgrounds, UI, captions or watermarks.",
    `Map each source material to a named ${targetSurface} region and target mask; record required orientation and curvature/fold.`,
    "Project the canonical material onto the target mask. Do not ask the model to redraw the design from reference.",
    "Permit only bounded environment-light overlay after projection; do not rewrite palette, brightness hierarchy, gradient direction or shape.",
    "Record transfer proof and per-region visual review before final delivery.",
  ],
};
fs.writeFileSync(path.join(outDir, "canonical-material-lock.json"), JSON.stringify(lock, null, 2));
fs.writeFileSync(path.join(outDir, "material-transfer-plan.json"), JSON.stringify(plan, null, 2));
fs.writeFileSync(path.join(outDir, "canonical-material-lock.md"), [
  "# Canonical Surface Material Lock", "", `- Category: ${lock.category}`, `- Mode: ${lock.transfer_mode}`,
  `- Target surface: ${lock.target_surface}`,
  "- Source artwork is authoritative. It must be projected to the target surface, not redrawn by the generation model.",
  "- Required visual evidence: material mask/cutout, orientation map, target mask, transfer proof, and final per-region review.", "",
  "## Sources", "", ...materials.map((material) => `- ${material.id}: ${material.source_image}`), "",
].join("\n"));
console.log(JSON.stringify({ status: "ready_for_visual_extraction", out_dir: outDir, materials: materials.length }, null, 2));

function defaultTargetSurface(category) {
  if (/(nail|美甲|穿戴甲|甲片)/i.test(category)) return "nail regions";
  if (/(bag|包|tote|bucket|桶包|handbag|shoulder)/i.test(category)) return "bag panels";
  if (/(decal|sticker|tattoo|贴纸|纹身贴)/i.test(category)) return "transfer surface";
  if (/(fabric|textile|print|印花|织物|涤棉|棉|jacquard|woven)/i.test(category)) return "fabric product surface";
  return "target product surface";
}

function defaultPreserveList(category) {
  const base = ["exact palette", "color temperature", "brightness hierarchy", "gradient direction", "source silhouette"];
  if (/(bag|包|bucket|桶包|fabric|textile|印花|织物|涤棉|jacquard|woven|双喜)/i.test(category)) {
    return base.concat(["motif identity", "motif scale", "motif grid spacing", "woven fiber texture", "panel seam alignment"]);
  }
  if (/(nail|美甲|穿戴甲|甲片)/i.test(category)) {
    return base.concat(["nail silhouette", "pearl/glitter/highlight structure"]);
  }
  return base.concat(["pattern scale", "surface texture"]);
}

function defaultForbiddenChanges(category) {
  const base = ["palette rewrite", "color temperature rewrite", "brightness hierarchy rewrite", "gradient reversal", "gradient mirroring", "unnecessary gradient rotation", "shape redesign", "pattern density rewrite"];
  if (/(bag|包|bucket|桶包|fabric|textile|印花|织物|涤棉|jacquard|woven|双喜)/i.test(category)) {
    return base.concat(["motif redraw from memory", "motif scale rewrite", "woven texture smoothing", "fabric converted to leather, plastic, silk, or glossy synthetic material"]);
  }
  if (/(nail|美甲|穿戴甲|甲片)/i.test(category)) {
    return base.concat(["particle density rewrite"]);
  }
  return base;
}

function slugify(value) {
  return String(value || "target_surface").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "target_surface";
}
