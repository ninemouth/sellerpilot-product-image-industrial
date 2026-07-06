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
node scripts/prompt-readiness-gate.mjs --run-dir /abs/run

Checks whether a run is ready to deliver final personalized generation prompts.
The gate validates goal, strategy, creative direction, photography treatment,
layout sketches, and prompt personalization markers.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = path.join(runDir, "qa");
fs.mkdirSync(outDir, { recursive: true });

const requiredFiles = [
  ["goal-contract", "01-goal-contract.yaml"],
  ["commerce-strategy", "blueprint/05-commerce-strategy-brief.yaml"],
  ["creative-direction", "blueprint/06-creative-direction-brief.yaml"],
  ["photography-treatment", "blueprint/08-photography-treatment.yaml"],
  ["layout-wireframes", "layout-drafts/09-layout-wireframes.yaml"],
  ["sketch-self-review", "layout-drafts/09-sketch-self-review.md"],
  ["final-generation-prompts", ["prompt-pack/10-final-generation-prompts.md", "prompt-pack/11-final-personalized-prompt-delivery.md"]],
];

const findings = [];

for (const [label, relOrOptions] of requiredFiles) {
  const rel = resolveFirstExistingRel(runDir, relOrOptions);
  const abs = rel ? path.join(runDir, rel) : null;
  if (!abs || !fs.existsSync(abs)) {
    findings.push({
      severity: "fail",
      type: "missing-artifact",
      artifact: label,
      message: `${Array.isArray(relOrOptions) ? relOrOptions.join(" or ") : relOrOptions} is missing.`,
    });
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  if (looksEmpty(text)) {
    findings.push({
      severity: "warn",
      type: "thin-artifact",
      artifact: label,
      message: `${rel} exists but appears mostly empty or still at scaffold state.`,
    });
  }
}

const requestPackRel = resolveFirstExistingRel(runDir, ["prompt-pack/10-generation-request-pack.yaml"]);
const requestPackPath = requestPackRel ? path.join(runDir, requestPackRel) : "";
const requestPack = requestPackPath && fs.existsSync(requestPackPath) ? fs.readFileSync(requestPackPath, "utf8") : "";
if (requestPack) {
  for (const marker of [
    "strategy_locked: true",
    "sketches_reviewed: true",
    "photography_treatment_locked: true",
    "layout_intent_locked: true",
    "prompt_is_personalized: true",
  ]) {
    if (!requestPack.includes(marker)) {
      findings.push({
        severity: "fail",
        type: "prompt-readiness-marker-missing",
        marker,
        message: `Prompt readiness marker is not true: ${marker}`,
      });
    }
  }
}

const finalPromptRel = resolveFirstExistingRel(runDir, ["prompt-pack/10-final-generation-prompts.md", "prompt-pack/11-final-personalized-prompt-delivery.md"]);
const finalPromptPath = finalPromptRel ? path.join(runDir, finalPromptRel) : "";
const finalPrompt = fs.existsSync(finalPromptPath) ? fs.readFileSync(finalPromptPath, "utf8") : "";
if (/requests:\s*\[\]/.test(finalPrompt) || /Status:\s*pending/i.test(finalPrompt)) {
  findings.push({
    severity: "fail",
    type: "final-prompt-not-written",
    message: "Final personalized prompt delivery still has empty requests or pending status.",
  });
}

const status = findings.some((item) => item.severity === "fail")
  ? "blocked"
  : findings.some((item) => item.severity === "warn")
    ? "ready_with_warnings"
    : "ready";

const report = {
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  findings,
};

fs.writeFileSync(path.join(outDir, "prompt-readiness-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "prompt-readiness-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "blocked") process.exitCode = 1;

function looksEmpty(text) {
  const meaningful = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.endsWith(":") && !line.endsWith(": []") && !line.endsWith(": {}"));
  return meaningful.length < 3;
}

function resolveFirstExistingRel(baseDir, relOrOptions) {
  const options = Array.isArray(relOrOptions) ? relOrOptions : [relOrOptions];
  return options.find((rel) => fs.existsSync(path.join(baseDir, rel))) || options[0];
}

function toMarkdown(report) {
  const lines = [
    "# Prompt Readiness Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Run dir: ${report.run_dir}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) {
    lines.push("- None");
  } else {
    for (const item of report.findings) {
      const subject = item.artifact || item.marker || item.type;
      lines.push(`- [${item.severity}] ${item.type}: ${subject} - ${item.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
