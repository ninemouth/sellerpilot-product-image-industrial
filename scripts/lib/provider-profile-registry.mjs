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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return normalized;
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
  };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function defaultKeyEnv(label) { const normalized = String(label || "IMAGE_PROVIDER").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, ""); return `${normalized || "IMAGE_PROVIDER"}_IMAGE_API_KEY`; }
function stripSlash(value) { return String(value || "").trim().replace(/\/+$/, ""); }
