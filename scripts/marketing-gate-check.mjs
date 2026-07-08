#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/marketing-gate-check.mjs --copy-json /abs/panels.json --out-dir /abs/run/qa

The JSON should be an array of panel/blueprint objects. Useful fields:
image_role, title, sub, tag, main_message, secondary_message, required_copy,
camera_angle, product_view, crop_type, visual_composition, image,
scene_asset_type, final_asset_type, generation_status, generated_asset_path,
scene_asset_path, blank_region_risk, source_language_residue_risk,
final_visible_text_review.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["copy-json"] || !args["out-dir"]) usage();

const copyJson = path.resolve(args["copy-json"]);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const panels = JSON.parse(fs.readFileSync(copyJson, "utf8"));
if (!Array.isArray(panels)) {
  throw new Error("copy-json must be a JSON array");
}

const internalTerms = [
  "不虚标",
  "以源图为准",
  "示意",
  "平台要求",
  "合规",
  "QA",
  "风险",
  "证据不足",
  "未验证",
  "待确认",
  "内部",
];

const watermarkTerms = [
  "拼多多女包套图",
  "拼多多套图",
  "女包套图",
  "pdd",
  "sellerpilot",
  "codex",
  "ai生成",
  "样图",
  "示例图",
  "仅供参考",
];

const masterStyleTerms = [
  "warm editorial street",
  "clean marketplace studio",
  "premium leather goods macro",
  "korean/japanese minimal fashion ecommerce",
  "cafe/commute natural moment",
  "mobile commerce detail clarity",
  "soft luxury leather still life",
  "contemporary asian street fashion",
  "quiet office commute editorial",
  "boutique window natural light",
  "high-inspectability macro grid",
  "truthful capacity tabletop",
  "soft social commerce lifestyle",
  "温暖街拍编辑",
  "干净电商棚拍",
  "皮具微距",
  "韩日极简",
  "咖啡通勤",
  "移动电商细节",
  "柔和轻奢皮具",
  "亚洲街头时装",
  "办公室通勤",
  "精品店橱窗",
  "高检视细节",
  "真实容量台面",
  "社交电商生活方式",
];

const findings = [];
const angleGroups = groupBy(panels, (panel) => normalize(panel.camera_angle || panel.product_view || panel.view || ""));
const cropCounts = countBy(panels.map((panel) => normalize(panel.crop_type || panel.focal_subject || panel.visual_composition || "")));
const imageCounts = countBy(panels.map((panel) => normalize(panel.image || panel.image_path || panel.source_image || "")));
const layoutIntentCounts = countBy(panels.map((panel) => normalize(panel.graphic_design_intent || panel.layout_intent || panel.layout_style || panel.overlay_style || "")));

for (const [value, group] of Object.entries(angleGroups)) {
  const count = group.length;
  if (value && count > Math.max(2, Math.ceil(panels.length * 0.35))) {
    const variation = sameAngleVariation(value, group);
    if (!variation.allowed) {
      findings.push({
        severity: "fail",
        type: "repeated-camera-angle",
        message: `Camera/product view "${value}" appears ${count} times without enough scene, lighting, prop, role, or commercial-task variation. ${variation.reason}`,
      });
    }
  }
}

for (const [value, count] of Object.entries(cropCounts)) {
  if (value && count > Math.max(2, Math.ceil(panels.length * 0.35))) {
    findings.push({
      severity: "warn",
      type: "repeated-crop-or-composition",
      message: `Crop/composition "${value}" appears ${count} times.`,
    });
  }
}

for (const [value, count] of Object.entries(imageCounts)) {
  if (value && count > Math.max(3, Math.ceil(panels.length * 0.45))) {
    findings.push({
      severity: "fail",
      type: "repeated-primary-image",
      message: `The same source/rendered image is used ${count} times.`,
    });
  }
}

