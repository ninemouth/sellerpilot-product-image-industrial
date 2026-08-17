import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NORMALIZED_TASK_SCHEMA = "sellerpilot.normalized_production_task.v1";

export function normalizeProductionTask({ args = {}, runDir = "", platformOverride = {} } = {}) {
  const imageCount = positiveInteger(args["image-count"], positiveInteger(platformOverride.default_image_count, 1));
  const locale = String(args.locale || platformOverride.locale || "").trim();
  const userText = String(args["user-text"] || "");
  const sourceImages = unique(list(args["source-image"] || args["source-images"]).map((item) => path.resolve(item)));
  const sourceImageFingerprints = sourceImages.map((item, index) => sourceImageFingerprint(item, index));
  const facts = {
    has_source_image: asBool(args["has-source-image"]) || sourceImages.length > 0,
    source_images: sourceImages,
    source_image_fingerprints: sourceImageFingerprints,
    source_quality: String(args["source-quality"] || "unknown").toLowerCase(),
    multiple_sources: asBool(args["multiple-sources"]) || sourceImages.length > 1,
    conflicting_sources: asBool(args["conflicting-sources"]),
    scene_requested: asBool(args["scene-requested"]),
    claims: list(args.claims),
    dimensions: String(args.dimensions || ""),
    audience: String(args.audience || ""),
    style: String(args.style || ""),
    micro_detail_risk: asBool(args["micro-detail-risk"]),
    has_unclear_logo: asBool(args["has-unclear-logo"]),
    annotations_present: asBool(args["annotations-present"]),
    visible_copy: asBool(args["visible-copy"]),
    localized_copy: asBool(args["localized-copy"]),
    physical_function_risk: asBool(args["physical-function-risk"]),
    surface_material_canonical: asBool(args["surface-material-canonical"]),
    competitor_reference: asBool(args["competitor-reference"]),
    platform_research_needed: asBool(args["platform-research-needed"]),
    revision_requested: asBool(args["revision-requested"]) || asBool(args.revision),
    industrial_audit: asBool(args["industrial-audit"]) || asBool(args.audit),
    explicit_fast: asBool(args.fast),
  };
  const signals = deriveSignals({ facts, userText, locale, imageCount });
  const normalized = {
    schema_version: NORMALIZED_TASK_SCHEMA,
    normalized_at: new Date().toISOString(),
    run_id: safeRunId(args["run-id"] || (runDir ? path.basename(runDir) : "run")),
    run_dir: runDir ? path.resolve(runDir) : null,
    request: {
      platform: String(args.platform || "").trim(),
      category: String(args.category || "").trim(),
      locale,
      image_count: imageCount,
      user_text: userText,
      quality_target: String(args["quality-target"] || "").toLowerCase(),
      mode: String(args.mode || ""),
    },
    input_resolution: {
      image_count_source: args["image-count"] ? "explicit" : platformOverride.default_image_count ? "platform_default" : "fallback",
      locale_source: args.locale ? "explicit" : platformOverride.locale ? "platform_default" : "unspecified",
    },
    facts,
    signals,
    platform_override: platformOverride,
    provider_request: {
      mode: String(args.provider || "auto"),
      profile_id: String(args.profile || ""),
      provider_config: args["provider-config"] ? path.resolve(args["provider-config"]) : null,
      codex_config: args["codex-config"] ? path.resolve(args["codex-config"]) : null,
      provider_config_digest: fileDigest(args["provider-config"]),
      codex_config_digest: fileDigest(args["codex-config"]),
    },
  };
  normalized.content_digest = digestNormalizedTask(normalized);
  return normalized;
}

export function deriveSignals({ facts = {}, userText = "", locale = "", imageCount = 1 } = {}) {
  const text = String(userText || "");
  const normalizedLocale = String(locale || "").toLowerCase();
  return {
    has_source_image: Boolean(facts.has_source_image),
    visible_copy: Boolean(facts.visible_copy) || /(文案|标题|卖点|文字|copy|text)/i.test(text),
    localized_copy: Boolean(facts.localized_copy) || /^(ru|de|ar)(-|_|$)/.test(normalizedLocale),
    scene_requested: Boolean(facts.scene_requested) || /(场景|上身|模特|lifestyle|outfit|commute|cafe|street)/i.test(text),
    physical_function_risk: Boolean(facts.physical_function_risk) || /(安装|使用步骤|承重|防水|固定|尺寸|scale|function|installation)/i.test(text),
    surface_material_canonical: Boolean(facts.surface_material_canonical) || /(印花|织物|提花|纹身贴|贴纸|穿戴甲|nail wrap|printed fabric|woven)/i.test(text),
    competitor_reference: Boolean(facts.competitor_reference) || /(竞品|竞争对手|competitor reference|competitive redesign)/i.test(text),
    platform_research_needed: Boolean(facts.platform_research_needed) || /(趋势|热词|节日|气候|区域|season|holiday|trend|hotword)/i.test(text),
    rough_or_open_request: /(随便|你看着|粗略|不知道|方案|方向|任选|open|rough)/i.test(text),
    explicit_high_quality: /(高质量|精修|商业级|成品|final|high quality|premium)/i.test(text),
    revision_requested: Boolean(facts.revision_requested) || /(修改|修图|批注|标注|重做|继续优化|revision|revise|annotation)/i.test(text),
    industrial_audit: Boolean(facts.industrial_audit) || /(工业级|完整流程|审计|迁移|gate report|audit package|可迁移)/i.test(text),
    explicit_fast: Boolean(facts.explicit_fast) || /(快速|先快出|草稿|draft|quick|fast|rough)/i.test(text),
    multi_image_set: Number(imageCount) > 1 || /(套图|组图|8图|七图|多图|image set|listing images)/i.test(text),
  };
}

