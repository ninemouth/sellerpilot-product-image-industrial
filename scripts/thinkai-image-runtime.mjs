#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { normalizeProviderCapabilities, resolveCapabilityValue, resolveProviderSize } from "./lib/provider-capabilities.mjs";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_API_KEY_ENV = "THINKAI_IMAGE_API_KEY";
const LEGACY_API_KEY_ENV = "THINKAI_API_KEY";
const DEFAULT_USER_AGENT = "curl/8.7.1";
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
  --size SIZE                   Platform generation target. Omit only for a direct provider-default request.
  --quality auto|low|medium|high Provider capability default when omitted.
  --n 1                         Default: 1.
  --config /abs/config.json     Optional provider config. Default: legacy ThinkAI config.
  --base-url URL                Override OpenAI-compatible base URL.
  --model MODEL                 Override model. Default: gpt-image-2.
  --api-key-env NAME            Key environment variable. Default: THINKAI_IMAGE_API_KEY.
  --provider-resolution FILE    Optional resolver output; preserves a non-default third-party route.
  --progress-file /abs/progress.json  Write run-scoped execution status and heartbeats.
  --request-timeout-seconds N   Request deadline. Default: 1800; does not lower image quality.
  --download-timeout-seconds N  Per-image download deadline. Default: 900.
  --heartbeat-seconds N         Progress heartbeat interval. Default: 30.
  --run-dir /abs/run            Optional compiled Loop Engineering run for provider budget/ledger recording.
  --role IMG-01                 Required with --run-dir; binds this call to one final-image role.
  --dry-run                     Write request snapshot without calling the network.

API key resolution order: --api-key-env, config.api_key_env, THINKAI_IMAGE_API_KEY, legacy THINKAI_API_KEY, config.api_key.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.prompt || !args["output-dir"]) usage();

const skillRoot = skillRootFrom(import.meta.url);
const outputDir = path.resolve(args["output-dir"]);
const imagePaths = args.image.map((item) => path.resolve(item));
const isEdit = imagePaths.length > 0;
const count = Number.parseInt(args.n || "1", 10);
const progressFile = args["progress-file"] ? path.resolve(args["progress-file"]) : "";
const runDir = args["run-dir"] ? path.resolve(args["run-dir"]) : "";
const runRole = args.role ? String(args.role) : "";
const requestTimeoutSeconds = positiveNumber(args["request-timeout-seconds"], DEFAULT_REQUEST_TIMEOUT_SECONDS);
const downloadTimeoutSeconds = positiveNumber(args["download-timeout-seconds"], DEFAULT_DOWNLOAD_TIMEOUT_SECONDS);
const heartbeatSeconds = positiveNumber(args["heartbeat-seconds"], DEFAULT_HEARTBEAT_SECONDS);

if (!Number.isInteger(count) || count < 1) {
  throwCli("n must be a positive integer.");
}
if (runDir && !runRole) throwCli("--role is required when --run-dir is provided.");

fs.mkdirSync(outputDir, { recursive: true });

