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
node scripts/copy-strategy-gate.mjs --copy-json /abs/panels.json --out-dir /abs/run/qa \\
  [--platform-context /abs/run/research/platform-context-plan.json] [--allow-unresearched-hotwords]`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["copy-json"] || !args["out-dir"]) usage();

const copyJson = path.resolve(args["copy-json"]);
const outDir = path.resolve(args["out-dir"]);
const contextPath = args["platform-context"] ? path.resolve(args["platform-context"]) : null;
fs.mkdirSync(outDir, { recursive: true });

const panels = JSON.parse(fs.readFileSync(copyJson, "utf8"));
if (!Array.isArray(panels)) throw new Error("copy-json must be a JSON array");
const platformContext = contextPath && fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, "utf8")) : null;
const context = platformContext?.platform_category_profile_overlay || platformContext || {};
const findings = [];

if (!platformContext) {
  findings.push({
    severity: "warn",
    type: "missing-platform-context-plan",
    message: "Copy strategy has no platform-context-plan.json; current platform/category/season hot words cannot be audited.",
  });
}

if (context.web_research_required && !args["allow-unresearched-hotwords"]) {
  const hasAnyResearchBasis = panels.some((panel) => hasResearchBasis(panel));
  if (!hasAnyResearchBasis) {
    findings.push({
      severity: "fail",
      type: "missing-current-research-basis",
      message: "Platform context requires current research, but no panel records source-backed copy or hotword basis.",
    });
  }
}

const riskyCopyPattern = /(全网最低|销量第一|爆卖|必买|神器|永久|100%|防水|速干|真皮|官方授权|正品保证|冠军同款|医疗|认证|无敌|最强|零风险)/i;
const hotwordPattern = /(热词|hotword|搜索词|关键词|爆款词|trend keyword|search term)/i;
const buyerBenefitPattern = /(适合|解决|轻松|舒适|清晰|透气|显瘦|百搭|通勤|训练|比赛|夏季|冬季|节日|礼物|耐看|质感|细节|版型|容量|收纳|随身|小物|婚礼|晚宴|约会|便携|整理|防晒|保暖|cool|comfort|fit|gift|summer|winter|training|match|commute|wedding|evening|portable|organized|texture|detail)/i;

panels.forEach((panel, index) => {
  const copy = textify([
    panel.title,
    panel.sub,
    panel.tag,
    panel.main_message,
    panel.secondary_message,
    panel.buyer_facing_message,
    panel.required_copy,
    panel.overlay_text,
    panel.copy_lines,
  ]);
  const strategyText = textify([
    panel.buyer_question,
    panel.conversion_intent,
    panel.purchase_objection,
    panel.image_job,
    panel.commercial_task,
    panel.buyer_benefit,
    panel.buyer_benefits,
    panel.buyer_decision_reason,
    panel.visual_decision_reason,
    panel.usage_context,
    panel.occasion,
    panel.copy_strategy,
    panel.copy_source_strategy,
    panel.research_basis,
    panel.platform_context_ref,
  ]);
  if (!copy.trim()) {
    if (allowsTextlessPanel(panel) || strategyText.length >= 24) {
      findings.push({
        severity: "warn",
        type: "textless-panel-with-structured-copy-strategy",
        image_index: index + 1,
        message: "Panel has no visible copy, but records a structured buyer-facing strategy for a textless visual.",
      });
    } else {
      findings.push({
        severity: "fail",
        type: "missing-buyer-facing-copy",
        image_index: index + 1,
        message: "Panel has no buyer-facing copy or structured textless strategy.",
      });
    }
  }
  if (!strategyText || strategyText.length < 24) {
    findings.push({
      severity: "fail",
      type: "thin-copy-strategy",
      image_index: index + 1,
      message: "Panel copy lacks buyer question, conversion intent, objection, or research-backed strategy.",
    });
  }
  if (!buyerBenefitPattern.test(copy) && !buyerBenefitPattern.test(strategyText)) {
    findings.push({
      severity: "warn",
      type: "weak-buyer-benefit",
      image_index: index + 1,
      message: "Copy does not clearly express a buyer benefit, usage context, or decision reason.",
    });
  }
  if (riskyCopyPattern.test(copy) && !hasEvidence(panel)) {
    findings.push({
      severity: "fail",
      type: "unsupported-marketing-claim",
      image_index: index + 1,
      message: "Copy contains high-risk marketing claim without evidence or product fact support.",
    });
  }
  if (hotwordPattern.test(strategyText + " " + copy) && !hasResearchBasis(panel) && !args["allow-unresearched-hotwords"]) {
    findings.push({
      severity: "fail",
      type: "unverified-hotword-use",
      image_index: index + 1,
      message: "Panel references hot/search/trend words without web/search/platform evidence.",
    });
  }
  const dynamicNeeded = textify(context.dynamic_context || {});
  if (dynamicNeeded && /(season|summer|winter|holiday|festival|climate|regional|夏|冬|节日|气候|区域)/i.test(dynamicNeeded)) {
    const seasonalText = textify([copy, strategyText, panel.seasonal_relevance, panel.regional_relevance]);
    if (!/(season|summer|winter|holiday|festival|climate|regional|夏|冬|节日|气候|区域|炎热|寒冷|雨季|开学|圣诞|新年)/i.test(seasonalText)) {
      findings.push({
        severity: "warn",
        type: "dynamic-context-not-used",
        image_index: index + 1,
        message: "Platform context includes season/climate/holiday/region, but panel copy strategy does not use or reject it.",
      });
    }
  }
});

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  panel_count: panels.length,
  platform_context: contextPath,
  findings,
};

fs.writeFileSync(path.join(outDir, "copy-strategy-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "copy-strategy-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function hasEvidence(panel) {
  return Boolean(textify([
    panel.fact_sheet_ref,
    panel.source_evidence,
    panel.claim_evidence,
    panel.supported_claims,
    panel.product_fact_support,
  ]).trim());
}

function hasResearchBasis(panel) {
  return Boolean(textify([
    panel.research_basis,
    panel.hotword_basis,
    panel.search_term_source,
    panel.platform_context_ref,
    panel.platform_category_research_ref,
    panel.sources,
  ]).trim());
}

function allowsTextlessPanel(panel) {
  const policyText = normalize(textify([
    panel.visible_text_policy,
    panel.text_policy,
    panel.copy_visibility,
    panel.overlay_text_policy,
    panel.textless_reason,
  ]));
  return Boolean(
    panel.textless_ok
    || panel.no_visible_text
    || panel.copyless_ok
    || /(no visible text|textless|copyless|无字|不加字|无需文字|纯图|仅图片)/i.test(policyText)
  );
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

function toMarkdown(report) {
  const lines = [
    "# Copy Strategy Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Panel count: ${report.panel_count}`,
    `- Platform context: ${report.platform_context || "none"}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  else {
    for (const item of report.findings) {
      const prefix = item.image_index ? `image ${item.image_index}, ` : "";
      lines.push(`- [${item.severity}] ${item.type}: ${prefix}${item.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
