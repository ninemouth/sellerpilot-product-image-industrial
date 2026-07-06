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

function asBool(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|y)$/i.test(String(value || ""));
}

function usage() {
  console.error(`Usage:
node scripts/brief-intake-gate.mjs --out-dir /abs/run/brief-intake \\
  [--platform 拼多多] [--category 女包] [--image-count 8] \\
  [--has-source-image true] [--source-quality low|ok|unknown] \\
  [--scene-requested true] [--claims "真皮,防水"] [--dimensions "28x8x20cm"] \\
  [--micro-detail-risk true] [--has-unclear-logo true]`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["out-dir"]) usage();

const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const platform = args.platform || "";
const category = args.category || "";
const imageCount = args["image-count"] || "";
const hasSourceImage = asBool(args["has-source-image"]);
const sourceQuality = String(args["source-quality"] || "unknown").toLowerCase();
const sceneRequested = asBool(args["scene-requested"]);
const claims = String(args.claims || "")
  .split(/[,，]/)
  .map((item) => item.trim())
  .filter(Boolean);
const dimensions = args.dimensions || "";
const hasMultipleSources = asBool(args["multiple-sources"]);
const conflictingSources = asBool(args["conflicting-sources"]);
const locale = args.locale || "";
const audience = args.audience || "";
const style = args.style || "";
const microDetailRisk = asBool(args["micro-detail-risk"]);
const hasUnclearLogo = asBool(args["has-unclear-logo"]);

const questions = [];
const assumptions = [];
const riskFlags = [];
const taskAnalysisAdditions = [];

if (!platform) {
  questions.push("目标平台/渠道是什么？如果不补充，我会按商品图常见电商平台默认规范继续。");
} else {
  taskAnalysisAdditions.push(`target_platform=${platform}`);
}

if (!category) {
  questions.push("商品品类是什么？这会影响镜头、卖点和场景默认值。");
} else {
  taskAnalysisAdditions.push(`category=${category}`);
}

if (!hasSourceImage) {
  riskFlags.push("missing-source-image");
  questions.push("请提供商品原图；没有源图时不能称为身份保持的商品图。");
}

if (sourceQuality === "low" || sourceQuality === "very-low") {
  riskFlags.push("weak-source-image");
  questions.push("源图偏弱，是否有背面、底部、五金、内里或上身角度？没有我会先增强并避免细节/容量硬 claims。");
}

if (microDetailRisk || hasUnclearLogo) {
  riskFlags.push("unclear-micro-detail");
  questions.push("源图里的商标/小字/吊牌/五金刻字或挂件表情不够清晰，是否能提供近拍？不补充我会保留位置和形状，但不生成可读品牌文字。");
  taskAnalysisAdditions.push("micro_detail_lock=unclear_details_preserve_as_unreadable_mark_or_shape_only");
}

if (hasMultipleSources && conflictingSources) {
  riskFlags.push("conflicting-source-images");
  questions.push("多张源图疑似不是同一商品或细节冲突，请确认哪张是主商品身份。");
}

const riskyClaims = claims.filter((claim) => /(真皮|皮革|防水|防火|认证|授权|容量|承重|销量|第一|最低价|正品|品牌)/i.test(claim));
if (riskyClaims.length) {
  riskFlags.push("unsupported-claim-risk");
  questions.push(`这些卖点需要证据支持：${riskyClaims.join("、")}。请确认是否有证据；否则我会从图片文案中移除。`);
}

if (sceneRequested && !style) {
  assumptions.push("scene_style=通勤/咖啡/周末逛街的安全默认组合");
  questions.push("场景更偏通勤咖啡、约会逛街、校园，还是办公室？不补充我按通勤/咖啡/周末默认组合继续。");
}

if (!locale && /amazon|etsy|ozon|wildberries|wb|tiktok|temu|shein|mercado|shopee|falabella/i.test(platform)) {
  questions.push("目标国家/语言是什么？不补充我会按平台常见主语言继续。");
}

if (!audience) {
  assumptions.push("audience=按平台和品类默认买家画像推断");
}

if (!imageCount) {
  assumptions.push("image_count=按平台默认套图数量推断");
} else {
  taskAnalysisAdditions.push(`target_image_count=${imageCount}`);
}

if (dimensions) taskAnalysisAdditions.push(`confirmed_dimensions=${dimensions}`);
if (style) taskAnalysisAdditions.push(`scene_or_style_preference=${style}`);
if (locale) taskAnalysisAdditions.push(`locale=${locale}`);
if (audience) taskAnalysisAdditions.push(`audience=${audience}`);

const criticalQuestions = questions.slice(0, 3);
const status = criticalQuestions.some((q) => /请提供商品原图|确认哪张是主商品身份|需要证据/.test(q))
  ? "user_input_recommended"
  : criticalQuestions.length
    ? "continue_with_optional_questions"
    : "continue";

const report = {
  status,
  checked_at: new Date().toISOString(),
  critical_questions: criticalQuestions,
  assumptions,
  risk_flags: riskFlags,
  task_analysis_additions: taskAnalysisAdditions,
  policy: {
    max_questions: 3,
    ask_only_when_material: true,
    continue_on_low_risk_gaps: true,
  },
};

fs.writeFileSync(path.join(outDir, "brief-intake-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "brief-intake-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, questions: criticalQuestions.length, outDir }, null, 2));

function toMarkdown(report) {
  const lines = [
    "# Brief Intake Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    "",
    "## Questions",
    ...(report.critical_questions.length ? report.critical_questions.map((q, i) => `${i + 1}. ${q}`) : ["- None"]),
    "",
    "## Assumptions",
    ...(report.assumptions.length ? report.assumptions.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Risk Flags",
    ...(report.risk_flags.length ? report.risk_flags.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Task Analysis Additions",
    ...(report.task_analysis_additions.length ? report.task_analysis_additions.map((item) => `- ${item}`) : ["- None"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
