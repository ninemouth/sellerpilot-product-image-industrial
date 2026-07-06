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
node scripts/parse-canvas-annotations.mjs --annotations /abs/annotations.json --out /abs/generation-tasks.json [--run-dir /abs/run]

Converts tldraw review annotations into SellerPilot generation/revision tasks.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.annotations || !args.out) usage();

const annotationsPath = path.resolve(args.annotations);
const outPath = path.resolve(args.out);
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
const input = JSON.parse(fs.readFileSync(annotationsPath, "utf8"));
const annotations = Array.isArray(input.annotations) ? input.annotations : [];

const tasks = annotations
  .filter((annotation) => String(annotation.status || "open") !== "closed")
  .map((annotation, index) => {
    const issue = normalizeIssue(annotation.issue_type);
    const region = String(annotation.region || "H-overall-style");
    const imageId = annotation.image_id || annotation.image_index || imageIndexFromFile(annotation.image_file || annotation.file);
    return {
      task_id: `TASK-${String(index + 1).padStart(3, "0")}`,
      status: "open",
      priority: annotation.priority || "P1",
      image_id: imageId,
      image_file: annotation.image_file || annotation.file || "",
      image_path: annotation.image_path || annotation.path || "",
      region,
      issue_type: issue,
      return_node: returnNode(issue, region),
      action: actionForIssue(issue, region),
      user_feedback: annotation.comment || annotation.note || annotation.text || "",
      source_annotation_id: annotation.id || null,
      rerun_scope: rerunScope(issue),
      created_at: new Date().toISOString(),
    };
  });

const grouped = {
  regenerate_assets: tasks.filter((task) => task.rerun_scope === "regenerate_asset"),
  rerender_layout: tasks.filter((task) => task.rerun_scope === "rerender_layout"),
  copy_rewrite: tasks.filter((task) => task.rerun_scope === "copy_rewrite"),
  keep_only: tasks.filter((task) => task.rerun_scope === "keep_only"),
};

const output = {
  schema_version: "sellerpilot.generation_tasks.v1",
  created_at: new Date().toISOString(),
  run_dir: runDir,
  source_annotations: annotationsPath,
  task_count: tasks.length,
  tasks,
  grouped_summary: {
    regenerate_assets: grouped.regenerate_assets.length,
    rerender_layout: grouped.rerender_layout.length,
    copy_rewrite: grouped.copy_rewrite.length,
    keep_only: grouped.keep_only.length,
  },
  next_codex_step: tasks.length
    ? "Feed these tasks into qa-loop-router / failed-output-regeneration and revise only affected assets."
    : "No open annotation tasks found.",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ status: "ok", tasks: tasks.length, out: outPath }, null, 2));

function normalizeIssue(value) {
  const text = String(value || "modify").toLowerCase().replace(/_/g, "-");
  if (/keep|ok|pass/.test(text)) return "keep";
  if (/regen|重出|重生|scene-asset/.test(text)) return "regenerate";
  if (/layout|排版|rerender/.test(text)) return "rerender-layout";
  if (/copy|文案|text/.test(text)) return "copy-adjust";
  if (/identity|不像|漂移/.test(text)) return "identity-drift";
  return text || "modify";
}

function returnNode(issue, region) {
  if (issue === "keep") return "approved-assets";
  if (issue === "copy-adjust" || /C-main-title|D-subtitle|E-selling-point/.test(region)) return "localized-copy-pack";
  if (issue === "rerender-layout" || /layout|title|subtitle|label/.test(region)) return "layout-wireframes";
  if (issue === "identity-drift" || /A-product-subject/.test(region)) return "product-identity-lock";
  if (issue === "regenerate" || /G-people-scene/.test(region)) return "scene-asset-production";
  return "failed-output-regeneration";
}

function actionForIssue(issue, region) {
  if (issue === "keep") return "Lock this asset; do not rerun unless a dependent global change requires it.";
  if (issue === "copy-adjust") return "Rewrite buyer-facing copy and rerender layout only.";
  if (issue === "rerender-layout") return "Adjust composition, spacing, hierarchy, and readable regions; do not regenerate product asset.";
  if (issue === "identity-drift") return "Tighten identity lock and regenerate only affected image with source reference.";
  if (issue === "regenerate" && /G-people-scene/.test(region)) return "Generate true scene asset first, then rerender final layout.";
  if (issue === "regenerate") return "Regenerate only the affected asset with revised prompt layer.";
  return "Revise the smallest responsible upstream artifact, then rerun downstream gates.";
}

function rerunScope(issue) {
  if (issue === "keep") return "keep_only";
  if (issue === "copy-adjust") return "copy_rewrite";
  if (issue === "rerender-layout") return "rerender_layout";
  if (issue === "identity-drift" || issue === "regenerate") return "regenerate_asset";
  return "rerender_layout";
}

function imageIndexFromFile(file) {
  const match = String(file || "").match(/(?:IMG|POSTER|DETAIL)-(\d{2})/i);
  return match ? `IMG-${match[1]}` : "";
}
