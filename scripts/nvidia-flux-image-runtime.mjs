#!/usr/bin/env node
// NVIDIA Build's hosted FLUX endpoints are JSON GenAI APIs, not the
// OpenAI-compatible Images API used by ThinkAI. Keep this adapter explicit so
// selecting NVIDIA never mutates the default gpt-image-2 route.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

const DEFAULT_BASE_URL = "https://ai.api.nvidia.com/v1/genai";
const DEFAULT_MODEL = "black-forest-labs/flux.2-klein-4b";
const DEFAULT_API_KEY_ENV = "NVIDIA_API_KEY";
const SUPPORTED_MODELS = new Set([
  "black-forest-labs/flux.1-dev",
  "black-forest-labs/flux.1-schnell",
  "black-forest-labs/flux.1-kontext-dev",
  "black-forest-labs/flux.2-klein-4b",
]);

const args = parseArgs(process.argv);
if (!args.prompt || !args["output-dir"]) usage();
const outputDir = path.resolve(args["output-dir"]);
const images = args.image.map((file) => path.resolve(file));
const config = loadConfig(args.config, args["provider-resolution"]);
const model = String(args.model || config.model || DEFAULT_MODEL).trim();
const baseUrl = String(args["base-url"] || config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
const apiKeyEnv = String(args["api-key-env"] || config.api_key_env || DEFAULT_API_KEY_ENV);
const apiKey = String(config.api_key || process.env[apiKeyEnv] || "").trim();
const size = parseSize(args.size);
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
const role = String(args.role || "");

if (!SUPPORTED_MODELS.has(model)) fail(`Unsupported NVIDIA FLUX model: ${model}.`);
if (runDir && !role) fail("--role is required when --run-dir is provided.");
for (const file of images) if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`Source image not found: ${file}`);
if (images.length > 1) fail("NVIDIA FLUX adapter accepts one source image per request.");
if (["black-forest-labs/flux.1-dev", "black-forest-labs/flux.1-schnell"].includes(model) && images.length) fail(`${model} does not accept an ordinary source-image edit in this adapter; use FLUX.1-Kontext-dev or FLUX.2-klein-4b.`);

