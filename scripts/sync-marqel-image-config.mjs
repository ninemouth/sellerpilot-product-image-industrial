#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findProfile, normalizeExternalProfile, readProviderRegistry, writeProviderRegistry } from "./lib/provider-profile-registry.mjs";

const DEFAULT_TARGET_ID = "sellerpilot-image";
const DEFAULT_PROFILE_ID = "marqel-sellerpilot-image";

function parseArgs(argv = process.argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args[key] = true;
    else { args[key] = value; index += 1; }
  }
  return args;
}

export function defaultClientConfigPath(env = process.env, platform = process.platform, homeDirectory = os.homedir()) {
  if (env.ETSY_OPS_CLIENT_CONFIG) return env.ETSY_OPS_CLIENT_CONFIG;
  const pathApi = platform === "win32" ? path.win32 : path;
  if (platform === "win32") return pathApi.join(env.LOCALAPPDATA || pathApi.join(homeDirectory, "AppData", "Local"), "Marqel", "codex-client-config.json");
  return path.join(homeDirectory, ".etsy-ops", "codex-client-config.json");
}

export function buildMarqelImageProfile(config, { targetId = DEFAULT_TARGET_ID, profileId = DEFAULT_PROFILE_ID } = {}) {
  const target = config?.targets?.[targetId];
  const image = target?.image;
  if (!image || image.provider === "native_codex") return null;
  const baseUrl = String(image.baseUrl || "").trim();
  const model = String(image.model || "").trim();
  const apiKey = String(image.apiKey || "").trim();
  if (!baseUrl || !model || !apiKey) throw new Error("Marqel Image 配置缺少第三方生图 Base URL、模型或 API Key；请先在 Web 配置中心保存完整配置。");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Marqel Image Base URL 必须是不携带账号密码的 HTTP/HTTPS 地址。");
  const deliveryDigest = String(target.deliveryDigest || "").trim().toLowerCase();
  const deliveryRevision = String(target.deliveryRevision || "").trim();
  const activeProfileId = String(target.resolution?.modelProfileIds?.imageProfileId || "").trim();
  return normalizeExternalProfile({
    id: profileId,
    label: String(target.displayName || "Marqel SellerPilot Image").trim().slice(0, 160),
    kind: "external",
    runtime: "openai_images",
    base_url: baseUrl,
    model,
    api_key_env: "MARQEL_SELLERPILOT_IMAGE_API_KEY",
    api_key: apiKey,
    _marqel: {
      managed: true,
      status: "applied",
      target_id: targetId,
      delivery_revision: deliveryRevision,
      delivery_digest: /^[a-f0-9]{64}$/.test(deliveryDigest) ? deliveryDigest : "",
      active_profile_id: activeProfileId,
      synced_at: new Date().toISOString(),
    },
  });
}

export function mergeMarqelImageProfile(registry, profile, { forceActive = false } = {}) {
  if (!profile) return { registry, changed: false, activated: false };
  const profiles = [...registry.profiles.filter((candidate) => candidate.id !== profile.id), profile];
  const shouldActivate = forceActive || registry.active_profile_id === "codex-native";
  return {
    registry: { ...registry, profiles, active_profile_id: shouldActivate ? profile.id : registry.active_profile_id },
    changed: true,
    activated: shouldActivate,
  };
}

export function removeMarqelImageProfile(registry, { profileId = DEFAULT_PROFILE_ID } = {}) {
  const hadProfile = registry.profiles.some((candidate) => candidate.id === profileId);
  const profiles = registry.profiles.filter((candidate) => candidate.id !== profileId);
  const activeProfileId = registry.active_profile_id === profileId ? "codex-native" : registry.active_profile_id;
  return { registry: { ...registry, profiles, active_profile_id: activeProfileId }, changed: hadProfile, activated: false };
}

export function marqelImageProviderStatus({ providerConfigPath, targetId = DEFAULT_TARGET_ID, profileId = DEFAULT_PROFILE_ID } = {}) {
  const resolvedPath = path.resolve(providerConfigPath);
  const state = readProviderRegistry(resolvedPath);
  const profile = findProfile(state.registry, profileId);
  const managed = profile?._marqel?.managed === true ? profile._marqel : null;
  const keyConfigured = Boolean(String(profile?.api_key || "").trim() || String(process.env[profile?.api_key_env] || "").trim());
  const applied = Boolean(profile && keyConfigured);
  return {
    clientId: "sellerpilot-product-image-industrial",
    targetId,
    status: applied ? "applied" : "not_configured",
    providerReady: applied,
    keyConfigured,
    profileId: profile?.id || "",
    activeProfileId: state.registry.active_profile_id,
    profileActive: state.registry.active_profile_id === profile?.id,
    deliveryRevision: String(managed?.delivery_revision || ""),
    deliveryDigest: String(managed?.delivery_digest || ""),
    managed: Boolean(managed),
    configSource: state.source,
    configPath: resolvedPath,
  };
}

export function syncMarqelImageConfig({ configPath, providerConfigPath, targetId = DEFAULT_TARGET_ID, forceActive = false } = {}) {
  const saved = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
  const profile = buildMarqelImageProfile(saved, { targetId });
  const current = readProviderRegistry(path.resolve(providerConfigPath));
  if (!profile) {
    const removed = removeMarqelImageProfile(current.registry);
    if (removed.changed) writeProviderRegistry(path.resolve(providerConfigPath), removed.registry);
    return { ...marqelImageProviderStatus({ providerConfigPath, targetId }), removedManagedProfile:removed.changed };
  }
  const merged = mergeMarqelImageProfile(current.registry, profile, { forceActive });
  writeProviderRegistry(path.resolve(providerConfigPath), merged.registry);
  return { ...marqelImageProviderStatus({ providerConfigPath, targetId }), activated: merged.activated };
}

function main() {
  const args = parseArgs();
  const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const configPath = path.resolve(args.config || defaultClientConfigPath());
  const providerConfigPath = path.resolve(args["provider-config"] || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
  if (args.status) {
    process.stdout.write(`${JSON.stringify(marqelImageProviderStatus({ providerConfigPath, targetId: String(args["target-id"] || DEFAULT_TARGET_ID) }))}\n`);
    return;
  }
  if (!fs.existsSync(configPath)) throw new Error("未找到 Marqel 客户端配置，请先完成共享鉴权并运行 sync-config --target-id sellerpilot-image。");
  const result = syncMarqelImageConfig({ configPath, providerConfigPath, targetId: String(args["target-id"] || DEFAULT_TARGET_ID), forceActive: Boolean(args["set-active"]) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
