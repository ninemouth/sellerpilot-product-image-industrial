#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const TARGET_ID = "sellerpilot-image";
const CONFIG_CONTRACT = "marqel-client-config.v1";
const ACK_CONTRACT = "marqel-client-config-ack.v1";
const API_KEY_ENV = "MARQEL_IMAGE_PROXY_API_KEY";

export class MarqelProviderSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "") : "";
}

function codexHome() {
  return path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
}

function defaultConfigPath() {
  return path.join(codexHome(), "image-proxy", "image-provider.json");
}

function defaultControlCenterClientPath(skillRoot) {
  return path.join(path.dirname(path.resolve(skillRoot)), "marqel-control-center-auth", "scripts", "control-center-client.mjs");
}

async function managedRelease(skillRoot) {
  try {
    const release = JSON.parse(await fs.readFile(path.join(skillRoot, ".marqel-skill-release.json"), "utf8"));
    return release?.contractVersion === "marqel-installed-skill-release.v1" && release?.id === "image-proxy"
      ? release
      : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new MarqelProviderSyncError("managed_release_invalid", "The managed image-proxy release metadata is invalid.");
  }
}

function secureProviderUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new MarqelProviderSyncError("provider_config_invalid", "The Web-managed image Provider Base URL is invalid.");
  }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new MarqelProviderSyncError("provider_config_invalid", "The Web-managed image Provider must use HTTPS outside loopback development.");
  }
  if (url.username || url.password || url.hash) {
    throw new MarqelProviderSyncError("provider_config_invalid", "The Web-managed image Provider URL must not contain credentials or a fragment.");
  }
  for (const name of url.searchParams.keys()) {
    const normalized = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    if (/(?:^|_)(?:api_?key|token|secret|password|authorization|credential)(?:$|_)/.test(normalized)) {
      throw new MarqelProviderSyncError("provider_config_invalid", "The Web-managed image Provider URL must not contain credential query parameters.");
    }
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

function deliveryIdentity(config) {
  const deliveryRevision = String(config?.deliveryRevision || "").trim().slice(0, 240);
  const deliveryDigest = String(config?.deliveryDigest || "").trim().toLowerCase();
  if (!deliveryRevision || !/^[a-f0-9]{64}$/.test(deliveryDigest)) {
    throw new MarqelProviderSyncError("provider_config_invalid", "The Web-managed image Provider delivery identity is invalid.");
  }
  return { deliveryRevision, deliveryDigest };
}

function appliedProviderConfig(payload, now = new Date().toISOString()) {
  if (payload?.targetId !== TARGET_ID || payload?.config?.contractVersion !== CONFIG_CONTRACT) {
    throw new MarqelProviderSyncError("provider_config_invalid", "The Control Center returned an unexpected image Provider target or contract.");
  }
  const config = payload.config;
  const identity = deliveryIdentity(config);
  const image = config.image && typeof config.image === "object" ? config.image : {};
  const apiKey = String(image.apiKey || "").trim();
  const model = String(image.model || "").trim();
  if (image.enabled === false || !apiKey || !model) {
    throw new MarqelProviderSyncError("configuration_required", "The Web-managed image Provider configuration is incomplete.");
  }
  const baseUrl = secureProviderUrl(image.baseUrl);
  const activeProfileId = String(config.resolution?.modelProfileIds?.imageProfileId || "").trim().slice(0, 120);
  return {
    config: {
      provider_mode: "third_party_proxy",
      third_party: {
        enabled: true,
        name: String(image.provider || "Marqel Web-managed Provider").trim().slice(0, 160),
        base_url: baseUrl,
        model,
        api_key_env: API_KEY_ENV,
        api_key: apiKey,
      },
      _marqel: {
        managed: true,
        status: "applied",
        target_id: TARGET_ID,
        delivery_revision: identity.deliveryRevision,
        delivery_digest: identity.deliveryDigest,
        active_profile_id: activeProfileId,
        synced_at: now,
      },
    },
    identity,
    activeProfileId,
    publicResult: {
      status: "applied",
      target_id: TARGET_ID,
      delivery_revision: identity.deliveryRevision,
      delivery_digest: identity.deliveryDigest,
      active_profile_id: activeProfileId,
      provider_name: String(image.provider || "Marqel Web-managed Provider").trim().slice(0, 160),
      model,
      key_configured: true,
    },
  };
}

function unavailableProviderConfig(status, now = new Date().toISOString()) {
  return {
    provider_mode: "third_party_proxy",
    third_party: {
      enabled: false,
      name: "Marqel Web-managed Provider",
      base_url: "",
      model: "",
      api_key_env: API_KEY_ENV,
    },
    _marqel: {
      managed: true,
      status,
      target_id: TARGET_ID,
      synced_at: now,
    },
  };
}

async function applyWindowsFileAcl(filePath) {
  if (process.platform !== "win32") return;
  const username = process.env.USERNAME || "";
  const account = username ? `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ""}${username}` : "";
  if (!account) throw new MarqelProviderSyncError("provider_config_write_failed", "Windows user identity is unavailable for the image Provider configuration ACL.");
  await execFileAsync("icacls.exe", [filePath, "/inheritance:r", "/grant:r", `${account}:F`], { maxBuffer: 16 * 1024 });
  const { stdout = "" } = await execFileAsync("icacls.exe", [filePath], { maxBuffer: 16 * 1024 });
  if (stdout.includes("(I)") || /\bEveryone\b|\bAuthenticated Users\b|BUILTIN\\Users/i.test(stdout) || !/:\(F\)|:F/.test(stdout)) {
    throw new MarqelProviderSyncError("provider_config_write_failed", "The image Provider configuration does not have a verified user-only Windows ACL.");
  }
}

async function chmodIfSupported(filePath, mode) {
  try {
    await fs.chmod(filePath, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function writeSecureJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await chmodIfSupported(directory, 0o700);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmodIfSupported(temporaryPath, 0o600);
    await applyWindowsFileAcl(temporaryPath);
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error.code)) throw error;
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    }
    await applyWindowsFileAcl(filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    if (error instanceof MarqelProviderSyncError) throw error;
    throw new MarqelProviderSyncError("provider_config_write_failed", "The Web-managed image Provider configuration could not be written securely.");
  }
}

async function controlCenterRequester(skillRoot, clientPath = "") {
  const resolved = path.resolve(clientPath || defaultControlCenterClientPath(skillRoot));
  try {
    const module = await import(pathToFileURL(resolved).href);
    if (typeof module.requestControlCenter !== "function") throw new Error("missing requestControlCenter export");
    return { request: module.requestControlCenter, manageSessionPath: path.join(path.dirname(resolved), "manage-session.mjs") };
  } catch (error) {
    if (error?.code === "auth_required") throw error;
    throw new MarqelProviderSyncError("auth_required", "Marqel Control Center Auth is unavailable; reconnect this Codex installation in Web and Codex.");
  }
}

export async function authorizeDeviceInWeb({ manageSessionPath } = {}) {
  const resolved = path.resolve(String(manageSessionPath || ""));
  if (!manageSessionPath) throw new MarqelProviderSyncError("auth_required", "Marqel device authorization is unavailable for this installation.");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolved, "device-start"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdoutBuffer = "";
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const relay = (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event?.status === "approval_required") {
        process.stderr.write(`${JSON.stringify({ type: "marqel_device_authorization", status: "approval_required", verification_uri: String(event.verificationUri || ""), expires_in_seconds: Number(event.expiresInSeconds || 0) })}\n`);
      } else if (event?.status === "authorized") {
        process.stderr.write(`${JSON.stringify({ type: "marqel_device_authorization", status: "authorized", client_id: String(event.clientId || ""), device_id: String(event.deviceId || "") })}\n`);
      }
    };
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      lines.filter(Boolean).forEach(relay);
    });
    child.stderr.resume();
    child.on("error", () => finish(() => reject(new MarqelProviderSyncError("auth_required", "Marqel device authorization could not be started."))));
    child.on("close", (code) => finish(() => {
      if (stdoutBuffer.trim()) relay(stdoutBuffer.trim());
      if (code === 0) resolve({ status: "authorized" });
      else reject(new MarqelProviderSyncError("auth_required", "Marqel device authorization was not completed in Web."));
    }));
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new MarqelProviderSyncError("auth_required", "Marqel device authorization timed out before Web approval.")));
    }, 11 * 60 * 1000);
  });
}

async function acknowledge(request, status, identity, activeProfileId = "") {
  return request("/api/client-config/ack", {
    method: "POST",
    body: {
      contractVersion: ACK_CONTRACT,
      targetId: TARGET_ID,
      status,
      deliveryRevision: identity.deliveryRevision,
      deliveryDigest: identity.deliveryDigest,
      activeProfileId,
    },
  });
}

