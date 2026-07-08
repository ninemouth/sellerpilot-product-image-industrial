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
node scripts/final-delivery-gate.mjs --run-dir /abs/run [--out-dir /abs/run/qa] [--allow-missing-gates]

Aggregates QA gate reports and blocks final delivery when any upstream gate
failed, scene generation is blocked, or draft assets are present in final-images.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const qaDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const finalImageDir = path.join(runDir, "final-images");
const overviewReportPath = path.join(runDir, "overview", "delivery-overview-report.json");
const sourceUnderstandingPath = path.join(runDir, "source-understanding", "source-product-understanding.json");
fs.mkdirSync(qaDir, { recursive: true });

const reports = loadGateReports(qaDir);
const findings = [];
const allowMissingGates = Boolean(args["allow-missing-gates"]);
const runLocale = inferRunLocale(runDir);

if (!allowMissingGates) {
  if (!reports.length) {
    findings.push({
      severity: "fail",
      type: "missing-gate-reports",
      gate_id: "final-delivery-gate",
      message: "No qa/*-report.json files were found. Final delivery requires upstream gate evidence.",
    });
  }
  for (const requiredName of ["marketing-quality-gate-report.json", "copy-strategy-gate-report.json", "image-set-export-gate-report.json"]) {
    if (!reports.some((item) => item.name === requiredName)) {
      findings.push({
        severity: "fail",
        type: "missing-required-gate-report",
        gate_id: "final-delivery-gate",
        source_report: requiredName,
        message: `${requiredName} is required before final ecommerce image delivery can pass.`,
      });
    }
  }
  if (requiresLocalizedCopyQa(runLocale) && !reports.some((item) => item.name === "localized-copy-qa-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "localized-copy-qa-report.json",
      message: `localized-copy-qa-report.json is required before final delivery for locale ${runLocale}.`,
    });
  } else if (requiresLocalizedCopyQa(runLocale)) {
    const localizedReport = reports.find((item) => item.name === "localized-copy-qa-report.json")?.report || null;
    const localizedStatus = normalizeStatus(localizedReport?.status);
    if (!["pass", "pass_with_warnings"].includes(localizedStatus)) {
      findings.push({
        severity: "fail",
        type: "localized-copy-qa-not-passed",
        gate_id: "final-delivery-gate",
        source_report: "localized-copy-qa-report.json",
        message: `localized-copy-qa-report.json must pass before final delivery for locale ${runLocale}; current status is ${localizedReport?.status || "unknown"}.`,
      });
    }
  }
}

const sourceGeometryPath = path.join(runDir, "geometry", "source-geometry.json");
if (fs.existsSync(sourceGeometryPath) && requiresGeometryGate(sourceGeometryPath)) {
  if (!reports.some((item) => item.name === "identity-geometry-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "identity-geometry-gate-report.json",
      message: "identity-geometry-gate-report.json is required for apparel or proportion-sensitive products before final delivery can pass.",
    });
  }
}

const physicalTruthPath = path.join(runDir, "blueprint", "02b-product-physical-truth.json");
if (fs.existsSync(physicalTruthPath) && requiresPhysicalTruthGate(physicalTruthPath)) {
  if (!reports.some((item) => item.name === "product-physics-fact-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "product-physics-fact-gate-report.json",
      message: "product-physics-fact-gate-report.json is required when physical function/use/scale truth is locked before final delivery can pass.",
    });
  }
}

if (fs.existsSync(sourceUnderstandingPath) && requiresSourceUnderstandingGate(sourceUnderstandingPath)) {
  if (!reports.some((item) => item.name === "source-product-understanding-gate-report.json")) {
    findings.push({
      severity: "fail",
      type: "missing-required-gate-report",
      gate_id: "final-delivery-gate",
      source_report: "source-product-understanding-gate-report.json",
      message: "source-product-understanding-gate-report.json is required when source image recognition, OCR text, dimensions, labels, or product facts are present.",
    });
  }
}

