const DEFAULT_QUALITY_VALUES = ["auto", "low", "medium", "high"];
const DEFAULT_SIZE_VALUES = ["auto", "1024x1024", "1024x1536", "1536x1024"];
const DEFAULT_RESPONSE_FORMAT_VALUES = ["url", "b64_json"];

export function normalizeProviderCapabilities(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const quality = normalizeEnum(source.quality, DEFAULT_QUALITY_VALUES, "auto");
  const size = normalizeEnum(source.size, DEFAULT_SIZE_VALUES, "auto");
  const responseFormat = normalizeEnum(source.response_format, DEFAULT_RESPONSE_FORMAT_VALUES, "url");
  return {
    schema_version: "sellerpilot.openai_compatible_provider_capabilities.v1",
    quality,
    size: { ...size, allow_custom: source.size?.allow_custom === true },
    response_format: responseFormat,
  };
}

export function resolveCapabilityValue({ requested, capability, label }) {
  const value = String(requested || capability.default).trim().toLowerCase();
  if (!capability.allowed.includes(value)) throw new Error(`${label} must be one of: ${capability.allowed.join(", ")}.`);
  return value;
}

export function resolveProviderSize({ requested, capabilities }) {
  const value = String(requested || capabilities.size.default).trim().toLowerCase();
  if (capabilities.size.allow_custom && /^\d{2,5}x\d{2,5}$/.test(value)) return value;
  return resolveCapabilityValue({ requested: value, capability: capabilities.size, label: "size" });
}

export function nearestSupportedSizeForRatio({ requiredRatio, capabilities }) {
  if (capabilities.size.allow_custom) return null;
  const [targetWidth, targetHeight] = String(requiredRatio || "1:1").split(":").map(Number);
  if (!(targetWidth > 0 && targetHeight > 0)) return capabilities.size.default;
  const target = targetWidth / targetHeight;
  const candidates = capabilities.size.allowed.filter((item) => /^\d+x\d+$/.test(item));
  if (!candidates.length) return capabilities.size.default;
  return candidates.map((item) => {
    const [width, height] = item.split("x").map(Number);
    return { item, delta: Math.abs(Math.log((width / height) / target)) };
  }).sort((left, right) => left.delta - right.delta || left.item.localeCompare(right.item))[0].item;
}

function normalizeEnum(source, fallbackAllowed, fallbackDefault) {
  const raw = source && typeof source === "object" ? source : {};
  const allowed = uniqueStrings(raw.allowed, fallbackAllowed);
  const defaultValue = String(raw.default || fallbackDefault).trim().toLowerCase();
  return { default: allowed.includes(defaultValue) ? defaultValue : allowed[0], allowed };
}

function uniqueStrings(value, fallback) {
  const values = Array.isArray(value) ? value : fallback;
  const normalized = [...new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
  return normalized.length ? normalized : [...fallback];
}
