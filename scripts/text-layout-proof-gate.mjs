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
node scripts/text-layout-proof-gate.mjs --copy-json /abs/panels.json --out-dir /abs/run/qa

Checks buyer-facing text before expensive final generation/raster export. Panels
may provide text_layout_boxes or text_layout_proof.status=pass when a low-cost
layout proof screenshot/canvas review already confirmed fit.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["copy-json"] || !args["out-dir"]) usage();

const copyJson = path.resolve(args["copy-json"]);
const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const panels = JSON.parse(fs.readFileSync(copyJson, "utf8"));
if (!Array.isArray(panels)) throw new Error("copy-json must be a JSON array");

const findings = [];
panels.forEach((panel, index) => {
  const proofStatus = normalize(firstValue(panel, [
    "text_layout_proof.status",
    "layout_proof.status",
    "copy_layout_proof.status",
  ]));
  const proofPassed = ["pass", "passed", "approved", "not_required"].includes(proofStatus);
  const boxes = normalizeBoxes(panel);
  const textFields = visibleTextFields(panel);

  if (!textFields.length) return;

  for (const field of textFields) {
    const box = boxes[field.name] || defaultBox(field.name);
    const result = estimateFit(field.text, box);
    if (!result.fits) {
      findings.push({
        severity: "fail",
        type: "text-layout-overflow-risk",
        image_index: index + 1,
        field: field.name,
        message: `${field.name} is likely to overflow: ${result.reason}`,
      });
    } else if (result.tight && !proofPassed) {
      findings.push({
        severity: "warn",
        type: "text-layout-tight-needs-proof",
        image_index: index + 1,
        field: field.name,
        message: `${field.name} is close to its estimated fit limit. Create/review a low-cost text layout proof before final raster export.`,
      });
    }
  }

  const longVisibleCopy = textFields.some((field) => weightedLength(field.text) > longCopyThreshold(field.name));
  if (longVisibleCopy && !proofPassed) {
    findings.push({
      severity: "fail",
      type: "missing-text-layout-proof",
      image_index: index + 1,
      message: "Panel has long visible copy but no text_layout_proof.status=pass/not_required. Generate a low-cost layout proof or shorten/wrap the copy before final output.",
    });
  }
});

const status = findings.some((item) => item.severity === "fail")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  schema_version: "sellerpilot.text_layout_proof_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  panel_count: panels.length,
  findings,
};

fs.writeFileSync(path.join(outDir, "text-layout-proof-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "text-layout-proof-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function visibleTextFields(panel) {
  return [
    ["title", panel.title],
    ["subtitle", panel.sub || panel.subtitle],
    ["tag", panel.tag],
    ["main_message", panel.main_message || panel.buyer_facing_message],
    ["secondary_message", panel.secondary_message],
    ["footer", panel.footer_label || panel.final_visible_text],
    ["badge", panel.badge || panel.badges],
    ["overlay", panel.overlay_text || panel.visible_overlay],
  ]
    .map(([name, value]) => ({ name, text: textify(value).trim() }))
    .filter((item) => item.text);
}

function normalizeBoxes(panel) {
  const raw = panel.text_layout_boxes || panel.layout_text_boxes || panel.copy_layout_boxes || {};
  const boxes = {};
  for (const [key, value] of Object.entries(raw || {})) {
    boxes[key] = {
      width: Number(value.width || value.w || 0) || defaultBox(key).width,
      height: Number(value.height || value.h || 0) || defaultBox(key).height,
      font_size: Number(value.font_size || value.fontSize || 0) || defaultBox(key).font_size,
      max_lines: Number(value.max_lines || value.maxLines || 0) || defaultBox(key).max_lines,
    };
  }
  return boxes;
}

function defaultBox(name) {
  const defaults = {
    title: { width: 930, height: 130, font_size: 58, max_lines: 2 },
    subtitle: { width: 930, height: 82, font_size: 34, max_lines: 2 },
    tag: { width: 950, height: 120, font_size: 34, max_lines: 2 },
    main_message: { width: 880, height: 120, font_size: 38, max_lines: 2 },
    secondary_message: { width: 880, height: 100, font_size: 30, max_lines: 2 },
    footer: { width: 960, height: 140, font_size: 36, max_lines: 2 },
    badge: { width: 260, height: 70, font_size: 24, max_lines: 1 },
    overlay: { width: 760, height: 140, font_size: 30, max_lines: 3 },
  };
  return defaults[name] || { width: 800, height: 100, font_size: 30, max_lines: 2 };
}

function estimateFit(text, box) {
  const averageGlyph = averageGlyphWidth(text) * box.font_size;
  const charsPerLine = Math.max(1, Math.floor(box.width / averageGlyph));
  const estimatedLines = Math.ceil(weightedLength(text) / charsPerLine);
  const lineHeight = box.font_size * 1.2;
  const maxLinesByHeight = Math.max(1, Math.floor(box.height / lineHeight));
  const allowedLines = Math.min(box.max_lines || maxLinesByHeight, maxLinesByHeight);
  const fits = estimatedLines <= allowedLines;
  const tight = fits && estimatedLines >= allowedLines && weightedLength(text) > charsPerLine * allowedLines * 0.82;
  return {
    fits,
    tight,
    reason: `estimated ${estimatedLines} lines, allowed ${allowedLines}, approx ${charsPerLine} weighted chars/line`,
  };
}

function averageGlyphWidth(text) {
  if (/[\u4e00-\u9fff]/.test(text)) return 1.0;
  if (/[\u0600-\u06ff]/.test(text)) return 0.66;
  if (/[\u0400-\u04ff]/.test(text)) return 0.62;
  return 0.56;
}

function weightedLength(text) {
  return Array.from(String(text || "")).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.35;
    if (/[\u4e00-\u9fff]/.test(char)) return sum + 1.8;
    if (/[\u0600-\u06ff]/.test(char)) return sum + 1.1;
    if (/[\u0400-\u04ff]/.test(char)) return sum + 1.05;
    if (/[A-Z0-9]/.test(char)) return sum + 1.05;
    return sum + 1;
  }, 0);
}

function longCopyThreshold(name) {
  const map = {
    title: 34,
    subtitle: 42,
    tag: 42,
    main_message: 42,
    secondary_message: 48,
    footer: 44,
    badge: 16,
    overlay: 58,
  };
  return map[name] || 44;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = getPath(object, key);
    if (value !== undefined && value !== null && String(textify(value)).trim()) return value;
  }
  return "";
}

function getPath(object, key) {
  return String(key).split(".").reduce((current, part) => {
    if (current && Object.prototype.hasOwnProperty.call(current, part)) return current[part];
    return undefined;
  }, object);
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
    "# Text Layout Proof Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Panel count: ${report.panel_count}`,
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const image = finding.image_index ? `IMG-${String(finding.image_index).padStart(2, "0")} ` : "";
    const field = finding.field ? ` (${finding.field})` : "";
    lines.push(`- [${finding.severity}] ${image}${finding.type}${field}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
