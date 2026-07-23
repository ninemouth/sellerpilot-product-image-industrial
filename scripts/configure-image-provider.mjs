#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) { const args = {}; for (let i = 2; i < argv.length; i += 1) { const arg = argv[i]; if (!arg.startsWith("--")) continue; const next = argv[i + 1]; if (!next || next.startsWith("--")) args[arg.slice(2)] = true; else { args[arg.slice(2)] = next; i += 1; } } return args; }
const args = parseArgs(process.argv);
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const configPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const defaultApiKeyEnv = "THINKAI_IMAGE_API_KEY";
const legacyApiKeyEnv = "THINKAI_API_KEY";
const apiKey = String(args["api-key"] || process.env[defaultApiKeyEnv] || process.env[legacyApiKeyEnv] || "").trim();
const apiKeyEnv = String(args["api-key-env"] || defaultApiKeyEnv).trim();
if (!apiKey) { console.error(`Missing third-party image API key. Provide --api-key or set ${defaultApiKeyEnv}.`); process.exit(2); }
const config = {
  provider_mode: "third_party_proxy",
  third_party: {
    enabled: true,
    name: args.name || "ThinkAI",
    base_url: String(args["base-url"] || "https://www.thinkai.tv/v1").replace(/\/+$/, ""),
    model: args.model || "gpt-image-2",
    api_key_env: apiKeyEnv,
    api_key: apiKey,
  },
};
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
try { fs.chmodSync(configPath, 0o600); } catch {}
console.log(JSON.stringify({ status: "configured", config_path: configPath, provider_mode: config.provider_mode, provider: { name: config.third_party.name, base_url: config.third_party.base_url, model: config.third_party.model, api_key_env: apiKeyEnv }, chmod: "600" }, null, 2));
