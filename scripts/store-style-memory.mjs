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
node scripts/store-style-memory.mjs --mode draft --store-name "Brand" --store-url https://example.com --run-dir /abs/run [--analysis "..."] [--recommendation "..."]
node scripts/store-style-memory.mjs --mode remember --store-name "Brand" --store-url https://example.com --confirmed true [style fields...]
node scripts/store-style-memory.mjs --mode apply --store-name "Brand" --run-dir /abs/run
node scripts/store-style-memory.mjs --mode report [--store-name "Brand"]

Style fields for remember:
  --platform, --category, --locale, --positioning, --audience, --visual-trait,
  --palette, --typography, --photography, --layout, --copy-tone, --avoid,
  --prompt-directive, --evidence, --confirmed-by

Store style memory is durable brand/store guidance. Do not store product identity,
supplier/customer private data, credentials, unsupported claims, or one-off failures.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
const mode = String(args.mode || "").toLowerCase();
if (!["draft", "remember", "apply", "report"].includes(mode)) usage();

const memoryRoot = path.resolve(args["memory-root"] || process.env.SELLERPILOT_IMAGE_SKILL_MEMORY || path.join(os.homedir(), ".codex", "sellerpilot-product-image-industrial"));
const storeDir = path.join(memoryRoot, "store-style-memory");
const indexPath = path.join(storeDir, "index.json");
fs.mkdirSync(storeDir, { recursive: true });

const index = readIndex(indexPath);
let result;
if (mode === "draft") result = draft(args);
else if (mode === "remember") result = remember(args);
else if (mode === "apply") result = apply(args);
else result = report(args);

fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function draft(input) {
  const storeName = required(input["store-name"], "--store-name");
  const storeUrl = cleanUrl(input["store-url"] || input.url || "");
  const platform = String(input.platform || "");
  const category = String(input.category || "");
  const runDir = input["run-dir"] ? path.resolve(input["run-dir"]) : "";
  const draftDoc = [
    `# Store Style Draft: ${storeName}`,
    "",
    "## Store",
    `- Store name: ${storeName}`,
    `- Store URL: ${storeUrl}`,
    `- Platform: ${platform}`,
    `- Category focus: ${category}`,
    "",
    "## Initial Analysis",
    ...(cleanList(input.analysis).length ? cleanList(input.analysis).map((item) => `- ${item}`) : ["- Pending Codex store/page analysis."]),
    "",
    "## Suggested Unified Style Directions",
    ...(cleanList(input.recommendation || input["style-option"]).length ? cleanList(input.recommendation || input["style-option"]).map((item) => `- ${item}`) : [
      "- Direction A: keep close to current store/product truth and improve consistency.",
      "- Direction B: define a cleaner marketplace-ready system with stronger image hierarchy.",
      "- Direction C: define a more premium/editorial system if supported by category and audience.",
    ]),
    "",
    "## Questions Before Saving Memory",
    "- Which direction should become the store default?",
    "- Which colors, layouts, or scene types must remain consistent?",
    "- What should this store avoid across future product images?",
    "",
    "## Save Rule",
    "- Do not write final store style memory until the user confirms the direction.",
    "- Store style memory must not override source product identity, platform rules, physical truth, or current user instructions.",
    "",
  ].join("\n");
  let draftPath = "";
  if (runDir) {
    const outDir = path.join(runDir, "memory");
    fs.mkdirSync(outDir, { recursive: true });
    draftPath = path.join(outDir, "store-style-draft.md");
    fs.writeFileSync(draftPath, draftDoc);
  }
  return {
    status: "draft_ready",
    store_name: storeName,
    store_url: storeUrl,
    draft_path: draftPath || null,
    next_step: "Show the analysis and 2-3 style directions to the user. Save memory only after confirmation.",
  };
}

function remember(input) {
  const storeName = required(input["store-name"], "--store-name");
  const confirmed = String(input.confirmed || input["user-confirmed"] || "").toLowerCase();
  if (!["true", "yes", "1", "confirmed"].includes(confirmed)) {
    return {
      status: "blocked_needs_user_confirmation",
      message: "Store style memory is durable. Ask the user to confirm the final unified style direction before writing the Markdown memory.",
    };
  }
  const storeUrl = cleanUrl(input["store-url"] || input.url || "");
  const slug = storeSlug(storeName, storeUrl);
  const memoryPath = path.join(storeDir, `${slug}.md`);
  const rejected = rejectedPrivate([
    ...cleanList(input.positioning),
    ...cleanList(input.audience),
    ...cleanList(input["visual-trait"] || input.trait),
    ...cleanList(input.palette),
    ...cleanList(input.typography),
    ...cleanList(input.photography),
    ...cleanList(input.layout),
    ...cleanList(input["copy-tone"]),
    ...cleanList(input.avoid),
    ...cleanList(input["prompt-directive"]),
  ]);
  if (rejected.length) {
    return {
      status: "blocked_private_or_unsupported_content",
      rejected,
      message: "Remove private data, credentials, unsupported claims, product identity facts, or one-off feedback before saving store style memory.",
    };
  }
  const entry = {
    id: slug,
    store_name: storeName,
    store_url: storeUrl,
    platform: String(input.platform || ""),
    category: String(input.category || ""),
    locale: String(input.locale || ""),
    memory_path: memoryPath,
    updated_at: new Date().toISOString(),
  };
  const markdown = toStoreMarkdown(entry, input);
  fs.writeFileSync(memoryPath, markdown);
  upsertIndex(entry);
  return {
    status: "remembered",
    store_name: storeName,
    store_url: storeUrl,
    memory_path: memoryPath,
    entry,
  };
}

