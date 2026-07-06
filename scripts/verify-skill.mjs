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

record("review workspace UI contract", () => {
  const mainPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "src", "main.jsx");
  const cssPath = path.join(skillRoot, "assets", "tldraw-review-workspace", "src", "styles.css");
  const main = fs.readFileSync(mainPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");
  const requiredMain = [
    "image-floor-layer",
    "standard-overlay-layer",
    "action-complete-review",
    "captureReviewPng",
    "review_completion.v1",
    "locked-no-independent-canvas-zoom",
    "compact-field",
  ];
  for (const token of requiredMain) {
    if (!main.includes(token)) throw new Error(`review workspace main.jsx missing ${token}`);
  }
  const requiredCss = [
    ".topbar",
    ".image-floor-layer",
    ".standard-overlay-layer",
    ".review-toolbar",
    ".annotation-dock",
  ];
  for (const token of requiredCss) {
    if (!css.includes(token)) throw new Error(`review workspace styles.css missing ${token}`);
  }
  if (/className=["']sidebar["']|\.sidebar\b|image-card-layer/.test(`${main}\n${css}`)) {
    throw new Error("review workspace should not restore left sidebar or image-card overlay layer.");
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
    "source-understanding/source-product-understanding.json",
    "research/platform-context-plan.md",
    "blueprint/02-identity-lock.yaml",
    "blueprint/02b-product-physical-truth.json",
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
});

record("source product understanding OCR starter smoke", () => {
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
  ]);
  const report = readJson(path.join(dir, "source-understanding", "source-product-understanding.json"));
  if (report.vision_ocr_pass.status !== "completed_needs_verification") {
    throw new Error(`OCR starter should read text when tesseract is available, got ${report.vision_ocr_pass.status}`);
  }
  const values = (report.text_understanding?.text_derived_facts || []).map((item) => item.value).join(" ");
  if (!/1\.08 in/.test(values) || !/0\.47 in/.test(values)) {
    throw new Error("OCR starter should extract visible dimension facts.");
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
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
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
    "data/generation-tasks.json",
    "public/imported-images/IMG-01-main-product.png",
  ]) {
    if (!fs.existsSync(path.join(outDir, file))) throw new Error(`missing review workspace file ${file}`);
  }
  const manifest = readJson(path.join(outDir, "data", "import-manifest.json"));
  if (manifest.protocol?.review_completion_file !== "data/review-completion.json") {
    throw new Error("review workspace manifest should expose review completion file.");
  }
  if (!/bottom floor layer/.test(manifest.protocol?.layer_policy || "")) {
    throw new Error("review workspace manifest should record layer policy.");
  }
  const canvasState = readJson(path.join(outDir, "data", "canvas-state.json"));
  if (canvasState.board?.zoom_policy !== "locked-no-independent-canvas-zoom") {
    throw new Error("review workspace canvas state should lock independent zoom.");
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
