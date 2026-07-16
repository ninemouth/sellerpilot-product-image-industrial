#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_USER_AGENT = "curl/8.7.1";
const SIZE_ALIASES = new Map([
  ["1k", "1920x1088"],
  ["2k", "2560x1440"],
  ["4k", "3840x2160"],
]);
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 1800;
const DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 900;
const DEFAULT_HEARTBEAT_SECONDS = 30;

class RuntimeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseArgs(argv) {
  const args = { image: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === "image") {
      if (!next || next.startsWith("--")) usage();
      args.image.push(next);
      i += 1;
    } else if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/thinkai-image-runtime.mjs --prompt '<prompt>' --output-dir /abs/out [options]

Options:
  --image /abs/source.png       Add source/reference image. Repeat for multi-image edits.
  --mask /abs/mask.png          Optional edit mask.
  --size 1k|2k|4k|WIDTHxHEIGHT  Default: 2k for generation, auto for edits.
  --quality standard|hd         Default: hd.
  --n 1                         Default: 1.
  --config /abs/config.json     Optional provider config. Default: legacy ThinkAI config.
  --base-url URL                Override OpenAI-compatible base URL.
  --model MODEL                 Override model. Default: gpt-image-2.
  --api-key-env NAME            Key environment variable. Default: THINKAI_API_KEY.
  --progress-file /abs/progress.json  Write run-scoped execution status and heartbeats.
  --request-timeout-seconds N   Request deadline. Default: 1800; does not lower image quality.
  --download-timeout-seconds N  Per-image download deadline. Default: 900.
  --heartbeat-seconds N         Progress heartbeat interval. Default: 30.
  --dry-run                     Write request snapshot without calling the network.

API key resolution order: --api-key-env, config.api_key_env, THINKAI_API_KEY, config.api_key.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.prompt || !args["output-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const outputDir = path.resolve(args["output-dir"]);
const imagePaths = args.image.map((item) => path.resolve(item));
const isEdit = imagePaths.length > 0;
const size = resolveSize(args.size || (isEdit ? "auto" : "2k"));
const quality = args.quality || "hd";
const count = Number.parseInt(args.n || "1", 10);
const progressFile = args["progress-file"] ? path.resolve(args["progress-file"]) : "";
const requestTimeoutSeconds = positiveNumber(args["request-timeout-seconds"], DEFAULT_REQUEST_TIMEOUT_SECONDS);
const downloadTimeoutSeconds = positiveNumber(args["download-timeout-seconds"], DEFAULT_DOWNLOAD_TIMEOUT_SECONDS);
const heartbeatSeconds = positiveNumber(args["heartbeat-seconds"], DEFAULT_HEARTBEAT_SECONDS);

if (!Number.isInteger(count) || count < 1) {
  throwCli("n must be a positive integer.");
}

fs.mkdirSync(outputDir, { recursive: true });

const config = loadRuntimeConfig(args.config);
const baseUrl = String(args["base-url"] || config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
const model = String(args.model || config.model || DEFAULT_MODEL);
const providerName = String(config.provider_name || config.name || "ThinkAI");
const apiKeyEnv = String(args["api-key-env"] || config.api_key_env || "THINKAI_API_KEY");
const apiKey = String(process.env[apiKeyEnv] || process.env.THINKAI_API_KEY || config.api_key || "").trim();

try {
  validateInputs(imagePaths, args.mask);
  const request = isEdit
    ? buildEditRequest({ model, prompt: args.prompt, imagePaths, maskPath: args.mask ? path.resolve(args.mask) : "", size, quality, count })
    : buildGenerationRequest({ model, prompt: args.prompt, size, quality, count });

  writeJson(path.join(outputDir, "request.json"), redactRequest(request.snapshot));
  writeProgress("request_prepared", { output_dir: outputDir, requested_size: size, quality, n: count });

  if (args["dry-run"]) {
    const summary = {
      status: "dry_run",
      provider: providerName === "ThinkAI" ? "thinkai-openai-compatible-image-runtime" : "third-party-openai-compatible-image-runtime",
      provider_name: providerName,
      base_url: baseUrl,
      model,
      endpoint: request.endpoint,
      requested_size: size,
      quality,
      n: count,
      output_dir: outputDir,
      request_path: path.join(outputDir, "request.json"),
    };
    writeJson(path.join(outputDir, "summary.json"), summary);
    writeProgress("dry_run", { summary_path: path.join(outputDir, "summary.json") });
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (!apiKey) {
    throw new RuntimeError("configuration_required", `${providerName} image API key is not configured in ${apiKeyEnv}.`);
  }

  writeProgress("generating", { endpoint: request.endpoint, progress_event: "request_started" });
  const generation = isEdit
    ? executeEdit({ baseUrl, apiKey, request, requestTimeoutSeconds })
    : executeGeneration({ baseUrl, apiKey, request, requestTimeoutSeconds });
  const response = await withHeartbeat("generating", () => generation);
  writeProgress("generating", { endpoint: request.endpoint, progress_event: "response_received" });
  writeJson(path.join(outputDir, "response.json"), response);

  writeProgress("downloading", { response_items: Array.isArray(response.data) ? response.data.length : 0, progress_event: "download_started" });
  const assets = await withHeartbeat("downloading", () => writeImagesFromResponse(response, outputDir, downloadTimeoutSeconds));
  const summary = {
    status: "generated",
    provider: providerName === "ThinkAI" ? "thinkai-openai-compatible-image-runtime" : "third-party-openai-compatible-image-runtime",
    provider_name: providerName,
    base_url: baseUrl,
    model,
    endpoint: request.endpoint,
    requested_size: size,
    quality,
    n: count,
    output_dir: outputDir,
    images: assets,
    request_path: path.join(outputDir, "request.json"),
    response_path: path.join(outputDir, "response.json"),
  };
  writeJson(path.join(outputDir, "summary.json"), summary);
  writeProgress("completed", { completed_images: assets, summary_path: path.join(outputDir, "summary.json"), progress_event: "asset_verified" });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  writeProgress("failed", { failure: publicFailure(error) });
  throwCli(JSON.stringify(publicFailure(error)));
}

function loadRuntimeConfig(configArg) {
  const candidates = configArg
    ? [path.resolve(configArg)]
    : [
        path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sellerpilot-product-image-industrial", "image-provider.json"),
        path.join(skillRoot, ".thinkai-image-runtime.json"),
      ];
  for (const configPath of candidates) {
    if (!fs.existsSync(configPath)) continue;
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.third_party && typeof config.third_party === "object") {
      return { ...config.third_party, provider_name: config.third_party.name || "ThinkAI" };
    }
    return config;
  }
  return {};
}

function resolveSize(rawSize) {
  const normalized = String(rawSize).trim().toLowerCase();
  return SIZE_ALIASES.get(normalized) || String(rawSize).trim();
}

function validateInputs(paths, maskPath) {
  for (const item of paths) {
    const stat = fs.existsSync(item) ? fs.statSync(item) : null;
    if (!stat?.isFile()) throw new Error(`Source image not found: ${item}`);
  }
  if (maskPath) {
    const resolved = path.resolve(maskPath);
    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
    if (!stat?.isFile()) throw new Error(`Mask not found: ${resolved}`);
    if (path.extname(resolved).toLowerCase() !== ".png") throw new Error("Mask must be a PNG file.");
  }
}

function buildGenerationRequest({ model, prompt, size, quality, count }) {
  const body = {
    model,
    prompt,
    n: count,
    size,
    quality,
    response_format: "url",
  };
  return {
    endpoint: "/images/generations",
    body,
    snapshot: body,
  };
}

function buildEditRequest({ model, prompt, imagePaths, maskPath, size, quality, count }) {
  return {
    endpoint: "/images/edits",
    fields: { model, prompt, size, quality, n: String(count) },
    imagePaths,
    maskPath,
    snapshot: {
      model,
      prompt,
      size,
      quality,
      n: count,
      images: imagePaths,
      mask: maskPath || null,
      response_format: "url_or_b64_json",
    },
  };
}

async function executeGeneration({ baseUrl, apiKey, request, requestTimeoutSeconds: timeoutSeconds }) {
  return requestJsonWithCurl({
    url: `${baseUrl}${request.endpoint}`,
    apiKey,
    body: request.body,
    label: "Image generation request failed",
    timeoutSeconds,
  });
}

async function executeEdit({ baseUrl, apiKey, request, requestTimeoutSeconds: timeoutSeconds }) {
  const curlArgs = [
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    String(timeoutSeconds),
    "-X",
    "POST",
    `${baseUrl}${request.endpoint}`,
    "-H",
    `Authorization: Bearer ${apiKey}`,
    "-H",
    "Accept: */*",
    "-H",
    `User-Agent: ${DEFAULT_USER_AGENT}`,
  ];
  for (const [key, value] of Object.entries(request.fields)) {
    curlArgs.push("-F", `${key}=${value}`);
  }
  for (const imagePath of request.imagePaths) {
    curlArgs.push("-F", `image=@${imagePath};type=${contentType(imagePath)}`);
  }
  if (request.maskPath) {
    curlArgs.push("-F", `mask=@${request.maskPath};type=image/png`);
  }
  const text = await runCurl(curlArgs, "Image edit request failed", { progressEvent: "provider_first_byte_received" });
  return parseJsonPayload(text, "Image edit request failed");
}

async function requestJsonWithCurl({ url, apiKey, body, label, timeoutSeconds }) {
  const text = await runCurl([
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    String(timeoutSeconds),
    "-X",
    "POST",
    url,
    "-H",
    `Authorization: Bearer ${apiKey}`,
    "-H",
    "Content-Type: application/json",
    "-H",
    "Accept: */*",
    "-H",
    `User-Agent: ${DEFAULT_USER_AGENT}`,
    "--data-binary",
    JSON.stringify(body),
  ], label, { progressEvent: "provider_first_byte_received" });
  return parseJsonPayload(text, label);
}

function runCurl(curlArgs, label, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", curlArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let firstByteRecorded = false;
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      if (!firstByteRecorded && options.progressEvent) {
        firstByteRecorded = true;
        writeProgress("generating", { progress_event: options.progressEvent });
      }
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => reject(new RuntimeError("transport_unavailable", `${label}: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(stdout));
      const detail = Buffer.concat(stderr).toString("utf8").trim() || Buffer.concat(stdout).toString("utf8").trim();
      reject(new RuntimeError(signal ? "cancelled" : "provider_request_failed", `${label}: ${detail || `curl exited with ${code}`}`));
    });
    const onSignal = () => child.kill("SIGTERM");
    process.once("SIGINT", onSignal);
    child.once("close", () => process.removeListener("SIGINT", onSignal));
  });
}

function parseJsonPayload(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: non-JSON response ${String(text).slice(0, 1000)}`);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function writeImagesFromResponse(response, dir, timeoutSeconds) {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new Error(`Unexpected image response payload: ${JSON.stringify(response).slice(0, 1000)}`);
  }
  const assets = await mapWithConcurrency(response.data, 2, async (item, index) => {
    const imageBytes = item.b64_json ? Buffer.from(item.b64_json, "base64") : await downloadImageBytes(item.url, timeoutSeconds);
    if (!imageBytes?.length) throw new Error(`Image response item ${index} did not include url or b64_json.`);
    const dimensions = detectImageSize(imageBytes);
    if (!dimensions) throw new RuntimeError("invalid_image_payload", `Image response item ${index} was not a decodable PNG, JPEG, or WebP image.`);
    const filename = response.data.length === 1 ? "image.png" : `image-${String(index + 1).padStart(2, "0")}.png`;
    const imagePath = path.join(dir, filename);
    fs.writeFileSync(imagePath, imageBytes);
    writeProgress("downloading", { completed_downloads: index + 1, total_downloads: response.data.length, progress_event: "download_item_verified" });
    return {
      image_path: imagePath,
      image_url: item.url || null,
      actual_size: dimensions,
    };
  });
  return assets;
}

async function downloadImageBytes(url, timeoutSeconds) {
  if (!url) throw new Error("Image response item is missing url.");
  return runCurl([
    "-L",
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    String(timeoutSeconds),
    "-H",
    "Accept: */*",
    "-H",
    `User-Agent: ${DEFAULT_USER_AGENT}`,
    url,
  ], "Image download failed", { progressEvent: "download_first_byte_received" });
}

function detectImageSize(bytes) {
  if (bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  }
  if (bytes.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  })).then(() => results);
}

function writeProgress(status, details = {}) {
  if (!progressFile) return;
  const existing = readJsonSafe(progressFile);
  const now = new Date().toISOString();
  const existingRuntime = existing.runtime || {};
  const event = details.progress_event;
  const eventHistory = Array.isArray(existingRuntime.meaningful_progress_events)
    ? existingRuntime.meaningful_progress_events.slice(-24)
    : [];
  if (event) eventHistory.push({ event, at: now });
  fs.mkdirSync(path.dirname(progressFile), { recursive: true });
  writeJson(progressFile, {
    ...existing,
    status,
    updated_at: now,
    runtime: {
      ...existingRuntime,
      provider: providerName,
      model,
      api_key_env: apiKeyEnv,
      heartbeat_seconds: heartbeatSeconds,
      ...details,
      last_meaningful_progress_at: event ? now : existingRuntime.last_meaningful_progress_at || null,
      meaningful_progress_events: eventHistory,
    },
  });
}

async function withHeartbeat(status, task) {
  const timer = setInterval(() => writeProgress(status, { heartbeat: true, waiting: true }), heartbeatSeconds * 1000);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function positiveNumber(raw, fallback) {
  const value = Number(raw || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function publicFailure(error) {
  const code = error?.code || "generation_failed";
  const message = code === "configuration_required"
    ? "ThinkAI requires a configured API key before generation can start."
    : code === "cancelled"
      ? "Generation was cancelled; completed assets remain available for recovery."
      : "Image generation could not complete. The run state was preserved so only affected assets need retrying.";
  return { code, message };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function redactRequest(request) {
  return JSON.parse(JSON.stringify(request));
}

function throwCli(message) {
  console.error(message);
  process.exit(1);
}