for (const item of reports) {
  const status = normalizeStatus(item.report.status);
  if (["fail", "blocked", "needs_visual_review"].includes(status)) {
    findings.push({
      severity: status === "needs_visual_review" ? "warn" : "fail",
      type: "upstream-gate-not-passed",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported status ${item.report.status}. Final delivery cannot be marked passed while upstream gates are unresolved.`,
    });
  } else if (status === "warn") {
    findings.push({
      severity: "warn",
      type: "upstream-gate-warning",
      gate_id: item.gate_id,
      source_report: item.name,
      message: `${item.gate_id} reported warnings. Review before publishing.`,
    });
  }

  for (const raw of Array.isArray(item.report.findings) ? item.report.findings : []) {
    const severity = normalizeSeverity(raw.severity);
    if (["fail", "critical"].includes(severity)) {
      findings.push({
        severity: "fail",
        type: normalizeType(raw.type || "upstream-finding"),
        gate_id: item.gate_id,
        source_report: item.name,
        image_index: raw.image_index || raw.index || null,
        file: raw.file || null,
        message: raw.message || `${item.gate_id} has unresolved fail finding.`,
      });
    }
  }
}

const requestPackPath = [
  path.join(runDir, "prompt-pack", "10-generation-request-pack.yaml"),
].find((file) => fs.existsSync(file));
if (requestPackPath) {
  const requestPack = fs.readFileSync(requestPackPath, "utf8");
  if (/generation_status:\s*blocked_runtime_unavailable/i.test(requestPack)) {
    findings.push({
      severity: "fail",
      type: "blocked-runtime-unavailable",
      gate_id: "final-delivery-gate",
      source_report: path.relative(runDir, requestPackPath),
      message: "Request pack is blocked because the runtime cannot execute GPT built-in image generation with source image references.",
    });
  }
}

if (fs.existsSync(finalImageDir)) {
  const finalImageNames = fs.readdirSync(finalImageDir).filter((item) => /\.(png|jpe?g|webp)$/i.test(item));
  for (const name of finalImageNames) {
    if (/\b(?:layout-)?draft\b|placeholder|wireframe|blocked/i.test(name)) {
      findings.push({
        severity: "fail",
        type: "draft-exported-as-final",
        gate_id: "final-delivery-gate",
        file: path.join(finalImageDir, name),
        message: `Draft, placeholder, wireframe, or blocked asset is present in final-images: ${name}.`,
      });
    }
  }
  const exportReport = reports.find((item) => item.name === "image-set-export-gate-report.json")?.report || null;
  const manifestPath = exportReport?.image_manifest ? path.resolve(exportReport.image_manifest) : "";
  if (finalImageNames.length > 1 && !manifestPath) {
    findings.push({
      severity: "fail",
      type: "missing-final-images-manifest",
      gate_id: "final-delivery-gate",
      source_report: "image-set-export-gate-report.json",
      message: "Multi-image delivery requires image-set-export-gate-report.json to point at export/final-images-manifest.json so images are scoped to one run.",
    });
  }
  if (manifestPath) {
    validateFinalImagesManifest({ manifestPath, runDir, finalImageDir, finalImageNames, findings });
  }
  if (finalImageNames.length > 1 && !args["allow-missing-overview"]) {
    if (!fs.existsSync(overviewReportPath)) {
      findings.push({
        severity: "fail",
        type: "missing-delivery-overview",
        gate_id: "final-delivery-gate",
        source_report: "overview/delivery-overview-report.json",
        message: "Multi-image sets must include overview/SET-OVERVIEW-contact-sheet.png plus delivery-overview-report.json for package review.",
      });
    } else {
      try {
        const overview = JSON.parse(fs.readFileSync(overviewReportPath, "utf8"));
        if (!overview.overview_image || !fs.existsSync(overview.overview_image)) {
          findings.push({
            severity: "fail",
            type: "missing-delivery-overview-image",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: "Delivery overview report exists but overview_image is missing on disk.",
          });
        }
        if (Number(overview.image_count || 0) !== finalImageNames.length) {
          findings.push({
            severity: "fail",
            type: "stale-delivery-overview",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview covers ${overview.image_count || 0} images, but final-images contains ${finalImageNames.length}. Regenerate the overview.`,
          });
        }
        const exportReport = reports.find((item) => item.name === "image-set-export-gate-report.json")?.report || null;
        if (exportReport?.image_manifest && !overview.image_manifest) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-missing-manifest",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: "Delivery overview must be created from the current run final-images manifest, not from an unscoped directory scan.",
          });
        }
        if (exportReport?.image_manifest && overview.image_manifest && path.resolve(exportReport.image_manifest) !== path.resolve(overview.image_manifest)) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-manifest-mismatch",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview used ${overview.image_manifest}, but export gate used ${exportReport.image_manifest}. Regenerate the overview from the current run manifest.`,
          });
        }
        if (exportReport?.run_id && overview.run_id && exportReport.run_id !== overview.run_id) {
          findings.push({
            severity: "fail",
            type: "delivery-overview-run-mismatch",
            gate_id: "final-delivery-gate",
            source_report: "overview/delivery-overview-report.json",
            message: `Delivery overview run_id ${overview.run_id} does not match export gate run_id ${exportReport.run_id}.`,
          });
        }
      } catch (error) {
        findings.push({
          severity: "fail",
          type: "unreadable-delivery-overview-report",
          gate_id: "final-delivery-gate",
          source_report: "overview/delivery-overview-report.json",
          message: error.message,
        });
      }
    }
  }
}