panels.forEach((panel, index) => {
  const copy = [
    panel.title,
    panel.sub,
    panel.tag,
    panel.main_message,
    panel.secondary_message,
    panel.required_copy,
    panel.buyer_facing_message,
    panel.overlay_text,
    panel.badge,
    panel.badges,
    panel.corner_label,
    panel.watermark,
    panel.visible_mark,
    panel.footer_label,
    panel.visible_overlay,
    panel.visible_corner_mark,
    panel.visible_badge_text,
    panel.visible_label_text,
    panel.final_visible_text,
  ].filter(Boolean).join(" ");
  const copyNormalized = normalize(copy);
  for (const term of internalTerms) {
    if (copy.includes(term)) {
      findings.push({
        severity: "fail",
        type: "internal-copy",
        image_index: index + 1,
        message: `Final image copy contains internal/review term "${term}".`,
      });
    }
  }
  for (const term of watermarkTerms) {
    if (copyNormalized.includes(normalize(term)) && !hasVisibleMarkAuthorization(panel, term, index + 1)) {
      findings.push({
        severity: "fail",
        type: "watermark-or-platform-pack-label",
        image_index: index + 1,
        message: `Final image contains watermark/platform-pack label "${term}" without explicit user authorization for that exact visible mark.`,
      });
    }
  }
  const visibleDesignText = [
    panel.corner_label,
    panel.badge,
    panel.badges,
    panel.watermark,
    panel.visible_mark,
    panel.footer_label,
    panel.visible_overlay,
    panel.visible_corner_mark,
    panel.visible_badge_text,
    panel.visible_label_text,
    panel.final_visible_text,
    panel.rendered_text,
    panel.layer_text,
    panel.text_layers,
  ].filter(Boolean).join(" ");
  for (const term of watermarkTerms) {
    if (normalize(visibleDesignText).includes(normalize(term)) && !hasVisibleMarkAuthorization(panel, term, index + 1)) {
      findings.push({
        severity: "fail",
        type: "watermark-or-platform-pack-label",
        image_index: index + 1,
        message: `Visible design/layer field contains watermark/platform-pack label "${term}" without explicit user authorization for that exact visible mark.`,
      });
    }
  }
  for (const item of visibleMarkFields(panel)) {
    if (item.value && !hasVisibleMarkAuthorization(panel, item.value, index + 1)) {
      findings.push({
        severity: "fail",
        type: "unauthorized-visible-watermark-mark",
        image_index: index + 1,
        message: `Visible mark field "${item.field}" is populated without explicit user authorization. Default policy is no watermark/visible mark.`,
      });
    }
  }
  const layoutText = [
    panel.graphic_design_intent,
    panel.layout_intent,
    panel.layout_style,
    panel.overlay_style,
    panel.visual_composition,
  ].filter(Boolean).join(" ");
  const designQualityText = [
    panel.design_quality_bar,
    panel.typography_hierarchy,
    panel.safe_zone_notes,
    panel.mobile_thumbnail_rule,
    panel.visual_difference_from_previous,
    panel.color_and_contrast,
    panel.text_hierarchy,
  ].filter(Boolean).join(" ");
  if (!layoutText || layoutText.length < 18 || !designQualityText) {
    findings.push({
      severity: "fail",
      type: "weak-graphic-design-system",
      image_index: index + 1,
      message: "Panel lacks role-specific graphic design intent, hierarchy/safe-zone notes, mobile readability, or set-variation rationale.",
    });
  }
  if (/半透明|translucent|rounded card|圆角卡片|glass card|frosted card/i.test(layoutText)
    && !/variation|变化|仅此图|not repeated|role-specific|差异/i.test(layoutText)) {
    findings.push({
      severity: "warn",
      type: "repeated-template-card-layout",
      image_index: index + 1,
      message: "Panel uses a translucent/rounded-card layout without role-specific variation notes.",
    });
  }
  const photographyText = [
    panel.photography_style_archetype,
    panel.photography_archetype,
    panel.master_style_archetype,
    panel.lens_feel,
    panel.lighting,
    panel.lighting_direction,
    panel.color_temperature,
    panel.camera_height,
    panel.props_or_model_context,
    panel.product_placement,
    panel.audience_fit,
    panel.why_it_fits_product_and_audience,
  ].filter(Boolean).join(" ");
  const hasMasterStyle = masterStyleTerms.some((term) => normalize(photographyText).includes(normalize(term)));
  if (!photographyText || photographyText.length < 32 || !hasMasterStyle || /^(高级商拍|电商风|commercial photography|premium photo)$/i.test(photographyText.trim())) {
    findings.push({
      severity: "fail",
      type: "generic-photography-style",
      image_index: index + 1,
      message: "Panel lacks a named master-level archetype plus lens, light, scene/body relationship, audience fit, or product placement notes.",
    });
  }
  const microDetailText = [
    panel.micro_detail_preservation,
    panel.must_preserve_micro_details,
    panel.detail_focus,
    panel.logo_or_markings,
  ].filter(Boolean).join(" ");
  const wantsMicroDetail = /logo|商标|品牌|吊牌|tag|engraving|刻字|小字|mark|五金|hardware|charm|挂件|纹理|texture/i.test(copy + " " + [
    panel.image_role,
    panel.role,
    panel.focal_subject,
    panel.required_detail_difference,
  ].filter(Boolean).join(" "));
  if (wantsMicroDetail && !microDetailText) {
    findings.push({
      severity: "fail",
      type: "unclear-micro-detail",
      image_index: index + 1,
      message: "Panel references micro-details but lacks source-backed preservation notes or unclear-detail handling.",
    });
  }
  const inventedMicroDetailRisk = /invent|new logo|new brand|生成品牌|自创商标|可读品牌|readable brand/i.test(microDetailText);
  const inventedMicroDetailNegated = /\b(no|not|never|without|forbid|forbidden|avoid|do not|don't)\b.{0,48}(invent|new logo|new brand|readable brand)|不得.{0,24}(生成|自创|可读)|禁止.{0,24}(生成|自创|可读)|不要.{0,24}(生成|自创|可读)/i.test(microDetailText);
  if (inventedMicroDetailRisk && !inventedMicroDetailNegated) {
    findings.push({
      severity: "fail",
      type: "invented-logo-or-trademark",
      image_index: index + 1,
      message: "Panel appears to allow invented readable logo/trademark or micro text.",
    });
  }
  if (!normalize(panel.camera_angle || panel.product_view || panel.view)) {
    findings.push({
      severity: "warn",
      type: "missing-camera-angle",
      image_index: index + 1,
      message: "Panel is missing camera_angle/product_view.",
    });
  }
  if (!normalize(panel.image_role || panel.role)) {
    findings.push({
      severity: "warn",
      type: "missing-image-role",
      image_index: index + 1,
      message: "Panel is missing image_role.",
    });
  }
  const blankRisk = textify([
    panel.blank_region_risk,
    panel.large_blank_region,
    panel.empty_visual_module,
    panel.blank_module_risk,
    panel.final_raster_blank_region_review,
  ]);
  if (truthyRisk(blankRisk)) {
    findings.push({
      severity: "fail",
      type: "blank-or-empty-final-module",
      image_index: index + 1,
      message: "Panel/final review reports a large blank region, empty card, or unused visual module in the final image.",
    });
  }
  const languageResidueRisk = textify([
    panel.source_poster_visible_text_risk,
    panel.source_language_residue_risk,
    panel.non_target_language_residue,
    panel.source_language_residue_review,
    panel.final_visible_text_review,
  ]);
  if (truthyRisk(languageResidueRisk)) {
    findings.push({
      severity: "fail",
      type: "source-or-non-target-language-residue",
      image_index: index + 1,
      message: "Panel/final review reports source poster text or non-target-language residue in the final commerce image.",
    });
  }
});

for (const [value, count] of Object.entries(layoutIntentCounts)) {
  if (value && count > Math.max(2, Math.ceil(panels.length * 0.35))) {
    findings.push({
      severity: "fail",
      type: "weak-graphic-design-system",
      message: `Graphic/layout intent "${value}" appears ${count} times; the set needs role-specific visual design variation.`,
    });
  }
}

const scenePanels = panels.filter((panel) => /场景|scene|上身|穿搭|通勤|户外|咖啡|逛街|约会|街|lifestyle|wear|outfit|commute|cafe|date|street|shopping/i.test([
  panel.image_role,
  panel.role,
  panel.title,
  panel.slug,
  panel.asset_id,
  panel.background_or_scene,
].filter(Boolean).join(" ")));
for (const panel of scenePanels) {
  const sceneText = [
    panel.background_or_scene,
    panel.lighting,
    panel.props_or_model_context,
    panel.visual_composition,
  ].filter(Boolean).join(" ");
  if (!sceneText || sceneText.length < 12) {
    findings.push({
      severity: "fail",
      type: "thin-scene-direction",
      image_index: panels.indexOf(panel) + 1,
      message: "Scene panel lacks environment, lighting, prop/model, or placement direction.",
    });
  }
  const imagePath = normalize(panel.scene_asset_path || panel.generated_asset_path || panel.image || panel.image_path || "");
  const sourcePath = normalize(panel.source_image || "");
  const assetSignal = normalize([
    panel.scene_asset_type,
    panel.final_asset_type,
    panel.asset_type,
    panel.asset_origin,
    panel.generation_status,
    panel.render_mode,
  ].filter(Boolean).join(" "));
  if (!imagePath) {
    findings.push({
      severity: "fail",
      type: "missing-scene-asset",
      image_index: panels.indexOf(panel) + 1,
      message: "Scene panel has no panel-specific generated/photo scene asset path.",
    });
  }
  if (imagePath && sourcePath && imagePath === sourcePath) {
    findings.push({
      severity: "fail",
      type: "source-cutout-used-as-scene",
      image_index: panels.indexOf(panel) + 1,
      message: "Scene panel reuses the source product cutout as the scene asset.",
    });
  }
  if (/(layout|wireframe|draft|placeholder|cutout|renderer_only|deterministic_only)/i.test(assetSignal)) {
    findings.push({
      severity: "fail",
      type: "scene-is-layout-placeholder",
      image_index: panels.indexOf(panel) + 1,
      message: "Scene panel is marked as a layout, draft, placeholder, cutout, or renderer-only asset.",
    });
  }
  if (!/(gpt|imagegen|image_gen|built-in|runtime|generated|photo|scene_asset|approved)/i.test(assetSignal) && !(panel.scene_asset_path || panel.generated_asset_path)) {
    findings.push({
      severity: "fail",
      type: "missing-scene-generation-proof",
      image_index: panels.indexOf(panel) + 1,
      message: "Scene panel lacks scene_asset_type/final_asset_type/generation_status evidence for a true scene asset.",
    });
  }
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  panel_count: panels.length,
  findings,
};

fs.writeFileSync(path.join(outDir, "marketing-quality-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "marketing-quality-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function groupBy(values, keyFn) {
  const groups = {};
  for (const value of values) {
    const key = keyFn(value);
    groups[key] = groups[key] || [];
    groups[key].push(value);
  }
  return groups;
}

function sameAngleVariation(angle, group) {
  const explicitReason = textify(group.map((panel) => [
    panel.same_angle_series_reason,
    panel.consistent_catalog_angle_reason,
    panel.camera_angle_rationale,
    panel.set_variation_rationale,
  ]));
  if (/(consistent catalog|same angle series|同角度系列|统一角度|连续棚拍|catalog consistency|环境变化|scene variation|role-specific|商业理由|commercial reason)/i.test(explicitReason)) {
    return { allowed: true, reason: "Explicit same-angle series rationale is recorded." };
  }

  const axes = [
    ["role", group.map((panel) => textify([panel.image_role, panel.role, panel.asset_id, panel.slug]))],
    ["commercial task", group.map((panel) => textify([panel.image_job, panel.commercial_task, panel.buyer_question, panel.conversion_intent]))],
    ["environment", group.map((panel) => textify([panel.background_or_scene, panel.scene, panel.environment, panel.location, panel.usage_context, panel.occasion]))],
    ["props/model", group.map((panel) => textify([panel.props_or_model_context, panel.props, panel.model_context, panel.handheld_context]))],
    ["surface", group.map((panel) => textify([panel.surface, panel.tabletop_surface, panel.floor_surface, panel.background_surface]))],
    ["lighting", group.map((panel) => textify([panel.lighting, panel.lighting_direction, panel.color_temperature]))],
    ["placement", group.map((panel) => textify([panel.product_placement, panel.product_scale, panel.focal_subject]))],
    ["composition", group.map((panel) => textify([panel.crop_type, panel.visual_composition, panel.graphic_design_intent, panel.layout_intent]))],
  ];
  const variedAxes = axes
    .map(([name, values]) => [name, distinctMeaningfulValues(values)])
    .filter(([, values]) => values.length >= 2);
  const hasImageReuse = distinctMeaningfulValues(group.map((panel) => panel.image || panel.image_path || panel.source_image)).length <= 1;
  const hasCommercialOrSceneVariation = variedAxes.some(([name]) => ["role", "commercial task", "environment", "props/model", "surface", "lighting", "placement"].includes(name));

  if (hasCommercialOrSceneVariation) {
    return {
      allowed: true,
      reason: `Same angle has meaningful variation in ${variedAxes.map(([name]) => name).join(", ")}.`,
    };
  }
  if (variedAxes.length >= 2 && !hasImageReuse) {
    return {
      allowed: true,
      reason: `Same angle has composition/layout variation in ${variedAxes.map(([name]) => name).join(", ")}.`,
    };
  }
  return {
    allowed: false,
    reason: `Variation axes found: ${variedAxes.map(([name]) => name).join(", ") || "none"}.`,
  };
}

function distinctMeaningfulValues(values) {
  return [...new Set(values.map((value) => normalize(textify(value))).filter((value) => value.length >= 3))];
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function textify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textify).filter(Boolean).join(" ");
  if (typeof value === "object") return Object.values(value).map(textify).filter(Boolean).join(" ");
  return String(value);
}

function truthyRisk(value) {
  const text = normalize(textify(value));
  if (!text) return false;
  if (/^(false|no|none|pass|passed|ok|clear|clean|not_detected|not detected|无|没有|通过)$/.test(text)) return false;
  return /(true|yes|fail|failed|risk|detected|blank|empty|large blank|unused|source|non[-_ ]?target|residue|poster|chinese|中文|汉字|残留|空白|生造|未处理)/i.test(text);
}

function visibleMarkFields(panel) {
  return [
    ["watermark", panel.watermark],
    ["visible_mark", panel.visible_mark],
    ["visible_corner_mark", panel.visible_corner_mark],
    ["platform_pack_label", panel.platform_pack_label],
    ["system_mark", panel.system_mark],
    ["internal_mark", panel.internal_mark],
    ["ai_mark", panel.ai_mark],
    ["watermark_text", panel.watermark_text],
  ]
    .filter(([, value]) => normalize(textify(value)))
    .map(([field, value]) => ({ field, value: textify(value) }));
}

function hasVisibleMarkAuthorization(panel, markValue, imageIndex) {
  const policy = panel.no_watermark_policy || panel.graphic_design_direction?.no_watermark_policy || {};
  const authorizations = [
    panel.watermark_authorization,
    panel.visible_mark_authorization,
    panel.user_visible_mark_authorization,
    policy.watermark_authorization,
  ];
  const explicitFlag = [
    panel.user_requested_watermark,
    panel.explicit_user_requested_visible_mark,
    panel.user_explicitly_requested_visible_mark,
    policy.user_requested_watermark,
    policy.explicit_user_requested_visible_mark,
  ].some(Boolean);
  const authText = normalize(textify(authorizations));
  const explicitStatus = /user_explicitly_requested|explicit_user|用户明确|明确要求|requested_by_user|authorized_by_user/.test(authText);
  if (!explicitFlag && !explicitStatus) return false;

  const mark = normalize(textify(markValue));
  const allowedTexts = [
    panel.allowed_visible_marks,
    panel.user_requested_visible_marks,
    policy.allowed_visible_marks,
    ...authorizations.map((item) => item?.exact_visible_text),
    ...authorizations.map((item) => item?.text),
    ...authorizations.map((item) => item?.visible_text),
    ...authorizations.map((item) => item?.mark),
  ]
    .flat()
    .map((item) => normalize(textify(item)))
    .filter(Boolean);

  const allowedImages = [
    ...authorizations.map((item) => item?.allowed_images),
    policy.allowed_images,
  ].flat().filter((item) => item !== undefined && item !== null);
  const imageAllowed = !allowedImages.length
    || allowedImages.some((item) => normalize(textify(item)) === "all" || Number(item) === imageIndex || normalize(textify(item)) === `image-${imageIndex}`);
  if (!imageAllowed) return false;

  if (!mark) return true;
  return allowedTexts.some((item) => item === mark || item.includes(mark) || mark.includes(item));
}

function toMarkdown(report) {
  const lines = [
    "# Marketing Quality Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Panel count: ${report.panel_count}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) {
    lines.push("- None");
  } else {
    for (const item of report.findings) {
      const prefix = item.image_index ? `image ${item.image_index}, ` : "";
      lines.push(`- [${item.severity}] ${item.type}: ${prefix}${item.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
