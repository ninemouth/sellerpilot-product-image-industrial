import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PROVIDER_REGISTRY_SCHEMA = "sellerpilot.image_provider_registry.v1";

export const BUILT_IN_PROVIDER_PROFILES = Object.freeze([
  Object.freeze({
    id: "codex-native",
    label: "Codex Native",
    kind: "built_in",
    runtime: "native_codex",
    enabled: true,
  }),
  Object.freeze({
    id: "nvidia-flux",
    label: "NVIDIA FLUX",
    kind: "built_in",
    runtime: "nvidia_nim_flux",
    enabled: true,
    base_url: "https://ai.api.nvidia.com/v1/genai",
    model: "black-forest-labs/flux.2-klein-4b",
    api_key_env: "NVIDIA_API_KEY",
  }),
]);

export function readProviderRegistry(file) {
  const raw = readJson(file);
  if (!raw) return { registry: createDefaultRegistry(), source: "default", raw: null };
  if (raw.schema_version === PROVIDER_REGISTRY_SCHEMA) return { registry: normalizeRegistry(raw), source: "registry", raw };
  if (raw.third_party) return { registry: migrateLegacyConfig(raw), source: "legacy_migration", raw };
  return { registry: createDefaultRegistry(), source: "default", raw };
}

export function createDefaultRegistry() {
  return normalizeRegistry({ schema_version: PROVIDER_REGISTRY_SCHEMA, active_profile_id: "codex-native", profiles: [...BUILT_IN_PROVIDER_PROFILES] });
}

export function normalizeRegistry(value) {
  const supplied = Array.isArray(value?.profiles) ? value.profiles : [];
  const builtIns = BUILT_IN_PROVIDER_PROFILES.map((builtin) => {
    const saved = supplied.find((profile) => profile?.id === builtin.id) || {};
    return {
      ...builtin,
      ...(saved.enabled === false ? { enabled: false } : {}),
      ...(String(saved.api_key || "").trim() ? { api_key: String(saved.api_key).trim() } : {}),
      ...(String(saved.api_key_env || "").trim() ? { api_key_env: String(saved.api_key_env).trim() } : {}),
    };
  });
  const externals = supplied
    .filter((profile) => profile && profile.kind === "external" && !BUILT_IN_PROVIDER_PROFILES.some((builtin) => builtin.id === profile.id))
    .map(normalizeExternalProfile);
  const profiles = [...builtIns, ...externals];
  const requestedActive = String(value?.active_profile_id || "").trim();
  const active = profiles.find((profile) => profile.id === requestedActive && profile.enabled !== false) || profiles.find((profile) => profile.id === "codex-native");
  return { schema_version: PROVIDER_REGISTRY_SCHEMA, active_profile_id: active.id, profiles };
}

export function migrateLegacyConfig(raw) {
  const legacy = raw?.third_party || {};
  const name = String(legacy.name || "Third-party image provider").trim();
  const profile = normalizeExternalProfile({
    id: `external-${slug(name) || "image-provider"}`,
    label: name,
    kind: "external",
    enabled: legacy.enabled !== false,
    runtime: legacy.runtime || "openai_images",
    base_url: legacy.base_url,
    model: legacy.model,
    api_key_env: legacy.api_key_env,
    api_key: legacy.api_key,
    capabilities: legacy.capabilities,
  });
  const profiles = [...BUILT_IN_PROVIDER_PROFILES, profile];
  const legacyThirdPartySelected = raw?.provider_mode === "third_party_proxy" || legacy.enabled === true;
  return normalizeRegistry({ schema_version: PROVIDER_REGISTRY_SCHEMA, active_profile_id: legacyThirdPartySelected ? profile.id : "codex-native", profiles });
}

export function findProfile(registry, id) {
  const normalized = normalizeRegistry(registry);
  return normalized.profiles.find((profile) => profile.id === String(id || normalized.active_profile_id)) || null;
}