const qaLoopPath = path.join(qaDir, "qa-loop-routing-decision.json");
if (fs.existsSync(qaLoopPath)) {
  try {
    const routing = JSON.parse(fs.readFileSync(qaLoopPath, "utf8"));
    const decision = routing.loop_decision || {};
    if (decision.status && decision.status !== "continue") {
      const qaLoopMtime = fs.statSync(qaLoopPath).mtimeMs;
      const newerReports = reports
        .filter((item) => {
          try {
            return fs.statSync(item.file).mtimeMs > qaLoopMtime + 1;
          } catch {
            return false;
          }
        })
        .map((item) => item.name);
      const currentFailingReports = reports
        .filter((item) => ["fail", "blocked", "needs_visual_review"].includes(normalizeStatus(item.report.status)))
        .map((item) => item.name);
      if (newerReports.length && !currentFailingReports.length) {
        findings.push({
          severity: "fail",
          type: "stale-qa-loop-routing-decision",
          gate_id: "qa-loop-router",
          source_report: "qa-loop-routing-decision.json",
          message: `QA loop decision is ${decision.status}, but upstream gate reports were updated after it (${newerReports.join(", ")}). Rerun qa-loop-router once so it can close to continue before final delivery.`,
        });
      } else {
        findings.push({
          severity: "fail",
          type: "qa-loop-not-closed",
          gate_id: "qa-loop-router",
          source_report: "qa-loop-routing-decision.json",
          message: `QA loop decision is ${decision.status}; return node ${decision.return_node || "unknown"} must be resolved before final delivery.`,
        });
      }
    }
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-qa-loop-routing-decision",
      gate_id: "final-delivery-gate",
      source_report: "qa-loop-routing-decision.json",
      message: error.message,
    });
  }
}

const status = findings.some((item) => item.severity === "fail" || item.severity === "critical")
  ? "fail"
  : findings.some((item) => item.severity === "warn")
    ? "pass_with_warnings"
    : "pass";

const report = {
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  reports_seen: reports.map((item) => item.name),
  findings,
};

fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, findings: findings.length, outDir: qaDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function loadGateReports(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /-report\.json$/.test(name))
    .filter((name) => name !== "final-delivery-gate-report.json")
    .map((name) => {
      const file = path.join(dir, name);
      try {
        const report = JSON.parse(fs.readFileSync(file, "utf8"));
        return { file, name, gate_id: gateIdFromName(name), report };
      } catch (error) {
        return {
          file,
          name,
          gate_id: gateIdFromName(name),
          report: {
            status: "fail",
            findings: [{
              severity: "fail",
              type: "unreadable-gate-report",
              message: error.message,
            }],
          },
        };
      }
    });
}

function validateFinalImagesManifest({ manifestPath, runDir, finalImageDir, finalImageNames, findings }) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.run_dir && path.resolve(manifest.run_dir) !== runDir) {
      findings.push({
        severity: "fail",
        type: "final-images-manifest-run-mismatch",
        gate_id: "final-delivery-gate",
        source_report: path.relative(runDir, manifestPath),
        message: `Final image manifest belongs to ${manifest.run_dir}, not ${runDir}.`,
      });
    }
    const manifestNames = new Set((manifest.images || []).map((item) => path.basename(item.path || item.file || "")));
    for (const name of finalImageNames) {
      if (!manifestNames.has(name)) {
        findings.push({
          severity: "fail",
          type: "unmanifested-final-image",
          gate_id: "final-delivery-gate",
          source_report: path.relative(runDir, manifestPath),
          file: path.join(finalImageDir, name),
          message: `${name} is present in final-images but not in the run-scoped final-images manifest.`,
        });
      }
    }
    for (const item of manifest.images || []) {
      const file = path.resolve(item.path || path.join(manifest.image_dir || finalImageDir, item.file || ""));
      if (!file.startsWith(`${path.resolve(finalImageDir)}${path.sep}`)) {
        findings.push({
          severity: "fail",
          type: "manifest-image-outside-final-dir",
          gate_id: "final-delivery-gate",
          source_report: path.relative(runDir, manifestPath),
          file,
          message: "Final image manifest points outside this run's final-images directory.",
        });
      }
    }
  } catch (error) {
    findings.push({
      severity: "fail",
      type: "unreadable-final-images-manifest",
      gate_id: "final-delivery-gate",
      source_report: path.relative(runDir, manifestPath),
      message: error.message,
    });
  }
}

function requiresGeometryGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const text = JSON.stringify(parsed).toLowerCase();
    if (/"status"\s*:\s*"pending_annotation"/.test(JSON.stringify(parsed))) return false;
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(apparel|clothing|shirt|jersey|dress|pants|shoe|bag|服装|衣|球衣|裙|裤|鞋|包|版型|下摆|袖)/i.test(text);
  }
}

function requiresPhysicalTruthGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const root = parsed.product_physical_truth || parsed;
    if (/pending|unknown|not_run/i.test(String(root.status || ""))) return false;
    const text = JSON.stringify(root).toLowerCase();
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(function|install|screw|route|cable|clip|clamp|hold|press|lock|scale|dimension|mount|adhesive|magnet|waterproof|load-bearing|功能|安装|螺丝|固定|走线|线缆|夹|按压|尺寸|比例|承重|防水)/i.test(text);
  }
}

function inferRunLocale(runDir) {
  const taskContextPath = path.join(runDir, "00-task-context.yaml");
  const fromTaskContext = extractYamlScalar(taskContextPath, "locale");
  if (fromTaskContext) return fromTaskContext;
  const contextPlanPath = path.join(runDir, "research", "platform-context-plan.json");
  if (fs.existsSync(contextPlanPath)) {
    try {
      const plan = JSON.parse(fs.readFileSync(contextPlanPath, "utf8"));
      return String(plan?.platform_category_profile_overlay?.locale || plan?.locale || "").trim();
    } catch {
      return "";
    }
  }
  return "";
}

function requiresLocalizedCopyQa(locale) {
  const normalized = String(locale || "").trim().toLowerCase();
  if (!normalized) return false;
  return !/^(zh|zh-|en|en-)/.test(normalized);
}

function extractYamlScalar(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^${escapeRegex(key)}:\\s*(.*?)\\s*$`));
    if (!match) continue;
    const value = String(match[1] || "").replace(/^["']|["']$/g, "").trim();
    if (value) return value;
  }
  return "";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiresSourceUnderstandingGate(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const text = JSON.stringify(parsed).toLowerCase();
    if (!parsed.source_image && !parsed.vision_ocr_pass?.raw_text && !parsed.text_understanding?.visible_text_items?.length) return false;
    return /(source|ocr|visible_text|dimension|length|width|height|diameter|label|warning|model|install|function|material|weight|尺寸|文字|标签|型号|安装|功能|材质|重量)/i.test(text);
  } catch {
    const text = fs.readFileSync(filePath, "utf8");
    return /(source_image|ocr|visible_text|dimension|length|width|height|diameter|label|warning|model|install|function|material|weight|尺寸|文字|标签|型号|安装|功能|材质|重量)/i.test(text);
  }
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (["pass", "ready", "ok", "continue"].includes(value)) return "pass";
  if (["pass_with_warnings", "ready_with_warnings", "warn"].includes(value)) return "warn";
  if (["fail", "failed"].includes(value)) return "fail";
  if (["blocked"].includes(value)) return "blocked";
  if (["needs_visual_review"].includes(value)) return "needs_visual_review";
  return value || "unknown";
}

function normalizeSeverity(severity) {
  const value = String(severity || "").toLowerCase();
  if (value === "error") return "fail";
  if (["critical", "fail", "warn", "info"].includes(value)) return value;
  return "warn";
}

function normalizeType(type) {
  return String(type || "unknown").trim().toLowerCase().replace(/_/g, "-");
}

function gateIdFromName(name) {
  return name.replace(/-report\.json$/, "").replace(/\.json$/, "");
}

function toMarkdown(report) {
  const lines = [
    "# Final Delivery Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Checked at: ${report.checked_at}`,
    `- Run dir: ${report.run_dir}`,
    "",
    "## Reports Seen",
    "",
    ...(report.reports_seen.length ? report.reports_seen.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Findings",
    "",
  ];
  if (!report.findings.length) lines.push("- None");
  for (const finding of report.findings) {
    const image = finding.image_index ? ` image ${finding.image_index}` : "";
    const file = finding.file ? ` (${path.basename(finding.file)})` : "";
    lines.push(`- [${finding.severity}] ${finding.gate_id}/${finding.type}${image}${file}: ${finding.message}`);
  }
  lines.push("");
  return lines.join("\n");
}
