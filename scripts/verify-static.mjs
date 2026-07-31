#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const checks = [];
check("package JSON", () => JSON.parse(read("package.json")));
check("skill package metadata", () => {
  const result = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "verify-skill-package.mjs")], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "skill package validation failed");
});
check("skill progressive disclosure budget", () => {
  const skill = read("SKILL.md");
  const lines = skill.split("\n").length;
  if (lines > 500) throw new Error(`SKILL.md must remain under 500 lines, got ${lines}`);
  if (!skill.includes("production-runtime-runbook.md")) throw new Error("SKILL.md must route exact runtime operations to the on-demand runbook");
  if (!fs.existsSync(path.join(skillRoot, "references", "production-runtime-runbook.md"))) throw new Error("production runtime runbook is missing");
});
for (const file of ["contracts/production-contract.json", "contracts/platform-overrides.json", "contracts/integration-suite-registry.json", "schemas/production-contract.schema.json", "schemas/run-state.schema.json", "schemas/platform-overrides.schema.json"]) check(file, () => JSON.parse(read(file)));
check("production contract invariants", () => {
  const contract = JSON.parse(read("contracts/production-contract.json"));
  if (!contract.modes?.[contract.default_mode]) throw new Error("default mode is missing");
  if (contract.loop_policy?.retry_requires_evidence_delta !== true) throw new Error("retry evidence delta must be mandatory");
  if (contract.loop_policy?.final_delivery_is_root_cause !== false) throw new Error("final delivery must not be a retry root cause");
  for (const [mode, config] of Object.entries(contract.modes || {})) {
    if (mode !== "revision_repair" && config.requires_review_workspace_for_final_delivery !== true) throw new Error(`${mode} must require a review workspace for formal final delivery`);
  }
});
check("platform overrides invariants", () => {
  const overrides = JSON.parse(read("contracts/platform-overrides.json"));
  if (overrides.schema_version !== "sellerpilot.platform_overrides.v1") throw new Error("platform override schema version is invalid");
  if (overrides.platforms?.ozon?.required_ratio !== "3:4") throw new Error("Ozon ordinary-category ratio contract is missing");
});
check("third-party dispatch boundary", () => {
  const dispatch = read("scripts/create-image-generation-dispatch.mjs");
  for (const token of ["resolve-image-provider.mjs", "third_party_proxy", "create-native-imagegen-handoff.mjs", "runtime_script"]) if (!dispatch.includes(token)) throw new Error(`dispatch missing ${token}`);
});
check("automatic cross-platform provider setup boundary", () => {
  const installer = read("scripts/sync-to-codex-skill.mjs");
  const ensure = read("scripts/ensure-image-provider-configuration.mjs");
  const dialog = read("scripts/configure-image-provider-interactive.mjs");
  for (const token of ["ensure-image-provider-configuration.mjs", "no-provider-config-prompt"]) if (!installer.includes(token)) throw new Error(`sync installer missing ${token}`);
  for (const token of ["third_party_proxy", "configuration_required", "--no-prompt", "secure_local_input_pending"]) if (!ensure.includes(token)) throw new Error(`automatic provider setup missing ${token}`);
  for (const token of ["darwin", "win32", "UseSystemPasswordChar", "zenity", "key_output: \"never_printed\""]) if (!dialog.includes(token)) throw new Error(`interactive provider dialog missing ${token}`);
});
check("integration suite registry invariants", () => {
  const registry = JSON.parse(read("contracts/integration-suite-registry.json"));
  if (registry.schema_version !== "sellerpilot.integration_suite_registry.v1") throw new Error("integration suite registry schema version is invalid");
  for (const name of ["control-plane", "natural-finish", "canvas-review", "delivery"]) if (!registry.suites?.[name]?.filters?.length) throw new Error(`integration suite ${name} has no filters`);
});
for (const file of fs.readdirSync(path.join(skillRoot, "scripts")).filter((name) => name.endsWith(".mjs")).sort()) {
  check(`syntax ${file}`, () => {
    const result = spawnSync(process.execPath, ["--check", path.join(skillRoot, "scripts", file)], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "syntax check failed");
  });
}
for (const file of fs.readdirSync(path.join(skillRoot, "workflows")).filter((name) => name.endsWith(".yaml")).sort()) {
  check(`workflow ${file}`, () => {
    const raw = read(path.join("workflows", file));
    const legacyCompatibility = file !== "ecommerce-product-image-generation.yaml" && raw.includes("compatibility_mode: compiler_default");
    const required = file === "ecommerce-product-image-generation.yaml"
      ? ["workflow_id:", "execution_modes:", "qa-loop-router", "final-delivery-gate"]
      : legacyCompatibility
        ? ["workflow_id:", "inherits: ecommerce-product-image-generation", "compatibility_mode: compiler_default", "platform_override:"]
        : ["workflow_id:", "inherits:", "qa-loop-router", "final-delivery-gate"];
    for (const token of required) if (!raw.includes(token)) throw new Error(`missing ${token}`);
    if (!legacyCompatibility && raw.indexOf("qa-loop-router") > raw.indexOf("final-delivery-gate")) throw new Error("final delivery must follow QA routing");
  });
}
const failed = checks.filter((item) => item.status === "fail");
if (process.argv.includes("--verbose")) for (const item of checks) console.log(`${item.status.toUpperCase()} ${item.name}${item.message ? `: ${item.message}` : ""}`);
else for (const item of failed) console.error(`FAIL ${item.name}: ${item.message}`);
console.log(JSON.stringify({ status: failed.length ? "fail" : "pass", checks: checks.length, failed: failed.length }, null, 2));
if (failed.length) process.exitCode = 1;

function check(name, fn) { try { fn(); checks.push({ name, status: "pass" }); } catch (error) { checks.push({ name, status: "fail", message: error.message }); } }
function read(file) { return fs.readFileSync(path.join(skillRoot, file), "utf8"); }
