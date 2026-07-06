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
node scripts/platform-context-planner.mjs --run-dir /abs/run \\
  [--platform 拼多多] [--category 球衣] [--locale zh-CN] [--region 华南] \\
  [--season summer] [--climate hot-humid] [--holiday 七夕] [--trend-intent marketing]`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runDir = path.resolve(args["run-dir"]);
const researchDir = path.join(runDir, "research");
fs.mkdirSync(researchDir, { recursive: true });

const taskContext = readTextIfExists(path.join(runDir, "00-task-context.yaml"));
const platform = args.platform || extractYamlScalar(taskContext, "platform") || "";
const category = args.category || extractYamlScalar(taskContext, "category") || "";
const locale = args.locale || extractYamlScalar(taskContext, "locale") || "";
const region = args.region || "";
const season = args.season || extractYamlScalar(taskContext, "season_or_occasion") || "";
const climate = args.climate || "";
const holiday = args.holiday || "";
const trendIntent = args["trend-intent"] || "conversion";
const today = args.date || new Date().toISOString().slice(0, 10);
const profile = resolveProfile(platform);
const profileText = profile ? fs.readFileSync(profile, "utf8") : "";

const baselineReadiness = inspectProfile(profileText);
const cadence = buildCadence({ platform, category, season, climate, holiday, trendIntent });
const queries = buildQueries({ platform, category, locale, region, season, climate, holiday, trendIntent });
const webResearchRequired = cadence.some((item) => item.required_now);
const overlay = {
  platform_category_profile_overlay: {
    platform,
    category,
    locale,
    region,
    research_date: today,
    baseline_profile: profile ? path.relative(skillRoot, profile) : null,
    baseline_yaml_interpretability: baselineReadiness,
    dynamic_context: {
      season,
      climate,
      holiday,
      regional_trend_scope: region,
      marketing_trend_intent: trendIntent,
    },
    research_cadence: cadence,
    web_research_required: webResearchRequired,
    query_plan: queries,
    production_implications: {
      image_roles: [],
      scenes: [],
      copy_voice: null,
      hotword_policy: "Use current platform/category hot words only after web/search evidence; do not invent search-volume claims.",
      avoid: [],
    },
  },
};

fs.writeFileSync(path.join(researchDir, "platform-context-plan.json"), JSON.stringify(overlay, null, 2));
fs.writeFileSync(path.join(researchDir, "platform-context-plan.md"), toMarkdown(overlay.platform_category_profile_overlay));
fs.writeFileSync(path.join(researchDir, "platform-category-profile-overlay.yaml"), toYaml(overlay));
console.log(JSON.stringify({
  status: "ready",
  web_research_required: webResearchRequired,
  baseline_profile: overlay.platform_category_profile_overlay.baseline_profile,
  outDir: researchDir,
}, null, 2));

function resolveProfile(platform) {
  const key = normalize(platform);
  const mapping = [
    [/拼多多|pinduoduo|pdd/, "pinduoduo.yaml"],
    [/amazon|亚马逊/, "amazon.yaml"],
    [/tiktok/, "tiktok-shop.yaml"],
    [/小红书|xiaohongshu/, "xiaohongshu.yaml"],
    [/抖音|douyin/, "douyin.yaml"],
    [/京东|jd/, "jd.yaml"],
    [/temu/, "temu.yaml"],
    [/shein/, "shein.yaml"],
    [/etsy/, "etsy.yaml"],
    [/ozon/, "ozon.yaml"],
    [/wildberries|wb/, "wildberries.yaml"],
    [/mercado/, "mercado-libre.yaml"],
    [/falabella/, "falabella.yaml"],
    [/shopee.*latam|brazil/, "shopee-latam.yaml"],
    [/shopee|lazada/, "shopee-lazada.yaml"],
    [/taobao|tmall|淘宝|天猫/, "taobao-tmall.yaml"],
  ];
  const found = mapping.find(([pattern]) => pattern.test(key));
  if (!found) return null;
  const file = path.join(skillRoot, "platform-profiles", found[1]);
  return fs.existsSync(file) ? file : null;
}

function inspectProfile(text) {
  if (!text) {
    return {
      status: "missing_or_unknown_platform_profile",
      readable_as_baseline: false,
      missing_recommended_sections: ["image_requirements", "visual_guidance", "copy_tone", "risk_controls"],
    };
  }
  const recommended = {
    image_requirements: /image|尺寸|size|dimension|ratio|count|主图|listing/i,
    visual_guidance: /visual|style|scene|background|camera|lighting|图|场景/i,
    copy_tone: /copy|tone|text|文案|语气|language/i,
    risk_controls: /avoid|risk|prohibit|claim|watermark|禁止|避免|风险/i,
  };
  const missing = Object.entries(recommended)
    .filter(([, pattern]) => !pattern.test(text))
    .map(([name]) => name);
  return {
    status: missing.length ? "baseline_readable_with_gaps" : "baseline_readable",
    readable_as_baseline: true,
    missing_recommended_sections: missing,
    note: "Platform YAML is a stable baseline. It is not complete live truth for current category, season, region, or marketing trend.",
  };
}

function buildCadence(ctx) {
  const dynamicSignals = [ctx.season, ctx.climate, ctx.holiday, ctx.trendIntent].filter(Boolean);
  return [
    {
      topic: "official_platform_rules",
      cadence: "refresh every 30-90 days, and before high-risk marketplace compliance work",
      required_now: false,
      reason: "Stable profile YAML can cover routine runs unless platform rules are unknown or compliance-sensitive.",
    },
    {
      topic: "category_visual_norms",
      cadence: "refresh every production run when conversion quality matters",
      required_now: true,
      reason: "Category image conventions and competitor patterns drift faster than platform baseline YAML.",
    },
    {
      topic: "season_climate_holiday_regional_context",
      cadence: "refresh every production run when any dynamic context exists",
      required_now: dynamicSignals.length > 0,
      reason: "Season, climate, holiday, and regional trend signals are date-sensitive.",
    },
    {
      topic: "marketing_hot_words_and_search_language",
      cadence: "refresh every production run before final copy strategy",
      required_now: true,
      reason: "Buyer language and platform hot terms are unstable and must not be invented.",
    },
  ];
}

function buildQueries(ctx) {
  const base = [ctx.platform || "电商平台", ctx.category || "商品"].filter(Boolean).join(" ");
  const dynamic = [ctx.locale, ctx.region, ctx.season, ctx.climate, ctx.holiday].filter(Boolean).join(" ");
  return [
    `${base} 商品图 规范 图片尺寸 文案 ${ctx.locale || ""}`.trim(),
    `${base} 爆款 商品图 场景图 卖点 文案 ${dynamic}`.trim(),
    `${base} 搜索热词 买家关注点 ${dynamic}`.trim(),
    `${base} ${ctx.trendIntent || "营销"} 趋势 ${new Date().getFullYear()} ${dynamic}`.trim(),
    `${ctx.category || "商品"} ${ctx.region || ctx.locale || ""} 季节 气候 使用场景 电商图`.trim(),
  ];
}

function toMarkdown(plan) {
  return [
    "# Platform Context Plan",
    "",
    `- Platform: ${plan.platform || ""}`,
    `- Category: ${plan.category || ""}`,
    `- Locale: ${plan.locale || ""}`,
    `- Region: ${plan.region || ""}`,
    `- Baseline profile: ${plan.baseline_profile || "none"}`,
    `- Baseline status: ${plan.baseline_yaml_interpretability.status}`,
    `- Web research required: ${plan.web_research_required}`,
    "",
    "## Dynamic Context",
    "",
    `- Season: ${plan.dynamic_context.season || ""}`,
    `- Climate: ${plan.dynamic_context.climate || ""}`,
    `- Holiday: ${plan.dynamic_context.holiday || ""}`,
    `- Trend intent: ${plan.dynamic_context.marketing_trend_intent || ""}`,
    "",
    "## Cadence",
    "",
    ...plan.research_cadence.map((item) => `- ${item.topic}: ${item.cadence}; required_now=${item.required_now}; ${item.reason}`),
    "",
    "## Query Plan",
    "",
    ...plan.query_plan.map((query) => `- ${query}`),
    "",
  ].join("\n");
}

function toYaml(overlay) {
  return [
    "platform_category_profile_overlay:",
    `  platform: ${JSON.stringify(overlay.platform_category_profile_overlay.platform)}`,
    `  category: ${JSON.stringify(overlay.platform_category_profile_overlay.category)}`,
    `  locale: ${JSON.stringify(overlay.platform_category_profile_overlay.locale)}`,
    `  region: ${JSON.stringify(overlay.platform_category_profile_overlay.region)}`,
    `  research_date: ${JSON.stringify(overlay.platform_category_profile_overlay.research_date)}`,
    `  baseline_profile: ${JSON.stringify(overlay.platform_category_profile_overlay.baseline_profile)}`,
    "  baseline_yaml_interpretability:",
    `    status: ${JSON.stringify(overlay.platform_category_profile_overlay.baseline_yaml_interpretability.status)}`,
    `    readable_as_baseline: ${overlay.platform_category_profile_overlay.baseline_yaml_interpretability.readable_as_baseline}`,
    "    missing_recommended_sections:",
    ...overlay.platform_category_profile_overlay.baseline_yaml_interpretability.missing_recommended_sections.map((item) => `      - ${JSON.stringify(item)}`),
    "  dynamic_context:",
    `    season: ${JSON.stringify(overlay.platform_category_profile_overlay.dynamic_context.season)}`,
    `    climate: ${JSON.stringify(overlay.platform_category_profile_overlay.dynamic_context.climate)}`,
    `    holiday: ${JSON.stringify(overlay.platform_category_profile_overlay.dynamic_context.holiday)}`,
    `    regional_trend_scope: ${JSON.stringify(overlay.platform_category_profile_overlay.dynamic_context.regional_trend_scope)}`,
    `    marketing_trend_intent: ${JSON.stringify(overlay.platform_category_profile_overlay.dynamic_context.marketing_trend_intent)}`,
    `  web_research_required: ${overlay.platform_category_profile_overlay.web_research_required}`,
    "  research_cadence:",
    ...overlay.platform_category_profile_overlay.research_cadence.flatMap((item) => [
      `    - topic: ${JSON.stringify(item.topic)}`,
      `      cadence: ${JSON.stringify(item.cadence)}`,
      `      required_now: ${item.required_now}`,
      `      reason: ${JSON.stringify(item.reason)}`,
    ]),
    "  query_plan:",
    ...overlay.platform_category_profile_overlay.query_plan.map((query) => `    - ${JSON.stringify(query)}`),
    "  production_implications:",
    "    image_roles: []",
    "    scenes: []",
    "    copy_voice:",
    `    hotword_policy: ${JSON.stringify(overlay.platform_category_profile_overlay.production_implications.hotword_policy)}`,
    "    avoid: []",
    "",
  ].join("\n");
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function extractYamlScalar(text, key) {
  const match = text.match(new RegExp(`^\\s*${escapeRegex(key)}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].replace(/^["']|["']$/g, "").trim();
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
