#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_API_KEY_ENV = "THINKAI_IMAGE_API_KEY";
const LEGACY_API_KEY_ENV = "THINKAI_API_KEY";

const args = parseArgs(process.argv);
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const configPath = path.resolve(args.config || path.join(codexHome, "image-proxy", "image-provider.json"));
const config = readConfig(configPath);
const provider = config.third_party && typeof config.third_party === "object" ? config.third_party : config;
const name = String(args.name || provider.name || provider.provider_name || "ThinkAI").trim();
const baseUrl = stripSlash(args["base-url"] || provider.base_url || DEFAULT_BASE_URL);
const model = String(args.model || provider.model || DEFAULT_MODEL).trim();
const apiKeyEnv = String(args["api-key-env"] || provider.api_key_env || DEFAULT_API_KEY_ENV).trim();
const keyConfigured = Boolean(process.env[apiKeyEnv] || process.env[DEFAULT_API_KEY_ENV] || process.env[LEGACY_API_KEY_ENV] || provider.api_key);
const status = keyConfigured ? "ready" : "configuration_required";

const report = {
  schema_version: "codex.third_party_image_provider_resolution.v1",
  selected_mode: "third_party_proxy",
  status,
  provider: {
    name,
    base_url: baseUrl,
    model,
    api_key_env: apiKeyEnv,
  },
  key_configured: keyConfigured,
  config_source: fs.existsSync(configPath) ? "local_config" : "default_profile_or_environment",
  next_action: keyConfigured
    ? "Run the provider runtime with the resolved endpoint and model."
    : `Configure an API key through the environment or the secure local configurator for ${apiKeyEnv}.`,
};

console.log(JSON.stringify(report, null, 2));
if (status !== "ready") process.exitCode = 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { fail(`Provider config is not valid JSON: ${file}`); }
}

function stripSlash(value) { return String(value).trim().replace(/\/+$/, ""); }
function fail(message) { console.error(message); process.exit(2); }
