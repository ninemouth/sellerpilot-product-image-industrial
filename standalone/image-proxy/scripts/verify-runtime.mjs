#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const skillRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-proxy-verify-"));
const runtime = path.join(skillRoot, "scripts", "openai-compatible-image-runtime.mjs");
const configure = path.join(skillRoot, "scripts", "configure-image-provider.mjs");
const interactive = path.join(skillRoot, "scripts", "configure-image-provider-interactive.mjs");
const resolver = path.join(skillRoot, "scripts", "resolve-provider.mjs");

try {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const metadata = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  const packageJson = readJson(path.join(skillRoot, "package.json"));
  assert(/^---\nname: image-proxy\ndescription: \S[\s\S]*?\n---\n/.test(skill), "SKILL.md must contain valid standalone-skill frontmatter");
  assert(skill.split("\n").length < 500, "SKILL.md must stay below 500 lines");
  assert(metadata.includes('display_name: "Image Proxy"'), "agents/openai.yaml must expose the standalone provider name");
  assert(metadata.includes("$image-proxy"), "agents/openai.yaml default_prompt must name the skill");
  assert(packageJson.scripts?.verify === "node scripts/verify-runtime.mjs", "package.json must expose the standalone verifier");
  assert(!skill.includes("scripts/thinkai-image-runtime.mjs") && !skill.includes("record-provider-call.mjs"), "instructions must not depend on the source runtime or provider ledger");

  for (const file of [runtime, configure, interactive, resolver, path.join(skillRoot, "scripts", "codex-path-info.mjs")]) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert(result.status === 0, result.stderr || `syntax check failed: ${file}`);
  }

  const generationDir = path.join(tempRoot, "generation");
  const generation = run(runtime, ["--prompt", "verify dry run", "--output-dir", generationDir, "--dry-run"]);
  const generationSummary = readJson(path.join(generationDir, "summary.json"));
  const generationRequest = readJson(path.join(generationDir, "request.json"));
  assert(generationSummary.status === "dry_run", "generation dry-run must complete without a network call");
  assert(generationSummary.endpoint === "/images/generations", "generation dry-run must use /images/generations");
  assert(generationSummary.base_url === "https://www.thinkai.tv/v1", "default provider base URL must remain ThinkAI");
  assert(generationSummary.model === "gpt-image-2", "default provider model must remain gpt-image-2");
  assert(generationRequest.response_format === "url", "generation request must request URL responses");

  const source = path.join(tempRoot, "source.png");
  const mask = path.join(tempRoot, "mask.png");
  fs.writeFileSync(source, Buffer.from("source-fixture"));
  fs.writeFileSync(mask, Buffer.from("mask-fixture"));
  const editDir = path.join(tempRoot, "edit");
  run(runtime, ["--prompt", "verify edit dry run", "--image", source, "--mask", mask, "--output-dir", editDir, "--dry-run"]);
  const editSummary = readJson(path.join(editDir, "summary.json"));
  const editRequest = readJson(path.join(editDir, "request.json"));
  assert(editSummary.endpoint === "/images/edits", "source-image dry-run must use /images/edits");
  assert(editRequest.images.length === 1 && editRequest.mask === mask, "edit dry-run must preserve image and mask references");

  const configPath = path.join(tempRoot, "image-provider.json");
  const configured = spawnSync(process.execPath, [configure, "--config", configPath, "--api-key-stdin", "--name", "Acme", "--base-url", "https://images.example/v1", "--model", "acme-image", "--api-key-env", "ACME_IMAGE_KEY"], { input: "verify-key\n", encoding: "utf8" });
  assert(configured.status === 0, configured.stderr || "stdin provider configuration failed");
  assert(!configured.stdout.includes("verify-key"), "provider configuration must not print the API key");
  const config = readJson(configPath);
  assert(config.third_party.name === "Acme" && config.third_party.model === "acme-image", "provider config must preserve explicit provider values");
  assert(config.third_party.api_key === "verify-key", "provider config must receive the key through stdin");
  if (process.platform !== "win32") assert((fs.statSync(configPath).mode & 0o077) === 0, "provider config must not be group/world readable");

  const resolved = run(resolver, ["--config", configPath]);
  const resolution = JSON.parse(resolved);
  assert(resolution.status === "ready" && resolution.provider.base_url === "https://images.example/v1", "resolver must expose the configured third-party endpoint without the key");
  assert(!resolved.includes("verify-key"), "resolver must not print the API key");
  const customDir = path.join(tempRoot, "custom");
  run(runtime, ["--config", configPath, "--prompt", "custom provider dry run", "--output-dir", customDir, "--dry-run"]);
  const customSummary = readJson(path.join(customDir, "summary.json"));
  assert(customSummary.provider_name === "Acme" && customSummary.model === "acme-image", "runtime must load the configured provider independently");

  const missingKeyDir = path.join(tempRoot, "missing-key");
  const missingKey = spawnSync(process.execPath, [runtime, "--api-key-env", "PROXY_VERIFY_MISSING_KEY", "--prompt", "must not call network", "--output-dir", missingKeyDir], {
    cwd: skillRoot,
    env: { ...process.env, PROXY_VERIFY_MISSING_KEY: "", THINKAI_IMAGE_API_KEY: "", THINKAI_API_KEY: "" },
    encoding: "utf8",
  });
  assert(missingKey.status !== 0 && `${missingKey.stdout}\n${missingKey.stderr}`.includes("configuration_required"), "runtime must block missing-key execution before network transport");
  assert(!fs.existsSync(path.join(missingKeyDir, "response.json")), "missing-key execution must not create a provider response");

  const interactiveDryRun = run(interactive, ["--dry-run"]);
  const interactiveReport = JSON.parse(interactiveDryRun);
  assert(interactiveReport.status === "ready" && interactiveReport.key_output === "never_printed", "interactive configuration must provide a masked, non-printing path");

  console.log(JSON.stringify({ status: "pass", checks: 24, network_calls: 0, fixture: crypto.createHash("sha256").update(tempRoot).digest("hex").slice(0, 12) }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: skillRoot, encoding: "utf8" });
  assert(result.status === 0, result.stderr || result.stdout || `command failed: ${file}`);
  return result.stdout;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }
