#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
node scripts/create-source-product-understanding.mjs --image /abs/source.png --out-dir /abs/run/source-understanding [--category "..."] [--langs eng+chi_sim] [--ocr-mode auto|always|never] [--text-visibility yes|no|uncertain]

Creates a starter source-product-understanding.json with image metadata and
fields for Codex visual inspection. OCR is conditional: Codex visual text
recognition is preferred, and local tesseract is used only when text is
visible/uncertain, explicitly requested, or needed for fallback. If
--text-visibility is omitted, OCR is skipped until Codex completes the visual
text precheck.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.image || !args["out-dir"]) usage();

const image = path.resolve(args.image);
const outDir = path.resolve(args["out-dir"]);
const outPath = path.join(outDir, "source-product-understanding.json");
const langs = args.langs || "eng+chi_sim";
const ocrMode = String(args["ocr-mode"] || "auto").toLowerCase();
const textVisibility = normalizeTextVisibility(args["text-visibility"]);
if (!["auto", "always", "never"].includes(ocrMode)) usage();
fs.mkdirSync(outDir, { recursive: true });

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  try {
    sharp = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"));
  } catch {
    sharp = null;
  }
}

const metadata = sharp ? await imageMetadata(image) : {};
const ocrDecision = decideOcr({ ocrMode, textVisibility });
const ocr = ocrDecision.should_run ? runOcr(image, langs) : {
  status: "skipped_ai_visual_first",
  engine: "tesseract",
  text: "",
  warning: ocrDecision.reason,
};
const visibleText = normalizeOcrText(ocr.text);
const factCandidates = deriveFactsFromText(visibleText);

const report = {
  schema_version: "sellerpilot.source_product_understanding.v1",
  status: "starter_needs_codex_visual_review",
  created_at: new Date().toISOString(),
  source_image: image,
  category: args.category || "",
  image_metadata: metadata,
  ai_visual_text_first_policy: {
    status: "pending_codex_visual_read",
    ocr_mode: ocrMode,
    text_visibility_hint: textVisibility,
    rule: "Codex visual recognition should identify and transcribe visible product text first. Run OCR only when text is visible, uncertain, user-requested, or visual reading cannot confidently transcribe size/spec/function text.",
    ocr_decision: ocrDecision,
  },
  vision_ocr_pass: {
    status: ocr.status,
    engine: ocr.engine,
    languages: langs,
    raw_text: visibleText,
    warning: ocr.warning || null,
  },
  codex_visual_product_read: {
    status: "pending",
    product_identity_summary: "",
    observed_product_type: "",
    observed_components: [],
    observed_materials_or_finish: [],
    observed_color_family: [],
    observed_structure: [],
    observed_function_or_use: [],
    physical_size_cues_from_image: [],
    scale_references: [],
    uncertainty_notes: [],
  },
  text_understanding: {
    ai_visual_text_read: {
      status: "pending",
      visible_text_detected: textVisibility === "yes" ? true : textVisibility === "no" ? false : null,
      transcribed_items: [],
      uncertain_items: [],
      ocr_needed_after_visual_read: ocrMode === "always" || textVisibility === "uncertain" || textVisibility === "pending",
    },
    visible_text_items: visibleText
      ? visibleText.split(/\n+/).map((line, index) => ({
        index: index + 1,
        text: line.trim(),
        location: "unknown",
        confidence: "ocr_unverified",
        reveals: classifyTextFact(line),
      })).filter((item) => item.text)
      : [],
    text_derived_facts: factCandidates,
    text_uncertain_or_needs_closeup: [],
  },
  facts_to_lock: {
    identity_lock_fields: [],
    physical_truth_fields: factCandidates.filter((item) => ["dimension", "weight", "installation", "compatibility", "safety", "material"].includes(item.fact_type)),
    geometry_lock_fields: factCandidates.filter((item) => item.fact_type === "dimension"),
    prompt_forbidden_changes: [],
  },
  propagation_checklist: {
    must_update_identity_lock: true,
    must_update_physical_truth_lock_when_function_or_scale_present: true,
    must_update_geometry_lock_when_size_or_proportion_present: true,
    must_include_text_facts_in_prompt_layers: true,
  },
};

fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  outPath,
  ocrMode,
  textVisibility,
  ocrDecision: ocrDecision.action,
  ocrStatus: ocr.status,
  factCandidates: factCandidates.length,
}, null, 2));

async function imageMetadata(file) {
  const meta = await sharp(file, { failOn: "none" }).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || null,
    has_alpha: Boolean(meta.hasAlpha),
  };
}

