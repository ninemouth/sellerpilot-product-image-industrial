#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const checks = [];

function record(name, fn) {
  const started = Date.now();
  try {
    fn();
    checks.push({ name, status: "pass", ms: Date.now() - started });
  } catch (error) {
    checks.push({ name, status: "fail", ms: Date.now() - started, message: error.message });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || skillRoot,
    encoding: "utf8",
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit ${result.status}`,
      result.stdout && `stdout:\n${result.stdout.trim()}`,
      result.stderr && `stderr:\n${result.stderr.trim()}`,
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function listFiles(dir, predicate) {
  const found = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (predicate(full)) {
        found.push(full);
      }
    }
  }
  return found.sort();
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setRecursiveMtime(dir, date) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) setRecursiveMtime(full, date);
    fs.utimesSync(full, date, date);
  }
  fs.utimesSync(dir, date, date);
}

function requireBundled(name) {
  try {
    return require(name);
  } catch {
    const bundled = path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
      name,
    );
    return require(bundled);
  }
}

function writeFixturePng(file, color = "#f8f8f8", width = 1200, height = 1200) {
  const sharp = requireBundled("sharp");
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toFile(file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function workflowSteps(file) {
  const text = fs.readFileSync(path.join(skillRoot, file), "utf8");
  const stepsMatch = text.match(/^steps:\n([\s\S]*?)(?:\n[a-zA-Z0-9_]+:|\n$)/m);
  if (!stepsMatch) throw new Error(`${file} is missing steps.`);
  return stepsMatch[1]
    .split("\n")
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean);
}

function assertStepBefore(file, steps, before, after) {
  const beforeIndex = steps.indexOf(before);
  const afterIndex = steps.indexOf(after);
  if (beforeIndex < 0) throw new Error(`${file} missing workflow step ${before}`);
  if (afterIndex < 0) throw new Error(`${file} missing workflow step ${after}`);
  if (beforeIndex >= afterIndex) {
    throw new Error(`${file} must run ${before} before ${after}.`);
  }
}

record("frontmatter", () => {
  const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  if (!skillMd.startsWith("---\n")) throw new Error("SKILL.md must start with YAML frontmatter.");
  const end = skillMd.indexOf("\n---", 4);
  if (end < 0) throw new Error("SKILL.md frontmatter is not closed.");
  const frontmatter = skillMd.slice(4, end);
  if (!/^name:\s*sellerpilot-product-image-industrial(?:-thinkai)?$/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter name is missing or wrong.");
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter description is missing.");
  }
});

record("openai agent display metadata", () => {
  const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const isThinkAi = /^name:\s*sellerpilot-product-image-industrial-thinkai$/m.test(skillMd);
  const metadata = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  if (isThinkAi) {
    if (!/display_name:\s*"SellerPilot Product Image ThinkAI"/.test(metadata)) {
      throw new Error("ThinkAI variant must have a distinct OpenAI display_name.");
    }
    if (!metadata.includes("$sellerpilot-product-image-industrial-thinkai")) {
      throw new Error("ThinkAI variant default prompt must reference the ThinkAI skill name.");
    }
  } else {
    if (!/display_name:\s*"SellerPilot Product Image"/.test(metadata)) {
      throw new Error("Base skill OpenAI display_name should remain SellerPilot Product Image.");
    }
    if (/display_name:\s*"SellerPilot Product Image ThinkAI"/.test(metadata)) {
      throw new Error("Base skill display_name must not be changed to the ThinkAI variant name.");
    }
  }
});

record("node syntax", () => {
  for (const file of listFiles(path.join(skillRoot, "scripts"), (item) => item.endsWith(".mjs"))) {
    run(process.execPath, ["--check", file]);
  }
});

record("json parse", () => {
  for (const file of listFiles(skillRoot, (item) => item.endsWith(".json"))) {
    readJson(file);
  }
});

record("yaml parse", () => {
  const files = listFiles(skillRoot, (item) => /\.ya?ml$/i.test(item));
  const python = spawnSync("python3", ["-c", "import yaml"], { encoding: "utf8" });
  if (python.status === 0) {
    const script = [
      "import pathlib, sys, yaml",
      "for p in sys.argv[1:]:",
      "    yaml.safe_load(pathlib.Path(p).read_text())",
    ].join("\n");
    run("python3", ["-c", script, ...files], { maxBuffer: 50 * 1024 * 1024 });
    return;
  }
  const ruby = spawnSync("ruby", ["-e", "require 'yaml'"], { encoding: "utf8" });
  if (ruby.status === 0) {
    run("ruby", ["-e", "require 'yaml'; ARGV.each { |p| YAML.load_file(p) }", ...files], {
      maxBuffer: 50 * 1024 * 1024,
    });
    return;
  }
  throw new Error("Neither python3 PyYAML nor Ruby YAML is available for YAML validation.");
});

record("workflow loop guard ordering", () => {
  const workflows = [
    "workflows/ecommerce-product-image-generation.yaml",
    "workflows/pinduoduo-image-set.yaml",
    "workflows/amazon-image-set.yaml",
    "workflows/competitive-redesign.yaml",
    "workflows/multi-platform-image-pack.yaml",
    "workflows/tiktok-shop-image-set.yaml",
    "workflows/xiaohongshu-image-pack.yaml",
  ];
  for (const file of workflows) {
    const steps = workflowSteps(file);
    for (const required of [
      "skill-update-check-first",
      "create-run-skeleton",
      "production-efficiency-plan",
      "source-asset-normalization-for-card-and-infographic-layouts",
      "source-product-understanding-ai-text-first-ocr-if-needed",
      "source-product-understanding-gate-if-source-facts-or-visible-text",
      "product-identity-lock",
      "product-physical-truth-lock-if-function-use-or-scale-sensitive",
      "platform-preference-memory-apply-if-platform-category-match",
      "platform-preference-memory-remember-if-user-confirms-platform-traits",
      "store-style-memory-create-or-update-if-user-requests-store-style",
      "store-style-memory-apply-if-store-mentioned",
      "commerce-design-research-planner-if-conversion-critical",
      "copy-strategy-gate",
      "localized-copy-qa-gate-if-locale-needs-review",
      "text-layout-proof-gate-before-final-raster-if-visible-copy",
      "compact-image-set-blueprint",
      "image-set-export-gate",
      "anchor-batch-qa-decision-record",
      "localized-final-visible-text-qa-if-locale-needs-review",
      "text-layout-proof-gate-before-final-export-if-visible-copy",
      "product-background-card-consistency-gate",
      "generation-progress-reconcile-before-final-delivery",
      "runtime-watchdog-before-qa-loop",
      "qa-loop-router",
      "delivery-overview-contact-sheet-if-multi-image-set",
      "post-generation-tldraw-auto-start-if-generated-images",
      "final-delivery-gate",
    ]) {
      if (!steps.includes(required)) throw new Error(`${file} missing workflow step ${required}`);
    }
    assertStepBefore(file, steps, "resolve-skill-root", "skill-update-check-first");
    assertStepBefore(file, steps, "skill-update-check-first", "production-mode-router");
    assertStepBefore(file, steps, "create-run-skeleton", "image-set-export-gate");
    assertStepBefore(file, steps, "production-mode-router", "production-efficiency-plan");
    assertStepBefore(file, steps, "production-efficiency-plan", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "source-image-enhancement-if-needed", "source-asset-normalization-for-card-and-infographic-layouts");
    assertStepBefore(file, steps, "source-asset-normalization-for-card-and-infographic-layouts", "source-product-understanding-ai-text-first-ocr-if-needed");
    assertStepBefore(file, steps, "source-product-understanding-ai-text-first-ocr-if-needed", "product-identity-lock");
    assertStepBefore(file, steps, "source-product-understanding-gate-if-source-facts-or-visible-text", "product-identity-lock");
    assertStepBefore(file, steps, "product-identity-lock", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "platform-preference-memory-apply-if-platform-category-match", "platform-context-planner");
    assertStepBefore(file, steps, "store-style-memory-apply-if-store-mentioned", "platform-context-planner");
    assertStepBefore(file, steps, "store-style-memory-apply-if-store-mentioned", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "commerce-design-research-planner-if-conversion-critical", "audience-persona");
    assertStepBefore(file, steps, "compact-image-set-blueprint", "prompt-layer-stack");
    assertStepBefore(file, steps, "product-physical-truth-lock-if-function-use-or-scale-sensitive", "product-physics-fact-gate-if-function-use-or-scale-sensitive");
    assertStepBefore(file, steps, "copy-strategy-gate", "marketing-quality-gate");
    assertStepBefore(file, steps, "localized-copy-qa-gate-if-locale-needs-review", "marketing-quality-gate");
    assertStepBefore(file, steps, "localized-copy-qa-gate-if-locale-needs-review", "text-layout-proof-gate-before-final-raster-if-visible-copy");
    assertStepBefore(file, steps, "text-layout-proof-gate-before-final-raster-if-visible-copy", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "anchor-batch-generation-loop-if-runtime-available", "anchor-batch-qa-decision-record");
    assertStepBefore(file, steps, "anchor-batch-qa-decision-record", "continue-missing-assets-only");
    assertStepBefore(file, steps, "text-layout-proof-gate-before-final-export-if-visible-copy", "localized-final-visible-text-qa-if-locale-needs-review");
    assertStepBefore(file, steps, "localized-final-visible-text-qa-if-locale-needs-review", "marketing-quality-gate");
    assertStepBefore(file, steps, "product-background-card-consistency-gate", "marketing-quality-gate");
    assertStepBefore(file, steps, "image-set-export-gate", "qa-loop-router");
    assertStepBefore(file, steps, "image-set-export-gate", "generation-progress-reconcile-before-final-delivery");
    assertStepBefore(file, steps, "generation-progress-reconcile-before-final-delivery", "qa-loop-router");
    assertStepBefore(file, steps, "generation-progress-reconcile-before-final-delivery", "runtime-watchdog-before-qa-loop");
    assertStepBefore(file, steps, "runtime-watchdog-before-qa-loop", "qa-loop-router");
    assertStepBefore(file, steps, "qa-loop-router", "delivery-overview-contact-sheet-if-multi-image-set");
    assertStepBefore(file, steps, "delivery-overview-contact-sheet-if-multi-image-set", "final-delivery-gate");
    assertStepBefore(file, steps, "delivery-overview-contact-sheet-if-multi-image-set", "post-generation-tldraw-auto-start-if-generated-images");
    assertStepBefore(file, steps, "post-generation-tldraw-auto-start-if-generated-images", "final-delivery-gate");
  }
});

record("no legacy provider naming", () => {
  const files = listFiles(skillRoot, (item) => !/node_modules/.test(item) && /\.(md|mjs|json|ya?ml)$/i.test(item));
  const legacyPatterns = [
    new RegExp(["gpt", "imagine", "2"].join("-"), "i"),
    new RegExp(["imagine", "2"].join("-"), "i"),
    new RegExp(["imagine", "2"].join(""), "i"),
  ];
  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (legacyPatterns.some((pattern) => pattern.test(text) || pattern.test(path.basename(file)))) {
      offenders.push(path.relative(skillRoot, file));
    }
  }
  if (offenders.length) throw new Error(`Legacy provider naming remains in: ${offenders.join(", ")}`);
});

record("thinkai runtime contract", () => {
  const runtimePath = path.join(skillRoot, "scripts", "thinkai-image-runtime.mjs");
  const configurePath = path.join(skillRoot, "scripts", "configure-thinkai-runtime.mjs");
  if (!fs.existsSync(runtimePath)) throw new Error("scripts/thinkai-image-runtime.mjs is missing.");
  if (!fs.existsSync(configurePath)) throw new Error("scripts/configure-thinkai-runtime.mjs is missing.");
  const runtime = fs.readFileSync(runtimePath, "utf8");
  for (const token of [
    'DEFAULT_BASE_URL = "https://www.thinkai.tv/v1"',
    'DEFAULT_MODEL = "gpt-image-2"',
    "THINKAI_API_KEY",
    "spawnSync(\"curl\"",
    "/images/generations",
    "/images/edits",
    "response_format",
  ]) {
    if (!runtime.includes(token)) throw new Error(`ThinkAI runtime missing ${token}`);
  }
  run(process.execPath, [
    "scripts/thinkai-image-runtime.mjs",
    "--prompt", "verify dry run",
    "--output-dir", tmpDir("sp-verify-thinkai-runtime-"),
    "--dry-run",
  ]);
  const configDir = tmpDir("sp-verify-thinkai-config-");
  const configOut = run(process.execPath, [
    "scripts/configure-thinkai-runtime.mjs",
    "--skill-dir", configDir,
    "--api-key", "verify-key",
  ]);
  const configSummary = JSON.parse(configOut);
  const config = readJson(path.join(configDir, ".thinkai-image-runtime.json"));
  if (configSummary.model !== "gpt-image-2" || config.model !== "gpt-image-2") {
    throw new Error("ThinkAI config script must write model gpt-image-2.");
  }
  if (config.api_key !== "verify-key") {
    throw new Error("ThinkAI config script did not write the supplied API key.");
  }
  const docs = [
    "README.md",
    "SKILL.md",
    "references/gpt-built-in-image-generation-policy.md",
  ].map((file) => [file, fs.readFileSync(path.join(skillRoot, file), "utf8")]);
  for (const [file, text] of docs) {
    if (!text.includes("gpt-image-2")) throw new Error(`${file} must name gpt-image-2.`);
    if (!text.includes("thinkai-image-runtime.mjs")) throw new Error(`${file} must name the ThinkAI runtime script.`);
  }
});

record("tldraw lockfile", () => {
  const lockPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "package-lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("assets/tldraw-review-workspace/package-lock.json is missing.");
  const lock = readJson(lockPath);
  if (lock.name !== "sellerpilot-tldraw-review-workspace") throw new Error("tldraw lockfile name mismatch.");
});

record("review workspace UI contract", () => {
  const mainPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "src", "main.jsx");
  const cssPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "src", "styles.css");
  const main = fs.readFileSync(mainPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const requiredMain = [
    "Tldraw",
    "AssetRecordType",
    "createShapeId",
    "locked image-floor shapes",
    "action-complete-review",
    "COMPLETE_REVIEW_API_URL",
    "__SELLERPILOT_REVIEW_HANDOFF_RESULT__",
    "review_completion.v2",
    "native-tldraw",
    "compact-field",
  ];
  for (const token of requiredMain) {
    if (!main.includes(token)) throw new Error(`review workspace main.jsx missing ${token}`);
  }
  const requiredCss = [
    ".topbar",
    ".tldraw-shell",
    ".review-toolbar",
    ".selected-summary",
  ];
  for (const token of requiredCss) {
    if (!css.includes(token)) throw new Error(`review workspace styles.css missing ${token}`);
  }
  if (/className=["']sidebar["']|\.sidebar\b|image-card-layer/.test(`${main}\n${css}`)) {
    throw new Error("review workspace should not restore left sidebar or HTML image-card overlay layer.");
  }
  if (!/isLocked:\s*true/.test(main) || !/sendToBack/.test(main)) {
    throw new Error("review workspace must lock imported image shapes and send them behind tldraw annotations.");
  }
  const vite = fs.readFileSync(path.join(skillRoot, "assets", "tldraw-review-workspace", "vite.config.js"), "utf8");
  for (const token of [
    "sellerpilotReviewHandoffPlugin",
    "/complete-review",
    "review-completion-ready.json",
    "ready_for_codex",
  ]) {
    if (!vite.includes(token)) throw new Error(`review workspace vite.config.js missing ${token}`);
  }
});

record("no default html review canvas generation", () => {
  const renderer = fs.readFileSync(path.join(skillRoot, "scripts", "render-commerce-image-set.mjs"), "utf8");
  if (/review-canvas\.html|create-review-canvas/.test(renderer)) {
    throw new Error("render-commerce-image-set.mjs must not create review-canvas.html by default.");
  }
  const docs = [
    "SKILL.md",
    "AGENTS.md",
    "references/review-canvas.md",
    "references/output-contract.md",
    "references/marketing-quality-gates.md",
  ].map((file) => [file, fs.readFileSync(path.join(skillRoot, file), "utf8")]);
  const offenders = docs
    .filter(([file, text]) => /review-canvas\.html|create-review-canvas|旧 HTML 画布仅作为 fallback|HTML Fallback|local HTML canvas/i.test(text))
    .map(([file]) => file);
  if (offenders.length) {
    throw new Error(`Docs still recommend or name legacy review-canvas.html: ${offenders.join(", ")}`);
  }
});

record("tldraw shared service template sync dry run", () => {
  const dir = tmpDir("sp-verify-shared-service-");
  const out = run(process.execPath, [
    "scripts/start-tldraw-shared-service.mjs",
    "--shared-root", path.join(dir, "canvas-service"),
    "--session-id", "verify-template-sync",
    "--dry-run",
  ]);
  const parsed = JSON.parse(out);
  if (parsed.status !== "dry_run") throw new Error("shared service dry-run should not start server.");
  if (!parsed.templateSync?.source_hash) throw new Error("shared service should report template source hash.");
  if (!parsed.templateSync?.changed) throw new Error("new shared root should report template sync changed=true.");
});

record("skill update checker smoke", () => {
  const dir = tmpDir("sp-verify-update-check-");
  const releasePath = path.join(dir, ".sellerpilot-skill-release.json");
  const packagePath = path.join(dir, "package.json");
  const cachePath = path.join(dir, ".cache", "skill-update-status.json");
  fs.writeFileSync(packagePath, JSON.stringify({
    version: "0.1.0",
    repository: { type: "git", url: "https://github.com/ninemouth/sellerpilot-product-image-industrial.git" },
  }, null, 2));
  fs.writeFileSync(releasePath, JSON.stringify({
    schema_version: "sellerpilot.skill_release.v1",
    local_commit: "1111111111111111111111111111111111111111",
    remote_url: "https://github.com/ninemouth/sellerpilot-product-image-industrial.git",
    remote_branch: "main",
    synced_at: "2026-07-06T00:00:00.000Z",
  }, null, 2));
  const out = run(process.execPath, [
    "scripts/check-skill-update.mjs",
    "--skill-root", dir,
    "--cache-file", cachePath,
    "--remote-commit", "2222222222222222222222222222222222222222",
    "--cache-ttl-hours", "0",
  ]);
  const report = JSON.parse(out);
  if (report.status !== "update_available" || !report.needs_update) {
    throw new Error("update checker should report update_available when local and remote commits differ.");
  }
  const cachedOut = run(process.execPath, [
    "scripts/check-skill-update.mjs",
    "--skill-root", dir,
    "--cache-file", cachePath,
    "--remote-commit", "3333333333333333333333333333333333333333",
    "--cache-ttl-hours", "24",
  ]);
  const cached = JSON.parse(cachedOut);
  if (!cached.cache_hit || cached.remote.commit !== "2222222222222222222222222222222222222222") {
    throw new Error("update checker should use fresh cache instead of rechecking remote.");
  }
});

record("skill sync release metadata branch smoke", () => {
  const dir = tmpDir("sp-verify-sync-release-");
  const dest = path.join(dir, "installed-skill");
  run(process.execPath, [
    "scripts/sync-to-codex-skill.mjs",
    "--source", skillRoot,
    "--dest", dest,
    "--skill-name", "sellerpilot-product-image-industrial",
    "--remote-branch", "codex/test-branch",
    "--skip-verify",
    "--no-backup",
  ]);
  const release = readJson(path.join(dest, ".sellerpilot-skill-release.json"));
  if (release.remote_branch !== "codex/test-branch") {
    throw new Error("sync release metadata should preserve the configured remote branch for update checks.");
  }
  if (!release.local_commit || !release.remote_url) {
    throw new Error("sync release metadata should include local commit and remote url.");
  }
  const pkg = readJson(path.join(skillRoot, "package.json"));
  if (!pkg.scripts?.["sync:thinkai"]?.includes("--remote-branch $(git rev-parse --abbrev-ref HEAD)")) {
    throw new Error("sync:thinkai should pass the current git branch because dist/ is not a git checkout.");
  }
  const distLikeSource = path.join(dir, "dist-like-source");
  const distLikeDest = path.join(dir, "dist-like-installed");
  fs.mkdirSync(distLikeSource, { recursive: true });
  fs.writeFileSync(path.join(distLikeSource, "SKILL.md"), [
    "---",
    "name: sellerpilot-product-image-industrial-thinkai",
    "description: test",
    "---",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(distLikeSource, "package.json"), JSON.stringify({
    version: "0.1.0",
    repository: { type: "git", url: "https://github.com/ninemouth/sellerpilot-product-image-industrial.git" },
  }, null, 2));
  run(process.execPath, [
    "scripts/sync-to-codex-skill.mjs",
    "--source", distLikeSource,
    "--dest", distLikeDest,
    "--skill-name", "sellerpilot-product-image-industrial-thinkai",
    "--remote-branch", "codex/test-branch",
    "--skip-verify",
    "--no-backup",
  ]);
  const distLikeRelease = readJson(path.join(distLikeDest, ".sellerpilot-skill-release.json"));
  if (!distLikeRelease.local_commit || distLikeRelease.remote_branch !== "codex/test-branch") {
    throw new Error("sync release metadata should preserve branch and local commit for dist-like sources without .git.");
  }
});

record("production update gate contract", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const agents = fs.readFileSync(path.join(skillRoot, "AGENTS.md"), "utf8");
  const readme = fs.readFileSync(path.join(skillRoot, "README.md"), "utf8");
  if (!skill.includes("Every production request must start with the update check")) {
    throw new Error("SKILL.md must require update check as the first production gate.");
  }
  if (!skill.includes("Do not enter production planning, source analysis, image generation, QA, or canvas launch until the user chooses")) {
    throw new Error("SKILL.md must pause production when update_available is detected.");
  }
  if (!agents.includes("所有 production request 的第一步必须运行 skill update check")) {
    throw new Error("AGENTS.md must require update check as the first production step.");
  }
  if (!readme.includes("用户选择前不进入生产规划、生图、QA 或画布启动")) {
    throw new Error("README.md must document the update_available pause behavior.");
  }
});

record("production mode router smoke", () => {
  const dir = tmpDir("sp-verify-mode-router-");
  const qualityDir = path.join(dir, "quality");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", qualityDir,
    "--user-text", "为拼多多女包生成8图高质量套图，包含场景图",
    "--image-count", "8",
    "--quality-target", "high",
    "--has-source-image", "true",
    "--scene-requested", "true",
  ]);
  const quality = readJson(path.join(qualityDir, "production-mode-router-report.json"));
  if (quality.selected_mode !== "quality_production") {
    throw new Error(`multi-image high-quality set should route to quality_production, got ${quality.selected_mode}`);
  }
  if (!quality.execution_policy.required_quality_path.includes("anchor-batch-imagegen")) {
    throw new Error("quality production should require anchor batch pacing.");
  }
  if (!quality.execution_policy.required_quality_path.includes("compact-image-set-planning")) {
    throw new Error("quality production should preserve compact image-set planning.");
  }

  const singleQualityDir = path.join(dir, "single-quality");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", singleQualityDir,
    "--user-text", "生成一张高质量场景主图",
    "--image-count", "1",
    "--quality-target", "high",
    "--scene-requested", "true",
  ]);
  const singleQuality = readJson(path.join(singleQualityDir, "production-mode-router-report.json"));
  if (singleQuality.selected_mode !== "quality_production") {
    throw new Error(`single high-quality image should route to quality_production, got ${singleQuality.selected_mode}`);
  }
  if (!singleQuality.execution_policy.required_quality_path.includes("single-image-generation")) {
    throw new Error("single quality production should use the single-image path.");
  }
  if (singleQuality.execution_policy.required_quality_path.includes("anchor-batch-imagegen") || singleQuality.execution_policy.required_quality_path.includes("overview-contact-sheet")) {
    throw new Error("single quality production should not require anchor batch or delivery overview.");
  }

  const fastDir = path.join(dir, "fast");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", fastDir,
    "--user-text", "快速生成一张草稿主图",
    "--image-count", "1",
    "--fast", "true",
  ]);
  const fast = readJson(path.join(fastDir, "production-mode-router-report.json"));
  if (fast.selected_mode !== "fast_generation") {
    throw new Error(`single speed-first draft should route to fast_generation, got ${fast.selected_mode}`);
  }

  const auditDir = path.join(dir, "audit");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", auditDir,
    "--user-text", "生成工业级完整审计包和 gate report",
  ]);
  const audit = readJson(path.join(auditDir, "production-mode-router-report.json"));
  if (audit.selected_mode !== "industrial_audit") {
    throw new Error(`industrial evidence request should route to industrial_audit, got ${audit.selected_mode}`);
  }
});

record("production efficiency plan smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-efficiency-plan-"), "run");
  const modeDir = path.join(runDir, "mode");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", modeDir,
    "--user-text", "为拼多多女包生成8图高质量套图",
    "--image-count", "8",
    "--quality-target", "high",
    "--has-source-image", "true",
  ]);
  run(process.execPath, [
    "scripts/production-efficiency-plan.mjs",
    "--run-dir", runDir,
    "--mode-report", path.join(modeDir, "production-mode-router-report.json"),
    "--image-count", "8",
    "--has-source-image", "true",
  ]);
  const plan = readJson(path.join(runDir, "planning", "production-efficiency-plan.json"));
  if (!plan.quality_contract?.compact_image_set_planning_required) {
    throw new Error("quality efficiency plan should require compact image-set planning.");
  }
  if (plan.triggered_work.platform_web_research !== "skip_use_platform_yaml_baseline") {
    throw new Error("quality efficiency plan should skip live research when no freshness trigger exists.");
  }
  if (!plan.skip_by_default.includes("full industrial report pack")) {
    throw new Error("quality efficiency plan should skip verbose industrial artifacts by default.");
  }
  const progress = readJson(path.join(runDir, "generated-assets", "generation-progress.json"));
  if (progress.next_action !== "build compact image-set planning before anchor batch") {
    throw new Error("efficiency plan should initialize generation progress.");
  }

  const singleRunDir = path.join(tmpDir("sp-verify-single-efficiency-"), "run");
  const singleModeDir = path.join(singleRunDir, "mode");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", singleModeDir,
    "--user-text", "生成一张高质量场景主图",
    "--image-count", "1",
    "--quality-target", "high",
    "--scene-requested", "true",
  ]);
  run(process.execPath, [
    "scripts/production-efficiency-plan.mjs",
    "--run-dir", singleRunDir,
    "--mode-report", path.join(singleModeDir, "production-mode-router-report.json"),
    "--image-count", "1",
    "--scene-requested", "true",
  ]);
  const singlePlan = readJson(path.join(singleRunDir, "planning", "production-efficiency-plan.json"));
  if (singlePlan.quality_contract.compact_image_set_planning_required) {
    throw new Error("single-image quality production should not require compact image-set planning.");
  }
  if (!singlePlan.quality_contract.single_image_delivery_allowed) {
    throw new Error("single-image quality production should explicitly allow single-image delivery.");
  }
  const singleProgress = readJson(path.join(singleRunDir, "generated-assets", "generation-progress.json"));
  if (singleProgress.next_action !== "build single-image visual plan before final generation") {
    throw new Error("single-image efficiency plan should initialize a single-image next action.");
  }
});

record("brief intake smoke", () => {
  const outDir = path.join(tmpDir("sp-verify-brief-"), "brief");
  run(process.execPath, [
    "scripts/brief-intake-gate.mjs",
    "--out-dir", outDir,
    "--platform", "拼多多",
    "--category", "女包",
    "--image-count", "8",
    "--has-source-image", "true",
    "--scene-requested", "true",
  ]);
  const report = readJson(path.join(outDir, "brief-intake-gate-report.json"));
  if (!/^continue/.test(report.status)) throw new Error(`unexpected brief status ${report.status}`);
});

record("run skeleton and gates smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-run-"), "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "女包",
    "--product-name", "测试女包",
  ]);
  const required = [
    "00-task-context.yaml",
    "01-goal-contract.yaml",
    "strategy/direction-selection.yaml",
    "source-normalized/product-normalization-report.json",
    "source-understanding/source-product-understanding.json",
    "research/platform-context-plan.md",
    "blueprint/02-identity-lock.yaml",
    "blueprint/02b-product-physical-truth.json",
    "copy/copy-strategy.yaml",
    "geometry/source-geometry.json",
    "blueprint/07-graphic-design-direction.yaml",
    "prompt-pack/10-generation-request-pack.yaml",
    "prompt-pack/12-prompt-layer-stack.json",
    "qa/qa-loop-state.json",
    "qa/final-delivery-gate-report.md",
  ];
  for (const file of required) {
    if (!fs.existsSync(path.join(runDir, file))) throw new Error(`run skeleton missing ${file}`);
  }
});

record("source product understanding gate smoke", () => {
  const dir = tmpDir("sp-verify-source-understanding-");
  const understandingPath = path.join(dir, "source-product-understanding.json");
  const identityPath = path.join(dir, "identity-lock.yaml");
  const physicalPath = path.join(dir, "physical-truth.json");
  const geometryPath = path.join(dir, "source-geometry.json");
  fs.writeFileSync(understandingPath, JSON.stringify({
    schema_version: "sellerpilot.source_product_understanding.v1",
    status: "locked",
    vision_ocr_pass: {
      status: "completed_needs_verification",
      raw_text: "Length 1.08 in\\nClosed Height 0.47 in\\nScrew installation",
    },
    codex_visual_product_read: {
      status: "complete",
      product_identity_summary: "Black low-profile string light cable routing clip with screw mount base.",
      observed_product_type: "string light cable routing clip",
      observed_components: ["curved cable channel", "screw mount base", "press-lock arm"],
      observed_function_or_use: ["routes cable on wood rail"],
    },
    text_understanding: {
      visible_text_items: [{ text: "Length 1.08 in", reveals: ["physical_size_or_dimension"] }],
      text_derived_facts: [
        { fact_type: "dimension", value: "Length 1.08 in" },
        { fact_type: "dimension", value: "Closed Height 0.47 in" },
        { fact_type: "installation", value: "Screw installation" },
      ],
    },
  }, null, 2));
  fs.writeFileSync(identityPath, "identity_lock:\n  product_type: string light cable routing clip\n  must_preserve:\n    components:\n      - curved cable channel\n      - screw mount base\n");
  fs.writeFileSync(physicalPath, JSON.stringify({
    product_physical_truth: {
      status: "locked",
      confirmed_functions: ["routes cable on wood rail"],
      confirmed_user_actions: ["Screw installation"],
      scale_reference: { dimensions: ["Length 1.08 in", "Closed Height 0.47 in"] },
    },
  }, null, 2));
  fs.writeFileSync(geometryPath, JSON.stringify({
    geometry_lock: {
      product_type: "string light cable routing clip",
      dimensions_from_source_text: ["Length 1.08 in", "Closed Height 0.47 in"],
    },
  }, null, 2));
  run(process.execPath, [
    "scripts/source-product-understanding-gate.mjs",
    "--understanding", understandingPath,
    "--identity-lock", identityPath,
    "--physical-truth", physicalPath,
    "--source-geometry", geometryPath,
    "--out-dir", path.join(dir, "qa-pass"),
  ]);

  const pendingPath = path.join(dir, "pending-source-product-understanding.json");
  fs.writeFileSync(pendingPath, JSON.stringify({
    status: "starter_needs_codex_visual_review",
    vision_ocr_pass: { status: "completed_needs_verification", raw_text: "Length 1.08 in" },
    codex_visual_product_read: { status: "pending" },
    text_understanding: { visible_text_items: [], text_derived_facts: [] },
  }, null, 2));
  spawnSync(process.execPath, [
    "scripts/source-product-understanding-gate.mjs",
    "--understanding", pendingPath,
    "--out-dir", path.join(dir, "qa-fail"),
  ], { cwd: skillRoot });
  const failed = readJson(path.join(dir, "qa-fail", "source-product-understanding-gate-report.json"));
  if (failed.status !== "fail") throw new Error("source understanding gate should fail pending/OCR-unstructured source read.");

  const noTextPath = path.join(dir, "no-text-source-product-understanding.json");
  fs.writeFileSync(noTextPath, JSON.stringify({
    schema_version: "sellerpilot.source_product_understanding.v1",
    status: "locked",
    vision_ocr_pass: { status: "skipped_ai_visual_first", raw_text: "" },
    codex_visual_product_read: {
      status: "complete",
      product_identity_summary: "Plain black cable clip with no visible label text.",
      observed_product_type: "cable clip",
      observed_components: ["curved cable channel", "mount base"],
    },
    text_understanding: {
      ai_visual_text_read: {
        status: "complete",
        visible_text_detected: false,
        transcribed_items: [],
        uncertain_items: [],
      },
      visible_text_items: [],
      text_derived_facts: [],
    },
  }, null, 2));
  fs.writeFileSync(identityPath, "identity_lock:\n  product_type: cable clip\n  must_preserve:\n    components:\n      - curved cable channel\n      - mount base\n");
  run(process.execPath, [
    "scripts/source-product-understanding-gate.mjs",
    "--understanding", noTextPath,
    "--identity-lock", identityPath,
    "--out-dir", path.join(dir, "qa-no-text-pass"),
  ]);
});

record("source product understanding conditional OCR smoke", () => {
  const tesseract = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (tesseract.status !== 0) return;
  const dir = tmpDir("sp-verify-source-ocr-");
  const imagePath = path.join(dir, "source.png");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="white"/><text x="120" y="180" font-family="Arial" font-size="64" font-weight="700" fill="black">Length 1.08 in</text><text x="120" y="280" font-family="Arial" font-size="64" fill="black">Closed Height 0.47 in</text></svg>`;
  execFileSync(process.execPath, ["-e", `
    (async () => {
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    await sharp(Buffer.from(process.argv[2])).png().toFile(process.argv[1]);
    })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imagePath, svg], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/create-source-product-understanding.mjs",
    "--image", imagePath,
    "--out-dir", path.join(dir, "source-understanding"),
    "--category", "cable clip",
    "--ocr-mode", "always",
  ]);
  const report = readJson(path.join(dir, "source-understanding", "source-product-understanding.json"));
  if (report.vision_ocr_pass.status !== "completed_needs_verification") {
    throw new Error(`Conditional OCR should read text when explicitly requested, got ${report.vision_ocr_pass.status}`);
  }
  const values = (report.text_understanding?.text_derived_facts || []).map((item) => item.value).join(" ");
  if (!/1\.08 in/.test(values) || !/0\.47 in/.test(values)) {
    throw new Error("Conditional OCR should extract visible dimension facts.");
  }

  const skipDir = path.join(dir, "source-understanding-skip");
  run(process.execPath, [
    "scripts/create-source-product-understanding.mjs",
    "--image", imagePath,
    "--out-dir", skipDir,
    "--category", "cable clip",
    "--ocr-mode", "auto",
    "--text-visibility", "no",
  ]);
  const skipped = readJson(path.join(skipDir, "source-product-understanding.json"));
  if (skipped.vision_ocr_pass.status !== "skipped_ai_visual_first") {
    throw new Error(`OCR should be skipped when AI visual precheck sees no text, got ${skipped.vision_ocr_pass.status}`);
  }
});

record("strategy direction smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-strategy-"), "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "球衣",
    "--product-name", "测试球衣",
  ]);
  run(process.execPath, [
    "scripts/strategy-direction-gate.mjs",
    "--run-dir", runDir,
    "--platform", "拼多多",
    "--category", "球衣",
    "--season", "summer",
  ]);
  const report = readJson(path.join(runDir, "strategy", "direction-options.json"));
  if (report.options.length < 2) throw new Error("strategy direction gate should create multiple options.");
  if (!report.selected_option_id) throw new Error("strategy direction gate should auto-select a route.");
  run(process.execPath, [
    "scripts/strategy-direction-handoff-gate.mjs",
    "--run-dir", runDir,
  ]);
  const handoff = readJson(path.join(runDir, "strategy", "direction-user-handoff.json"));
  if (handoff.status !== "ready") throw new Error("strategy handoff should be ready.");
  if (!handoff.first_user_visible_message.includes("我会先给你 2-3 个商品图方向")) {
    throw new Error("strategy handoff should produce first user-visible choices.");
  }
  if (!handoff.must_surface_before_formal_production) {
    throw new Error("strategy handoff should be mandatory before formal production.");
  }
});

record("platform context planner smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-context-"), "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "球衣",
  ]);
  run(process.execPath, [
    "scripts/platform-context-planner.mjs",
    "--run-dir", runDir,
    "--platform", "拼多多",
    "--category", "球衣",
    "--season", "summer",
    "--climate", "hot-humid",
    "--region", "华南",
  ]);
  const report = readJson(path.join(runDir, "research", "platform-context-plan.json"));
  const plan = report.platform_category_profile_overlay;
  if (!plan.baseline_yaml_interpretability?.readable_as_baseline) throw new Error("platform profile should be readable as baseline.");
  if (!plan.web_research_required) throw new Error("dynamic platform context should require current research.");
  if (!Array.isArray(plan.query_plan) || !plan.query_plan.length) throw new Error("platform context planner should create query plan.");
});

record("platform preference memory smoke", () => {
  const root = tmpDir("sp-verify-platform-memory-");
  const memoryRoot = path.join(root, "memory-root");
  const runDir = path.join(root, "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Ozon",
    "--category", "women bag",
  ]);
  const rememberedOut = run(process.execPath, [
    "scripts/platform-preference-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "remember",
    "--platform", "Ozon",
    "--category", "women bag",
    "--locale", "ru-RU",
    "--trait", "3:4 portrait first image with clean marketplace readability",
    "--style", "minimal premium detail gallery for Ozon women bag",
    "--copy-tone", "short Russian benefit phrasing",
    "--avoid", "do not overload the first image with infographic labels",
    "--avoid", "supplier password token",
    "--source-note", "user_confirmed_platform_style_trait",
  ]);
  const remembered = JSON.parse(rememberedOut);
  if (remembered.status !== "remembered") throw new Error("platform preference memory should remember confirmed platform traits.");
  if (remembered.entry.avoid.some((item) => /password|token/i.test(item))) {
    throw new Error("platform preference memory should not store private/non-platform avoid notes.");
  }
  run(process.execPath, [
    "scripts/platform-preference-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "apply",
    "--platform", "Ozon",
    "--category", "women bag",
    "--locale", "ru-RU",
    "--run-dir", runDir,
  ]);
  const overlay = readJson(path.join(runDir, "memory", "platform-preference-overlay.json"));
  if (overlay.status !== "applied") throw new Error("platform preference memory should apply matching platform/category memory.");
  if (!overlay.merged_preferences.visual_traits.some((item) => /3:4 portrait/.test(item))) {
    throw new Error("platform preference overlay should include remembered visual traits.");
  }
  if (!overlay.use_policy.includes("Do not override current user instructions")) {
    throw new Error("platform preference overlay should include a use policy boundary.");
  }
});

record("store style memory smoke", () => {
  const root = tmpDir("sp-verify-store-style-memory-");
  const memoryRoot = path.join(root, "memory-root");
  const runDir = path.join(root, "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Amazon",
    "--category", "bridal clutch",
  ]);
  const draftOut = run(process.execPath, [
    "scripts/store-style-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "draft",
    "--store-name", "Luna Bridal",
    "--store-url", "https://example.com/store?utm=secret",
    "--platform", "Amazon",
    "--category", "bridal clutch",
    "--analysis", "Current store reads as soft bridal, pearl detail, warm neutral styling.",
    "--recommendation", "Elegant warm ivory bridal system with close detail shots and restrained typography.",
    "--run-dir", runDir,
  ]);
  const draft = JSON.parse(draftOut);
  if (draft.status !== "draft_ready") throw new Error("store style draft should be created before confirmation.");
  if (!fs.existsSync(path.join(runDir, "memory", "store-style-draft.md"))) {
    throw new Error("store style draft should be written into the run memory folder.");
  }
  const blockedOut = run(process.execPath, [
    "scripts/store-style-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "remember",
    "--store-name", "Luna Bridal",
    "--store-url", "https://example.com/store",
    "--visual-trait", "warm ivory background",
  ]);
  if (JSON.parse(blockedOut).status !== "blocked_needs_user_confirmation") {
    throw new Error("store style memory must require explicit user confirmation before saving.");
  }
  const rememberedOut = run(process.execPath, [
    "scripts/store-style-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "remember",
    "--store-name", "Luna Bridal",
    "--store-url", "https://example.com/store?utm=secret",
    "--platform", "Amazon",
    "--category", "bridal clutch",
    "--confirmed", "true",
    "--confirmed-by", "user",
    "--positioning", "soft premium bridal accessories",
    "--audience", "brides seeking elegant pearl evening bags",
    "--visual-trait", "warm ivory background with pearl-detail closeups",
    "--palette", "ivory, champagne gold, soft shadow gray",
    "--typography", "thin elegant serif for headline, simple sans for specs",
    "--photography", "macro pearl texture, hand-held bridal scene, clean tabletop hero",
    "--layout", "airy composition with product dominant and small trust details",
    "--copy-tone", "short graceful bridal wording",
    "--avoid", "no loud discount badges or unrelated party props",
    "--prompt-directive", "apply store style as a brand layer after product identity lock",
    "--evidence", "confirmed after store URL review and user approval",
  ]);
  const remembered = JSON.parse(rememberedOut);
  if (remembered.status !== "remembered") throw new Error("confirmed store style memory should be remembered.");
  const memoryMd = fs.readFileSync(remembered.memory_path, "utf8");
  if (!memoryMd.includes("# Store Style Memory: Luna Bridal") || !memoryMd.includes("Prompt Directives")) {
    throw new Error("store style memory should be saved as a durable Markdown document.");
  }
  run(process.execPath, [
    "scripts/store-style-memory.mjs",
    "--memory-root", memoryRoot,
    "--mode", "apply",
    "--store-name", "Luna Bridal",
    "--run-dir", runDir,
  ]);
  const overlay = readJson(path.join(runDir, "memory", "store-style-overlay.json"));
  if (overlay.status !== "applied") throw new Error("store style memory should apply by store name.");
  const appliedMd = fs.readFileSync(path.join(runDir, "memory", "store-style-memory.md"), "utf8");
  if (!appliedMd.includes("warm ivory background")) {
    throw new Error("applied store style Markdown should be copied into the run memory folder.");
  }
  if (!overlay.use_policy.includes("source product identity")) {
    throw new Error("store style overlay should preserve product identity boundary.");
  }
});

record("commerce design research planner smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-commerce-research-"), "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Ozon",
    "--category", "women bag",
  ]);
  run(process.execPath, [
    "scripts/commerce-design-research-planner.mjs",
    "--run-dir", runDir,
    "--platform", "Ozon",
    "--category", "women bag",
    "--locale", "ru-RU",
    "--goal", "both",
    "--research-depth", "compact",
  ]);
  const plan = readJson(path.join(runDir, "research", "commerce-design-research-plan.json"));
  if (plan.research_budget.required_reference_count !== 4) throw new Error("compact commerce research should use compact reference budget.");
  for (const key of ["first_second_click_hook", "dwell_time_mechanisms", "trust_and_objection_handlers", "conversion_copy"]) {
    if (!Array.isArray(plan.extraction_framework[key]) || !plan.extraction_framework[key].length) {
      throw new Error(`commerce design research plan missing extraction framework ${key}.`);
    }
  }
  if (!plan.output_contract.blueprint_fields_to_update.includes("image_set[].buyer_question")) {
    throw new Error("commerce design research should write back into image-set buyer questions.");
  }
});

record("blocked scaffold smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-blocked-"), "run");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "女包",
    "--product-name", "测试女包",
  ]);
  spawnSync(process.execPath, ["scripts/prompt-readiness-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const readiness = readJson(path.join(runDir, "qa", "prompt-readiness-gate-report.json"));
  if (readiness.status !== "blocked") throw new Error("prompt readiness should block empty scaffold.");
  spawnSync(process.execPath, [
    "scripts/prompt-layer-gate.mjs",
    "--stack", path.join(runDir, "prompt-pack", "12-prompt-layer-stack.json"),
    "--out-dir", path.join(runDir, "qa"),
  ], { cwd: skillRoot });
  const layer = readJson(path.join(runDir, "qa", "prompt-layer-gate-report.json"));
  if (layer.status !== "blocked") throw new Error("prompt layer should block empty scaffold.");
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const finalGate = readJson(path.join(runDir, "qa", "final-delivery-gate-report.json"));
  if (finalGate.status !== "fail") throw new Error("final delivery should fail unresolved scaffold.");
});

record("qa loop retry budget guard smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-qa-loop-budget-"), "run");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "女包",
  ]);
  const reportPath = path.join(qaDir, "marketing-quality-gate-report.json");
  const writeFailingReport = (attemptLabel) => {
    fs.writeFileSync(reportPath, JSON.stringify({
      status: "fail",
      checked_at: new Date().toISOString(),
      attempt_label: attemptLabel,
      findings: [{
        severity: "fail",
        type: "source-cutout-used-as-scene",
        image_index: 2,
        message: `Scene role used the source cutout instead of a real generated/photo scene asset (${attemptLabel}).`,
      }],
    }, null, 2));
  };
  writeFailingReport("initial-anchor-qa");
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  let decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.status !== "regenerate_failed_assets_only") {
    throw new Error(`first QA route should allow failed-asset regeneration, got ${decision.loop_decision.status}`);
  }
  if (decision.loop_decision.retry_attempts_used !== 1) throw new Error("first QA route should record retry attempt 1.");
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.retry_attempts_used !== 1) throw new Error("rerunning router with unchanged gate evidence must not consume retry budget.");
  if (decision.loop_guard.status !== "same_evidence_not_counted") throw new Error("unchanged gate evidence should be marked same_evidence_not_counted.");

  writeFailingReport("failed-retry-1");
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.retry_attempts_used !== 2) throw new Error("changed gate evidence should record retry attempt 2.");

  writeFailingReport("failed-retry-2");
  const exhausted = spawnSync(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir], { cwd: skillRoot });
  if (exhausted.status === 0) throw new Error("third changed failing QA evidence should exhaust retry budget and exit non-zero.");
  decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.status !== "blocked_retry_budget_exhausted") {
    throw new Error(`expected blocked_retry_budget_exhausted, got ${decision.loop_decision.status}`);
  }
  if (!decision.loop_decision.user_input_required) throw new Error("retry budget exhaustion should require user input or direction change.");
  const state = readJson(path.join(qaDir, "qa-loop-state.json"));
  const entries = Object.values(state.signatures || {});
  if (!entries.some((item) => item.status === "exhausted" && item.attempt_count === 3 && item.max_attempts === 2 && item.evidence_fingerprints?.length === 3)) {
    throw new Error("qa-loop-state should persist exhausted attempt count from changed gate evidence only.");
  }
});

record("qa loop ignores final gate self-loop smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-qa-loop-final-"), "run");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Amazon",
    "--category", "cable clip",
  ]);
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({
    status: "fail",
    findings: [{
      severity: "fail",
      type: "internal-copy",
      image_index: 1,
      message: "Final image copy contains internal QA wording.",
    }],
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "final-delivery-gate-report.json"), JSON.stringify({
    status: "fail",
    findings: [{
      severity: "critical",
      type: "qa-loop-not-closed",
      message: "QA loop decision is not closed.",
    }],
  }, null, 2));
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  const decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.reports_seen.includes("final-delivery-gate-report.json")) {
    throw new Error("qa-loop-router should not treat final-delivery-gate-report.json as a root-cause report.");
  }
  if (decision.loop_decision.primary_failure_type !== "internal-copy") {
    throw new Error(`expected upstream internal-copy root cause, got ${decision.loop_decision.primary_failure_type}`);
  }
  if (decision.loop_decision.return_node === "qa-loop-router") {
    throw new Error("qa-loop-router should not route final delivery symptoms back to itself when upstream evidence exists.");
  }
});

record("qa loop warnings do not trigger retry loop smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-qa-loop-warnings-"), "run");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Ozon",
    "--category", "garden trimmer",
  ]);
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({
    status: "pass_with_warnings",
    findings: [{
      severity: "warn",
      type: "textless-panel-with-structured-copy-strategy",
      image_index: 1,
      message: "Textless main image has structured strategy notes for audit traceability.",
    }],
  }, null, 2));
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  const decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.status !== "continue") {
    throw new Error(`warning-only QA route should continue, got ${decision.loop_decision.status}`);
  }
  if (decision.loop_decision.warning_count !== 1 || !decision.loop_decision.warnings_require_human_review) {
    throw new Error("warning-only QA route should keep warning count and human review hint.");
  }
  const state = readJson(path.join(qaDir, "qa-loop-state.json"));
  if (state.last_decision?.status !== "continue") {
    throw new Error("warning-only QA route should not consume retry budget.");
  }
});

record("export gate pass and draft fail", () => {
  const runDir = path.join(tmpDir("sp-verify-export-"), "run");
  const dir = path.join(runDir, "final-images");
  fs.mkdirSync(dir, { recursive: true });
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "女包",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-strap.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, dir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", dir,
    "--out-dir", path.join(dir, "qa-pass"),
    "--expected-count", "2",
    "--require-square",
  ]);
  fs.renameSync(path.join(dir, "IMG-02-detail-strap.png"), path.join(dir, "IMG-02-layout-draft.png"));
  spawnSync(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", dir,
    "--out-dir", path.join(dir, "qa-fail"),
    "--expected-count", "2",
    "--require-square",
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa-fail", "image-set-export-gate-report.json"));
  if (report.status !== "fail") throw new Error("export gate should reject draft final image.");

  const singleRunDir = path.join(tmpDir("sp-verify-single-export-"), "run");
  const singleDir = path.join(singleRunDir, "final-images");
  const singleQaDir = path.join(singleRunDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", singleRunDir,
    "--platform", "Amazon",
    "--category", "hero image",
    "--run-id", "verify-single-image",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, singleDir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", singleRunDir,
    "--image-dir", singleDir,
    "--out-dir", singleQaDir,
    "--expected-count", "1",
    "--require-square",
  ]);
  const singleExport = readJson(path.join(singleQaDir, "image-set-export-gate-report.json"));
  if (singleExport.status !== "pass" || singleExport.exported_count !== 1) {
    throw new Error("export gate should allow intentional single-image delivery with --expected-count 1.");
  }
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", singleRunDir,
    "--image-dir", singleDir,
    "--out-dir", path.join(singleRunDir, "qa-single-unspecified"),
    "--require-square",
  ]);
  const singleUnspecified = readJson(path.join(singleRunDir, "qa-single-unspecified", "image-set-export-gate-report.json"));
  if (singleUnspecified.status !== "pass") {
    throw new Error("export gate should allow single-image delivery when no multi-image expected count is specified.");
  }
});

record("ozon export ratio gate smoke", () => {
  const root = tmpDir("sp-verify-ozon-ratio-");
  const runDir = path.join(root, "run");
  const imageDir = path.join(runDir, "final-images");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Ozon",
    "--category", "women bag",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:900,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:900,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-material.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", path.join(runDir, "qa-ozon-pass"),
    "--expected-count", "2",
    "--require-square",
  ]);
  const pass = readJson(path.join(runDir, "qa-ozon-pass", "image-set-export-gate-report.json"));
  if (pass.required_ratio !== "3:4" || pass.require_square !== false) {
    throw new Error("Ozon export gate should infer 3:4 from platform profile and disable generic square fallback.");
  }

  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await sharp({create:{width:1200,height:1200,channels:4,background:'#ddd'}}).png().toFile(dir + '/IMG-02-detail-material.png'); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  spawnSync(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", path.join(runDir, "qa-ozon-fail"),
    "--expected-count", "2",
  ], { cwd: skillRoot });
  const fail = readJson(path.join(runDir, "qa-ozon-fail", "image-set-export-gate-report.json"));
  if (fail.status !== "fail" || !fail.findings.some((item) => item.type === "wrong-required-aspect-ratio")) {
    throw new Error("Ozon export gate should fail non-3:4 images for normal categories.");
  }

  const freshRun = path.join(root, "fresh-run");
  const freshDir = path.join(freshRun, "final-images");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", freshRun,
    "--platform", "Ozon",
    "--category", "Ozon Fresh food",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-pack.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, freshDir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", freshRun,
    "--image-dir", freshDir,
    "--out-dir", path.join(freshRun, "qa-fresh-pass"),
    "--expected-count", "2",
  ]);
  const fresh = readJson(path.join(freshRun, "qa-fresh-pass", "image-set-export-gate-report.json"));
  if (fresh.required_ratio !== "1:1") throw new Error("Ozon Fresh exception should infer 1:1.");
});

record("delivery overview and final gate smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-overview-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Amazon",
    "--category", "cable clip",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-structure.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(qaDir, "marketing-quality-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "product-background-card-consistency-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
  ]);
  run(process.execPath, [
    "scripts/reconcile-generation-progress.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
  ]);
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const missingOverview = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!missingOverview.findings.some((item) => item.type === "missing-delivery-overview")) {
    throw new Error("final gate should require delivery overview for multi-image sets.");
  }
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
    "--out-dir", path.join(runDir, "overview"),
    "--title", "Verify Overview",
  ]);
  run(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir]);
  const finalGate = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (finalGate.status !== "pass") throw new Error("final gate should pass when overview and gates are present.");

  const singleRunDir = path.join(tmpDir("sp-verify-single-final-"), "run");
  const singleImageDir = path.join(singleRunDir, "final-images");
  const singleQaDir = path.join(singleRunDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", singleRunDir,
    "--platform", "Amazon",
    "--category", "single hero image",
    "--run-id", "verify-single-final",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, singleImageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(singleQaDir, "marketing-quality-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(singleQaDir, "copy-strategy-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(singleQaDir, "product-background-card-consistency-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", singleRunDir,
    "--image-dir", singleImageDir,
    "--out-dir", singleQaDir,
    "--expected-count", "1",
    "--require-square",
  ]);
  run(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", singleRunDir]);
  const singleFinalGate = readJson(path.join(singleQaDir, "final-delivery-gate-report.json"));
  if (singleFinalGate.status !== "pass") {
    throw new Error("final gate should pass intentional single-image delivery without a delivery overview.");
  }
  if (singleFinalGate.findings.some((item) => item.type === "missing-delivery-overview")) {
    throw new Error("final gate should not require delivery overview for intentional single-image delivery.");
  }
});

record("final delivery gate requires localized copy qa for non english locales", () => {
  const runDir = path.join(tmpDir("sp-verify-localized-final-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Amazon",
    "--category", "cable clip",
  ]);
  fs.writeFileSync(path.join(runDir, "00-task-context.yaml"), [
    "created_at: \"2026-07-08T00:00:00.000Z\"",
    "run_id: \"verify-localized-final\"",
    "platform: \"Amazon\"",
    "category: \"cable clip\"",
    "product_name: \"测试包\"",
    "source_images: []",
    "target_image_count: 2",
    "locale: \"ru-RU\"",
    "audience: \"\"",
    "season_or_occasion: \"\"",
    "commercial_goal: \"\"",
    "notes: []",
    "",
  ].join("\n"));
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-structure.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(qaDir, "marketing-quality-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
  ]);
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!report.findings.some((item) => item.source_report === "localized-copy-qa-report.json")) {
    throw new Error("final gate should require localized copy QA for ru-RU delivery.");
  }
});

record("final delivery gate blocks stale progress and missing anchor decision", () => {
  const runDir = path.join(tmpDir("sp-verify-final-progress-anchor-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Ozon",
    "--category", "garden trimmer",
    "--run-id", "verify-progress-anchor",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([1,2,3,4].map((i) =>
      sharp({create:{width:900,height:1200,channels:4,background:i % 2 ? '#fff' : '#eee'}}).png().toFile(dir + '/IMG-0' + i + '-ozon-test-' + i + '.png')
    )); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(qaDir, "marketing-quality-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "4",
  ]);
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
    "--out-dir", path.join(runDir, "overview"),
  ]);
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!report.findings.some((item) => item.type === "stale-generation-progress")) {
    throw new Error("final gate should block stale not_started/planned generation progress when final images exist.");
  }
  if (!report.findings.some((item) => item.type === "missing-anchor-batch-qa-decision")) {
    throw new Error("final gate should block multi-image quality delivery without anchor batch QA decision.");
  }
  const manifest = readJson(path.join(runDir, "export", "final-images-manifest.json"));
  fs.writeFileSync(path.join(runDir, "generated-assets", "generation-progress.json"), JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "completed",
    expected_count: manifest.image_count,
    completed_images: manifest.images.map((image) => ({
      id: image.id,
      path: image.path,
      status: "approved_final",
    })),
    anchor_batch: {
      qa_decision: "pass",
      images: ["IMG-01", "IMG-02"],
    },
    updated_at: new Date().toISOString(),
  }, null, 2));
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const acceptedAnchor = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (acceptedAnchor.findings.some((item) => item.type === "missing-anchor-batch-qa-decision")) {
    throw new Error("final gate should accept anchor batch QA decision recorded inside generation-progress.json.");
  }
});

record("runtime watchdog classifies long-running stalls", () => {
  const now = "2026-07-09T10:00:00.000Z";

  const readyRun = path.join(tmpDir("sp-verify-watchdog-ready-"), "run");
  fs.mkdirSync(path.join(readyRun, "export"), { recursive: true });
  fs.mkdirSync(path.join(readyRun, "generated-assets"), { recursive: true });
  fs.writeFileSync(path.join(readyRun, "export", "final-images-manifest.json"), JSON.stringify({
    schema_version: "sellerpilot.final_images_manifest.v1",
    image_count: 2,
    images: [
      { id: "IMG-01", file: "IMG-01-main-product.png", path: path.join(readyRun, "final-images", "IMG-01-main-product.png") },
      { id: "IMG-02", file: "IMG-02-detail-view.png", path: path.join(readyRun, "final-images", "IMG-02-detail-view.png") },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(readyRun, "generated-assets", "generation-progress.json"), JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "completed",
    created_at: "2026-07-09T09:50:00.000Z",
    updated_at: "2026-07-09T09:59:00.000Z",
    image_count: 2,
    completed_images: ["IMG-01-main-product.png", "IMG-02-detail-view.png"],
    pending_images: [],
    failed_images: [],
  }, null, 2));
  const ready = spawnSync(process.execPath, [
    "scripts/runtime-watchdog.mjs",
    "--run-dir", readyRun,
    "--now", now,
  ], { cwd: skillRoot, encoding: "utf8" });
  if (ready.status === 0) throw new Error("ready-but-not-closed watchdog should exit non-zero to force handoff closure.");
  const readyReport = readJson(path.join(readyRun, "qa", "runtime-watchdog-report.json"));
  if (readyReport.classification !== "ready_but_not_closed" || !readyReport.decision.stop_automatic_regeneration) {
    throw new Error("watchdog should classify manifest-without-final-handoff as ready_but_not_closed.");
  }

  const churnRun = path.join(tmpDir("sp-verify-watchdog-churn-"), "run");
  fs.mkdirSync(path.join(churnRun, "qa"), { recursive: true });
  fs.writeFileSync(path.join(churnRun, "qa", "qa-loop-state.json"), JSON.stringify({
    schema_version: "sellerpilot.qa_loop_state.v1",
    signatures: {
      scene: { attempts: 3, retry_budget: 2 },
    },
  }, null, 2));
  const churn = spawnSync(process.execPath, [
    "scripts/runtime-watchdog.mjs",
    "--run-dir", churnRun,
    "--now", now,
  ], { cwd: skillRoot, encoding: "utf8" });
  if (churn.status === 0) throw new Error("gate churn watchdog should exit non-zero.");
  const churnReport = readJson(path.join(churnRun, "qa", "runtime-watchdog-report.json"));
  if (churnReport.classification !== "gate_churn_detected" || churnReport.status !== "blocked") {
    throw new Error("watchdog should classify exhausted QA state as gate_churn_detected.");
  }

  const stalledRun = path.join(tmpDir("sp-verify-watchdog-stall-"), "run");
  fs.mkdirSync(path.join(stalledRun, "generated-assets"), { recursive: true });
  fs.writeFileSync(path.join(stalledRun, "generated-assets", "generation-progress.json"), JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "generating",
    created_at: "2026-07-09T09:00:00.000Z",
    updated_at: "2026-07-09T09:00:00.000Z",
    image_count: 8,
    completed_images: ["IMG-01-main-product.png"],
    pending_images: ["IMG-02-scene.png", "IMG-03-detail.png"],
    failed_images: [],
  }, null, 2));
  setRecursiveMtime(stalledRun, new Date("2026-07-09T09:00:00.000Z"));
  const stalled = spawnSync(process.execPath, [
    "scripts/runtime-watchdog.mjs",
    "--run-dir", stalledRun,
    "--now", now,
    "--warn-after-seconds", "900",
    "--block-after-seconds", "1800",
    "--stale-after-seconds", "900",
  ], { cwd: skillRoot, encoding: "utf8" });
  if (stalled.status === 0) throw new Error("stalled watchdog should exit non-zero.");
  const stalledReport = readJson(path.join(stalledRun, "qa", "runtime-watchdog-report.json"));
  if (stalledReport.classification !== "blocked_stalled_no_progress" || !stalledReport.decision.user_update_required) {
    throw new Error("watchdog should block stale long-running production without recent activity.");
  }
});

record("cross-run image scope isolation smoke", () => {
  const root = tmpDir("sp-verify-cross-run-");
  const shared = path.join(root, "outputs");
  fs.mkdirSync(shared, { recursive: true });
  const runA = path.join(root, "runs", "task-a");
  const runB = path.join(root, "runs", "task-b");
  run(process.execPath, ["scripts/create-run-skeleton.mjs", "--out-dir", runA, "--platform", "Amazon", "--category", "clip", "--run-id", "task-a"]);
  run(process.execPath, ["scripts/create-run-skeleton.mjs", "--out-dir", runB, "--platform", "Amazon", "--category", "shirt", "--run-id", "task-b"]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [shared, runA, runB] = process.argv.slice(1);
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(runA + '/final-images/IMG-01-main-clip.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(runA + '/final-images/IMG-02-detail-clip.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#ddd'}}).png().toFile(runB + '/final-images/IMG-01-main-shirt.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#111'}}).png().toFile(shared + '/IMG-01-main-clip.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#777'}}).png().toFile(shared + '/IMG-02-main-shirt.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#333'}}).png().toFile(shared + '/IMG-03-main-sleeve.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, shared, runA, runB], { cwd: skillRoot, stdio: "inherit" });
  const blocked = spawnSync(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runA,
    "--image-dir", shared,
    "--out-dir", path.join(runA, "overview-blocked"),
  ], { cwd: skillRoot, encoding: "utf8" });
  if (blocked.status === 0) throw new Error("delivery overview should reject shared cross-run outputs directory.");
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runA,
    "--image-dir", path.join(runA, "final-images"),
    "--out-dir", path.join(runA, "qa"),
    "--expected-count", "2",
    "--require-square",
  ]);
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runA,
    "--manifest", path.join(runA, "export", "final-images-manifest.json"),
    "--out-dir", path.join(runA, "overview"),
  ]);
  const overview = readJson(path.join(runA, "overview", "delivery-overview-report.json"));
  if (overview.image_count !== 2) throw new Error("manifest-scoped overview should include only task-a images.");
  if (overview.source_images.some((file) => /shirt|sleeve/i.test(file))) {
    throw new Error("manifest-scoped overview leaked another task image.");
  }
});

record("tldraw session collision isolation smoke", () => {
  const root = tmpDir("sp-verify-session-isolation-");
  const sharedRoot = path.join(root, "shared-canvas-service");
  const runA = path.join(root, "runs", "task-a");
  const runB = path.join(root, "runs", "task-b");
  run(process.execPath, ["scripts/create-run-skeleton.mjs", "--out-dir", runA, "--platform", "Amazon", "--category", "clip", "--run-id", "task-a"]);
  run(process.execPath, ["scripts/create-run-skeleton.mjs", "--out-dir", runB, "--platform", "Amazon", "--category", "shirt", "--run-id", "task-b"]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [runA, runB] = process.argv.slice(1);
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(runA + '/final-images/IMG-01-main-clip.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#f4f4f4'}}).png().toFile(runA + '/final-images/IMG-02-detail-clip.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(runB + '/final-images/IMG-01-main-shirt.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#dedede'}}).png().toFile(runB + '/final-images/IMG-02-detail-shirt.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, runA, runB], { cwd: skillRoot, stdio: "inherit" });
  for (const runDir of [runA, runB]) {
    run(process.execPath, [
      "scripts/image-set-export-gate.mjs",
      "--run-dir", runDir,
      "--image-dir", path.join(runDir, "final-images"),
      "--out-dir", path.join(runDir, "qa"),
      "--allow-drafts",
    ]);
    run(process.execPath, [
      "scripts/create-tldraw-review-workspace.mjs",
      "--out-dir", path.join(runDir, "review-workspace"),
      "--run-dir", runDir,
      "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
      "--session-id", "same-session",
      "--no-auto-start",
    ]);
  }
  run(process.execPath, [
    "scripts/register-tldraw-review-session.mjs",
    "--workspace-dir", path.join(runA, "review-workspace"),
    "--session-id", "same-session",
    "--shared-root", sharedRoot,
  ]);
  const second = spawnSync(process.execPath, [
    "scripts/register-tldraw-review-session.mjs",
    "--workspace-dir", path.join(runB, "review-workspace"),
    "--session-id", "same-session",
    "--shared-root", sharedRoot,
  ], { cwd: skillRoot, encoding: "utf8" });
  if (second.status === 0) throw new Error("register should reject reusing a session id across different runs.");
  if (!/already registered/.test(`${second.stderr}\n${second.stdout}`)) {
    throw new Error("session collision rejection should explain the existing registration.");
  }
});

record("marketing gate watermark fail", () => {
  const dir = tmpDir("sp-verify-marketing-");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    { id: "IMG-01", title: "拼多多女包套图", subtitle: "仅供参考", shot: "front" },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/marketing-gate-check.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "marketing-quality-gate-report.json"));
  if (report.status !== "fail") throw new Error("marketing gate should reject platform-pack labels.");
});

record("source asset normalization and product background gate smoke", () => {
  const dir = tmpDir("sp-verify-source-asset-normalization-");
  const source = path.join(dir, "source-gray-bg.png");
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const out = process.argv[1];
    (async () => {
      const product = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420"><rect width="420" height="420" fill="#eeeeee"/><rect x="140" y="95" width="145" height="245" rx="24" fill="#1687d9"/><circle cx="212" cy="210" r="34" fill="#e33"/></svg>');
      await sharp(product).png().toFile(out);
    })().catch((e)=>{ console.error(e); process.exit(1); });
  `, source], { cwd: skillRoot, stdio: "inherit" });
  const normalizedDir = path.join(dir, "source-normalized");
  run(process.execPath, [
    "scripts/normalize-source-product-asset.mjs",
    "--input", source,
    "--out-dir", normalizedDir,
    "--card-color", "#ffffff",
  ]);
  const normalization = readJson(path.join(normalizedDir, "product-normalization-report.json"));
  if (!fs.existsSync(normalization.outputs.product_cutout_transparent)) {
    throw new Error("source asset normalization should create product-cutout-transparent.png.");
  }
  if (!fs.existsSync(normalization.outputs.product_on_card_safe)) {
    throw new Error("source asset normalization should create product-on-card-safe.png.");
  }
  if (!(normalization.normalization.background_coverage > 0.3)) {
    throw new Error("source asset normalization should remove the edge-connected gray background.");
  }

  const failingPanels = path.join(dir, "panels-fail.json");
  fs.writeFileSync(failingPanels, JSON.stringify([
    {
      id: "IMG-02",
      image_role: "parameter card",
      layout_intent: "white card infographic",
      card_background_color: "#ffffff",
      product_asset_path: source,
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/product-background-card-consistency-gate.mjs",
    "--copy-json", failingPanels,
    "--out-dir", path.join(dir, "qa-fail"),
  ], { cwd: skillRoot });
  const fail = readJson(path.join(dir, "qa-fail", "product-background-card-consistency-gate-report.json"));
  if (fail.status !== "fail" || !fail.findings.some((item) => item.type === "product-background-card-mismatch")) {
    throw new Error("product background gate should fail a gray no-alpha product asset placed on a white card.");
  }

  const passingPanels = path.join(dir, "panels-pass.json");
  fs.writeFileSync(passingPanels, JSON.stringify([
    {
      id: "IMG-02",
      image_role: "parameter card",
      layout_intent: "white card infographic",
      card_background_color: "#ffffff",
      product_normalization_report: path.join(normalizedDir, "product-normalization-report.json"),
    },
  ], null, 2));
  run(process.execPath, [
    "scripts/product-background-card-consistency-gate.mjs",
    "--copy-json", passingPanels,
    "--out-dir", path.join(dir, "qa-pass"),
  ]);
  const pass = readJson(path.join(dir, "qa-pass", "product-background-card-consistency-gate-report.json"));
  if (pass.status === "fail") throw new Error("product background gate should pass with a normalization report and transparent cutout.");
});

record("marketing gate catches blank module and source-language residue flags", () => {
  const dir = tmpDir("sp-verify-marketing-final-visual-flags-");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-02",
      title: "Clear buyer-facing title",
      image_role: "use case comparison",
      commercial_task: "Show the two blade use cases without unsupported claims.",
      camera_angle: "front three-quarter",
      image: path.join(dir, "IMG-02.png"),
      background_or_scene: "clean marketplace studio with small garden prop surface",
      props_or_model_context: "subtle garden-use props with product scale kept consistent",
      lighting: "clean marketplace studio, 70mm lens, softbox light, product centered for mobile commerce detail clarity, audience fit: fast product inspection",
      photography_style_archetype: "clean marketplace studio, 70mm lens, softbox light, product centered for mobile commerce detail clarity, audience fit: fast product inspection",
      product_placement: "product remains the main subject with blades shown as verified accessories only",
      visual_composition: "role-specific comparison layout with no empty cards",
      graphic_design_intent: "Role-specific two-use comparison layout",
      design_quality_bar: "Clear hierarchy, safe spacing, mobile thumbnail readable, role-specific variation recorded.",
      typography_hierarchy: "Title/subtitle scale is reserved and does not cover the product.",
      safe_zone_notes: "Keep product and text inside platform-safe center region.",
      mobile_thumbnail_rule: "Recognizable product shape at mobile thumbnail size.",
      visual_difference_from_previous: "Distinct commercial task and layout from hero image.",
      blank_region_risk: "detected large blank top module",
      source_language_residue_risk: "detected Chinese source poster residue",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/marketing-gate-check.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "marketing-quality-gate-report.json"));
  if (!report.findings.some((item) => item.type === "blank-or-empty-final-module")) {
    throw new Error("marketing gate should catch blank/empty final modules from structured final review flags.");
  }
  if (!report.findings.some((item) => item.type === "source-or-non-target-language-residue")) {
    throw new Error("marketing gate should catch source/non-target language residue from structured final review flags.");
  }
});

