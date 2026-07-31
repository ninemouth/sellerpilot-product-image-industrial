#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv);
if (args.help || !args["run-dir"]) usage();

const runDir = path.resolve(args["run-dir"]);
const outDir = args["out-dir"] ? path.resolve(args["out-dir"]) : path.join(runDir, "qa");
const manifestPath = args.manifest ? path.resolve(args.manifest) : path.join(runDir, "export", "final-images-manifest.json");
const manifest = readJson(manifestPath);
const images = Array.isArray(manifest?.images) ? manifest.images : [];
const nativeImages = images.filter((image) => isNativeClaim(image.lineage));
const evidenceRecords = collectEvidence(path.join(runDir, "generated-assets"));
const ledger = readJsonLines(path.join(runDir, "telemetry", "cost-ledger.jsonl"));
const findings = [];
const reviews = nativeImages.map((image) => reviewImage(image));
for (const review of reviews) findings.push(...review.findings);

const status = !manifest
  ? "not_required"
  : !nativeImages.length
    ? "not_required"
    : findings.some((item) => item.severity === "fail") ? "fail" : "pass";
const report = {
  schema_version: "sellerpilot.native_imagegen_ledger_gate.v1",
  status,
  checked_at: new Date().toISOString(),
  run_dir: runDir,
  manifest: fs.existsSync(manifestPath) ? manifestPath : null,
  native_claimed_image_count: nativeImages.length,
  evidence_record_count: evidenceRecords.length,
  reviews,
  findings,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "native-imagegen-ledger-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "native-imagegen-ledger-gate-report.md"), toMarkdown(report));
console.log(JSON.stringify({ status, native_claimed_image_count: nativeImages.length, findings: findings.length, out_dir: outDir }, null, 2));
if (status === "fail") process.exitCode = 1;

function reviewImage(image) {
  const lineage = image.lineage || {};
  const role = normalizeRole(image.id || image.file || image.path || "");
  const refs = referencePaths(lineage);
  const matchingEvidence = evidenceRecords.filter((record) => role && record.role === role);
  const evidence = matchingEvidence.find((record) => refs.has(record.image_path)) || matchingEvidence[0] || null;
  const findings = [];
  if (!role) findings.push(fail(image, "native-imagegen-role-unresolved", "Native provider lineage needs an IMG-xx role identifier in image id or filename."));
  if (!evidence) findings.push(fail(image, "missing-native-imagegen-evidence", "Native provider lineage has no matching generated-assets/native-imagegen-IMG-xx.json evidence record."));
  if (evidence?.status !== "succeeded" || !evidence?.image_sha256 || !evidence.native_execution_evidence || !evidence.handoff_id || !evidence.handoff_path) {
    findings.push(fail(image, "invalid-native-imagegen-evidence", "Native imagegen evidence must record a succeeded output hash, host execution evidence identifier, and validated dispatch handoff."));
  }
  if (evidence && refs.size && !refs.has(evidence.image_path)) {
    findings.push(fail(image, "native-imagegen-lineage-source-mismatch", "Native final lineage does not point to the source image recorded by its native imagegen evidence."));
  }
  const ledgerMatch = evidence && ledger.some((event) => event.event === "provider_call" && event.status === "succeeded" && event.provider === "native_codex" && event.model === "imagegen" && event.role === evidence.role);
  if (evidence && !ledgerMatch) findings.push(fail(image, "missing-native-imagegen-ledger-event", "Native imagegen evidence has no matching successful shared cost-ledger event."));
  return { file: image.file || image.path || null, role, evidence: evidence?.file || null, status: findings.length ? "fail" : "pass", findings };
}

function isNativeClaim(lineage) {
  const value = `${lineage?.provider || ""} ${lineage?.provider_mode || ""} ${lineage?.execution_provider || ""}`.toLowerCase();
  return /native[_ -]?codex|image_gen|imagegen/.test(value);
}
function referencePaths(lineage) {
  const refs = [lineage?.generated_asset_path, lineage?.approved_source_path, lineage?.derived_from, lineage?.source_asset_path]
    .filter(Boolean)
    .map((value) => path.normalize(path.isAbsolute(value) ? path.relative(runDir, value) : value));
  return new Set(refs);
}
function collectEvidence(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^native-imagegen-img-\d{2}\.json$/i.test(name))
    .sort()
    .flatMap((name) => {
      const value = readJson(path.join(dir, name));
      if (!value) return [];
      return [{ ...value, file: path.relative(runDir, path.join(dir, name)), image_path: value.image_path ? path.normalize(value.image_path) : null }];
    });
}
function fail(image, type, message) { return { severity: "fail", type, file: image.file || image.path || null, message }; }
function normalizeRole(value) { const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i); return match ? `IMG-${match[1].padStart(2, "0")}` : null; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function readJsonLines(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function usage() { console.error("Usage: node scripts/native-imagegen-ledger-gate.mjs --run-dir /abs/run [--manifest /abs/run/export/final-images-manifest.json] [--out-dir /abs/run/qa]"); process.exit(2); }
function toMarkdown(report) { const lines = ["# Native Imagegen Ledger Gate", "", `- Status: ${report.status}`, `- Native-claimed images: ${report.native_claimed_image_count}`, "", "## Findings", ""]; if (!report.findings.length) lines.push("- None"); else for (const finding of report.findings) lines.push(`- [${finding.severity}] ${finding.type}: ${finding.message}`); return `${lines.join("\n")}\n`; }
