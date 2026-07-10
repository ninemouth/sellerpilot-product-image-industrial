#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/configure-thinkai-runtime.mjs [options]

Options:
  --api-key KEY        ThinkAI API key. If omitted, reads THINKAI_API_KEY.
  --skill-dir DIR      Skill directory to configure. Default: this package root.
  --config PATH        Explicit config path. Default: <skill-dir>/.thinkai-image-runtime.json.
  --base-url URL       Default: ${DEFAULT_BASE_URL}
  --model MODEL        Default: ${DEFAULT_MODEL}

This writes a local config file with mode 600. Do not commit the generated file.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (args.help) usage();

const packageRoot = path.resolve(new URL("..", import.meta.url).pathname);
const skillDir = path.resolve(args["skill-dir"] || packageRoot);
const configPath = path.resolve(args.config || path.join(skillDir, ".thinkai-image-runtime.json"));
const apiKey = String(args["api-key"] || process.env.THINKAI_API_KEY || "").trim();
const baseUrl = String(args["base-url"] || DEFAULT_BASE_URL).trim();
const model = String(args.model || DEFAULT_MODEL).trim();

if (!apiKey) {
  console.error("Missing ThinkAI API key. Provide --api-key or set THINKAI_API_KEY.");
  process.exit(2);
}

fs.mkdirSync(path.dirname(configPath), { recursive: true });
const config = {
  base_url: baseUrl,
  model,
  api_key: apiKey,
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
try {
  fs.chmodSync(configPath, 0o600);
} catch {
  // Some filesystems may not support chmod; the config is still written.
}

console.log(JSON.stringify({
  status: "configured",
  config_path: configPath,
  base_url: baseUrl,
  model,
  api_key_source: args["api-key"] ? "argument" : "THINKAI_API_KEY",
  chmod: "600",
}, null, 2));