record("marketing gate blocks fake vector use scenes", () => {
  const dir = tmpDir("sp-verify-marketing-fake-scene-");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-05",
      title: "Ровная форма кустов",
      sub: "Для легкой сезонной подрезки",
      image_role: "garden shrub trimming use case",
      buyer_question: "Can this tool help with light shrub trimming?",
      commercial_task: "Show the tool in a garden use scene.",
      camera_angle: "front three-quarter product card",
      image: path.join(dir, "product-card.png"),
      render_mode: "pillow deterministic composite",
      final_asset_type: "renderer_only_product_card",
      background_or_scene: "flat vector shrub background with repeating decorative circles",
      visual_composition: "white product card pasted over flat vector illustration background",
      props_or_model_context: "none; decorative vector garden only",
      lighting: "flat vector background with no real product-scene light interaction",
      photography_style_archetype: "clean marketplace studio, 70mm lens, softbox light, product centered for mobile commerce detail clarity, audience fit: fast product inspection",
      product_placement: "product pasted on a tilted white card over vector shrubs",
      graphic_design_intent: "Role-specific garden use layout",
      design_quality_bar: "Hierarchy and safe zones recorded.",
      typography_hierarchy: "Readable title and footer.",
      safe_zone_notes: "Keep text inside safe area.",
      mobile_thumbnail_rule: "Product visible at thumbnail size.",
      visual_difference_from_previous: "Different title and garden-use task.",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/marketing-gate-check.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "marketing-quality-gate-report.json"));
  if (!report.findings.some((item) => item.type === "fake-vector-scene")) {
    throw new Error("marketing gate should block fake vector/product-card use scenes.");
  }
  if (!report.findings.some((item) => item.type === "missing-scene-realism-review")) {
    throw new Error("marketing gate should require true scene proof or final scene realism review for use scenes.");
  }
});

