import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REFERENCE_LIMITS = Object.freeze({
  max_count: 2,
  max_per_image_bytes: 12 * 1024 * 1024,
  max_total_bytes: 20 * 1024 * 1024,
});

export function inferReferenceRole(value) {
  const name = path.basename(String(value || "")).toLowerCase();
  if (/(competitor|reference|竞品|参考)/i.test(name)) return "competitor_reference";
  if (/(interior|inside|lining|capacity|open|内里|内部|容量|开口)/i.test(name)) return "interior";
  if (/(bottom|base|底部|包底)/i.test(name)) return "bottom";
  if (/(top|opening|顶部|包口)/i.test(name)) return "top";
  if (/(detail|close|macro|hardware|zip|stitch|texture|细节|五金|拉链|走线|纹理)/i.test(name)) return "detail";
  if (/(pack|box|包装)/i.test(name)) return "packaging";
  if (/(logo|mark|label|商标|标牌|标签)/i.test(name)) return "logo";
  if (/(side|profile|侧面|侧视)/i.test(name)) return "side";
  if (/(back|rear|背面|后面)/i.test(name)) return "back";
  if (/(front|main|primary|hero|主图|正面)/i.test(name)) return "primary_identity";
  if (/(scene|life|model|usage|场景|上身|使用)/i.test(name)) return "scene";
  if (/(material|motif|pattern|print|fabric|材质|图案|印花|织物|提花)/i.test(name)) return "surface_material";
  return "unknown";
}

export function evidenceTagsForRole(role) {
  const map = {
    primary_identity: ["silhouette", "proportions", "primary_color", "material", "front_structure"],
    front: ["silhouette", "proportions", "front_structure"],
    side: ["depth", "side_profile", "strap_or_handle"],
    back: ["back_structure", "rear_hardware"],
    top: ["opening", "closure", "top_structure"],
    bottom: ["base_shape", "feet", "bottom_structure"],
    interior: ["interior", "lining", "compartments", "opening"],
    detail: ["hardware", "closure", "texture", "stitching", "micro_detail"],
    packaging: ["packaging", "included_items", "visible_markings"],
    logo: ["logo_or_markings", "micro_text"],
    scene: ["scale", "use_context"],
    surface_material: ["canonical_motif", "palette", "texture", "pattern_scale"],
  };
  return map[role] || ["needs_visual_review"];
}

export function useTagsForRole(role) {
  const map = {
    primary_identity: ["hero", "identity", "scene"], front: ["hero", "identity"], side: ["side", "dimensions", "identity"],
    back: ["back", "identity"], top: ["opening", "identity"], bottom: ["bottom", "identity"], interior: ["interior", "capacity"],
    detail: ["detail", "identity"], packaging: ["packaging", "trust"], logo: ["detail", "brand_mark"], scene: ["scene"],
    surface_material: ["surface_material", "detail", "identity"],
  };
  return map[role] || ["manual_review"];
}

export function inferGenerationIntent({ prompt = "", role = "" } = {}) {
  const text = `${role} ${prompt}`.toLowerCase();
  if (/(interior|inside|lining|capacity|compartment|open bag|内里|内部|容量|隔层|开口)/i.test(text)) return "interior";
  if (/(detail|macro|close[- ]?up|hardware|zipper|stitch|texture|logo|细节|特写|五金|拉链|走线|纹理|商标)/i.test(text)) return "detail";
  if (/(side|profile|dimension|侧面|侧视|尺寸)/i.test(text)) return "side";
  if (/(back|rear|背面|后视)/i.test(text)) return "back";
  if (/(packaging|unbox|box|trust|包装|开箱)/i.test(text)) return "packaging";
  if (/(surface|motif|pattern|print|fabric|材质|图案|印花|织物|提花)/i.test(text)) return "surface_material";
  if (/(scene|lifestyle|model|use|wear|outdoor|场景|上身|使用|户外)/i.test(text)) return "scene";
  if (/(bottom|base|底部|包底)/i.test(text)) return "bottom";
  if (/(top|opening|顶部|包口)/i.test(text)) return "top";
  if (/(hero|main image|primary|主图|首图)/i.test(text) || /IMG[-_ ]?0?1/i.test(role)) return "hero";
  return "generic";
}

export function normalizeReferenceLimits(value = {}, fallback = DEFAULT_REFERENCE_LIMITS) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    max_count: boundedInteger(raw.max_count, fallback.max_count, 1, 8),
    max_per_image_bytes: boundedInteger(raw.max_per_image_bytes, fallback.max_per_image_bytes, 256 * 1024, 100 * 1024 * 1024),
    max_total_bytes: boundedInteger(raw.max_total_bytes, fallback.max_total_bytes, 256 * 1024, 200 * 1024 * 1024),
  };
}

export function providerReferenceLimits(resolution = {}) {
  const configured = resolution?.provider?.capabilities?.reference_images;
  const limits = normalizeReferenceLimits(configured);
  const runtime = `${resolution?.provider?.runtime || ""} ${resolution?.provider?.runtime_script || ""} ${resolution?.provider?.id || ""}`;
  if (/nvidia|flux/i.test(runtime)) limits.max_count = 1;
  return limits;
}

export function fileBytes(file) {
  try { return fs.statSync(file).size; } catch { return null; }
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}