export async function syncMarqelProvider({ skillRoot, configPath = defaultConfigPath(), controlCenterClientPath = "", requestControlCenter = null, autoAuthorize = true, authorizeDevice = authorizeDeviceInWeb } = {}) {
  const resolvedSkillRoot = path.resolve(skillRoot || fileURLToPath(new URL("..", import.meta.url)));
  const auth = requestControlCenter
    ? { request: requestControlCenter, manageSessionPath: "" }
    : await controlCenterRequester(resolvedSkillRoot, controlCenterClientPath);
  const request = auth.request;
  let payload;
  try {
    payload = await request(`/api/client-config?targetId=${encodeURIComponent(TARGET_ID)}`);
  } catch (error) {
    if (String(error?.code || "") === "auth_required" && autoAuthorize) {
      try {
        await authorizeDevice({ manageSessionPath: auth.manageSessionPath });
      } catch (authorizationError) {
        throw new MarqelProviderSyncError("auth_required", "The current user must approve this Codex device in Marqel Web before image Provider configuration can be delivered.");
      }
      try {
        payload = await request(`/api/client-config?targetId=${encodeURIComponent(TARGET_ID)}`);
      } catch (retryError) {
        const retryCode = ["auth_required", "forbidden", "membership_expired", "control_center_timeout"].includes(String(retryError?.code || ""))
          ? String(retryError.code)
          : "provider_config_sync_failed";
        throw new MarqelProviderSyncError(retryCode, "The Web-managed image Provider configuration could not be synchronized after device approval.");
      }
    } else {
      const code = ["auth_required", "forbidden", "membership_expired", "control_center_timeout"].includes(String(error?.code || ""))
        ? String(error.code)
        : "provider_config_sync_failed";
      throw new MarqelProviderSyncError(code, "The Web-managed image Provider configuration could not be synchronized.");
    }
  }

  if (payload?.status !== "configured" || !payload?.config) {
    await writeSecureJson(path.resolve(configPath), unavailableProviderConfig(String(payload?.status || "not_configured")));
    return { status: String(payload?.status || "not_configured"), target_id: TARGET_ID, key_configured: false };
  }

  let applied;
  try {
    applied = appliedProviderConfig(payload);
    await writeSecureJson(path.resolve(configPath), applied.config);
    await acknowledge(request, "applied", applied.identity, applied.activeProfileId);
    return applied.publicResult;
  } catch (error) {
    try {
      const identity = deliveryIdentity(payload.config);
      await acknowledge(request, "sync_failed", identity, String(payload.config.resolution?.modelProfileIds?.imageProfileId || "").slice(0, 120));
    } catch {
      // A malformed delivery identity cannot be acknowledged safely.
    }
    if (error instanceof MarqelProviderSyncError) throw error;
    throw new MarqelProviderSyncError("provider_config_sync_failed", "The Web-managed image Provider configuration could not be applied.");
  }
}

export async function syncManagedMarqelProviderIfRequired({ skillRoot, force = false, configPath, controlCenterClientPath, requestControlCenter, autoAuthorize = true, authorizeDevice } = {}) {
  const resolvedSkillRoot = path.resolve(skillRoot || fileURLToPath(new URL("..", import.meta.url)));
  if (!force && !await managedRelease(resolvedSkillRoot)) return { status: "not_managed", target_id: TARGET_ID };
  return syncMarqelProvider({ skillRoot: resolvedSkillRoot, configPath, controlCenterClientPath, requestControlCenter, autoAuthorize, authorizeDevice });
}

async function invokedAsMainModule() {
  if (!process.argv[1]) return false;
  try {
    const [invokedPath, modulePath] = await Promise.all([fs.realpath(process.argv[1]), fs.realpath(fileURLToPath(import.meta.url))]);
    return invokedPath === modulePath;
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (await invokedAsMainModule()) {
  const args = process.argv.slice(2);
  syncManagedMarqelProviderIfRequired({
    skillRoot: fileURLToPath(new URL("..", import.meta.url)),
    force: args.includes("--force"),
    configPath: argument(args, "--config") || undefined,
    controlCenterClientPath: argument(args, "--control-center-client"),
    autoAuthorize: !args.includes("--no-auto-authorize"),
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ code: error?.code || "provider_config_sync_failed", message: error?.message || "Image Provider synchronization failed." })}\n`);
    process.exitCode = 1;
  });
}