record("text layout proof gate blocks long unproofed localized copy", () => {
  const dir = tmpDir("sp-verify-text-layout-proof-");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-05",
      title: "Ровная форма кустов",
      sub: "Для легкой сезонной подрезки",
      footer_label: "Длинное лезвие для ухода за небольшими кустами",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/text-layout-proof-gate.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa-fail"),
  ], { cwd: skillRoot });
  const fail = readJson(path.join(dir, "qa-fail", "text-layout-proof-gate-report.json"));
  if (fail.status !== "fail" || !fail.findings.some((item) => item.type === "missing-text-layout-proof")) {
    throw new Error("text layout proof gate should fail long visible copy without proof.");
  }

  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-05",
      title: "Ровная форма кустов",
      sub: "Для легкой сезонной подрезки",
      footer_label: "Длинное лезвие для ухода за небольшими кустами",
      text_layout_proof: { status: "pass", method: "low-cost layout screenshot reviewed" },
      text_layout_boxes: {
        footer: { width: 1080, height: 180, font_size: 30, max_lines: 3 },
      },
    },
  ], null, 2));
  run(process.execPath, [
    "scripts/text-layout-proof-gate.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa-pass"),
  ]);
  const pass = readJson(path.join(dir, "qa-pass", "text-layout-proof-gate-report.json"));
  if (pass.status === "fail") throw new Error("text layout proof gate should pass long copy with proof and sufficient text box.");
});

