#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      if (args[key] === undefined) args[key] = next;
      else if (Array.isArray(args[key])) args[key].push(next);
      else args[key] = [args[key], next];
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/platform-preference-memory.mjs --mode remember --platform Ozon --category "women bag" [--locale ru-RU] [--trait "..."] [--style "..."] [--avoid "..."] [--source-note "..."]
node scripts/platform-preference-memory.mjs --mode apply --platform Ozon --category "women bag" --run-dir /abs/run
node scripts/platform-preference-memory.mjs --mode report [--platform Ozon] [--category "women bag"]

Stores only platform/category visual, copy, and merchandising preferences that
the user explicitly gives or confirms. Do not store product identity facts,
private business data, unsupported claims, or one-off generation failures.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
const mode = String(args.mode || "").toLowerCase();
if (!["remember", "apply", "report"].includes(mode)) usage();

const memoryRoot = path.resolve(args["memory-root"] || process.env.SELLERPILOT_IMAGE_SKILL_MEMORY || path.join(os.homedir(), ".codex", "sellerpilot-product-image-industrial"));
const memoryPath = path.join(memoryRoot, "platform-preference-memory.json");
fs.mkdirSync(memoryRoot, { recursive: true });

const store = readStore(memoryPath);
let result;
if (mode === "remember") result = remember(store, args);
else if (mode === "apply") result = applyMemory(store, args);
else result = reportMemory(store, args);

