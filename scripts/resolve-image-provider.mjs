#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const THINKAI_BASE_URL = "https://www.thinkai.tv/v1";
const THINKAI_MODEL = "gpt-image-2";
const THINKAI_IMAGE_API_KEY_ENV = "THINKAI_IMAGE_API_KEY";
const LEGACY_THINKAI_API_KEY_ENV = "THINKAI_API_KEY";
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
  console.error("Usage: node scripts/resolve-image-provider.mjs [--provider auto|native_codex|third_party_proxy] [--config /abs/image-provider.json] [--codex-config /abs/config.toml] [--run-dir /abs/run]");
  process.exit(2);
}

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const providerConfigPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const codexConfigPath = path.resolve(args["codex-config"] || path.join(codexHome, "config.toml"));
const local = readJson(providerConfigPath) || {};
const codex = readCodexConfig(codexConfigPath);
const requestedMode = String(args.provider || local.provider_mode || "auto").trim();
if (!MODES.has(requestedMode)) fail(`Unsupported provider mode: ${requestedMode}`);

const detected = detectThirdParty(codex);
const thirdParty = normalizeThirdParty(local.third_party || {}, detected);
const selectedMode = selectMode(requestedMode, local, detected);
const hasKey = Boolean(process.env[thirdParty.api_key_env] || process.env[THINKAI_IMAGE_API_KEY_ENV] || process.env[LEGACY_THINKAI_API_KEY_ENV] || local.third_party?.api_key);
const status = selectedMode === "third_party_proxy" && !hasKey ? "configuration_required" : "ready";
const resolution = {
  schema_version: "sellerpilot.image_provider_resolution.v1",
  resolved_at: new Date().toISOString(),
  requested_mode: requestedMode,
  selected_mode: selectedMode,
  status,
  provider: selectedMode === "native_codex"
    ? { id: "codex-native-imagegen", execution: "system_imagegen_or_image_gen" }
    : {
        id: thirdParty.name === "ThinkAI" ? "thinkai-openai-compatible-image-runtime" : "third-party-openai-compatible-image-runtime",
        name: thirdParty.name,
        base_url: thirdParty.base_url,
        model: thirdParty.model,
        api_key_env: thirdParty.api_key_env,
        runtime_script: path.join(skillRoot, "scripts", "thinkai-image-runtime.mjs"),
      },
  detected_codex_provider: detected,
  configuration: {
    shared_provider_config: providerConfigPath,
    codex_config: fs.existsSync(codexConfigPath) ? codexConfigPath : null,
    legacy_thinkai_config_checked: legacyThinkAiConfigPaths(codexHome),
  },
  next_action: status === "ready"
    ? selectedMode === "native_codex"
      ? "Use the Codex-native imagegen/image_gen execution capability. Do not silently fall back if unavailable."
      : "Use the listed OpenAI-compatible runtime with the resolved base URL, model, and key environment variable."
    : `Ask only for an API key for ${thirdParty.api_key_env}; base URL is already resolved as ${thirdParty.base_url}.`,
};

if (args["run-dir"]) {
  const out = path.join(path.resolve(args["run-dir"]), "runtime", "image-provider-resolution.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(resolution, null, 2));
  resolution.run_report = out;
}
console.log(JSON.stringify(resolution, null, 2));
if (status !== "ready") process.exitCode = 1;

function selectMode(mode, config, detectedProvider) {
  if (mode !== "auto") return mode;
  if (config.third_party?.enabled === true || detectedProvider.detected) return "third_party_proxy";
  return "native_codex";
}

function normalizeThirdParty(value, detectedProvider) {
  const legacy = legacyThinkAiConfigPaths(codexHome).map(readJson).find(Boolean) || {};
  return {
    name: String(value.name || detectedProvider.name || legacy.provider_name || "ThinkAI"),
    base_url: stripSlash(value.base_url || detectedProvider.base_url || legacy.base_url || THINKAI_BASE_URL),
    model: String(value.model || detectedProvider.model || legacy.model || THINKAI_MODEL),
    api_key_env: String(value.api_key_env || legacy.api_key_env || defaultImageApiKeyEnv(detectedProvider) || THINKAI_IMAGE_API_KEY_ENV),
  };
}

function defaultImageApiKeyEnv(detectedProvider) {
  const provider = String(detectedProvider.name || detectedProvider.id || "ThinkAI").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return provider ? `${provider}_IMAGE_API_KEY` : THINKAI_IMAGE_API_KEY_ENV;
}

function detectThirdParty(config) {
  const providerId = config.top.model_provider || "";
  const record = config.providers[providerId] || {};
  const baseUrl = record.base_url || "";
  const isThirdParty = Boolean(providerId && providerId !== "openai" && providerId !== "default");
  return {
    detected: isThirdParty,
    id: providerId || null,
    name: providerId.toLowerCase() === "thinkai" ? "ThinkAI" : (providerId || null),
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

function legacyThinkAiConfigPaths(home) {
  return [
    path.join(home, "sellerpilot-product-image-industrial", "image-provider.json"),
    path.join(home, "skills", "sellerpilot-product-image-industrial", ".thinkai-image-runtime.json"),
    path.join(home, "skills", "sellerpilot-product-image-industrial-thinkai", ".thinkai-image-runtime.json"),
  ];
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function stripSlash(value) { return String(value).trim().replace(/\/+$/, ""); }
function fail(message) { console.error(message); process.exit(2); }
