#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeProviderCapabilities } from "./lib/provider-capabilities.mjs";

function parseArgs(argv) { const args = {}; for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (!arg.startsWith("--")) continue; const next = argv[i + 1]; if (!next || next.startsWith("--")) args[arg.slice(2)] = true; else { args[arg.slice(2)] = next; i += 1; } } return args; }
const args = parseArgs(process.argv);
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const configPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const defaultApiKeyEnv = "THINKAI_IMAGE_API_KEY";
const legacyApiKeyEnv = "THINKAI_API_KEY";
const runtime = String(args.runtime || "openai_images").trim();
if (!["openai_images", "nvidia_nim_flux"].includes(runtime)) { console.error("--runtime must be openai_images or nvidia_nim_flux."); process.exit(2); }
const nvidiaFlux = runtime === "nvidia_nim_flux";
if (args["api-key"] && args["api-key-stdin"]) { console.error("Use either --api-key or --api-key-stdin, not both."); process.exit(2); }
const stdinKey = args["api-key-stdin"] ? fs.readFileSync(0, "utf8").trim() : "";
const apiKey = String(args["api-key"] || stdinKey || process.env[nvidiaFlux ? "NVIDIA_API_KEY" : defaultApiKeyEnv] || (!nvidiaFlux && process.env[legacyApiKeyEnv]) || "").trim();
const apiKeyEnv = String(args["api-key-env"] || (nvidiaFlux ? "NVIDIA_API_KEY" : defaultApiKeyEnv)).trim();
const capabilities = normalizeProviderCapabilities({
  quality: { default: args["quality-default"], allowed: splitList(args["quality-allowed"]) },
  size: { default: args["size-default"], allowed: splitList(args["size-allowed"]), allow_custom: asBool(args["allow-custom-size"]) },
  response_format: { default: args["response-format-default"], allowed: splitList(args["response-format-allowed"]) },
  reference_images: {
    max_count: args["reference-max-count"],
    max_per_image_bytes: args["reference-max-per-image-bytes"],
    max_total_bytes: args["reference-max-total-bytes"],
  },
});
if (!apiKey) { console.error(`Missing third-party image API key. Provide --api-key or set ${defaultApiKeyEnv}.`); process.exit(2); }
const config = {
  provider_mode: "third_party_proxy",
  third_party: {
    enabled: true,
    name: args.name || (nvidiaFlux ? "NVIDIA NIM" : "ThinkAI"),
    base_url: String(args["base-url"] || (nvidiaFlux ? "https://ai.api.nvidia.com/v1/genai" : "https://www.thinkai.tv/v1")).replace(/\/+$/, ""),
    model: args.model || (nvidiaFlux ? "black-forest-labs/flux.2-klein-4b" : "gpt-image-2"),
    api_key_env: apiKeyEnv,
    api_key: apiKey,
    runtime,
    capabilities,
  },
};
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
try { fs.chmodSync(configPath, 0o600); } catch {}
console.log(JSON.stringify({ status: "configured", config_path: configPath, provider_mode: config.provider_mode, provider: { name: config.third_party.name, base_url: config.third_party.base_url, model: config.third_party.model, api_key_env: apiKeyEnv }, key_source: args["api-key-stdin"] ? "stdin" : args["api-key"] ? "argument" : "environment", chmod: "600" }, null, 2));
function splitList(value) { return value ? String(value).split(",").map((item) => item.trim()).filter(Boolean) : undefined; }
function asBool(value) { return value === true || /^(1|true|yes)$/i.test(String(value || "")); }
