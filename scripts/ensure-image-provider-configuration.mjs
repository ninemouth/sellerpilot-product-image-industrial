#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv);
if (args.help) usage();
const skillRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const resolveArgs = [path.join(skillRoot, "scripts", "resolve-image-provider.mjs")];
for (const flag of ["config", "codex-config", "provider"]) if (args[flag]) resolveArgs.push(`--${flag}`, String(args[flag]));
const resolved = spawnSync(process.execPath, resolveArgs, { encoding: "utf8" });
const resolution = safeJson(resolved.stdout);
if (!resolution) fail("Provider route could not be read; installation continues without changing provider configuration.");
if (resolution.selected_mode !== "third_party_proxy" || resolution.status === "ready") {
  console.log(JSON.stringify({ status: "not_required", selected_mode: resolution.selected_mode, provider: resolution.provider?.name || null }, null, 2));
  process.exit(0);
}
if (args["no-prompt"] || process.env.CI === "true" || process.env.CI === "1") {
  console.log(JSON.stringify({ status: "configuration_required", selected_mode: "third_party_proxy", provider: resolution.provider?.name || "third-party provider", action: "secure_local_input_pending", prompted: false }, null, 2));
  process.exit(0);
}
const configureArgs = [path.join(skillRoot, "scripts", "configure-image-provider-interactive.mjs"), "--profile-id", resolution.profile?.id || ""];
for (const [flag, value] of Object.entries({ config: args.config, name: resolution.provider?.name, "base-url": resolution.provider?.base_url, model: resolution.provider?.model, "api-key-env": resolution.provider?.api_key_env, "quality-default": resolution.provider?.capabilities?.quality?.default, "quality-allowed": resolution.provider?.capabilities?.quality?.allowed?.join(","), "size-default": resolution.provider?.capabilities?.size?.default, "size-allowed": resolution.provider?.capabilities?.size?.allowed?.join(","), "response-format-default": resolution.provider?.capabilities?.response_format?.default, "response-format-allowed": resolution.provider?.capabilities?.response_format?.allowed?.join(",") })) if (value) configureArgs.push(`--${flag}`, String(value));
if (resolution.provider?.capabilities?.size?.allow_custom === true) configureArgs.push("--allow-custom-size");
const configured = spawnSync(process.execPath, configureArgs, { encoding: "utf8" });
if (configured.status !== 0) {
  console.log(JSON.stringify({ status: "configuration_required", selected_mode: "third_party_proxy", provider: resolution.provider?.name || "third-party provider", action: "secure_local_input_pending", prompted: true, configuration_saved: false }, null, 2));
  process.exit(0);
}
const result = safeJson(configured.stdout) || {};
console.log(JSON.stringify({ status: "configured", selected_mode: "third_party_proxy", provider: result.provider?.name || resolution.provider?.name || "third-party provider", prompted: true, key_output: "never_printed" }, null, 2));

function parseArgs(argv) { const out = {}; for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (!arg.startsWith("--")) continue; const next = argv[i + 1]; if (!next || next.startsWith("--")) out[arg.slice(2)] = true; else { out[arg.slice(2)] = next; i += 1; } } return out; }
function safeJson(value) { try { return JSON.parse(String(value || "")); } catch { return null; } }
function fail(message) { console.log(JSON.stringify({ status: "unknown", action: "provider_configuration_not_changed", message }, null, 2)); process.exit(0); }
function usage() { console.error("Usage: node scripts/ensure-image-provider-configuration.mjs [--config /abs/image-provider.json] [--codex-config /abs/config.toml] [--provider auto|native_codex|third_party_proxy] [--no-prompt]"); process.exit(2); }
