#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) { const args = {}; for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (!arg.startsWith("--")) continue; const next = argv[i + 1]; if (!next || next.startsWith("--")) args[arg.slice(2)] = true; else { args[arg.slice(2)] = next; i += 1; } } return args; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
const args = parseArgs(process.argv);
if (!args.lock || !args["out-dir"]) { console.error("Usage: node scripts/surface-material-transfer-gate.mjs --lock /abs/canonical-material-lock.json --transfer-proof /abs/material-transfer-proof.json --out-dir /abs/run/qa [--visual-review /abs/surface-material-visual-review.json]"); process.exit(2); }
const lockPath = path.resolve(args.lock);
const outDir = path.resolve(args["out-dir"]);
const proofPath = args["transfer-proof"] ? path.resolve(args["transfer-proof"]) : "";
const reviewPath = args["visual-review"] ? path.resolve(args["visual-review"]) : path.join(path.dirname(outDir), "qa", "surface-material-visual-review.json");
fs.mkdirSync(outDir, { recursive: true });
const lock = readJson(lockPath);
const proof = proofPath && readJson(proofPath);
const review = readJson(reviewPath);
const findings = [];
const requiredStatuses = ["palette_status", "lightness_status", "color_temperature_status", "gradient_direction_status", "shape_status", "source_contamination_status"];
if (!lock || !Array.isArray(lock.per_material) || !lock.per_material.length) findings.push(fail("missing-canonical-material-lock", "surface-material-extraction", "Canonical material lock with per-material source mappings is required."));
if (!proof) findings.push(fail("missing-material-transfer-proof", "surface-material-transfer", "Material transfer proof is required before final delivery."));
const proofItems = Array.isArray(proof?.transfers) ? proof.transfers : [];
const reviews = Array.isArray(review?.reviews) ? review.reviews : [];
for (const material of lock?.per_material || []) {
  if (!material.source_image || !material.source_gradient_direction || material.source_gradient_direction === "must_be_visually_recorded" || !material.shape_class || material.shape_class === "must_be_visually_recorded") findings.push(fail("incomplete-canonical-material-lock", "surface-material-extraction", `${material.id} lacks source gradient-direction or shape evidence.`));
  if (material.source_contamination_removal?.status !== "pass" || !material.source_contamination_removal?.evidence_ref) findings.push(fail("material-source-contamination", "surface-material-extraction", `${material.id} lacks a passed background/UI/watermark removal record.`));
  const transfer = proofItems.find((item) => item.source_material_id === material.id);
  if (!transfer || !transfer.target_nail_region || !transfer.target_mask_ref || !transfer.orientation_mapping || !transfer.projection_evidence_ref) findings.push(fail("surface-material-transfer-drift", "surface-material-transfer", `${material.id} lacks target region, target mask, orientation mapping, or projection evidence.`));
  const visual = reviews.find((item) => item.source_material_id === material.id);
  if (!visual) { findings.push(fail("missing-surface-material-visual-review", "surface-material-transfer", `${material.id} lacks an independent final surface visual review.`)); continue; }
  for (const status of requiredStatuses) if (visual[status] !== "pass") findings.push(fail(statusToType(status), status === "source_contamination_status" ? "surface-material-extraction" : "surface-material-transfer", `${material.id} ${status} must pass; current value is ${visual[status] || "missing"}.`));
  if (!visual.target_image || !visual.target_nail_region || !visual.reviewed_by) findings.push(fail("incomplete-surface-material-visual-review", "surface-material-transfer", `${material.id} visual review must identify final target image, nail region and reviewer.`));
}
const status = findings.length ? "blocked" : "pass";
const report = { status, gate_id: "surface-material-transfer", checked_at: new Date().toISOString(), lock_path: lockPath, transfer_proof_path: proofPath || null, visual_review_path: reviewPath, findings };
fs.writeFileSync(path.join(outDir, "surface-material-transfer-gate-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "surface-material-transfer-gate-report.md"), ["# Surface Material Transfer Gate", "", `- Status: ${status}`, "", "## Findings", "", ...(findings.length ? findings.map((item) => `- [fail] ${item.type}: ${item.message} Return node: ${item.return_node}.`) : ["- None"]), ""].join("\n"));
console.log(JSON.stringify({ status, findings: findings.length, out_dir: outDir }, null, 2));
if (status !== "pass") process.exitCode = 1;
function fail(type, return_node, message) { return { severity: "fail", type, return_node, message }; }
function statusToType(status) { return ({ palette_status: "material-palette-drift", lightness_status: "material-lightness-drift", color_temperature_status: "material-color-temperature-drift", gradient_direction_status: "gradient-direction-drift", shape_status: "material-shape-drift", source_contamination_status: "material-source-contamination" })[status]; }