export function writeProviderRegistry(file, registry) {
  const normalized = normalizeRegistry(registry);
  const directory = path.dirname(file);
  const suffix = `${process.pid}-${crypto.randomUUID()}`;
  const candidate = `${file}.candidate-${suffix}`;
  const previous = `${file}.previous-${suffix}`;
  fs.mkdirSync(directory, { recursive: true, mode:0o700 });
  try { fs.chmodSync(directory, 0o700); } catch {}
  const body = `${JSON.stringify(normalized, null, 2)}\n`;
  let previousMoved = false;
  let finalPlaced = false;
  try {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("Provider registry path must not be a symbolic link.");
    fs.writeFileSync(candidate, body, { mode:0o600, flag:"wx" });
    try { fs.chmodSync(candidate, 0o600); } catch {}
    applyWindowsUserAcl(candidate);
    const handle = fs.openSync(candidate, "r+");
    try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    if (fs.existsSync(file)) { fs.renameSync(file, previous); previousMoved = true; }
    try { fs.renameSync(candidate, file); finalPlaced = true; }
    catch (error) {
      if (previousMoved) fs.renameSync(previous, file);
      throw error;
    }
    try { fs.chmodSync(file, 0o600); } catch {}
    applyWindowsUserAcl(file);
    if (fs.readFileSync(file, "utf8") !== body) throw new Error("Provider registry verification failed after secure replacement.");
    if (previousMoved) fs.rmSync(previous, { force:true });
  } catch (error) {
    fs.rmSync(candidate, { force:true });
    if (finalPlaced) fs.rmSync(file, { force:true });
    if (previousMoved && fs.existsSync(previous)) fs.renameSync(previous, file);
    throw error;
  }
  return normalized;
}

function applyWindowsUserAcl(file) {
  if (process.platform !== "win32") return;
  const username = String(process.env.USERNAME || "").trim();
  const domain = String(process.env.USERDOMAIN || "").trim();
  if (!username) throw new Error("Windows user identity is unavailable for the SellerPilot Provider configuration ACL.");
  const account = domain ? `${domain}\\${username}` : username;
  execFileSync("icacls.exe", [file, "/inheritance:r", "/grant:r", `${account}:F`], { stdio:"ignore", windowsHide:true });
  const permissions = execFileSync("icacls.exe", [file], { encoding:"utf8", windowsHide:true });
  if (permissions.includes("(I)") || /\bEveryone\b|\bAuthenticated Users\b|BUILTIN\\Users/i.test(permissions) || !/:\(F\)|:F/.test(permissions)) throw new Error("SellerPilot Provider configuration does not have a verified user-only Windows ACL.");
}

export function isThirdPartyProfile(profile) {
  return Boolean(profile && profile.runtime !== "native_codex");
}

export function normalizeExternalProfile(value) {
  const runtime = String(value?.runtime || "openai_images").trim();
  if (!new Set(["openai_images", "nvidia_nim_flux"]).has(runtime)) throw new Error(`Unsupported external provider runtime: ${runtime}`);
  const label = String(value?.label || value?.name || "Third-party image provider").trim();
  const id = String(value?.id || `external-${slug(label)}`).trim();
  const apiKeyEnv = String(value?.api_key_env || defaultKeyEnv(label)).trim();
  const managed = value?._marqel && typeof value._marqel === "object" && value._marqel.managed === true
    ? {
      managed: true,
      status: String(value._marqel.status || "unknown").trim().slice(0, 80),
      target_id: String(value._marqel.target_id || "").trim().slice(0, 120),
      delivery_revision: String(value._marqel.delivery_revision || "").trim().slice(0, 240),
      delivery_digest: String(value._marqel.delivery_digest || "").trim().toLowerCase(),
      active_profile_id: String(value._marqel.active_profile_id || "").trim().slice(0, 120),
      synced_at: String(value._marqel.synced_at || "").trim().slice(0, 80),
    }
    : null;
  return {
    id,
    label,
    kind: "external",
    enabled: value?.enabled !== false,
    runtime,
    base_url: stripSlash(value?.base_url),
    model: String(value?.model || "").trim(),
    api_key_env: apiKeyEnv,
    ...(String(value?.api_key || "").trim() ? { api_key: String(value.api_key).trim() } : {}),
    ...(value?.capabilities ? { capabilities: value.capabilities } : {}),
    ...(managed ? { _marqel: managed } : {}),
  };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function defaultKeyEnv(label) { const normalized = String(label || "IMAGE_PROVIDER").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, ""); return `${normalized || "IMAGE_PROVIDER"}_IMAGE_API_KEY`; }
function stripSlash(value) { return String(value || "").trim().replace(/\/+$/, ""); }