function runOcr(file, languageList) {
  const tesseract = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (tesseract.status !== 0) {
    return {
      status: "unavailable",
      engine: "tesseract",
      text: "",
      warning: "Local tesseract is not available; Codex visual text reading must transcribe visible text manually or request a clearer closeup.",
    };
  }
  const attempts = [...new Set([languageList, "eng"].filter(Boolean))];
  const failures = [];
  const imageInput = fs.readFileSync(file);
  for (const langsAttempt of attempts) {
    const result = spawnSync("tesseract", ["stdin", "stdout", "-l", langsAttempt, "--psm", "6"], {
      encoding: "utf8",
      input: imageInput,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status === 0) {
      return {
        status: result.stdout.trim() ? "completed_needs_verification" : "completed_no_text_detected",
        engine: "tesseract",
        text: result.stdout,
        languages_used: langsAttempt,
      };
    }
    failures.push(`${langsAttempt}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return {
    status: "failed",
    engine: "tesseract",
    text: "",
    warning: failures.join("\n"),
  };
}

function normalizeTextVisibility(value) {
  if (value === undefined || value === null || value === "") return "pending";
  const text = String(value).toLowerCase();
  if (/^(yes|true|visible|detected|has-text|text)$/i.test(text)) return "yes";
  if (/^(no|false|none|not-visible|no-text|textless)$/i.test(text)) return "no";
  return "uncertain";
}

function decideOcr({ ocrMode: mode, textVisibility: visibility }) {
  if (mode === "always") {
    return {
      should_run: true,
      action: "run",
      reason: "OCR mode is always; run local OCR as an explicit fallback/evidence pass.",
    };
  }
  if (mode === "never") {
    return {
      should_run: false,
      action: "skip",
      reason: "OCR mode is never; rely on Codex visual text recognition and user/source facts.",
    };
  }
  if (visibility === "no") {
    return {
      should_run: false,
      action: "skip",
      reason: "AI visual precheck says no visible text; skip local OCR for speed.",
    };
  }
  if (visibility === "pending") {
    return {
      should_run: false,
      action: "skip",
      reason: "Text visibility was not provided. Skip OCR until Codex performs AI visual text precheck and rerun with yes/uncertain only if needed.",
    };
  }
  return {
    should_run: true,
    action: "run",
    reason: visibility === "yes"
      ? "AI visual precheck says visible text is present; run OCR only as a verification fallback."
      : "Visible text is uncertain; run OCR as fallback because text may reveal size, model, warning, function, material, or compatibility facts.",
  };
}

function normalizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function deriveFactsFromText(text) {
  const facts = [];
  const source = String(text || "");
  const patterns = [
    { type: "dimension", regex: /\b\d+(?:\.\d+)?\s*(?:x|×|by)\s*\d+(?:\.\d+)?(?:\s*(?:x|×|by)\s*\d+(?:\.\d+)?)?\s*(?:in|inch|inches|cm|mm|m)\b/gi },
    { type: "dimension", regex: /\b(?:length|width|height|diameter|inner|outer|closed height|hole diameter)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:in|inch|inches|cm|mm|m)\b/gi },
    { type: "weight", regex: /\b\d+(?:\.\d+)?\s*(?:g|kg|lb|lbs|oz)\b/gi },
    { type: "installation", regex: /\b(?:screw|mount|clip|route|press|lock|install|adhesive|magnet|drill|hole)\b[^.\n]*/gi },
    { type: "compatibility", regex: /\b(?:for|fits|compatible with|works with)\b[^.\n]*/gi },
    { type: "safety", regex: /\b(?:warning|caution|waterproof|fireproof|child|pet|certified|certification|UL|CE|FCC|RoHS)\b[^.\n]*/gi },
    { type: "material", regex: /\b(?:plastic|metal|steel|aluminum|silicone|leather|cotton|polyester|nylon|ABS|PVC)\b[^.\n]*/gi },
  ];
  for (const { type, regex } of patterns) {
    for (const match of source.matchAll(regex)) {
      facts.push({
        fact_type: type,
        value: match[0].trim(),
        source: "ocr_text_candidate",
        status: "needs_codex_or_user_verification",
      });
    }
  }
  return dedupeFacts(facts);
}

function classifyTextFact(line) {
  const value = String(line || "").toLowerCase();
  const reveals = [];
  if (/\d/.test(value) && /(in|inch|cm|mm|length|width|height|diameter|size)/i.test(value)) reveals.push("physical_size_or_dimension");
  if (/(g|kg|lb|oz|weight)/i.test(value)) reveals.push("weight");
  if (/(screw|mount|clip|route|press|lock|install|adhesive|magnet|drill|hole)/i.test(value)) reveals.push("function_or_installation");
  if (/(warning|caution|waterproof|fireproof|certified|ul|ce|fcc|rohs)/i.test(value)) reveals.push("claim_or_compliance_risk");
  if (/(plastic|metal|steel|aluminum|silicone|leather|cotton|polyester|nylon|abs|pvc)/i.test(value)) reveals.push("material");
  return reveals.length ? reveals : ["unknown_text_meaning"];
}

function dedupeFacts(facts) {
  const seen = new Set();
  return facts.filter((item) => {
    const key = `${item.fact_type}:${item.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