record("copy strategy gate smoke", () => {
  const dir = tmpDir("sp-verify-copy-");
  const contextPath = path.join(dir, "platform-context-plan.json");
  fs.writeFileSync(contextPath, JSON.stringify({
    platform_category_profile_overlay: {
      web_research_required: true,
      dynamic_context: { season: "summer", climate: "hot-humid", region: "华南" },
    },
  }, null, 2));
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-01",
      title: "全网最低 爆卖球衣",
      buyer_question: "为什么现在买",
      conversion_intent: "click",
      copy_strategy: "使用热词但没有证据",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/copy-strategy-gate.mjs",
    "--copy-json", panelsPath,
    "--platform-context", contextPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "copy-strategy-gate-report.json"));
  if (report.status !== "fail") throw new Error("copy strategy gate should reject unsupported/unresearched copy.");
});

record("copy strategy gate allows structured textless panels", () => {
  const dir = tmpDir("sp-verify-copy-textless-");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-02",
      image_role: "warm tabletop visual",
      visible_text_policy: "no visible text",
      textless_ok: true,
      buyer_question: "Can this small bag feel suitable for a wedding or evening dinner?",
      commercial_task: "Show occasion fit through styling instead of overlay copy.",
      buyer_benefit: "A compact portable bag keeps small daily items organized without visual clutter.",
      usage_context: "wedding, evening dinner, date night",
      copy_strategy: "Use a textless visual so the product and setting carry the buyer benefit.",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/copy-strategy-gate.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "copy-strategy-gate-report.json"));
  if (report.status === "fail") throw new Error("copy strategy gate should not fail structured textless panels.");
  if (report.findings.some((item) => item.type === "missing-buyer-facing-copy")) {
    throw new Error("structured textless panels should not be reported as missing buyer-facing copy.");
  }
});

record("localized copy qa gate smoke", () => {
  const dir = tmpDir("sp-verify-localized-copy-");
  const qaDir = path.join(dir, "qa");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-03",
      title: "Короткий текст для товара",
      buyer_question: "Почему этот товар подходит для повседневного использования?",
      conversion_intent: "buy",
      copy_strategy: "Localized buyer-facing copy with review notes and a traced source line.",
      source_text: "原文：适合日常通勤，轻便好拿。",
      translation_review_notes: "Meaning, tone, and market fit checked for ru-RU.",
      back_translation: "Suitable for daily commuting; light and easy to carry.",
      translation_confidence: 0.93,
      market_keyword_basis: "ru-RU localized commerce phrasing reviewed against source meaning.",
      text_direction: "ltr",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/localized-copy-qa-gate.mjs",
    "--copy-json", panelsPath,
    "--locale", "ru-RU",
    "--source-locale", "zh-CN",
    "--out-dir", qaDir,
  ], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "localized-copy-qa-report.json"));
  if (report.status !== "pass") throw new Error("localized copy QA gate should pass with traced source, review notes, and back-translation.");
  if (report.review_required !== true) throw new Error("localized copy QA should require review for ru-RU.");
});

record("localized copy qa catches final raster source-language residue", () => {
  const dir = tmpDir("sp-verify-localized-raster-");
  const runDir = path.join(dir, "run");
  const qaDir = path.join(runDir, "qa");
  const panelsPath = path.join(runDir, "blueprint", "panels.json");
  const manifestPath = path.join(runDir, "export", "final-images-manifest.json");
  fs.mkdirSync(path.dirname(panelsPath), { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-04",
      title: "Для сада",
      source_text: "原文：适合花园修剪。",
      translation_review_notes: "Meaning checked for ru-RU.",
      back_translation: "Suitable for garden trimming.",
      translation_confidence: 0.94,
      text_direction: "ltr",
    },
  ], null, 2));
  fs.writeFileSync(manifestPath, JSON.stringify({
    images: [{ index: 1, file: "IMG-04-garden-use-case.png", path: path.join(runDir, "final-images", "IMG-04-garden-use-case.png") }],
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "final-visible-text-review.json"), JSON.stringify({
    images: [{
      image_index: 1,
      file: "IMG-04-garden-use-case.png",
      visible_text: "中文海报残留",
      languages: ["zh-CN"],
      source_language_residue: true,
    }],
  }, null, 2));
  spawnSync(process.execPath, [
    "scripts/localized-copy-qa-gate.mjs",
    "--copy-json", panelsPath,
    "--locale", "ru-RU",
    "--source-locale", "zh-CN",
    "--run-dir", runDir,
    "--manifest", manifestPath,
    "--final-visible-text-review", path.join(qaDir, "final-visible-text-review.json"),
    "--out-dir", qaDir,
  ], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "localized-copy-qa-report.json"));
  if (report.status !== "fail") throw new Error("localized copy QA should fail source-language residue in final raster review.");
  if (!report.findings.some((item) => item.type === "final-image-source-language-residue")) {
    throw new Error("localized copy QA should report final-image-source-language-residue.");
  }
});

