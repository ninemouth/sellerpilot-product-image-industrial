#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const skillRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "image-proxy-verify-"));
const runtime = path.join(skillRoot, "scripts", "openai-compatible-image-runtime.mjs");
const configure = path.join(skillRoot, "scripts", "configure-image-provider.mjs");
const interactive = path.join(skillRoot, "scripts", "configure-image-provider-interactive.mjs");
const resolver = path.join(skillRoot, "scripts", "resolve-provider.mjs");
const syncProvider = path.join(skillRoot, "scripts", "sync-marqel-provider.mjs");

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

  for (const file of [runtime, configure, interactive, resolver, syncProvider, path.join(skillRoot, "scripts", "codex-path-info.mjs")]) {
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

  const managedCodexHome = path.join(tempRoot, "managed-codex-home");
  const managedConfigPath = path.join(managedCodexHome, "image-proxy", "image-provider.json");
  const mockClientPath = path.join(tempRoot, "mock-control-center-client.mjs");
  const ackLogPath = path.join(tempRoot, "config-acks.jsonl");
  fs.writeFileSync(mockClientPath, `import fs from "node:fs";\nexport async function requestControlCenter(pathname, options = {}) {\n  if (pathname.startsWith("/api/client-config?")) return JSON.parse(process.env.MARQEL_SYNC_FIXTURE_PAYLOAD);\n  if (pathname === "/api/client-config/ack") { fs.appendFileSync(process.env.MARQEL_SYNC_ACK_LOG, JSON.stringify(options.body) + "\\n"); return { accepted: true }; }\n  throw new Error("unexpected fixture request");\n}\n`);
  const managedKey = "managed-user-image-key";
  const managedDigest = "a".repeat(64);
  const managedPayload = {
    targetId: "sellerpilot-image",
    status: "configured",
    config: {
      contractVersion: "marqel-client-config.v1",
      targetId: "sellerpilot-image",
      deliveryRevision: "scene:2;llm:0;image:4",
      deliveryDigest: managedDigest,
      image: { provider: "Managed Fixture", baseUrl: "https://images.example/v1", model: "managed-image-v2", enabled: true, apiKey: managedKey },
      resolution: { modelProfileIds: { imageProfileId: "managed-image-primary" } },
    },
  };
  const managedSync = spawnSync(process.execPath, [syncProvider, "--force", "--config", managedConfigPath, "--control-center-client", mockClientPath], {
    cwd: skillRoot,
    env: { ...process.env, CODEX_HOME: managedCodexHome, MARQEL_SYNC_FIXTURE_PAYLOAD: JSON.stringify(managedPayload), MARQEL_SYNC_ACK_LOG: ackLogPath },
    encoding: "utf8",
  });
  assert(managedSync.status === 0, managedSync.stderr || "Web-managed provider synchronization failed");
  assert(!`${managedSync.stdout}\n${managedSync.stderr}`.includes(managedKey), "provider synchronization must not print the delivered API key");
  const managedSyncResult = JSON.parse(managedSync.stdout);
  assert(managedSyncResult.status === "applied" && managedSyncResult.delivery_digest === managedDigest, "provider synchronization must report the applied delivery identity");
  const managedConfig = readJson(managedConfigPath);
  assert(managedConfig.third_party.api_key === managedKey, "provider synchronization must persist the delivered user-scoped key");
  assert(managedConfig.third_party.base_url === "https://images.example/v1" && managedConfig.third_party.model === "managed-image-v2", "provider synchronization must map the delivered Base URL and model");
  assert(managedConfig._marqel.managed === true && managedConfig._marqel.status === "applied", "provider synchronization must persist non-secret managed delivery metadata");
  if (process.platform !== "win32") assert((fs.statSync(managedConfigPath).mode & 0o077) === 0, "Web-managed provider config must not be group/world readable");
  const ack = JSON.parse(fs.readFileSync(ackLogPath, "utf8").trim().split(/\r?\n/).at(-1));
  assert(ack.status === "applied" && ack.deliveryDigest === managedDigest && ack.activeProfileId === "managed-image-primary", "provider synchronization must acknowledge only the applied delivery");
  assert(!JSON.stringify(ack).includes(managedKey), "provider acknowledgement must not contain the delivered API key");
  const managedResolution = run(resolver, ["--config", managedConfigPath]);
  assert(!managedResolution.includes(managedKey), "managed provider resolution must not print the delivered API key");
  assert(JSON.parse(managedResolution).marqel.delivery_digest === managedDigest, "managed provider resolution must expose only non-secret delivery metadata");

  const siblingSkillsRoot = path.join(tempRoot, ".agents", "skills");
  const siblingImageRoot = path.join(siblingSkillsRoot, "image-proxy");
  const siblingAuthScripts = path.join(siblingSkillsRoot, "marqel-control-center-auth", "scripts");
  const siblingConfigPath = path.join(managedCodexHome, "image-proxy", "sibling-provider.json");
  await fs.promises.mkdir(siblingImageRoot, { recursive: true });
  await fs.promises.mkdir(siblingAuthScripts, { recursive: true });
  await fs.promises.writeFile(path.join(siblingAuthScripts, "control-center-client.mjs"), `export async function requestControlCenter(pathname) {\n  if (pathname.startsWith("/api/client-config?")) return ${JSON.stringify(managedPayload)};\n  if (pathname === "/api/client-config/ack") return { accepted:true };\n  throw new Error("unexpected fixture request");\n}\n`);
  const syncModule = await import(`${pathToFileURL(syncProvider).href}?verify=${Date.now()}`);
  const siblingSync = await syncModule.syncManagedMarqelProviderIfRequired({ skillRoot: siblingImageRoot, force: true, configPath: siblingConfigPath });
  assert(siblingSync.status === "applied", "managed sync must discover Auth from the same current Skill root");
  assert(readJson(siblingConfigPath).third_party.api_key === managedKey, "same-root Auth discovery must apply the delivered key securely");

  let authorizationCompleted = false;
  let automaticRequestCount = 0;
  const automaticConfigPath = path.join(managedCodexHome, "image-proxy", "automatic-provider.json");
  const automaticSync = await syncModule.syncMarqelProvider({
    skillRoot: siblingImageRoot,
    configPath: automaticConfigPath,
    requestControlCenter: async (pathname) => {
      if (pathname === "/api/client-config/ack") return { accepted: true };
      automaticRequestCount += 1;
      if (!authorizationCompleted) throw Object.assign(new Error("session missing"), { code: "auth_required" });
      return managedPayload;
    },
    authorizeDevice: async () => { authorizationCompleted = true; return { status: "authorized" }; },
  });
  assert(automaticRequestCount === 2 && automaticSync.status === "applied", "missing authorization must start Web approval and automatically retry the same config pull");
  assert(readJson(automaticConfigPath).third_party.api_key === managedKey, "automatic authorization retry must finish local provider configuration without copy/paste");

  const unavailableConfigPath = path.join(managedCodexHome, "image-proxy", "unavailable-provider.json");
  const unavailableSync = spawnSync(process.execPath, [syncProvider, "--force", "--config", unavailableConfigPath, "--control-center-client", mockClientPath], {
    cwd: skillRoot,
    env: { ...process.env, CODEX_HOME: managedCodexHome, MARQEL_SYNC_FIXTURE_PAYLOAD: JSON.stringify({ targetId: "sellerpilot-image", status: "not_configured", config: null }), MARQEL_SYNC_ACK_LOG: ackLogPath },
    encoding: "utf8",
  });
  assert(unavailableSync.status === 0 && JSON.parse(unavailableSync.stdout).status === "not_configured", "an unavailable Web configuration must synchronize as a non-secret disabled state");
  const unavailableConfig = readJson(unavailableConfigPath);
  assert(unavailableConfig.third_party.enabled === false && !unavailableConfig.third_party.api_key, "an unavailable Web configuration must not retain a provider key");

  console.log(JSON.stringify({ status: "pass", checks: 44, network_calls: 0, fixture: crypto.createHash("sha256").update(tempRoot).digest("hex").slice(0, 12) }, null, 2));
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
