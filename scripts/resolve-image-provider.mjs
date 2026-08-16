#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { normalizeProviderCapabilities } from "./lib/provider-capabilities.mjs";
import { findProfile, isThirdPartyProfile, normalizeExternalProfile, readProviderRegistry } from "./lib/provider-profile-registry.mjs";

const MODES = new Set(["auto", "native_codex", "third_party_proxy"]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[arg.slice(2)] = true;
    else { args[arg.slice(2)] = next; i += 1; }
  }
  return args;
}

const args = parseArgs(process.argv);
if (args.help) {
  console.error("Usage: node scripts/resolve-image-provider.mjs [--provider auto|native_codex|third_party_proxy] [--profile PROFILE_ID] [--config /abs/image-provider.json] [--codex-config /abs/config.toml] [--run-dir /abs/run]");
  process.exit(2);
}

const skillRoot = skillRootFrom(import.meta.url);
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const providerConfigPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const codexConfigPath = path.resolve(args["codex-config"] || path.join(codexHome, "config.toml"));
const requestedMode = String(args.provider || "auto").trim();
if (!MODES.has(requestedMode)) fail(`Unsupported provider mode: ${requestedMode}`);

const registryState = readProviderRegistry(providerConfigPath);
const detected = detectThirdParty(readCodexConfig(codexConfigPath));
const requestedProfileId = String(args.profile || "").trim();
let profile = requestedProfileId ? findProfile(registryState.registry, requestedProfileId) : findProfile(registryState.registry);
if (requestedProfileId && !profile) fail(`Unknown provider profile: ${requestedProfileId}`);
if (registryState.source === "default" && !requestedProfileId && requestedMode === "auto" && detected.detected) profile = detectedProfile(detected);
if (requestedMode === "native_codex") profile = findProfile(registryState.registry, "codex-native");
if (requestedMode === "third_party_proxy" && profile?.runtime === "native_codex") {
  const configuredExternal = registryState.registry.profiles.find((candidate) => candidate.kind === "external" && candidate.enabled !== false);
  if (!configuredExternal) fail("third_party_proxy was requested but no enabled external provider profile is configured.");
  profile = configuredExternal;
}
if (!profile || profile.enabled === false) fail("The selected provider profile is disabled or unavailable.");

const selectedMode = isThirdPartyProfile(profile) ? "third_party_proxy" : "native_codex";
const storedKey = String(profile.api_key || "").trim();
const environmentKey = selectedMode === "third_party_proxy" ? String(process.env[profile.api_key_env] || "").trim() : "";
const hasKey = Boolean(storedKey || environmentKey);
const credentialSource = storedKey ? "local_provider_config" : environmentKey ? "environment" : "missing";
const status = selectedMode === "third_party_proxy" && !hasKey ? "configuration_required" : "ready";
const thirdParty = selectedMode === "third_party_proxy" ? normalizeThirdParty(profile) : null;
const resolution = {
  schema_version: "sellerpilot.image_provider_resolution.v2",
  resolved_at: new Date().toISOString(),
  requested_mode: requestedMode,
  requested_profile_id: requestedProfileId || null,
  selected_mode: selectedMode,
  status,
  credential_source: selectedMode === "third_party_proxy" ? credentialSource : "not_applicable",
  profile: { id: profile.id, label: profile.label, kind: profile.kind, source: registryState.source },
  provider: selectedMode === "native_codex"
    ? { id: "codex-native-imagegen", execution: "system_imagegen_or_image_gen" }
    : {
      id: thirdParty.runtime === "nvidia_nim_flux" ? "nvidia-nim-flux-image-runtime" : "third-party-openai-compatible-image-runtime",
      name: thirdParty.label,
      base_url: thirdParty.base_url,
      model: thirdParty.model,
      api_key_env: thirdParty.api_key_env,
      capabilities: thirdParty.capabilities,
      runtime: thirdParty.runtime,
      runtime_script: path.join(skillRoot, "scripts", thirdParty.runtime === "nvidia_nim_flux" ? "nvidia-flux-image-runtime.mjs" : "thinkai-image-runtime.mjs"),
    },
  detected_codex_provider: detected,
  configuration: {
    shared_provider_config: providerConfigPath,
    codex_config: fs.existsSync(codexConfigPath) ? codexConfigPath : null,
    selected_profile_source: registryState.source,
  },
  next_action: status === "ready"
    ? selectedMode === "native_codex"
      ? "Use the Codex-native imagegen/image_gen execution capability. Do not silently fall back if unavailable."
      : "Use the listed runtime with the resolved profile, base URL, model, and key environment variable."
    : `Configure an API key for the selected external profile (${thirdParty.label}) before generation.`,
};

if (args["run-dir"]) {
  const out = path.join(path.resolve(args["run-dir"]), "runtime", "image-provider-resolution.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(resolution, null, 2));
  resolution.run_report = out;
}
console.log(JSON.stringify(resolution, null, 2));
if (status !== "ready") process.exitCode = 1;

function normalizeThirdParty(profile) {
  return {
    label: String(profile.label || "Third-party image provider"),
    base_url: stripSlash(profile.base_url),
    model: String(profile.model || "").trim(),
    api_key_env: String(profile.api_key_env || "").trim(),
    runtime: String(profile.runtime || "openai_images"),
    capabilities: normalizeProviderCapabilities(profile.capabilities),
  };
}

function detectedProfile(provider) {
  return normalizeExternalProfile({
    id: `codex-config-${slug(provider.id || provider.name) || "external"}`,
    label: provider.name || provider.id || "Codex configured provider",
    kind: "external",
    runtime: "openai_images",
    base_url: provider.base_url,
    model: provider.model,
    api_key_env: provider.api_key_env || defaultImageApiKeyEnv(provider),
  });
}

function defaultImageApiKeyEnv(provider) {
  const name = String(provider.name || provider.id || "IMAGE_PROVIDER").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${name || "IMAGE_PROVIDER"}_IMAGE_API_KEY`;
}

function detectThirdParty(config) {
  const providerId = config.top.model_provider || "";
  const record = config.providers[providerId] || {};
  const baseUrl = record.base_url || "";
  const isThirdParty = Boolean(providerId && providerId !== "openai" && providerId !== "default");
  return {
    detected: isThirdParty,
    id: providerId || null,
    name: providerId || null,
    base_url: baseUrl ? stripSlash(baseUrl) : null,
    model: record.model || null,
    api_key_env: record.env_key || record.api_key_env || null,
  };
}

function readCodexConfig(file) {
  if (!fs.existsSync(file)) return { top: {}, providers: {} };
  const top = {};
  const providers = {};
  let section = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const match = line.match(/^\[model_providers\.([A-Za-z0-9_-]+)\]$/);
    if (match) { section = match[1]; providers[section] ||= {}; continue; }
    if (/^\[/.test(line)) { section = null; continue; }
    const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
    if (!pair) continue;
    if (section) providers[section][pair[1]] = pair[2];
    else top[pair[1]] = pair[2];
  }
  return { top, providers };
}

function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function stripSlash(value) { return String(value || "").trim().replace(/\/+$/, ""); }
function fail(message) { console.error(message); process.exit(2); }