fs.writeFileSync(memoryPath, `${JSON.stringify(store, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function remember(storeValue, input) {
  const platform = required(input.platform, "--platform");
  const category = required(input.category, "--category");
  const locale = String(input.locale || "");
  const traits = cleanList(input.trait || input.traits);
  const styles = cleanList(input.style || input.styles);
  const avoid = cleanList(input.avoid || input.avoids);
  const copyTone = cleanList(input["copy-tone"] || input.copy_tone);
  const merchandising = cleanList(input.merchandising || input["merchandising-note"]);
  const sourceNote = String(input["source-note"] || input.source || "user_explicit_platform_preference").trim();
  const rejected = [...traits, ...styles, ...avoid, ...copyTone, ...merchandising]
    .filter((item) => !isPlatformPreference(item));
  const accepted = {
    visual_traits: traits.filter(isPlatformPreference),
    style_direction: styles.filter(isPlatformPreference),
    avoid: avoid.filter(isPlatformPreference),
    copy_tone: copyTone.filter(isPlatformPreference),
    merchandising_notes: merchandising.filter(isPlatformPreference),
  };
  if (!Object.values(accepted).some((list) => list.length)) {
    return {
      status: "skipped_no_platform_preference",
      memory_path: memoryPath,
      rejected,
      message: "No platform/category visual, copy, or merchandising preference was provided.",
    };
  }
  const platformKey = key(platform);
  const categoryKey = key(category);
  let entry = storeValue.entries.find((item) => item.platform_key === platformKey && item.category_key === categoryKey && String(item.locale || "") === locale);
  if (!entry) {
    entry = {
      id: `${platformKey || "platform"}__${categoryKey || "category"}__${locale || "default"}`.replace(/[^a-z0-9._-]+/g, "-"),
      platform,
      platform_key: platformKey,
      category,
      category_key: categoryKey,
      locale,
      created_at: new Date().toISOString(),
      updated_at: null,
      use_count: 0,
      visual_traits: [],
      style_direction: [],
      avoid: [],
      copy_tone: [],
      merchandising_notes: [],
      evidence: [],
    };
    storeValue.entries.push(entry);
  }
  for (const field of Object.keys(accepted)) {
    entry[field] = unique([...(entry[field] || []), ...accepted[field]]);
  }
  entry.evidence = unique([...(entry.evidence || []), sourceNote]);
  entry.updated_at = new Date().toISOString();
  storeValue.updated_at = entry.updated_at;
  return {
    status: "remembered",
    memory_path: memoryPath,
    entry,
    rejected_non_platform_preferences: rejected,
  };
}

function applyMemory(storeValue, input) {
  const platform = required(input.platform, "--platform");
  const category = String(input.category || "");
  const locale = String(input.locale || "");
  const platformKey = key(platform);
  const categoryKey = key(category);
  const matches = storeValue.entries
    .filter((item) => item.platform_key === platformKey)
    .filter((item) => !locale || !item.locale || item.locale === locale)
    .map((item) => ({
      ...item,
      match_score: item.category_key === categoryKey ? 3 : categoryKey && item.category_key && relatedCategory(item.category_key, categoryKey) ? 2 : 1,
    }))
    .filter((item) => item.match_score > 1 || !categoryKey)
    .sort((a, b) => b.match_score - a.match_score || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  for (const item of matches) item.use_count = Number(item.use_count || 0) + 1;
  storeValue.updated_at = new Date().toISOString();
  const overlay = {
    schema_version: "sellerpilot.platform_preference_overlay.v1",
    status: matches.length ? "applied" : "no_memory",
    platform,
    category,
    locale,
    memory_path: memoryPath,
    applied_at: new Date().toISOString(),
    matches: matches.slice(0, 5).map(publicEntry),
    merged_preferences: merge(matches),
    use_policy: "Use as platform/category style memory only. Do not override current user instructions, product identity, official platform constraints, or fresh research.",
  };
  if (input["run-dir"]) {
    const runDir = path.resolve(input["run-dir"]);
    const outDir = path.join(runDir, "memory");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "platform-preference-overlay.json"), `${JSON.stringify(overlay, null, 2)}\n`);
    fs.writeFileSync(path.join(outDir, "platform-preference-overlay.md"), toMarkdown(overlay));
  }
  return overlay;
}

function reportMemory(storeValue, input) {
  const platformKey = input.platform ? key(input.platform) : "";
  const categoryKey = input.category ? key(input.category) : "";
  const entries = storeValue.entries
    .filter((item) => !platformKey || item.platform_key === platformKey)
    .filter((item) => !categoryKey || item.category_key === categoryKey || relatedCategory(item.category_key, categoryKey))
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .map(publicEntry);
  return {
    status: "ready",
    memory_path: memoryPath,
    entries,
  };
}

function readStore(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed.entries)) return parsed;
  } catch {}
  return {
    schema_version: "sellerpilot.platform_preference_memory.v1",
    created_at: new Date().toISOString(),
    updated_at: null,
    entries: [],
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    platform: entry.platform,
    category: entry.category,
    locale: entry.locale,
    match_score: entry.match_score || null,
    visual_traits: entry.visual_traits || [],
    style_direction: entry.style_direction || [],
    avoid: entry.avoid || [],
    copy_tone: entry.copy_tone || [],
    merchandising_notes: entry.merchandising_notes || [],
    evidence: entry.evidence || [],
    updated_at: entry.updated_at,
    use_count: entry.use_count || 0,
  };
}

function merge(entries) {
  return {
    visual_traits: unique(entries.flatMap((item) => item.visual_traits || [])).slice(0, 12),
    style_direction: unique(entries.flatMap((item) => item.style_direction || [])).slice(0, 12),
    avoid: unique(entries.flatMap((item) => item.avoid || [])).slice(0, 12),
    copy_tone: unique(entries.flatMap((item) => item.copy_tone || [])).slice(0, 12),
    merchandising_notes: unique(entries.flatMap((item) => item.merchandising_notes || [])).slice(0, 12),
  };
}

function toMarkdown(overlay) {
  const prefs = overlay.merged_preferences;
  return [
    "# Platform Preference Overlay",
    "",
    `- Status: ${overlay.status}`,
    `- Platform: ${overlay.platform}`,
    `- Category: ${overlay.category || ""}`,
    `- Locale: ${overlay.locale || ""}`,
    `- Memory path: ${overlay.memory_path}`,
    "",
    "## Visual Traits",
    ...(prefs.visual_traits.length ? prefs.visual_traits.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Style Direction",
    ...(prefs.style_direction.length ? prefs.style_direction.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Avoid",
    ...(prefs.avoid.length ? prefs.avoid.map((item) => `- ${item}`) : ["- None"]),
    "",
  ].join("\n");
}

function cleanList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => String(item).split(/[;\n]/))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= 180);
}

function isPlatformPreference(value) {
  const text = String(value || "");
  if (/(phone|email|address|成本|利润|采购|供应商|password|token|secret)/i.test(text)) return false;
  if (/(exact sku|serial|订单|客户|私密|private)/i.test(text)) return false;
  return true;
}

function relatedCategory(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function key(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const k = String(item).trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) usage();
  return text;
}