const request = buildRequest({ model, prompt: args.prompt, images, size });
fs.mkdirSync(outputDir, { recursive: true });
writeJson(path.join(outputDir, "request.json"), request);
if (args["dry-run"]) {
  const summary = { status: "dry_run", provider: "nvidia-nim-flux-image-runtime", provider_name: config.name || "NVIDIA NIM", model, endpoint: `${baseUrl}/${model}`, requested_size: size.label, n: 1, output_dir: outputDir, request_path: path.join(outputDir, "request.json") };
  writeJson(path.join(outputDir, "summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
if (!apiKey) fail(`NVIDIA FLUX image API key is not configured in ${apiKeyEnv}.`);

recordAttempt("requested");
try {
  const response = JSON.parse(await curlJson(`${baseUrl}/${model}`, apiKey, request));
  writeJson(path.join(outputDir, "response.json"), response);
  const artifact = Array.isArray(response.artifacts) ? response.artifacts[0] : null;
  const encoded = artifact?.base64;
  if (!encoded) throw new Error("NVIDIA FLUX response did not include artifacts[0].base64.");
  const bytes = Buffer.from(String(encoded), "base64");
  if (!bytes.length) throw new Error("NVIDIA FLUX response image was empty.");
  const imagePath = path.join(outputDir, "image.png");
  fs.writeFileSync(imagePath, bytes);
  const summary = { status: "generated", provider: "nvidia-nim-flux-image-runtime", provider_name: config.name || "NVIDIA NIM", model, endpoint: `${baseUrl}/${model}`, requested_size: size.label, n: 1, output_dir: outputDir, images: [{ image_path: imagePath }], request_path: path.join(outputDir, "request.json"), response_path: path.join(outputDir, "response.json") };
  writeJson(path.join(outputDir, "summary.json"), summary);
  recordAttempt("succeeded");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  recordAttempt("failed", true);
  fail(JSON.stringify({ code: "provider_request_failed", message: "NVIDIA FLUX image generation could not complete. The run state was preserved so only this asset needs retrying." }));
}

function buildRequest({ model: selectedModel, prompt, images: sourceImages, size: dimensions }) {
  const body = { prompt, width: dimensions.width, height: dimensions.height, seed: 0, samples: 1 };
  if (selectedModel === "black-forest-labs/flux.1-dev") Object.assign(body, { mode: "base", steps: 50 });
  if (selectedModel === "black-forest-labs/flux.1-schnell") Object.assign(body, { mode: "base", steps: 4 });
  if (selectedModel === "black-forest-labs/flux.1-kontext-dev") Object.assign(body, { image: dataUrl(sourceImages[0]), steps: 30 });
  if (selectedModel === "black-forest-labs/flux.2-klein-4b") Object.assign(body, { mode: sourceImages.length ? "Image Editing" : "Image Generation", steps: 4, ...(sourceImages.length ? { image: dataUrl(sourceImages[0]) } : {}) });
  return body;
}

function parseSize(value) {
  const match = String(value || "1024x1024").trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) fail("--size must be a platform target in WxH form for NVIDIA FLUX.");
  return { width: Number(match[1]), height: Number(match[2]), label: `${Number(match[1])}x${Number(match[2])}` };
}

function dataUrl(file) {
  if (!file) fail("This NVIDIA FLUX model requires one --image input.");
  const extension = path.extname(file).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function curlJson(url, key, body) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["--silent", "--show-error", "--fail", "--connect-timeout", "30", "--max-time", String(args["request-timeout-seconds"] || 1800), "-X", "POST", url, "-H", `Authorization: Bearer ${key}`, "-H", "Accept: application/json", "-H", "Content-Type: application/json", "--data-binary", JSON.stringify(body)], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = []; const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk)); child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(stdout).toString("utf8")) : reject(new Error(Buffer.concat(stderr).toString("utf8") || `curl exited with ${code}`)));
  });
}

function recordAttempt(status, suppress = false) {
  if (!runDir) return;
  const recorder = path.join(skillRootFrom(import.meta.url), "scripts", "record-provider-call.mjs");
  const result = spawnSync(process.execPath, [recorder, "--run-dir", runDir, "--role", role, "--status", status, "--prompt-hash", args.prompt, "--source-hash", images.join("|"), "--provider", config.name || "NVIDIA NIM", "--model", model, "--triggering-gate", "nvidia-flux-image-runtime"], { stdio: suppress ? "ignore" : "pipe", encoding: "utf8" });
  if (result.status !== 0 && !suppress) throw new Error((result.stderr || result.stdout || "Provider attempt was blocked by run budget.").trim());
}

function loadConfig(configArg, resolutionArg) {
  if (resolutionArg) { const resolution = readJson(path.resolve(resolutionArg)); if (resolution?.selected_mode === "third_party_proxy" && resolution.provider) return resolution.provider; }
  const file = configArg ? path.resolve(configArg) : path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sellerpilot-product-image-industrial", "image-provider.json");
  const loaded = readJson(file) || {}; return loaded.third_party || loaded;
}
function parseArgs(argv) { const result = { image: [] }; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const value = argv[i + 1]; if (key === "image") { if (!value || value.startsWith("--")) usage(); result.image.push(value); i += 1; } else if (!value || value.startsWith("--")) result[key] = true; else { result[key] = value; i += 1; } } return result; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function usage() { console.error("Usage: node scripts/nvidia-flux-image-runtime.mjs --prompt '<prompt>' --output-dir /abs/out --size WxH [--image /abs/source.png] [--model FLUX_MODEL] [--config /abs/image-provider.json] [--dry-run]"); process.exit(2); }
function fail(message) { console.error(message); process.exit(1); }
