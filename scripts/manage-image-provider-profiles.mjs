#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeProviderCapabilities } from "./lib/provider-capabilities.mjs";
import { findProfile, normalizeExternalProfile, readProviderRegistry, writeProviderRegistry } from "./lib/provider-profile-registry.mjs";

const args = parseArgs(process.argv);
if (args.help) usage();
const action = String(args.action || "list").trim();
if (!new Set(["list", "select", "upsert", "remove", "migrate"]).has(action)) fail("--action must be list, select, upsert, remove, or migrate.");
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const configPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const state = readProviderRegistry(configPath);

if (action === "list") {
  console.log(JSON.stringify(publicRegistry(state.registry, state.source), null, 2));
  process.exit(0);
}

if (action === "migrate") {
  const registry = writeProviderRegistry(configPath, state.registry);
  console.log(JSON.stringify({ status: "migrated", ...publicRegistry(registry, state.source) }, null, 2));
  process.exit(0);
}

if (action === "select") {
  const id = required("id");
  const profile = findProfile(state.registry, id);
  if (!profile || profile.enabled === false) fail("Selected provider profile is not enabled.");
  const registry = writeProviderRegistry(configPath, { ...state.registry, active_profile_id: profile.id });
  console.log(JSON.stringify({ status: "selected", active_profile_id: registry.active_profile_id, profile: publicProfile(findProfile(registry)) }, null, 2));
  process.exit(0);
}

if (action === "remove") {
  const id = required("id");
  if (["codex-native", "nvidia-flux"].includes(id)) fail("Built-in provider profiles cannot be removed.");
  const exists = state.registry.profiles.some((profile) => profile.id === id && profile.kind === "external");
  if (!exists) fail("External provider profile was not found.");
  const registry = writeProviderRegistry(configPath, {
    ...state.registry,
    active_profile_id: state.registry.active_profile_id === id ? "codex-native" : state.registry.active_profile_id,
    profiles: state.registry.profiles.filter((profile) => profile.id !== id),
  });
  console.log(JSON.stringify({ status: "removed", active_profile_id: registry.active_profile_id, removed_profile_id: id }, null, 2));
  process.exit(0);
}

const id = required("id");
const apiKey = readApiKey(args);
const builtIn = state.registry.profiles.find((profile) => profile.id === id && profile.kind === "built_in");
if (builtIn) {
  if (builtIn.runtime === "native_codex") fail("Codex Native does not accept an API key in this skill profile.");
  const updated = { ...builtIn, ...(apiKey ? { api_key: apiKey } : {}), ...(args["api-key-env"] ? { api_key_env: String(args["api-key-env"]) } : {}) };
  const registry = writeProviderRegistry(configPath, {
    ...state.registry,
    active_profile_id: args["set-active"] ? id : state.registry.active_profile_id,
    profiles: [...state.registry.profiles.filter((candidate) => candidate.id !== id), updated],
  });
  console.log(JSON.stringify({ status: "upserted", active_profile_id: registry.active_profile_id, profile: publicProfile(findProfile(registry, id)), key_source: apiKey ? (args["api-key-stdin"] ? "stdin" : "argument") : "retained_or_environment" }, null, 2));
  process.exit(0);
}
const previous = state.registry.profiles.find((profile) => profile.id === id && profile.kind === "external") || {};
const profile = normalizeExternalProfile({
  ...previous,
  id,
  label: args.label || args.name || previous.label,
  runtime: args.runtime || previous.runtime || "openai_images",
  enabled: args.disabled ? false : true,
  base_url: args["base-url"] || previous.base_url,
  model: args.model || previous.model,
  api_key_env: args["api-key-env"] || previous.api_key_env,
  api_key: apiKey || previous.api_key,
  capabilities: normalizeProviderCapabilities({
    ...(previous.capabilities || {}),
    quality: { default: args["quality-default"] || previous.capabilities?.quality?.default, allowed: splitList(args["quality-allowed"]) || previous.capabilities?.quality?.allowed },
    size: { default: args["size-default"] || previous.capabilities?.size?.default, allowed: splitList(args["size-allowed"]) || previous.capabilities?.size?.allowed, allow_custom: args["allow-custom-size"] ? true : previous.capabilities?.size?.allow_custom },
    response_format: { default: args["response-format-default"] || previous.capabilities?.response_format?.default, allowed: splitList(args["response-format-allowed"]) || previous.capabilities?.response_format?.allowed },
    reference_images: {
      max_count: args["reference-max-count"] || previous.capabilities?.reference_images?.max_count,
      max_per_image_bytes: args["reference-max-per-image-bytes"] || previous.capabilities?.reference_images?.max_per_image_bytes,
      max_total_bytes: args["reference-max-total-bytes"] || previous.capabilities?.reference_images?.max_total_bytes,
    },
  }),
});
if (!profile.label || !profile.base_url || !profile.model || !profile.api_key_env) fail("External profiles require --label, --base-url, --model, and --api-key-env (or an existing saved value).");
const registry = writeProviderRegistry(configPath, {
  ...state.registry,
  active_profile_id: args["set-active"] ? profile.id : state.registry.active_profile_id,
  profiles: [...state.registry.profiles.filter((candidate) => candidate.id !== profile.id), profile],
});
console.log(JSON.stringify({ status: "upserted", active_profile_id: registry.active_profile_id, profile: publicProfile(findProfile(registry, profile.id)), key_source: apiKey ? (args["api-key-stdin"] ? "stdin" : "argument") : "retained_or_environment" }, null, 2));

function publicRegistry(registry, source) { return { status: "ready", source, active_profile_id: registry.active_profile_id, profiles: registry.profiles.map(publicProfile) }; }
function publicProfile(profile) { return { id: profile.id, label: profile.label, kind: profile.kind, enabled: profile.enabled !== false, runtime: profile.runtime, base_url: profile.base_url || null, model: profile.model || null, api_key_env: profile.api_key_env || null, reference_images: profile.capabilities?.reference_images || null, has_stored_key: Boolean(profile.api_key) }; }
function readApiKey(input) { if (input["api-key"] && input["api-key-stdin"]) fail("Use either --api-key or --api-key-stdin, not both."); return String(input["api-key"] || (input["api-key-stdin"] ? fs.readFileSync(0, "utf8") : "")).trim(); }
function required(key) { const value = String(args[key] || "").trim(); if (!value) fail(`--${key} is required.`); return value; }
function splitList(value) { return value ? String(value).split(",").map((item) => item.trim()).filter(Boolean) : null; }
function parseArgs(argv) { const out = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) out[key] = true; else { out[key] = next; i += 1; } } return out; }
function fail(message) { console.error(message); process.exit(2); }
function usage() { console.error("Usage: node scripts/manage-image-provider-profiles.mjs --action list|select|upsert|remove|migrate [--config /abs/image-provider.json] [--id PROFILE_ID] [--label LABEL --runtime openai_images|nvidia_nim_flux --base-url URL --model MODEL --api-key-env NAME --api-key-stdin --set-active] [--reference-max-count 2 --reference-max-per-image-bytes N --reference-max-total-bytes N]"); process.exit(2); }
