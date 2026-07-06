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
node scripts/strategy-direction-gate.mjs --run-dir /abs/run \\
  [--platform 拼多多] [--category 球衣] [--product-name "..."] \\
  [--audience "..."] [--season summer] [--occasion "back to school"] \\
  [--style "..."] [--preferred-route conversion_direct|seasonal_lifestyle|premium_identity]`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = path.join(runDir, "strategy");
fs.mkdirSync(outDir, { recursive: true });

const taskContext = readTextIfExists(path.join(runDir, "00-task-context.yaml"));
const platform = args.platform || extractYamlScalar(taskContext, "platform") || "";
const category = args.category || extractYamlScalar(taskContext, "category") || "";
const productName = args["product-name"] || extractYamlScalar(taskContext, "product_name") || "";
const audience = args.audience || extractYamlScalar(taskContext, "audience") || "";
const season = args.season || extractYamlScalar(taskContext, "season_or_occasion") || "";
const occasion = args.occasion || "";
const style = args.style || "";
const preferredRoute = args["preferred-route"] || "";

const options = buildOptions({ platform, category, productName, audience, season, occasion, style });
const selected = selectOption(options, { platform, category, audience, season, occasion, style, preferredRoute });
const report = {
  status: "ready",
  created_at: new Date().toISOString(),
  selection_policy: {
    show_options_before_formal_production: true,
    max_user_options: 3,
    continue_if_user_has_no_preference: true,
    harness_autonomous_selection_allowed: true,
  },
  task_context: { platform, category, product_name: productName, audience, season, occasion, style },
  options,
  selected_option_id: selected.id,
  selected_reason: selected.reason,
  user_prompt_hint: "用户可选择一个方向；如果用户没有明确偏好，按 selected_option_id 继续并记录原因。",
};

fs.writeFileSync(path.join(outDir, "direction-options.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "direction-options.md"), toMarkdown(report));
fs.writeFileSync(path.join(outDir, "direction-selection.yaml"), toYaml(report));
console.log(JSON.stringify({ status: report.status, selected_option_id: selected.id, outDir }, null, 2));

function buildOptions(ctx) {
  const categoryLabel = ctx.category || "商品";
  const platformLabel = ctx.platform || "目标平台";
  const productLabel = ctx.productName || categoryLabel;
  return [
    {
      id: "conversion_direct",
      label: "直接转化型",
      best_when: ["用户需求粗略", "平台偏价格/效率/快速决策", "商品卖点需要被快速看懂"],
      buyer_strategy: `让买家在 1-2 秒内看懂 ${productLabel} 是什么、适合谁、为什么现在值得点开。`,
      visual_direction: "清晰主体、少装饰、高可读卖点、尺寸/材质/细节/穿着效果分工明确。",
      copy_direction: "短句、利益点优先、避免内部说明和未证实夸张词。",
      risks: ["容易过于促销化", "如果没有事实支撑，容量/材质/性能 claims 必须降级"],
      production_implications: ["主图和详情图先生成 anchor batch", "文案 gate 必须先过", "弱事实卖点只做视觉展示不做硬 claim"],
    },
    {
      id: "seasonal_lifestyle",
      label: "时令场景型",
      best_when: ["有季节/气候/节日/区域趋势", "服饰、包袋、户外、礼品、家居等受场景影响大", "用户希望图更有购买想象"],
      buyer_strategy: `把 ${categoryLabel} 放进 ${ctx.season || ctx.occasion || "当前季节/节日"} 的真实使用场景，让买家感到现在用得上。`,
      visual_direction: "真实生活方式场景、季节光线/气候线索、区域化穿搭/道具，但商品身份优先。",
      copy_direction: "围绕时令使用理由写，不蹭无关热点，不制造虚假节日促销。",
      risks: ["场景会增加身份漂移风险", "必须有真实生成/照片场景资产，不能用 cutout 假装场景"],
      production_implications: ["平台上下文研究必须包含 season/climate/holiday/regional trend", "先生成 1 张高风险场景 anchor 做 QA"],
    },
    {
      id: "premium_identity",
      label: "质感身份型",
      best_when: ["商品细节/版型/材质是核心信任点", "品牌感或高客单价更重要", "源图细节复杂且身份漂移风险高"],
      buyer_strategy: `用稳定棚拍、微距和版型对比建立 ${productLabel} 的可信商品身份。`,
      visual_direction: "克制背景、精确版型比例、细节特写、少量高级场景，优先还原商品。",
      copy_direction: "少而准，围绕看得见的结构、材质观感、版型和做工，不写证据不足 claims。",
      risks: ["不够热闹", "需要更严身份锁和几何锁，生成失败时只重跑漂移图"],
      production_implications: ["身份几何 gate 必须先定义", "服饰必须锁衣长/下摆/袖长/领口比例", "详情图优先用源图 crop 或参考生成"],
    },
  ];
}

function selectOption(options, ctx) {
  if (ctx.preferredRoute) {
    const found = options.find((option) => option.id === ctx.preferredRoute);
    if (found) return { id: found.id, reason: "user_or_call_explicit_preference" };
  }
  const text = normalize([ctx.platform, ctx.category, ctx.audience, ctx.season, ctx.occasion, ctx.style].join(" "));
  if (/season|summer|winter|spring|autumn|holiday|festival|节日|夏|冬|春|秋|开学|圣诞|新年|雨季|寒冷|炎热|通勤|场景|lifestyle/.test(text)) {
    return { id: "seasonal_lifestyle", reason: "season_or_scene_signal_present" };
  }
  if (/amazon|etsy|premium|高端|质感|品牌|版型|材质|logo|细节|球衣|服装|apparel|jersey/.test(text)) {
    return { id: "premium_identity", reason: "identity_or_quality_signal_present" };
  }
  if (/拼多多|pinduoduo|temu|促销|低价|性价比|转化|爆款/.test(text)) {
    return { id: "conversion_direct", reason: "direct_conversion_platform_signal" };
  }
  return { id: "conversion_direct", reason: "default_for_rough_request_without_preference" };
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function extractYamlScalar(text, key) {
  const match = text.match(new RegExp(`^[ \\t]*${escapeRegex(key)}:[ \\t]*(.*)$`, "m"));
  if (!match) return "";
  return match[1].replace(/^["']|["']$/g, "").trim();
}

function toMarkdown(report) {
  const lines = [
    "# Strategy Direction Options",
    "",
    `- Status: ${report.status}`,
    `- Selected: ${report.selected_option_id}`,
    `- Reason: ${report.selected_reason}`,
    "",
    "## Options",
    "",
  ];
  for (const option of report.options) {
    lines.push(`### ${option.label} (${option.id})`);
    lines.push(`- Buyer strategy: ${option.buyer_strategy}`);
    lines.push(`- Visual direction: ${option.visual_direction}`);
    lines.push(`- Copy direction: ${option.copy_direction}`);
    lines.push(`- Best when: ${option.best_when.join("; ")}`);
    lines.push(`- Risks: ${option.risks.join("; ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function toYaml(report) {
  return [
    "direction_selection:",
    `  status: ${JSON.stringify(report.status)}`,
    `  selected_option_id: ${JSON.stringify(report.selected_option_id)}`,
    `  selected_reason: ${JSON.stringify(report.selected_reason)}`,
    "  policy:",
    "    show_options_before_formal_production: true",
    "    continue_if_user_has_no_preference: true",
    "    harness_autonomous_selection_allowed: true",
    "  options:",
    ...report.options.flatMap((option) => [
      `    - id: ${JSON.stringify(option.id)}`,
      `      label: ${JSON.stringify(option.label)}`,
      `      buyer_strategy: ${JSON.stringify(option.buyer_strategy)}`,
      `      visual_direction: ${JSON.stringify(option.visual_direction)}`,
      `      copy_direction: ${JSON.stringify(option.copy_direction)}`,
    ]),
    "",
  ].join("\n");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
