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
node scripts/localized-copy-qa-gate.mjs --copy-json /abs/panels.json --out-dir /abs/run/qa \\
  [--locale ru-RU] [--source-locale zh-CN] [--task-context /abs/run/00-task-context.yaml] \\
  [--platform-context /abs/run/research/platform-context-plan.json]

Runs a pre-generation localization/translation QA gate for buyer-facing image copy.
For non-zh/non-en locales, especially ru/de/ar class markets, visible copy must carry
source text traceability, review notes, and locale-safe direction/script checks.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["copy-json"] || !args["out-dir"]) usage();

const copyJson = path.resolve(args["copy-json"]);
const outDir = path.resolve(args["out-dir"]);
const taskContextPath = args["task-context"] ? path.resolve(args["task-context"]) : null;
const platformContextPath = args["platform-context"] ? path.resolve(args["platform-context"]) : null;
fs.mkdirSync(outDir, { recursive: true });

const panels = JSON.parse(fs.readFileSync(copyJson, "utf8"));
if (!Array.isArray(panels)) throw new Error("copy-json must be a JSON array");

const platformContext = platformContextPath && fs.existsSync(platformContextPath)
  ? JSON.parse(fs.readFileSync(platformContextPath, "utf8"))
  : null;
const overlay = platformContext?.platform_category_profile_overlay || platformContext || {};
const locale = normalizeLocale(
  args.locale
  || extractYamlScalar(taskContextPath, "locale")
  || overlay.locale
  || firstPanelField(panels, ["locale", "target_locale", "language", "target_language"])
);
const sourceLocale = normalizeLocale(
  args["source-locale"]
  || extractYamlScalar(taskContextPath, "source_locale")
  || extractYamlScalar(taskContextPath, "source_language")
  || firstPanelField(panels, ["source_locale", "source_language"])
  || "zh-CN"
);
const profile = localeProfile(locale);
const findings = [];

if (!locale) {
  findings.push({
    severity: "warn",
    type: "missing-locale-context",
    message: "No target locale was provided, so localized-copy QA could only run in best-effort mode.",
  });
}