const config = loadRuntimeConfig(args.config, args["provider-resolution"]);
const baseUrl = String(args["base-url"] || config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
const model = String(args.model || config.model || DEFAULT_MODEL);
const providerName = String(config.provider_name || config.name || "ThinkAI");
const apiKeyEnv = String(args["api-key-env"] || config.api_key_env || DEFAULT_API_KEY_ENV);
const configuredApiKey = String(config.api_key || "").trim();
const environmentApiKey = String(process.env[apiKeyEnv] || (providerName === "ThinkAI" && (process.env[DEFAULT_API_KEY_ENV] || process.env[LEGACY_API_KEY_ENV])) || "").trim();
const apiKey = configuredApiKey || environmentApiKey;
const credentialSource = configuredApiKey ? "local_provider_config" : environmentApiKey ? "environment" : "missing";
const capabilities = normalizeProviderCapabilities(config.capabilities);
const size = resolveProviderSize({ requested: args.size, capabilities });
const quality = resolveCapabilityValue({ requested: args.quality, capability: capabilities.quality, label: "quality" });
const responseFormat = resolveCapabilityValue({ requested: args["response-format"], capability: capabilities.response_format, label: "response_format" });

try {
  validateInputs(imagePaths, args.mask);
  const request = isEdit
    ? buildEditRequest({ model, prompt: args.prompt, imagePaths, maskPath: args.mask ? path.resolve(args.mask) : "", size, quality, responseFormat, count })
    : buildGenerationRequest({ model, prompt: args.prompt, size, quality, responseFormat, count });

  writeJson(path.join(outputDir, "request.json"), redactRequest(request.snapshot));
  writeProgress("request_prepared", { output_dir: outputDir, requested_size: size, quality, n: count, request_timeout_seconds: requestTimeoutSeconds });

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
      credential_source: credentialSource,
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

  recordProviderAttempt("requested");

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
    credential_source: credentialSource,
    n: count,
    output_dir: outputDir,
    images: assets,
    request_path: path.join(outputDir, "request.json"),
    response_path: path.join(outputDir, "response.json"),
  };
  writeJson(path.join(outputDir, "summary.json"), summary);
  writeProgress("completed", { completed_images: assets, summary_path: path.join(outputDir, "summary.json"), progress_event: "asset_verified" });
  recordProviderAttempt("succeeded");
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  writeProviderFailureDiagnostic(error);
  writeProgress("failed", { failure: publicFailure(error) });
  // A host-side egress failure means no request reached the provider. It is not
  // a second user-authorization step and must not consume a billable-provider
  // retry or evidence-delta retry slot.
  if (error?.code !== "external_provider_transport_unavailable") recordProviderAttempt("failed", true);
  throwCli(JSON.stringify(publicFailure(error)));
}

function recordProviderAttempt(status, suppressFailure = false) {
  if (!runDir) return;
  const recorder = path.join(skillRoot, "scripts", "record-provider-call.mjs");
  const sourceHash = imagePaths.map((file) => {
    try { return `${file}:${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}`; } catch { return file; }
  }).join("|");
  const result = spawnSync(process.execPath, [
    recorder,
    "--run-dir", runDir,
    "--role", runRole,
    "--status", status,
    "--prompt-hash", args.prompt,
    "--source-hash", sourceHash,
    "--provider", providerName,
    "--model", model,
    "--triggering-gate", "thinkai-image-runtime",
  ], { cwd: skillRoot, encoding: "utf8" });
  if (result.status !== 0 && !suppressFailure) {
    throw new RuntimeError("provider_budget_or_evidence_delta_blocked", (result.stderr || result.stdout || "Provider call was blocked by run budget.").trim());
  }
}

function loadRuntimeConfig(configArg, resolutionArg) {
  if (resolutionArg) {
    const resolution = readJsonSafe(path.resolve(resolutionArg));
    if (resolution?.selected_mode === "third_party_proxy" && resolution.provider) {
      return { ...resolution.provider, provider_name: resolution.provider.name || "third-party provider" };
    }
  }
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

function buildGenerationRequest({ model, prompt, size, quality, responseFormat, count }) {
  const body = {
    model,
    prompt,
    n: count,
    quality,
    response_format: responseFormat,
  };
  if (size) body.size = size;
  return {
    endpoint: "/images/generations",
    body,
    snapshot: body,
  };
}

function buildEditRequest({ model, prompt, imagePaths, maskPath, size, quality, responseFormat, count }) {
  return {
    endpoint: "/images/edits",
    fields: { model, prompt, ...(size ? { size } : {}), quality, response_format: responseFormat, n: String(count) },
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
      response_format: responseFormat,
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
      const errorCode = signal
        ? "cancelled"
        : isExternalProviderTransportFailure(detail)
          ? "external_provider_transport_unavailable"
          : "provider_request_failed";
      reject(new RuntimeError(errorCode, `${label}: ${detail || `curl exited with ${code}`}`));
    });
    const onSignal = () => child.kill("SIGTERM");
    process.once("SIGINT", onSignal);
    child.once("close", () => process.removeListener("SIGINT", onSignal));
  });
}