record("localized copy qa gate catches rtl direction issues", () => {
  const dir = tmpDir("sp-verify-localized-copy-rtl-");
  const qaDir = path.join(dir, "qa");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-04",
      title: "نص عربي",
      source_text: "原文：适合礼物场景，强调轻便。",
      translation_review_notes: "Checked for Arabic market fit and meaning preservation.",
      back_translation: "Suitable for gifting scenes, emphasizing portability.",
      translation_confidence: 0.9,
      text_direction: "ltr",
      localized_copy: "صالح للهدايا والاستخدام اليومي",
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/localized-copy-qa-gate.mjs",
    "--copy-json", panelsPath,
    "--locale", "ar-SA",
    "--source-locale", "zh-CN",
    "--out-dir", qaDir,
  ], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "localized-copy-qa-report.json"));
  if (report.status === "pass") throw new Error("localized copy QA gate should catch rtl direction mismatch.");
  if (!report.findings.some((item) => item.type === "missing-rtl-layout-direction" || item.type === "wrong-text-direction")) {
    throw new Error("localized copy QA gate should report rtl direction issues.");
  }
});

record("identity geometry gate smoke", () => {
  const dir = tmpDir("sp-verify-geometry-");
  const sourcePath = path.join(dir, "source-geometry.json");
  const generatedPath = path.join(dir, "generated-geometry.json");
  fs.writeFileSync(sourcePath, JSON.stringify({
    geometry_lock: {
      product_type: "sports jersey",
      garment_length_class: "normal jersey length",
      hem_position: "below waist / upper hip",
      collar_to_hem_ratio: 1.0,
      shoulder_width_to_body_length_ratio: 0.72,
      sleeve_length_class: "short sleeve",
      forbidden_geometry_changes: ["shortening a normal jersey/shirt into a crop top"],
    },
  }, null, 2));
  fs.writeFileSync(generatedPath, JSON.stringify({
    images: [{
      index: 1,
      geometry: {
        garment_length_class: "cropped",
        hem_position: "above waist",
        collar_to_hem_ratio: 0.68,
        shoulder_width_to_body_length_ratio: 0.96,
        sleeve_length_class: "short sleeve",
        detected_changes: "crop top",
      },
    }],
  }, null, 2));
  spawnSync(process.execPath, [
    "scripts/identity-geometry-gate.mjs",
    "--source-geometry", sourcePath,
    "--generated-geometry", generatedPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "identity-geometry-gate-report.json"));
  if (report.status !== "fail") throw new Error("identity geometry gate should reject shortened jersey.");
  if (!report.findings.some((item) => item.type === "apparel-length-shortened")) {
    throw new Error("identity geometry gate should report apparel-length-shortened.");
  }
});