panels.forEach((panel, index) => {
  const copy = extractVisibleCopy(panel);
  const strategyText = textify([
    panel.buyer_question,
    panel.conversion_intent,
    panel.purchase_objection,
    panel.copy_strategy,
    panel.copy_notes,
    panel.localization_notes,
  ]);

  if (!copy.trim()) {
    if (allowsTextlessPanel(panel)) return;
    if (profile.review_required) {
      findings.push({
        severity: "warn",
        type: "localized-panel-has-no-visible-copy",
        image_index: index + 1,
        message: "Localized copy QA found no visible copy on this panel. Confirm that textless treatment is intentional.",
      });
    }
    return;
  }

  if (!profile.review_required) {
    if (profile.direction === "rtl") {
      const textDirection = normalizeDirection(firstValue(panel, [
        "text_direction",
        "layout_direction",
        "copy_direction",
      ]));
      if (textDirection && textDirection !== profile.direction) {
        findings.push({
          severity: "fail",
          type: "wrong-text-direction",
          image_index: index + 1,
          message: `Locale ${locale} expects ${profile.direction} text direction, but the panel is marked ${textDirection}.`,
        });
      }
    }
    return;
  }

  const sourceText = textify([
    panel.translation_source_text,
    panel.source_text,
    panel.source_copy,
    panel.source_language_text,
    panel.localization_source_text,
    panel.copy_source_text,
  ]);
  const reviewNotes = textify([
    panel.translation_review_notes,
    panel.localized_copy_review_notes,
    panel.linguistic_review_notes,
    panel.translation_rationale,
    panel.term_lock_notes,
    panel.localization_notes,
  ]);
  const backTranslation = textify([
    panel.back_translation,
    panel.translation_back_translation,
    panel.copy_back_translation,
    panel.review_back_translation,
  ]);
  const keywordBasis = textify([
    panel.market_keyword_basis,
    panel.localized_market_keyword_basis,
    panel.research_basis,
    panel.hotword_basis,
    panel.search_term_source,
    panel.platform_context_ref,
    panel.platform_category_research_ref,
  ]);
  const lockedTerms = textify([
    panel.locked_terms,
    panel.term_lock,
    panel.glossary_terms,
    panel.brand_term_policy,
    panel.model_term_policy,
  ]);
  const confidence = normalizeConfidence(firstValue(panel, [
    "translation_confidence",
    "localized_copy_confidence",
    "copy_confidence",
    "translation_review_confidence",
  ]));
  const textDirection = normalizeDirection(firstValue(panel, [
    "text_direction",
    "layout_direction",
    "copy_direction",
  ]));

  if (!sourceText.trim()) {
    findings.push({
      severity: "fail",
      type: "missing-translation-source-text",
      image_index: index + 1,
      message: `Locale ${locale} panel has visible copy but no source text traceability for translation review.`,
    });
  }

  if (!reviewNotes.trim()) {
    findings.push({
      severity: "fail",
      type: "missing-translation-review-notes",
      image_index: index + 1,
      message: `Locale ${locale} panel lacks translation or localization review notes before formal image generation.`,
    });
  }

  if (profile.requires_back_translation && !backTranslation.trim()) {
    findings.push({
      severity: "fail",
      type: "missing-back-translation",
      image_index: index + 1,
      message: `Locale ${locale} panel requires back-translation or semantic paraphrase review before generation.`,
    });
  }

  if (confidence === null) {
    findings.push({
      severity: "warn",
      type: "missing-translation-confidence",
      image_index: index + 1,
      message: "Translation review did not record a confidence signal.",
    });
  } else if (confidence < profile.minimum_confidence) {
    findings.push({
      severity: "fail",
      type: "low-translation-confidence",
      image_index: index + 1,
      message: `Translation confidence ${confidence.toFixed(2)} is below the required ${profile.minimum_confidence.toFixed(2)}.`,
    });
  }

  if (needsLocalizedMarketBasis(panel, strategyText + " " + copy) && !keywordBasis.trim()) {
    findings.push({
      severity: "fail",
      type: "missing-localized-market-basis",
      image_index: index + 1,
      message: "Localized copy uses market-sensitive phrasing or keyword intent without locale-specific basis.",
    });
  }

  if (profile.direction === "rtl" && textDirection !== "rtl") {
    findings.push({
      severity: "fail",
      type: "missing-rtl-layout-direction",
      image_index: index + 1,
      message: `Locale ${locale} requires rtl text direction metadata before generation.`,
    });
  }

  const scriptCheck = checkScriptExpectation(copy, profile, { lockedTerms, reviewNotes });
  if (scriptCheck.mismatch) {
    findings.push({
      severity: scriptCheck.severity,
      type: "target-script-mismatch",
      image_index: index + 1,
      message: scriptCheck.message,
    });
  }
  if (scriptCheck.mixedScriptNeedsReview) {
    findings.push({
      severity: "warn",
      type: "mixed-script-needs-review",
      image_index: index + 1,
      message: "Visible copy mixes scripts and needs explicit locked-term or review-note justification.",
    });
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
  locale,
  source_locale: sourceLocale,
  review_required: profile.review_required,
  locale_profile: profile,
  panel_count: panels.length,
  findings,
};

fs.writeFileSync(path.join(outDir, "localized-copy-qa-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "localized-copy-qa-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, locale, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function extractVisibleCopy(panel) {
  return textify([
    panel.title,
    panel.sub,
    panel.tag,
    panel.main_message,
    panel.secondary_message,
    panel.buyer_facing_message,
    panel.required_copy,
    panel.overlay_text,
    panel.copy_lines,
    panel.localized_copy,
    panel.localized_title,
    panel.localized_sub,
  ]);
}

function firstPanelField(panelsValue, keys) {
  for (const panel of panelsValue) {
    for (const key of keys) {
      const value = panel?.[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
  }
  return "";
}

function firstValue(panel, keys) {
  for (const key of keys) {
    const value = panel?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function extractYamlScalar(filePath, key) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const text = fs.readFileSync(filePath, "utf8");
  const match = text.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+?)\\s*$`, "m"));
  if (!match) return "";
  return String(match[1] || "").replace(/^["']|["']$/g, "").trim();
}

function localeProfile(localeValue) {
  const normalized = normalizeLocale(localeValue);
  const lang = normalized.split("-")[0];
  const defaultProfile = {
    locale: normalized,
    language: lang,
    review_required: Boolean(normalized) && !["zh", "en"].includes(lang),
    requires_back_translation: Boolean(normalized) && !["zh", "en"].includes(lang),
    minimum_confidence: 0.8,
    expected_script: expectedScript(lang),
    direction: ["ar", "fa", "he", "ur"].includes(lang) ? "rtl" : "ltr",
  };
  if (lang === "de") return { ...defaultProfile, minimum_confidence: 0.82 };
  if (lang === "ru") return { ...defaultProfile, minimum_confidence: 0.84 };
  if (lang === "ar") return { ...defaultProfile, minimum_confidence: 0.86 };
  return defaultProfile;
}

function expectedScript(lang) {
  if (["ru", "uk", "bg", "be", "sr", "mk"].includes(lang)) return "cyrillic";
  if (["ar", "fa", "ur"].includes(lang)) return "arabic";
  if (["de", "en", "fr", "it", "es", "pt", "nl", "pl", "cs", "ro", "hu", "tr", "sv", "da", "no", "fi"].includes(lang)) return "latin";
  return "any";
}

function normalizeLocale(value) {
  return String(value || "").trim();
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (/rtl|right[- ]to[- ]left|从右到左/.test(text)) return "rtl";
  if (/ltr|left[- ]to[- ]right|从左到右/.test(text)) return "ltr";
  return text;
}

function normalizeConfidence(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (value > 1) return value / 100;
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  if (/high|reviewed|approved|strong|confident|已复核|高/.test(text)) return 0.95;
  if (/medium|moderate|ok|一般|中/.test(text)) return 0.8;
  if (/low|uncertain|unsure|疑问|待确认|弱/.test(text)) return 0.55;
  const numeric = Number(text.replace(/%$/, ""));
  if (!Number.isNaN(numeric)) return numeric > 1 ? numeric / 100 : numeric;
  return null;
}

function needsLocalizedMarketBasis(panel, text) {
  const joined = normalize(textify([
    text,
    panel.market_keyword_target,
    panel.localized_search_phrase,
    panel.hotword_target,
    panel.keyword_target,
    panel.copy_strategy,
  ]));
  return /(hotword|search term|trend|keyword|热词|关键词|搜索词|趋势词|локальн|ключев|поиск|тренд|schlagwort|suchbegriff|trendwort|كلمة|بحث|ترند)/i.test(joined);
}

function checkScriptExpectation(copy, profile, options) {
  if (!copy.trim() || profile.expected_script === "any") {
    return { mismatch: false, mixedScriptNeedsReview: false, severity: "warn", message: "" };
  }
  const stats = {
    latin: (copy.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length,
    cyrillic: (copy.match(/[\u0400-\u04FF]/g) || []).length,
    arabic: (copy.match(/[\u0600-\u06FF]/g) || []).length,
  };
  const letters = stats.latin + stats.cyrillic + stats.arabic;
  if (!letters) {
    return { mismatch: false, mixedScriptNeedsReview: false, severity: "warn", message: "" };
  }
  const expectedCount = stats[profile.expected_script] || 0;
  const dominantRatio = expectedCount / letters;
  const presentScripts = Object.entries(stats).filter(([, count]) => count > 0).map(([name]) => name);
  const notes = normalize(`${options.reviewNotes || ""} ${options.lockedTerms || ""}`);
  const hasException = /(brand|logo|model|sku|romanized|latin|英文|品牌|型号|商标|бренд|модель|marke|modell|علامة|موديل)/i.test(notes);
  const mixedScriptNeedsReview = presentScripts.length > 1 && !hasException;
  if (dominantRatio >= 0.6) {
    return { mismatch: false, mixedScriptNeedsReview, severity: "warn", message: "" };
  }
  return {
    mismatch: true,
    mixedScriptNeedsReview,
    severity: profile.expected_script === "arabic" ? "fail" : "warn",
    message: `Locale ${profile.locale || profile.language} expects mostly ${profile.expected_script} script, but visible copy is not dominated by it.`,
  };
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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toMarkdown(report) {
  const lines = [
    "# Localized Copy QA Report",
    "",
    `- Status: ${report.status}`,
    `- Locale: ${report.locale || "unknown"}`,
    `- Source locale: ${report.source_locale || "unknown"}`,
    `- Review required: ${report.review_required}`,
    `- Checked at: ${report.checked_at}`,
    `- Panel count: ${report.panel_count}`,
    `- Direction: ${report.locale_profile?.direction || "unknown"}`,
    `- Expected script: ${report.locale_profile?.expected_script || "any"}`,
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
