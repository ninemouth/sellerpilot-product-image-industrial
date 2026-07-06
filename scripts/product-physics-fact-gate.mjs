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
node scripts/product-physics-fact-gate.mjs \\
  --fact-lock /abs/run/blueprint/02b-product-physical-truth.json \\
  --panels /abs/run/blueprint/panels.json \\
  --out-dir /abs/run/qa [--scale-tolerance 0.22]

Blocks invented product functions, unsupported installation/use steps, and
cross-image product scale drift for physical ecommerce products.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["fact-lock"] || !args.panels || !args["out-dir"]) usage();

const factPath = path.resolve(args["fact-lock"]);
const panelsPath = path.resolve(args.panels);
const outDir = path.resolve(args["out-dir"]);
const scaleTolerance = Number(args["scale-tolerance"] || 0.22);
fs.mkdirSync(outDir, { recursive: true });

const factLock = JSON.parse(fs.readFileSync(factPath, "utf8"));
const panels = JSON.parse(fs.readFileSync(panelsPath, "utf8"));
if (!Array.isArray(panels)) throw new Error("panels must be a JSON array");

const root = factLock.product_physical_truth || factLock;
const confirmedFunctions = list(root.confirmed_functions);
const confirmedActions = list(root.confirmed_user_actions);
const allowedUseContexts = list(root.allowed_use_contexts);
const forbiddenFunctions = list(root.forbidden_generated_functions);
const unsupportedClaims = list(root.unsupported_claims);
const scaleReference = root.scale_reference || {};
const expectedScale = numberOrNull(scaleReference.product_visual_scale_ratio || scaleReference.product_bbox_height_pct || scaleReference.product_area_pct);
const findings = [];

if (root.status && /pending|unknown|not_run/i.test(String(root.status))) {
  findings.push({
    severity: "fail",
    type: "physical-truth-lock-missing",
    message: "Product physical truth lock is still pending; formal generation cannot rely on unsupported function assumptions.",
  });
}

panels.forEach((panel, index) => {
  const panelText = textify([
    panel.title,
    panel.sub,
    panel.tag,
    panel.main_message,
    panel.required_copy,
    panel.buyer_facing_message,
    panel.overlay_text,
    panel.image_role,
    panel.role,
    panel.function_claims,
    panel.installation_steps,
    panel.use_steps,
    panel.product_interaction,
    panel.demonstrated_function,
  ]);
  const explicitClaims = [
    ...list(panel.function_claims),
    ...list(panel.installation_steps),
    ...list(panel.use_steps),
    ...list(panel.demonstrated_function),
  ];
  for (const claim of explicitClaims) {
    if (!isSupportedClaim(claim)) {
      findings.push({
        severity: "fail",
        type: "unsupported-function-claim",
        image_index: index + 1,
        claim,
        message: `Function/use claim is not supported by the product physical truth lock: ${claim}`,
      });
    }
  }
  for (const forbidden of [...forbiddenFunctions, ...unsupportedClaims]) {
    if (forbidden && containsLoose(panelText, forbidden)) {
      findings.push({
        severity: "fail",
        type: "invented-product-function",
        image_index: index + 1,
        claim: forbidden,
        message: `Panel appears to show or claim a forbidden/unsupported product function: ${forbidden}`,
      });
    }
  }
  const riskyFunctionWords = panelText.match(/\b(?:press to hold|lock in place|snap lock|auto clamp|magnetic|adhesive|waterproof|load-bearing|route cable|screw in|drill|no drill|adjustable|extendable)\b/ig) || [];
  for (const word of riskyFunctionWords) {
    if (!isSupportedClaim(word)) {
      findings.push({
        severity: "fail",
        type: "unsupported-physical-action",
        image_index: index + 1,
        claim: word,
        message: `Risky physical action or function "${word}" is not in confirmed functions/actions/use contexts.`,
      });
    }
  }
});

const scaleReadings = panels
  .map((panel, index) => ({
    image_index: index + 1,
    value: numberOrNull(panel.product_visual_scale_ratio || panel.product_bbox_height_pct || panel.product_area_pct || panel.product_scale_ratio),
    role: panel.image_role || panel.role || panel.asset_id || panel.id || "",
  }))
  .filter((item) => Number.isFinite(item.value));

if (scaleReadings.length >= 2) {
  const reference = Number.isFinite(expectedScale)
    ? expectedScale
    : median(scaleReadings.map((item) => item.value));
  for (const item of scaleReadings) {
    const allowed = Math.max(scaleTolerance, Math.abs(reference) * scaleTolerance);
    const delta = Math.abs(item.value - reference);
    if (delta > allowed) {
      findings.push({
        severity: "fail",
        type: "product-scale-drift",
        image_index: item.image_index,
        expected: reference,
        actual: item.value,
        message: `Product visual scale drifted from reference ${reference} to ${item.value}; allowed delta ${allowed.toFixed(3)}.`,
      });
    }
  }
}

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  fact_lock: factPath,
  panels: panelsPath,
  scale_tolerance: scaleTolerance,
  scale_readings: scaleReadings,
  findings,
};

fs.writeFileSync(path.join(outDir, "product-physics-fact-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "product-physics-fact-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function isSupportedClaim(claim) {
  const value = normalize(claim);
  if (!value) return true;
  const supported = [...confirmedFunctions, ...confirmedActions, ...allowedUseContexts]
    .map(normalize)
    .filter(Boolean);
  return supported.some((item) => item === value || item.includes(value) || value.includes(item));
}

function list(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(list);
  if (typeof value === "object") return Object.values(value).flatMap(list);
  return [String(value)].map((item) => item.trim()).filter(Boolean);
}

function textify(value) {
  return list(value).join(" ");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function containsLoose(haystack, needle) {
  const source = normalize(haystack);
  const target = normalize(needle);
  if (!target) return false;
  if (source.includes(target)) return true;
  const compactSource = source.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  const compactTarget = target.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  return compactTarget.length > 2 && compactSource.includes(compactTarget);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function toMarkdown(report) {
  const lines = [
    "# Product Physics Fact Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Scale tolerance: ${report.scale_tolerance}`,
    "",
    "## Scale Readings",
    "",
    ...(report.scale_readings.length
      ? report.scale_readings.map((item) => `- image ${item.image_index}: ${item.value} (${item.role || "role unknown"})`)
      : ["- None"]),
    "",
    "## Findings",
    "",
    ...(report.findings.length
      ? report.findings.map((item) => {
        const image = item.image_index ? `image ${item.image_index}, ` : "";
        return `- [${item.severity}] ${item.type}: ${image}${item.message}`;
      })
      : ["- None"]),
    "",
  ];
  return lines.join("\n");
}