record("identity geometry gate ignores non-apparel crop wording", () => {
  const dir = tmpDir("sp-verify-geometry-nonapparel-");
  const sourcePath = path.join(dir, "source-geometry.json");
  const generatedPath = path.join(dir, "generated-geometry.json");
  fs.writeFileSync(sourcePath, JSON.stringify({
    geometry_lock: {
      product_type: "cosmetic vanity bag",
      product_length_class: "compact vanity bag",
      product_height_to_width_ratio: 0.72,
    },
  }, null, 2));
  fs.writeFileSync(generatedPath, JSON.stringify({
    images: [{
      index: 1,
      geometry: {
        product_type: "cosmetic vanity bag",
        product_length_class: "compact vanity bag",
        product_height_to_width_ratio: 0.73,
        visual_description: "cropped cover image composition with short handles visible on top",
        detected_changes: "crop adjusted for square frame; short handles preserved",
      },
    }],
  }, null, 2));
  spawnSync(process.execPath, [
    "scripts/identity-geometry-gate.mjs",
    "--source-geometry", sourcePath,
    "--generated-geometry", generatedPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "identity-geometry-gate-report.json"));
  if (report.status === "fail") throw new Error("non-apparel crop/short wording should not fail apparel length checks.");
  if (report.findings.some((item) => item.type === "apparel-length-shortened")) {
    throw new Error("non-apparel crop/short wording should not report apparel-length-shortened.");
  }
});

record("marketing gate allows same angle with environment variation", () => {
  const dir = tmpDir("sp-verify-marketing-angle-");
  const panelsPath = path.join(dir, "panels.json");
  const panels = [
    ["IMG-01", "white seamless paper", "clean marketplace studio, 70mm lens, softbox lighting, product centered for marketplace inspection, audience fit: fast thumbnail recognition", "main product", "Show shape clearly", "centered front 3/4 composition"],
    ["IMG-02", "warm oak tabletop", "soft luxury leather still life, 70mm lens, warm side light, product placed beside small neutral props for daily carry scale, audience fit: gift/date styling", "tabletop occasion", "Show portable evening use", "front 3/4 tabletop composition"],
    ["IMG-03", "soft window shelf", "boutique window natural light, 70mm lens, daylight from left, product placed upright with shadow depth, audience fit: premium texture inspection", "texture mood", "Show material and detail feel", "front 3/4 window-light composition"],
    ["IMG-04", "neutral dressing table", "korean/japanese minimal fashion ecommerce, 70mm lens, soft indoor vanity lighting, product placed with clean outfit-adjacent surface, audience fit: compact organized carry", "organized carry", "Show small-item organization context", "front 3/4 vanity composition"],
  ].map(([id, background, photography, role, task, composition], index) => ({
    id,
    title: `Useful product image ${index + 1}`,
    image_role: role,
    commercial_task: task,
    camera_angle: "front three-quarter",
    image: path.join(dir, `${id}.png`),
    background_or_scene: background,
    props_or_model_context: `${background} prop context`,
    lighting: photography,
    photography_style_archetype: photography,
    product_placement: `${role} placement`,
    visual_composition: composition,
    graphic_design_intent: `Role-specific layout for ${role}`,
    design_quality_bar: "Clear hierarchy, safe spacing, mobile thumbnail readable, role-specific variation recorded.",
    typography_hierarchy: "Title/subtitle scale is reserved and does not cover the product.",
    safe_zone_notes: "Keep product and text inside platform-safe center region.",
    mobile_thumbnail_rule: "Recognizable product shape at mobile thumbnail size.",
    visual_difference_from_previous: `Distinct environment and task: ${task}.`,
  }));
  fs.writeFileSync(panelsPath, JSON.stringify(panels, null, 2));
  spawnSync(process.execPath, [
    "scripts/marketing-gate-check.mjs",
    "--copy-json", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "marketing-quality-gate-report.json"));
  if (report.findings.some((item) => item.type === "repeated-camera-angle" && item.severity === "fail")) {
    throw new Error("same angle with meaningful environment variation should not fail repeated-camera-angle.");
  }
});

record("product physics fact gate smoke", () => {
  const dir = tmpDir("sp-verify-physics-");
  const factPath = path.join(dir, "physical-truth.json");
  const panelsPath = path.join(dir, "panels.json");
  fs.writeFileSync(factPath, JSON.stringify({
    product_physical_truth: {
      status: "locked",
      product_type: "string light cable clip",
      confirmed_functions: ["holds a string light cable against a surface"],
      confirmed_user_actions: ["screw mount to wood", "place cable under clip"],
      allowed_use_contexts: ["outdoor patio string light routing"],
      scale_reference: { product_visual_scale_ratio: 0.42 },
      forbidden_generated_functions: ["press to hold", "magnetic hold", "adhesive mount"],
      unsupported_claims: ["snap lock"],
    },
  }, null, 2));
  fs.writeFileSync(panelsPath, JSON.stringify([
    {
      id: "IMG-02",
      image_role: "lifestyle detail",
      title: "Outdoor string light routing",
      function_claims: ["holds a string light cable against a surface"],
      product_visual_scale_ratio: 0.82,
    },
    {
      id: "IMG-03",
      image_role: "installation steps",
      title: "Simple Screw Installation",
      installation_steps: ["Screw In", "Route Cable", "Press to Hold"],
      product_visual_scale_ratio: 0.42,
    },
    {
      id: "IMG-04",
      image_role: "dimensions",
      title: "Product Dimensions",
      product_visual_scale_ratio: 0.40,
    },
  ], null, 2));
  spawnSync(process.execPath, [
    "scripts/product-physics-fact-gate.mjs",
    "--fact-lock", factPath,
    "--panels", panelsPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "product-physics-fact-gate-report.json"));
  if (report.status !== "fail") throw new Error("product physics gate should fail invented functions and scale drift.");
  if (!report.findings.some((item) => item.type === "invented-product-function" || item.type === "unsupported-physical-action")) {
    throw new Error("product physics gate should catch invented/unsupported function.");
  }
  if (!report.findings.some((item) => item.type === "product-scale-drift")) {
    throw new Error("product physics gate should catch product scale drift.");
  }
});