function isExternalProviderTransportFailure(detail) {
  // Some hosts report unavailable external egress as curl's "Bad access".
  // Third-party provider execution is authorized by its configured setup; this
  // is a runtime connectivity failure, not a request for another user consent.
  // Keep the detector narrow so provider, credential, TLS, and other network
  // failures retain their existing classifications.
  return /\bBad access\b/i.test(String(detail || ""));
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
    const inlineUrl = typeof item.url === "string" && item.url.startsWith("data:image/");
    const imageBytes = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : inlineUrl
        ? decodeDataImageUrl(item.url)
        : await downloadImageBytes(item.url, timeoutSeconds);
    if (!imageBytes?.length) throw new Error(`Image response item ${index} did not include url or b64_json.`);
    const dimensions = detectImageSize(imageBytes);
    if (!dimensions) throw new RuntimeError("invalid_image_payload", `Image response item ${index} was not a decodable PNG, JPEG, or WebP image.`);
    const filename = response.data.length === 1 ? "image.png" : `image-${String(index + 1).padStart(2, "0")}.png`;
    const imagePath = path.join(dir, filename);
    fs.writeFileSync(imagePath, imageBytes);
    writeProgress("downloading", { completed_downloads: index + 1, total_downloads: response.data.length, progress_event: "download_item_verified" });
    return {
      image_path: imagePath,
      image_url: inlineUrl ? null : item.url || null,
      inline_data_url: inlineUrl || undefined,
      actual_size: dimensions,
    };
  });
  return assets;
}

function decodeDataImageUrl(value) {
  const match = String(value).match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) throw new RuntimeError("invalid_image_payload", "Image response data URL was not a supported base64 image payload.");
  return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
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
    : code === "external_provider_transport_unavailable"
      ? "The configured external image provider could not be reached from this runtime. No provider request was sent; preserve the affected asset and restore provider connectivity through skill setup or update before retrying the same route."
    : code === "cancelled"
      ? "Generation was cancelled; completed assets remain available for recovery."
      : "Image generation could not complete. The run state was preserved so only affected assets need retrying.";
  return { code, message };
}

function writeProviderFailureDiagnostic(error) {
  if (!runDir) return;
  const raw = String(error?.message || "");
  const statusMatch = raw.match(/\b([45]\d\d)\b/);
  const curlExitMatch = raw.match(/curl exited with (\d+)/i);
  const code = String(error?.code || "generation_failed");
  const diagnostic = {
    schema_version: "sellerpilot.provider_failure_diagnostic.v1",
    recorded_at: new Date().toISOString(),
    provider: providerName,
    model,
    role: runRole || null,
    stage: code === "provider_request_failed" ? "provider_request" : code === "external_provider_transport_unavailable" ? "external_provider_transport" : code === "invalid_image_payload" ? "asset_validation" : code === "configuration_required" ? "configuration" : code,
    error_code: code,
    http_status: statusMatch ? Number(statusMatch[1]) : null,
    curl_exit_code: curlExitMatch ? Number(curlExitMatch[1]) : null,
    retryable: code === "provider_request_failed" && (!statusMatch || Number(statusMatch[1]) >= 500),
    policy: "Internal diagnostic only. It intentionally excludes API keys, base URLs, request bodies, response bodies, local paths, and raw transport errors.",
  };
  const diagnosticsDir = path.join(runDir, "runtime");
  fs.mkdirSync(diagnosticsDir, { recursive: true });
  writeJson(path.join(diagnosticsDir, `provider-failure-diagnostic-${normalizeRoleForDiagnostic(runRole) || "unbound"}.json`), diagnostic);
}

function normalizeRoleForDiagnostic(value) {
  const match = String(value || "").match(/(?:IMG|POSTER|DETAIL)[-_ ]?(\d{1,2})/i);
  return match ? `img-${match[1].padStart(2, "0")}` : "";
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
