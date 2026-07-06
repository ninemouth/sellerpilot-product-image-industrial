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

record("frontmatter", () => {
  const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  if (!skillMd.startsWith("---\n")) throw new Error("SKILL.md must start with YAML frontmatter.");
  const end = skillMd.indexOf("\n---", 4);
  if (end < 0) throw new Error("SKILL.md frontmatter is not closed.");
  const frontmatter = skillMd.slice(4, end);
  if (!/^name:\s*sellerpilot-product-image-industrial$/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter name is missing or wrong.");
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter description is missing.");
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

record("tldraw lockfile", () => {
  const lockPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "package-lock.json");
  if (!fs.existsSync(lockPath)) throw new Error("assets/tldraw-review-workspace/package-lock.json is missing.");
  const lock = readJson(lockPath);
  if (lock.name !== "sellerpilot-tldraw-review-workspace") throw new Error("tldraw lockfile name mismatch.");
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
    "research/platform-context-plan.md",
    "blueprint/02-identity-lock.yaml",
    "copy/copy-strategy.yaml",
    "geometry/source-geometry.json",
    "blueprint/07-graphic-design-direction.yaml",
    "prompt-pack/10-generation-request-pack.yaml",
    "prompt-pack/12-prompt-layer-stack.json",
    "qa/final-delivery-gate-report.md",
  ];
  for (const file of required) {
    if (!fs.existsSync(path.join(runDir, file))) throw new Error(`run skeleton missing ${file}`);
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

record("export gate pass and draft fail", () => {
  const dir = tmpDir("sp-verify-export-");
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-strap.png')
    ]).catch((e)=>{ console.error(e); process.exit(1); });
  `, dir], { cwd: skillRoot, stdio: "inherit" });
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--image-dir", dir,
    "--out-dir", path.join(dir, "qa-pass"),
    "--expected-count", "2",
    "--require-square",
  ]);
  fs.renameSync(path.join(dir, "IMG-02-detail-strap.png"), path.join(dir, "IMG-02-layout-draft.png"));
  spawnSync(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--image-dir", dir,
    "--out-dir", path.join(dir, "qa-fail"),
    "--expected-count", "2",
    "--require-square",
  ], { cwd: skillRoot });
  const report = readJson(path.join(dir, "qa-fail", "image-set-export-gate-report.json"));
  if (report.status !== "fail") throw new Error("export gate should reject draft final image.");
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
  ]);
  for (const file of [
    "data/import-manifest.json",
    "data/annotations.json",
    "data/canvas-state.json",
    "data/generation-tasks.json",
    "public/imported-images/IMG-01-main-product.png",
  ]) {
    if (!fs.existsSync(path.join(outDir, file))) throw new Error(`missing review workspace file ${file}`);
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
