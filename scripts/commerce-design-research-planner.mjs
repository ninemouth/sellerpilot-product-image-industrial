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
node scripts/commerce-design-research-planner.mjs --run-dir /abs/run --platform Ozon --category "women bag" [--locale ru-RU] [--goal conversion|dwell|both] [--research-depth compact|standard|deep]

Creates a commerce design research plan focused on sales intent, shopper dwell
time, click hooks, trust cues, and market/bestseller design patterns. This
planner does not copy competitor assets; it tells Codex what to research and
what to extract before visual direction and prompt layers.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"] || !args.platform || !args.category) usage();

const runDir = path.resolve(args["run-dir"]);
const platform = String(args.platform);
const category = String(args.category);
const locale = String(args.locale || "");
const goal = String(args.goal || "both").toLowerCase();
const depth = String(args["research-depth"] || "standard").toLowerCase();
const researchDir = path.join(runDir, "research");
fs.mkdirSync(researchDir, { recursive: true });

const plan = buildPlan({ platform, category, locale, goal, depth });
fs.writeFileSync(path.join(researchDir, "commerce-design-research-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
fs.writeFileSync(path.join(researchDir, "commerce-design-research-plan.md"), toMarkdown(plan));
console.log(JSON.stringify({
  status: "ready",
  outDir: researchDir,
  required_reference_count: plan.research_budget.required_reference_count,
  query_count: plan.query_plan.length,
}, null, 2));

function buildPlan(ctx) {
  const platformName = ctx.platform || "target platform";
  const categoryName = ctx.category || "product category";
  const referenceCount = ctx.depth === "deep" ? 12 : ctx.depth === "compact" ? 4 : 7;
  return {
    schema_version: "sellerpilot.commerce_design_research_plan.v1",
    status: "ready",
    created_at: new Date().toISOString(),
    platform: platformName,
    category: categoryName,
    locale: ctx.locale,
    goal: ctx.goal,
    research_depth: ctx.depth,
    research_budget: {
      required_reference_count: referenceCount,
      minimum_distinct_patterns: ctx.depth === "compact" ? 3 : 5,
      max_live_queries: ctx.depth === "deep" ? 8 : ctx.depth === "compact" ? 3 : 5,
      evidence_rule: "Use official/platform evidence when possible; otherwise require repeated patterns across independent listings. Do not copy competitor assets, exact layout, exact copy, brand style, model pose, or claims.",
    },
    query_plan: buildQueries(ctx),
    extraction_framework: {
      first_second_click_hook: [
        "main subject readability at thumbnail size",
        "product scale and silhouette clarity",
        "benefit or use-case signal visible without reading long copy",
      ],
      dwell_time_mechanisms: [
        "detail curiosity: texture, material, mechanism, inside/contents, closeup",
        "confidence path: what it is -> why trust -> how it fits buyer life",
        "progressive gallery story: hero, proof, detail, scale, scenario, comparison/summary",
      ],
      trust_and_objection_handlers: [
        "size or compatibility proof",
        "material or workmanship proof",
        "included items / bundle clarity",
        "use environment realism",
        "risk claim boundaries",
      ],
      conversion_copy: [
        "buyer question answered per image",
        "short platform-native benefit phrasing",
        "no unsupported ranking, certification, waterproof, medical, safety, or performance claims",
      ],
    },
    output_contract: {
      research_file: "research/commerce-design-research.md",
      patterns_file: "research/bestseller-patterns.yaml",
      blueprint_fields_to_update: [
        "image_set[].buyer_question",
        "image_set[].conversion_task",
        "image_set[].shot_direction",
        "image_set[].copy_intent",
        "image_set[].qa_acceptance_criteria",
      ],
    },
    pass_criteria: [
      "At least one click hook pattern is tied to the product identity and platform.",
      "At least one dwell-time mechanism is assigned to the gallery sequence.",
      "Trust/objection handling is backed by product truth, not invented claims.",
      "Patterns are borrowed as principles, not copied as assets or exact layouts.",
      "The final shot matrix has role diversity across hero, proof, detail, scale, scene, and summary.",
    ],
  };
}

function buildQueries(ctx) {
  const base = [ctx.platform, ctx.category].filter(Boolean).join(" ");
  const locale = ctx.locale ? ` ${ctx.locale}` : "";
  return [
    `${base} bestseller product images design patterns${locale}`.trim(),
    `${base} marketplace gallery images conversion trust detail scene${locale}`.trim(),
    `${base} top selling listing images buyer objections copy${locale}`.trim(),
    `${base} thumbnail click hook product image examples${locale}`.trim(),
    `${base} product detail images dwell time ecommerce${locale}`.trim(),
  ];
}

function toMarkdown(plan) {
  return [
    "# Commerce Design Research Plan",
    "",
    `- Status: ${plan.status}`,
    `- Platform: ${plan.platform}`,
    `- Category: ${plan.category}`,
    `- Locale: ${plan.locale || ""}`,
    `- Goal: ${plan.goal}`,
    `- Required references: ${plan.research_budget.required_reference_count}`,
    "",
    "## Query Plan",
    ...plan.query_plan.map((query) => `- ${query}`),
    "",
    "## Extract",
    "- First-second click hook",
    "- Dwell-time mechanism",
    "- Trust cue and objection handler",
    "- Platform-native copy rhythm",
    "- Product truth boundary",
    "- Pattern to borrow as principle",
    "- Pattern not to copy",
    "",
    "## Pass Criteria",
    ...plan.pass_criteria.map((item) => `- ${item}`),
    "",
  ].join("\n");
}
