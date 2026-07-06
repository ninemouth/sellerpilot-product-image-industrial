#!/usr/bin/env node
import fs from "node:fs";
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
node scripts/create-source-product-understanding.mjs --image /abs/source.png --out-dir /abs/run/source-understanding [--category "..."] [--langs eng+chi_sim]

Creates a starter source-product-understanding.json with image metadata, OCR text
when local tesseract is available, text-derived fact candidates, and fields for
Codex visual inspection to complete before generation.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.image || !args["out-dir"]) usage();

const image = path.resolve(args.image);
const outDir = path.resolve(args["out-dir"]);
const outPath = path.join(outDir, "source-product-understanding.json");
const langs = args.langs || "eng+chi_sim";
fs.mkdirSync(outDir, { recursive: true });

let sharp = null;
try {
  sharp = require("sharp");
} catch {
  try {
    sharp = require("/Users/yang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");
  } catch {
    sharp = null;
  }
}

const metadata = sharp ? await imageMetadata(image) : {};
const ocr = runOcr(image, langs);
const visibleText = normalizeOcrText(ocr.text);
const factCandidates = deriveFactsFromText(visibleText);

const report = {
  schema_version: "sellerpilot.source_product_understanding.v1",
  status: "starter_needs_codex_visual_review",
  created_at: new Date().toISOString(),
  source_image: image,
  category: args.category || "",
  image_metadata: metadata,
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
console.log(JSON.stringify({ status: report.status, outPath, ocrStatus: ocr.status, factCandidates: factCandidates.length }, null, 2));

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
      warning: "Local tesseract is not available; Codex visual/OCR pass must transcribe visible text manually.",
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