function apply(input) {
  const storeName = String(input["store-name"] || "");
  const storeUrl = cleanUrl(input["store-url"] || input.url || "");
  const runDir = path.resolve(required(input["run-dir"], "--run-dir"));
  const match = findEntry(storeName, storeUrl);
  const outDir = path.join(runDir, "memory");
  fs.mkdirSync(outDir, { recursive: true });
  const overlay = {
    schema_version: "sellerpilot.store_style_overlay.v1",
    status: match ? "applied" : "no_memory",
    store_name: storeName,
    store_url: storeUrl,
    applied_at: new Date().toISOString(),
    memory_path: match?.memory_path || null,
    overlay_markdown: match ? path.join(outDir, "store-style-memory.md") : null,
    use_policy: "Use this store style memory as a durable brand/store style layer. It must not override current user instructions, source product identity, official platform constraints, physical truth, or fresh research.",
  };
  if (match && fs.existsSync(match.memory_path)) {
    fs.copyFileSync(match.memory_path, path.join(outDir, "store-style-memory.md"));
  }
  fs.writeFileSync(path.join(outDir, "store-style-overlay.json"), `${JSON.stringify(overlay, null, 2)}\n`);
  return overlay;
}

function report(input) {
  const storeName = String(input["store-name"] || "");
  const storeUrl = cleanUrl(input["store-url"] || input.url || "");
  const entries = index.entries
    .filter((entry) => !storeName || key(entry.store_name) === key(storeName))
    .filter((entry) => !storeUrl || normalizeUrl(entry.store_url) === normalizeUrl(storeUrl))
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return {
    status: "ready",
    memory_root: storeDir,
    entries,
  };
}

function toStoreMarkdown(entry, input) {
  return [
    `# Store Style Memory: ${entry.store_name}`,
    "",
    "## Store Identity",
    `- Store name: ${entry.store_name}`,
    `- Store URL: ${entry.store_url}`,
    `- Platform: ${entry.platform}`,
    `- Category focus: ${entry.category}`,
    `- Locale: ${entry.locale}`,
    `- Last confirmed: ${entry.updated_at}`,
    `- Confirmed by: ${String(input["confirmed-by"] || "user").trim()}`,
    "",
    "## Positioning",
    listOrNone(input.positioning),
    "",
    "## Audience",
    listOrNone(input.audience),
    "",
    "## Visual Traits",
    listOrNone(input["visual-trait"] || input.trait),
    "",
    "## Palette",
    listOrNone(input.palette),
    "",
    "## Typography",
    listOrNone(input.typography),
    "",
    "## Photography And Scene Direction",
    listOrNone(input.photography),
    "",
    "## Layout System",
    listOrNone(input.layout),
    "",
    "## Copy Tone",
    listOrNone(input["copy-tone"]),
    "",
    "## Avoid",
    listOrNone(input.avoid),
    "",
    "## Prompt Directives",
    listOrNone(input["prompt-directive"]),
    "",
    "## Evidence And Source Notes",
    listOrNone(input.evidence || input["source-note"]),
    "",
    "## Use Policy",
    "- Apply this Markdown in future image-set planning, visual direction, prompt layering, and QA when this store is named or matched by URL.",
    "- This memory is a store/brand style layer only.",
    "- It must not override source product identity, physical truth, current user instructions, official platform constraints, safety/compliance boundaries, or fresh category research.",
    "- Do not add unsupported claims, credentials, supplier/customer data, or one-off failed-output feedback to this memory.",
    "",
  ].join("\n");
}

function listOrNone(value) {
  const list = cleanList(value);
  return list.length ? list.map((item) => `- ${item}`).join("\n") : "- None";
}

function readIndex(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed.entries)) return parsed;
  } catch {}
  return {
    schema_version: "sellerpilot.store_style_memory_index.v1",
    created_at: new Date().toISOString(),
    updated_at: null,
    entries: [],
  };
}

function upsertIndex(entry) {
  const existing = index.entries.findIndex((item) => item.id === entry.id);
  if (existing >= 0) index.entries[existing] = { ...index.entries[existing], ...entry };
  else index.entries.push(entry);
  index.updated_at = new Date().toISOString();
}

function findEntry(storeName, storeUrl) {
  const urlKey = normalizeUrl(storeUrl);
  const nameKey = key(storeName);
  return index.entries.find((entry) => urlKey && normalizeUrl(entry.store_url) === urlKey)
    || index.entries.find((entry) => nameKey && key(entry.store_name) === nameKey)
    || null;
}

function cleanList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => String(item).split(/[;\n]/))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length <= 300);
}

function rejectedPrivate(items) {
  return items.filter((item) => {
    if (/(password|token|secret|api[-_ ]?key|phone|email|address|供应商|采购价|成本|利润|客户|私密|private)/i.test(item)) return true;
    if (/(waterproof|fireproof|medical|certified|认证|防水|防火|医疗|儿童安全|宠物安全)/i.test(item) && !/(avoid|do not|不要|禁止|无证据|unsupported)/i.test(item)) return true;
    return false;
  });
}

function cleanUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/$/, "");
  }
}

function normalizeUrl(value) {
  return cleanUrl(value).toLowerCase();
}

function storeSlug(storeName, storeUrl) {
  const host = (() => {
    try {
      return new URL(storeUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  return key(`${storeName}-${host || storeUrl || "store"}`).slice(0, 96) || "store";
}

function key(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    console.error(`Missing required ${label}.`);
    process.exit(2);
  }
  return text;
}