export function resolvePlatformOverride(overrides, platform) {
  const key = String(platform || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return { ...(overrides?.default || {}), ...(overrides?.platforms?.[key] || {}), platform_key: key, matched: Boolean(overrides?.platforms?.[key]) };
}

export function readNormalizedTask(file) {
  if (!file) return null;
  const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (value?.schema_version !== NORMALIZED_TASK_SCHEMA) throw new Error(`Unsupported normalized task schema: ${value?.schema_version || "missing"}.`);
  const digest = digestNormalizedTask(value);
  if (value.content_digest && value.content_digest !== digest) throw new Error("normalized task content_digest does not match its canonical content.");
  return { ...value, content_digest: digest };
}

export function writeNormalizedTask(file, value) {
  const normalized = { ...value, content_digest: digestNormalizedTask(value) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function mergeArgsWithNormalizedTask(args, normalized) {
  if (!normalized) return { ...args };
  const request = normalized.request || {};
  const facts = normalized.facts || {};
  const merged = { ...args };
  const fill = (key, value) => { if (merged[key] === undefined && value !== undefined && value !== null && value !== "") merged[key] = value; };
  fill("platform", request.platform); fill("category", request.category); fill("locale", request.locale);
  fill("image-count", request.image_count); fill("user-text", request.user_text); fill("quality-target", request.quality_target);
  for (const [key, value] of Object.entries({
    "has-source-image": facts.has_source_image, "source-quality": facts.source_quality,
    "multiple-sources": facts.multiple_sources, "conflicting-sources": facts.conflicting_sources,
    "scene-requested": facts.scene_requested, claims: Array.isArray(facts.claims) ? facts.claims.join(",") : facts.claims,
    dimensions: facts.dimensions, audience: facts.audience, style: facts.style,
    "micro-detail-risk": facts.micro_detail_risk, "has-unclear-logo": facts.has_unclear_logo,
    "visible-copy": facts.visible_copy, "localized-copy": facts.localized_copy,
    "physical-function-risk": facts.physical_function_risk, "surface-material-canonical": facts.surface_material_canonical,
    "competitor-reference": facts.competitor_reference, "platform-research-needed": facts.platform_research_needed,
    "revision-requested": facts.revision_requested, "industrial-audit": facts.industrial_audit, fast: facts.explicit_fast,
  })) fill(key, value);
  return merged;
}

export function digestNormalizedTask(value) {
  const clone = JSON.parse(JSON.stringify(value || {}));
  delete clone.normalized_at; delete clone.content_digest;
  return crypto.createHash("sha256").update(JSON.stringify(sortObject(clone))).digest("hex");
}

function sortObject(value) { if (Array.isArray(value)) return value.map(sortObject); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])])); }
function list(value) { return (Array.isArray(value) ? value : String(value || "").split(/[,，]/)).map((item) => String(item).trim()).filter(Boolean); }
function unique(values) { return [...new Set(values)]; }
function asBool(value) { return typeof value === "boolean" ? value : /^(1|true|yes|y)$/i.test(String(value || "")); }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; }
function safeRunId(value) { return String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run"; }
function fileDigest(value) { if (!value) return null; try { return crypto.createHash("sha256").update(fs.readFileSync(path.resolve(value))).digest("hex"); } catch { return "missing"; } }
function sourceImageFingerprint(value, index) {
  const file = path.resolve(value);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return { source_id: `SRC-${String(index + 1).padStart(2, "0")}`, missing: true, bytes: null, sha256: null };
    return { source_id: `SRC-${String(index + 1).padStart(2, "0")}`, missing: false, bytes: stat.size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") };
  } catch {
    return { source_id: `SRC-${String(index + 1).padStart(2, "0")}`, missing: true, bytes: null, sha256: null };
  }
}