record("prompt layer physical function smoke", () => {
  const dir = tmpDir("sp-verify-physical-layer-");
  const stackPath = path.join(dir, "stack.json");
  fs.mkdirSync(path.join(dir, "qa"), { recursive: true });
  const layers = {
    execution_contract_layer: { provider: "gpt-built-in-image-generation", output_filename: "IMG-03-installation.png" },
    product_identity_layer: { identity_lock_ref: "blueprint/02-identity-lock.yaml", must_preserve: ["clip shape"] },
    fact_boundary_layer: { supported_claims: ["screw mount"] },
    commerce_goal_layer: { buyer_question: "How do I install it?", image_job: "explain installation" },
    context_layer: { platform: "Amazon", category: "cable clip" },
    creative_concept_layer: { visual_concept: "clear installation infographic" },
    photography_treatment_layer: { camera_angle: "front", lighting_direction: "soft studio" },
    layout_copy_layer: { layout_intent: "three step install panels" },
    negative_qa_layer: { negative_prompt: ["no invented features"], qa_expectations: { physical_truth: "strict" } },
  };
  fs.writeFileSync(stackPath, JSON.stringify({
    prompt_layer_stack: {
      prompt_layer_architect: {
        decision_basis: {
          image_role: "installation step: screw in, route cable, press to hold",
          product_category: "string light cable clip",
        },
      },
      layers,
      conditional_layer_payloads: {
        physical_function_layer: {
          product_physical_truth_ref: "blueprint/02b-product-physical-truth.json",
          confirmed_functions: [],
          confirmed_user_actions: [],
          forbidden_generated_functions: [],
        },
      },
      layer_review: { generic_prompt_risk: "low" },
    },
  }, null, 2));
  spawnSync(process.execPath, [
    "scripts/prompt-layer-gate.mjs",
    "--stack", stackPath,
    "--out-dir", path.join(dir, "qa"),
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa", "prompt-layer-gate-report.json"));
  if (report.status !== "blocked") throw new Error("prompt layer gate should block thin physical function layer.");
  if (!report.findings.some((item) => item.type === "thin-conditional-layer" && item.layer === "physical_function_layer")) {
    throw new Error("prompt layer gate should flag thin physical function layer.");
  }
});

record("scene renderer boundary", () => {
  const dir = tmpDir("sp-verify-render-");
  const source = path.join(dir, "source.png");
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    sharp({create:{width:900,height:700,channels:4,background:'#ded0bf'}}).png().toFile(process.argv[1])
      .catch((e)=>{ console.error(e); process.exit(1); });
  `, source], { cwd: skillRoot, stdio: "inherit" });
  const result = spawnSync(process.execPath, [
    "scripts/render-commerce-image-set.mjs",
    "--source-image", source,
    "--out-dir", path.join(dir, "out"),
    "--product-name", "测试女包",
    "--dimensions", "28 x 8 x 20cm",
    "--platform", "拼多多",
    "--panel-count", "3",
  ], { cwd: skillRoot, encoding: "utf8" });
  if (result.status === 0) throw new Error("renderer should block scene roles without generated/photo scene assets.");
  if (!/Scene roles cannot be rendered/.test(result.stderr)) throw new Error("renderer blocked for an unexpected reason.");
});

record("tldraw workspace smoke", () => {
  const dir = tmpDir("sp-verify-review-");
  const imageDir = path.join(dir, "final-images");
  fs.mkdirSync(imageDir, { recursive: true });
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    sharp({create:{width:800,height:800,channels:4,background:'#e6eef8'}}).png().toFile(process.argv[1])
      .catch((e)=>{ console.error(e); process.exit(1); });
  `, path.join(imageDir, "IMG-01-main-product.png")], { cwd: skillRoot, stdio: "inherit" });
  const outDir = path.join(dir, "review-workspace");
  run(process.execPath, [
    "scripts/create-tldraw-review-workspace.mjs",
    "--out-dir", outDir,
    "--image-dir", imageDir,
    "--run-dir", dir,
    "--title", "测试审核工作台",
    "--session-id", "verify",
    "--no-auto-start",
  ]);
  for (const file of [
    "data/import-manifest.json",
    "data/annotations.json",
    "data/canvas-state.json",
    "data/review-completion.json",
    "data/review-completion-ready.json",
    "data/generation-tasks.json",
    "public/imported-images/IMG-01-main-product.png",
  ]) {
    if (!fs.existsSync(path.join(outDir, file))) throw new Error(`missing review workspace file ${file}`);
  }
  const manifest = readJson(path.join(outDir, "data", "import-manifest.json"));
  if (manifest.protocol?.review_completion_file !== "data/review-completion.json") {
    throw new Error("review workspace manifest should expose review completion file.");
  }
  if (manifest.protocol?.review_completion_ready_file !== "data/review-completion-ready.json") {
    throw new Error("review workspace manifest should expose review completion ready file.");
  }
  if (!/Complete Review posts/.test(manifest.protocol?.auto_handoff_policy || "")) {
    throw new Error("review workspace manifest should record auto handoff policy.");
  }
  if (!/bottom floor layer/.test(manifest.protocol?.layer_policy || "")) {
    throw new Error("review workspace manifest should record layer policy.");
  }
  const canvasState = readJson(path.join(outDir, "data", "canvas-state.json"));
  if (canvasState.board?.zoom_policy !== "locked-no-independent-canvas-zoom") {
    throw new Error("review workspace canvas state should lock independent zoom.");
  }
});

record("post-generation tldraw launcher smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-post-tldraw-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "拼多多",
    "--category", "女包",
    "--product-name", "测试女包",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#f8f5f1'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#ece7df'}}).png().toFile(dir + '/IMG-02-detail-hardware.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
  ]);
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
    "--out-dir", path.join(runDir, "overview"),
    "--title", "Post Generation tldraw Verify",
  ]);
  run(process.execPath, [
    "scripts/post-generation-tldraw-launcher.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
    "--title", "商品图审核工作台",
    "--session-id", "post-generation-verify",
    "--no-auto-start",
  ]);
  const report = readJson(path.join(qaDir, "post-generation-tldraw-launch-report.json"));
  if (report.status !== "created_no_auto_start") {
    throw new Error(`post-generation launcher should create workspace with --no-auto-start, got ${report.status}`);
  }
  for (const file of [
    "review-workspace/data/import-manifest.json",
    "review-workspace/data/post-generation-tldraw-launch-report.json",
    "review-workspace/public/imported-images/IMG-01-main-product.png",
    "review-workspace/public/imported-images/IMG-02-detail-hardware.png",
  ]) {
    if (!fs.existsSync(path.join(runDir, file))) throw new Error(`post-generation launcher missing ${file}`);
  }
  const manifest = readJson(path.join(runDir, "review-workspace", "data", "import-manifest.json"));
  if (manifest.workspace?.image_manifest !== path.join(runDir, "export", "final-images-manifest.json")) {
    throw new Error("post-generation launcher should build tldraw workspace from final-images manifest.");
  }

  const singleRunDir = path.join(tmpDir("sp-verify-single-post-tldraw-"), "run");
  const singleImageDir = path.join(singleRunDir, "final-images");
  const singleQaDir = path.join(singleRunDir, "qa");
  const sharedRoot = path.join(singleRunDir, "shared-canvas-service");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", singleRunDir,
    "--platform", "Amazon",
    "--category", "single hero",
    "--run-id", "single-post-tldraw-verify",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, singleImageDir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", singleRunDir,
    "--image-dir", singleImageDir,
    "--out-dir", singleQaDir,
    "--expected-count", "1",
    "--require-square",
  ]);
  run(process.execPath, [
    "scripts/post-generation-tldraw-launcher.mjs",
    "--run-dir", singleRunDir,
    "--manifest", path.join(singleRunDir, "export", "final-images-manifest.json"),
    "--title", "Single Image tldraw Verify",
    "--session-id", "single-post-tldraw-verify",
    "--shared-root", sharedRoot,
    "--wait-ms", "30000",
  ], { maxBuffer: 50 * 1024 * 1024 });
  const singleReport = readJson(path.join(singleQaDir, "post-generation-tldraw-launch-report.json"));
  if (singleReport.status !== "ready" || !singleReport.url) {
    throw new Error("post-generation launcher should auto-start a ready tldraw session for single-image review handoff.");
  }
  const state = readJson(path.join(sharedRoot, "data", "shared-server-state.json"));
  if (state?.pid) {
    try {
      process.kill(Number(state.pid), "SIGTERM");
    } catch {}
  }
});

record("review completion parse smoke", () => {
  const dir = tmpDir("sp-verify-review-completion-");
  const completionPath = path.join(dir, "review-completion.json");
  const outPath = path.join(dir, "generation-tasks.json");
  fs.writeFileSync(completionPath, JSON.stringify({
    schema_version: "sellerpilot.review_completion.v1",
    review_screenshot: { filename: "sellerpilot-review.png", width: 1200, height: 900, data_url: "data:image/png;base64,AAA" },
    canvas_state: { board: { zoom_policy: "locked-no-independent-canvas-zoom", layer_order: ["image-floor-layer", "standard-overlay-layer"] } },
    annotations: [{
      id: "ann-1",
      image_id: "IMG-01",
      image_file: "IMG-01-main-product.png",
      region: "A-product-subject",
      issue_type: "identity-drift",
      priority: "P0",
      comment: "球衣下摆变短，必须恢复原图长度。",
    }],
  }, null, 2));
  run(process.execPath, [
    "scripts/parse-canvas-annotations.mjs",
    "--annotations", completionPath,
    "--out", outPath,
  ]);
  const parsed = readJson(outPath);
  if (parsed.task_count !== 1) throw new Error("completion parser should create one task.");
  if (parsed.review_screenshot?.has_data_url !== true) throw new Error("completion parser should retain screenshot evidence summary.");
  if (parsed.canvas_state_summary?.zoom_policy !== "locked-no-independent-canvas-zoom") {
    throw new Error("completion parser should retain canvas zoom policy.");
  }
  if (parsed.tasks[0].return_node !== "product-identity-lock") {
    throw new Error("identity drift completion task should route to product identity lock.");
  }
});

record("review completion wakeup smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-review-wakeup-"), "run");
  const workspaceDir = path.join(runDir, "review-workspace");
  fs.mkdirSync(path.join(workspaceDir, "data"), { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, "data", "review-completion.json"), JSON.stringify({
    schema_version: "sellerpilot.review_completion.v2",
    saved_at: new Date().toISOString(),
    handoff_status: "ready_for_codex",
    workspace: { run_dir: runDir, workspace_dir: workspaceDir, session_id: "verify-wakeup" },
    annotations: [{
      id: "ann-1",
      image_id: "IMG-02",
      image_file: "IMG-02-detail.png",
      region: "C-main-title",
      issue_type: "copy-adjust",
      priority: "P1",
      comment: "文案太像内部说明，改成买家语言。",
    }],
    canvas_state: { board: { zoom_policy: "locked-no-independent-canvas-zoom" } },
  }, null, 2));
  fs.writeFileSync(path.join(workspaceDir, "data", "review-completion-ready.json"), JSON.stringify({
    schema_version: "sellerpilot.review_completion_ready.v1",
    status: "ready",
    session_id: "verify-wakeup",
    workspace_dir: workspaceDir,
    completion_file: path.join(workspaceDir, "data", "review-completion.json"),
  }, null, 2));
  run(process.execPath, [
    "scripts/wait-for-review-completion.mjs",
    "--workspace-dir", workspaceDir,
    "--run-dir", runDir,
    "--session-id", "verify-wakeup",
    "--timeout-ms", "1000",
  ]);
  const tasks = readJson(path.join(workspaceDir, "data", "generation-tasks.json"));
  if (tasks.task_count !== 1) throw new Error("review completion watcher should parse one task.");
  if (tasks.tasks[0].return_node !== "localized-copy-pack") {
    throw new Error("copy-adjust wakeup task should route to localized-copy-pack.");
  }
  const wakeup = readJson(path.join(runDir, "qa", "review-completion-wakeup-report.json"));
  if (wakeup.status !== "ready" || wakeup.task_count !== 1) {
    throw new Error("review completion watcher should write a ready wakeup report.");
  }
});

const failed = checks.filter((item) => item.status === "fail");
for (const item of checks) {
  const suffix = item.status === "pass" ? `${item.ms}ms` : `${item.ms}ms - ${item.message}`;
  console.log(`${item.status.toUpperCase()} ${item.name} (${suffix})`);
}

if (failed.length) {
  console.error(`\n${failed.length} verification check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} verification checks passed.`);
