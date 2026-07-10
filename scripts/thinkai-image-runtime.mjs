#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_BASE_URL = "https://www.thinkai.tv/v1";
const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_USER_AGENT = "curl/8.7.1";
const SIZE_ALIASES = new Map([
  ["1k", "1920x1088"],
  ["2k", "2560x1440"],
  ["4k", "3840x2160"],
]);

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
  --config /abs/config.json     Optional local config. Default: .thinkai-image-runtime.json.
  --base-url URL                Override ThinkAI-compatible base URL.
  --model MODEL                 Override model. Default: gpt-image-2.
  --dry-run                     Write request snapshot without calling the network.

API key resolution order: THINKAI_API_KEY, config.api_key.`);
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

if (!Number.isInteger(count) || count < 1) {
  throwCli("n must be a positive integer.");
}

fs.mkdirSync(outputDir, { recursive: true });

const config = loadRuntimeConfig(args.config);
const baseUrl = String(args["base-url"] || config.base_url || DEFAULT_BASE_URL).replace(/\/+$/, "");
const model = String(args.model || config.model || DEFAULT_MODEL);
const apiKey = String(process.env.THINKAI_API_KEY || config.api_key || "").trim();

try {
  validateInputs(imagePaths, args.mask);
  const request = isEdit
    ? buildEditRequest({ model, prompt: args.prompt, imagePaths, maskPath: args.mask ? path.resolve(args.mask) : "", size, quality, count })
    : buildGenerationRequest({ model, prompt: args.prompt, size, quality, count });

  writeJson(path.join(outputDir, "request.json"), redactRequest(request.snapshot));

  if (args["dry-run"]) {
    const summary = {
      status: "dry_run",
      provider: "thinkai-openai-compatible-image-runtime",
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
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (!apiKey) {
    throwCli(
      "Missing ThinkAI API key. Set THINKAI_API_KEY or create .thinkai-image-runtime.json with api_key.",
    );
  }

  const response = isEdit
    ? await executeEdit({ baseUrl, apiKey, request })
    : await executeGeneration({ baseUrl, apiKey, request });
  writeJson(path.join(outputDir, "response.json"), response);

  const assets = await writeImagesFromResponse(response, outputDir);
  const summary = {
    status: "generated",
    provider: "thinkai-openai-compatible-image-runtime",
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
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  throwCli(error.message);
}

function loadRuntimeConfig(configArg) {
  const configPath = configArg
    ? path.resolve(configArg)
    : path.join(skillRoot, ".thinkai-image-runtime.json");
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
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

async function executeGeneration({ baseUrl, apiKey, request }) {
  return requestJsonWithCurl({
    url: `${baseUrl}${request.endpoint}`,
    apiKey,
    body: request.body,
    label: "Image generation request failed",
  });
}

async function executeEdit({ baseUrl, apiKey, request }) {
  const curlArgs = [
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    "1800",
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
  const text = runCurl(curlArgs, "Image edit request failed");
  return parseJsonPayload(text, "Image edit request failed");
}

function requestJsonWithCurl({ url, apiKey, body, label }) {
  const text = runCurl([
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    "1800",
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
  ], label);
  return parseJsonPayload(text, label);
}

function runCurl(curlArgs, label) {
  const result = spawnSync("curl", curlArgs, {
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.status === 0) return result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8").trim();
  const stdout = result.stdout.toString("utf8").trim();
  const detail = stderr || stdout || `curl exited with ${result.status}`;
  throw new Error(`${label}: ${detail}`);
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

async function writeImagesFromResponse(response, dir) {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new Error(`Unexpected image response payload: ${JSON.stringify(response).slice(0, 1000)}`);
  }
  const assets = [];
  for (const [index, item] of response.data.entries()) {
    const imageBytes = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadImageBytes(item.url);
    if (!imageBytes?.length) throw new Error(`Image response item ${index} did not include url or b64_json.`);
    const filename = response.data.length === 1 ? "image.png" : `image-${String(index + 1).padStart(2, "0")}.png`;
    const imagePath = path.join(dir, filename);
    fs.writeFileSync(imagePath, imageBytes);
    assets.push({
      image_path: imagePath,
      image_url: item.url || null,
      actual_size: detectPngSize(imageBytes),
    });
  }
  return assets;
}

async function downloadImageBytes(url) {
  if (!url) throw new Error("Image response item is missing url.");
  const result = spawnSync("curl", [
    "-L",
    "--silent",
    "--show-error",
    "--fail",
    "--connect-timeout",
    "30",
    "--max-time",
    "900",
    "-H",
    "Accept: */*",
    "-H",
    `User-Agent: ${DEFAULT_USER_AGENT}`,
    url,
  ], {
    encoding: "buffer",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (result.status === 0 && result.stdout?.length) return result.stdout;
  const stderr = result.stderr.toString("utf8").trim();
  const stdout = result.stdout.toString("utf8").trim();
  throw new Error(`Image download failed: ${stderr || stdout || `curl exited with ${result.status}`}`);
}

function detectPngSize(bytes) {
  if (bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  }
  return "unknown";
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
