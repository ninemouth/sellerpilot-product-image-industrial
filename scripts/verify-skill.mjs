#!/usr/bin/env node
import crypto from "node:crypto";
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

function sha256Path(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function createAdaptiveBatchFixtures(imageDir, failureSet) {
  const sharpPath = (() => {
    try { return require.resolve("sharp"); }
    catch { return path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"); }
  })();
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(sharpPath)});
    const dir = process.argv[1];
    const fail = process.argv[2] === 'true';
    const svg = (body) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640">' + body + '</svg>');
    (async () => {
      await sharp({create:{width:640,height:640,channels:3,background:'#8797a5'}})
        .composite([{input:svg('<rect width="640" height="640" fill="#8797a5"/><circle cx="330" cy="310" r="155" fill="#d7a46f"/><rect x="70" y="455" width="500" height="110" rx="16" fill="#52646f"/>')}])
        .png().toFile(dir + '/IMG-01-lifestyle-scene.png');
      if (fail) {
        await sharp({create:{width:128,height:128,channels:3,background:'#f4f4f4'}}).png().toFile(dir + '/IMG-02-too-small.png');
        return;
      }
      await sharp({create:{width:640,height:640,channels:3,background:'#ffffff'}})
        .composite([{input:svg('<rect x="180" y="120" width="280" height="400" rx="60" fill="#487363"/><ellipse cx="320" cy="535" rx="180" ry="22" fill="#dddddd"/>')}])
        .png().toFile(dir + '/IMG-02-studio-hero.png');
      await sharp({create:{width:640,height:640,channels:3,background:'#7b6655'}})
        .composite([{input:svg('<defs><pattern id="p" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M0 18L18 0M-5 5L5-5M13 23L23 13" stroke="#c6aa86" stroke-width="5"/></pattern></defs><rect width="640" height="640" fill="url(#p)"/>')}])
        .png().toFile(dir + '/IMG-03-macro-detail.png');
      await sharp({create:{width:640,height:640,channels:3,background:'#f7f7f4'}})
        .composite([{input:svg('<rect x="55" y="55" width="530" height="530" rx="20" fill="#ffffff" stroke="#202020" stroke-width="3"/><text x="95" y="155" font-family="Arial" font-size="42" font-weight="700">PREMIUM PRODUCT</text><text x="95" y="225" font-family="Arial" font-size="30">Exact size 28 x 20 cm</text><rect x="95" y="285" width="450" height="210" rx="20" fill="#5d8273"/>')}])
        .png().toFile(dir + '/IMG-04-parameter-card.png');
      await sharp({create:{width:640,height:640,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
        .composite([{input:svg('<rect x="150" y="90" width="340" height="460" rx="70" fill="#527965"/><circle cx="320" cy="260" r="80" fill="#d9bd86"/>')}])
        .png().toFile(dir + '/IMG-05-transparent-product.png');
    })().catch((error) => { console.error(error); process.exit(1); });
  `, imageDir, String(failureSet)], { cwd: skillRoot, stdio: "inherit" });
}

function writeIdentityConsistencyPass(runDir, files, options = {}) {
  const qaDir = path.join(runDir, "qa");
  const blueprintDir = path.join(runDir, "blueprint");
  fs.mkdirSync(qaDir, { recursive: true });
  fs.mkdirSync(blueprintDir, { recursive: true });
  const lockPath = options.identityLock || path.join(blueprintDir, "02-identity-lock.yaml");
  if (!fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, [
      "identity_lock:",
      "  must_preserve:",
      "    silhouette: verify source product silhouette",
      "    primary_color: verify source product color family",
      "    material_appearance: verify source material appearance",
      "",
    ].join("\n"));
  }
  fs.writeFileSync(path.join(qaDir, "identity-consistency-visual-review.json"), JSON.stringify({
    status: "pass",
    images: files.map((file) => ({
      file: path.basename(file),
      status: "pass",
      notes: "Fixture review confirms source-vs-generated identity consistency for this final image.",
    })),
  }, null, 2));
  run(process.execPath, ["scripts/identity-consistency-gate.mjs", "--run-dir", runDir]);
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
  if (!/^name:\s*sellerpilot-product-image-industrial$/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter name is missing or wrong.");
  }
  if (!/^description:\s*\S/m.test(frontmatter)) {
    throw new Error("SKILL.md frontmatter description is missing.");
  }
});

record("openai agent display metadata", () => {
  const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const metadata = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  if (!/display_name:\s*"SellerPilot Product Image"/.test(metadata)) {
    throw new Error("Main skill OpenAI display_name should remain SellerPilot Product Image.");
  }
  if (/display_name:\s*"SellerPilot Product Image ThinkAI"/.test(metadata)) {
    throw new Error("Main skill must not expose ThinkAI as a separate product version.");
  }
});

record("README variant naming contract", () => {
  const readme = fs.readFileSync(path.join(skillRoot, "README.md"), "utf8");
  if (readme.includes("sellerpilot-product-image-industrial-thinkai-thinkai")) {
    throw new Error("README.md must not contain a double ThinkAI skill suffix.");
  }
  if (readme.includes("github.com/ninemouth/sellerpilot-product-image-industrial-thinkai")) {
    throw new Error("README.md must keep the canonical GitHub repo URL, not a non-existent ThinkAI repo URL.");
  }
  for (const required of [
    "sellerpilot-product-image-industrial",
    "npm run paths:codex",
    "请检查并更新 sellerpilot-product-image-industrial",
  ]) {
    if (!readme.includes(required)) {
      throw new Error(`README.md missing required install guidance: ${required}`);
    }
  }
});

record("node syntax", () => {
  for (const file of listFiles(path.join(skillRoot, "scripts"), (item) => item.endsWith(".mjs"))) {
    run(process.execPath, ["--check", file]);
  }
});

record("python syntax", () => {
  const python = process.env.SELLERPILOT_PYTHON || (process.platform === "win32" ? "python" : "python3");
  run(python, ["-c", "import pathlib,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_text(encoding='utf-8'), str(p), 'exec')", path.join(skillRoot, "scripts", "natural-image-finish.py")]);
});

record("natural image runtime preparation contract", () => {
  const dir = tmpDir("sp-verify-natural-runtime-");
  const output = run(process.execPath, [
    "scripts/prepare-natural-image-runtime.mjs",
    "--prepare",
    "--dry-run",
    "--runtime-root", dir,
  ]);
  const report = JSON.parse(output);
  if (!["would_prepare", "would_install_dependencies"].includes(report.status)) {
    throw new Error(`natural image runtime dry-run should plan preparation, got ${report.status}.`);
  }
  if (output.includes(dir) || output.includes(skillRoot) || output.includes("runtime_root")) {
    throw new Error("natural image runtime default output must not expose local diagnostic paths.");
  }
  const diagnostics = JSON.parse(run(process.execPath, [
    "scripts/prepare-natural-image-runtime.mjs",
    "--prepare",
    "--dry-run",
    "--runtime-root", dir,
    "--include-diagnostics",
  ]));
  if (diagnostics.diagnostics?.runtime_root !== dir) {
    throw new Error("natural image runtime diagnostics should expose the runtime path only when requested.");
  }
  const pkg = readJson(path.join(skillRoot, "package.json"));
  for (const name of ["prepare:natural-image-runtime", "check:natural-image-runtime", "finish:natural-image", "finish:natural-image-batch", "qa:post-natural-finish-text"]) {
    if (!pkg.scripts?.[name]) throw new Error(`package.json is missing ${name}.`);
  }
  const runner = fs.readFileSync(path.join(skillRoot, "scripts", "natural-image-finish.mjs"), "utf8");
  for (const guard of ["approved_source_required", "visible_text_must_be_explicitly_false", "input_not_run_local", "natural_image_finish"]) {
    if (!runner.includes(guard)) throw new Error(`natural image finish runner is missing ${guard}.`);
  }
  const batch = fs.readFileSync(path.join(skillRoot, "scripts", "natural-image-finish-batch.mjs"), "utf8");
  for (const guard of ["all_final_images_processed", "natural-finish-originals", "selected_profile", "initializeVisibleTextReview"]) {
    if (!batch.includes(guard)) throw new Error(`natural image finish batch is missing ${guard}.`);
  }
});

record("adaptive natural image finish mixed batch smoke", () => {
  const runtimeCheck = spawnSync(process.execPath, [
    "scripts/prepare-natural-image-runtime.mjs",
    "--check",
  ], { cwd: skillRoot, encoding: "utf8" });
  if (runtimeCheck.status !== 0) {
    const processor = fs.readFileSync(path.join(skillRoot, "scripts", "natural-image-finish.py"), "utf8");
    for (const profile of ["photographic_scene", "studio_product", "macro_detail", "graphic_text", "transparent_asset", "hybrid_commerce"]) {
      if (!processor.includes(`\"${profile}\"`)) throw new Error(`Adaptive processor is missing ${profile}.`);
    }
    return;
  }

  const runDir = path.join(tmpDir("sp-verify-natural-batch-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const exportDir = path.join(runDir, "export");
  const blueprintDir = path.join(runDir, "blueprint");
  const qaDir = path.join(runDir, "qa");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(exportDir, { recursive: true });
  fs.mkdirSync(blueprintDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  createAdaptiveBatchFixtures(imageDir, false);
  const files = [
    "IMG-01-lifestyle-scene.png",
    "IMG-02-studio-hero.png",
    "IMG-03-macro-detail.png",
    "IMG-04-parameter-card.png",
    "IMG-05-transparent-product.png",
  ];
  fs.writeFileSync(path.join(blueprintDir, "panels.json"), JSON.stringify({ panels: [
    { id: "IMG-01", image_role: "lifestyle scene" },
    { id: "IMG-02", image_role: "studio hero product" },
    { id: "IMG-03", image_role: "macro texture detail" },
    { id: "IMG-04", image_role: "parameter infographic card", visible_copy: ["Exact size 28 x 20 cm"] },
    { id: "IMG-05", image_role: "transparent product asset" },
  ] }, null, 2));
  fs.writeFileSync(path.join(exportDir, "final-images-manifest.json"), JSON.stringify({
    schema_version: "sellerpilot.final_images_manifest.v1",
    run_id: "verify-natural-batch",
    run_dir: runDir,
    image_dir: imageDir,
    image_count: files.length,
    images: files.map((file, index) => ({
      id: `IMG-${String(index + 1).padStart(2, "0")}`,
      file,
      path: path.join(imageDir, file),
      lineage: { source_type: "provider_generated" },
    })),
  }, null, 2));

  run(process.execPath, ["scripts/natural-image-finish-batch.mjs", "--run-dir", runDir]);
  const report = readJson(path.join(qaDir, "natural-image-finish-batch-report.json"));
  if (report.status !== "pass" || report.processed_count !== 5 || report.all_final_images_processed !== true) {
    throw new Error("Adaptive natural finish batch should process all five mixed fixtures.");
  }
  const expectedProfiles = {
    "IMG-01-lifestyle-scene.png": "photographic_scene",
    "IMG-02-studio-hero.png": "studio_product",
    "IMG-03-macro-detail.png": "macro_detail",
    "IMG-04-parameter-card.png": "graphic_text",
    "IMG-05-transparent-product.png": "transparent_asset",
  };
  for (const [file, profile] of Object.entries(expectedProfiles)) {
    const asset = report.assets.find((item) => item.file === file);
    if (asset?.selected_profile !== profile) throw new Error(`${file} should use ${profile}.`);
  }
  const graphic = report.assets.find((item) => item.file === "IMG-04-parameter-card.png");
  const transparent = report.assets.find((item) => item.file === "IMG-05-transparent-product.png");
  if (!graphic.text_protection_applied) throw new Error("Visible-text fixture should apply text protection.");
  if (!transparent.alpha_preserved) throw new Error("Transparent fixture should preserve alpha.");
  const transparentProof = readJson(path.join(runDir, transparent.proof));
  if (
    transparentProof.alpha_verification?.status !== "pass"
    || transparentProof.alpha_verification.input_alpha_sha256 !== transparentProof.alpha_verification.output_alpha_sha256
  ) {
    throw new Error("Transparent fixture should prove byte-identical alpha preservation.");
  }

  const reviewInit = readJson(path.join(qaDir, "post-natural-finish-visible-text-review.json"));
  if (reviewInit.status !== "needs_visual_review" || reviewInit.required_files?.[0] !== "IMG-04-parameter-card.png") {
    throw new Error("Visible-text batch should initialize a post-finish visual review.");
  }
  fs.writeFileSync(path.join(qaDir, "post-finish-review-evidence.json"), JSON.stringify({
    reviewer_method: "codex_visual_inspection",
    images: [{
      file: "IMG-04-parameter-card.png",
      status: "pass",
      reviewed_sha256: report.final_image_hashes["IMG-04-parameter-card.png"],
      notes: "Visible copy remains legible and unchanged after adaptive finish.",
    }],
  }, null, 2));
  run(process.execPath, [
    "scripts/post-natural-finish-visible-text-review.mjs",
    "--run-dir", runDir,
    "--evidence", path.join(qaDir, "post-finish-review-evidence.json"),
  ]);
  const hashesBeforeRepeat = Object.fromEntries(files.map((file) => [file, sha256Path(path.join(imageDir, file))]));
  const repeated = JSON.parse(run(process.execPath, ["scripts/natural-image-finish-batch.mjs", "--run-dir", runDir]));
  if (repeated.status !== "already_applied") throw new Error("Adaptive batch should be idempotent for unchanged current finals.");
  for (const file of files) {
    if (hashesBeforeRepeat[file] !== sha256Path(path.join(imageDir, file))) throw new Error(`Idempotent rerun changed ${file}.`);
  }
  if (readJson(path.join(qaDir, "post-natural-finish-visible-text-review.json")).status !== "pass") {
    throw new Error("Idempotent batch rerun should preserve a hash-current passing text review.");
  }

  fs.mkdirSync(path.join(runDir, "mode"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "mode", "production-mode-router-report.json"), JSON.stringify({
    execution_policy: { required_quality_path: ["adaptive-natural-image-finish-batch-all-generated-images"] },
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "image-set-export-gate-report.json"), JSON.stringify({
    status: "pass",
    image_manifest: path.join(exportDir, "final-images-manifest.json"),
    findings: [],
  }, null, 2));
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir, "--allow-missing-gates"], { cwd: skillRoot });
  let finalReport = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (finalReport.findings.some((item) => /natural-image-finish|post-natural-finish/.test(item.type))) {
    throw new Error("Hash-current adaptive batch and post-finish text review should satisfy natural finish final-gate checks.");
  }
  const staleReview = readJson(path.join(qaDir, "post-natural-finish-visible-text-review.json"));
  staleReview.images[0].reviewed_sha256 = "0".repeat(64);
  fs.writeFileSync(path.join(qaDir, "post-natural-finish-visible-text-review.json"), JSON.stringify(staleReview, null, 2));
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir, "--allow-missing-gates"], { cwd: skillRoot });
  finalReport = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!finalReport.findings.some((item) => item.type === "post-natural-finish-visible-text-review-hash-mismatch")) {
    throw new Error("Final delivery gate should reject stale post-finish visible-text review hashes.");
  }

  const failedRun = path.join(tmpDir("sp-verify-natural-batch-failure-"), "run");
  const failedImages = path.join(failedRun, "final-images");
  const failedExport = path.join(failedRun, "export");
  fs.mkdirSync(failedImages, { recursive: true });
  fs.mkdirSync(failedExport, { recursive: true });
  createAdaptiveBatchFixtures(failedImages, true);
  const failureFiles = ["IMG-01-lifestyle-scene.png", "IMG-02-too-small.png"];
  fs.writeFileSync(path.join(failedExport, "final-images-manifest.json"), JSON.stringify({
    run_dir: failedRun,
    image_dir: failedImages,
    image_count: failureFiles.length,
    images: failureFiles.map((file, index) => ({ id: `IMG-0${index + 1}`, file, path: path.join(failedImages, file) })),
  }, null, 2));
  const failureHashes = Object.fromEntries(failureFiles.map((file) => [file, sha256Path(path.join(failedImages, file))]));
  const failed = spawnSync(process.execPath, ["scripts/natural-image-finish-batch.mjs", "--run-dir", failedRun], { cwd: skillRoot });
  if (failed.status === 0) throw new Error("Batch should fail when one image cannot pass processing validation.");
  for (const file of failureFiles) {
    if (failureHashes[file] !== sha256Path(path.join(failedImages, file))) throw new Error(`Failed transaction changed ${file}.`);
  }
});

record("natural image finish lineage proof gate", () => {
  const runDir = path.join(tmpDir("sp-verify-natural-lineage-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const sourceDir = path.join(runDir, "generated-assets");
  const qaDir = path.join(runDir, "qa");
  const exportDir = path.join(runDir, "export");
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  fs.mkdirSync(exportDir, { recursive: true });
  const fixture = path.join(skillRoot, "docs", "images", "readme-delivery-example.png");
  const source = path.join(sourceDir, "approved-scene.png");
  const output = path.join(imageDir, "IMG-01-lifestyle-scene.png");
  fs.copyFileSync(fixture, source);
  fs.copyFileSync(fixture, output);
  const outputHash = crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
  const inputHash = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  const proofPath = path.join(qaDir, "natural-image-finish-IMG-01-lifestyle-scene.json");
  fs.writeFileSync(proofPath, JSON.stringify({
    schema_version: "sellerpilot.natural_image_finish_asset.v1",
    status: "pass",
    input_sha256: inputHash,
    output_sha256: outputHash,
    operations: ["ffmpeg_temporal_uniform_grain_and_output_encode"],
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "natural-image-finish-gate-report.json"), JSON.stringify({
    schema_version: "sellerpilot.natural_image_finish_gate.v1",
    gate_id: "natural-image-finish-gate",
    status: "pass",
    assets: [{
      file: path.basename(output),
      approved_source: true,
      contains_visible_text: false,
      selected_profile: "photographic_scene",
      input_sha256: inputHash,
      output_sha256: outputHash,
    }],
    findings: [],
  }, null, 2));
  const manifestPath = path.join(exportDir, "final-images-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    schema_version: "sellerpilot.final_images_manifest.v1",
    run_dir: runDir,
    image_dir: imageDir,
    image_count: 1,
    images: [{
      id: "IMG-01",
      file: path.basename(output),
      path: output,
      lineage: {
        source_type: "derived_from_approved_generated_asset",
        derived_from: path.relative(runDir, source),
        transformation_type: "natural_image_finish",
        natural_finish_proof: path.relative(runDir, proofPath),
      },
    }],
  }, null, 2));
  run(process.execPath, ["scripts/final-image-lineage-gate.mjs", "--run-dir", runDir, "--manifest", manifestPath]);
  const passing = readJson(path.join(qaDir, "final-image-lineage-gate-report.json"));
  if (passing.status !== "pass") throw new Error("natural image finish lineage proof should pass with matching output hash.");
  const invalidProof = readJson(proofPath);
  invalidProof.output_sha256 = "0".repeat(64);
  fs.writeFileSync(proofPath, JSON.stringify(invalidProof, null, 2));
  const failed = spawnSync(process.execPath, ["scripts/final-image-lineage-gate.mjs", "--run-dir", runDir, "--manifest", manifestPath], { cwd: skillRoot });
  if (failed.status === 0) throw new Error("natural image finish lineage proof should fail when the output hash drifts.");
  const blocked = readJson(path.join(qaDir, "final-image-lineage-gate-report.json"));
  if (!blocked.findings.some((item) => item.type === "natural-image-finish-output-hash-mismatch")) {
    throw new Error("natural image finish lineage gate should report output hash mismatch.");
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
      "surface-material-classification-and-canonical-extraction-if-triggered",
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
      "resolve-image-provider-before-generation",
      "resolve-platform-ratio-and-provider-generation-spec-before-execution",
      "generation-execution-controller-anchor-first-bounded-concurrency-after-qa",
      "image-set-export-gate",
      "anchor-batch-qa-decision-record",
      "surface-material-transfer-proof-before-final-generation-if-triggered",
      "surface-material-transfer-gate-if-triggered",
      "adaptive-natural-image-finish-batch-all-generated-images",
      "post-natural-finish-visible-text-regression-review-if-copy",
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
    assertStepBefore(file, steps, "product-identity-lock", "surface-material-classification-and-canonical-extraction-if-triggered");
    assertStepBefore(file, steps, "surface-material-classification-and-canonical-extraction-if-triggered", "prompt-layer-stack");
    assertStepBefore(file, steps, "platform-preference-memory-apply-if-platform-category-match", "platform-context-planner");
    assertStepBefore(file, steps, "store-style-memory-apply-if-store-mentioned", "platform-context-planner");
    assertStepBefore(file, steps, "store-style-memory-apply-if-store-mentioned", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "commerce-design-research-planner-if-conversion-critical", "audience-persona");
    assertStepBefore(file, steps, "compact-image-set-blueprint", "prompt-layer-stack");
    assertStepBefore(file, steps, "personalized-prompt-delivery", "resolve-image-provider-before-generation");
    assertStepBefore(file, steps, "resolve-image-provider-before-generation", "resolve-platform-ratio-and-provider-generation-spec-before-execution");
    assertStepBefore(file, steps, "prompt-layer-stack", "resolve-platform-ratio-and-provider-generation-spec-before-execution");
    assertStepBefore(file, steps, "resolve-platform-ratio-and-provider-generation-spec-before-execution", "generation-runtime-execution-boundary");
    assertStepBefore(file, steps, "generation-execution-controller-anchor-first-bounded-concurrency-after-qa", "anchor-batch-generation-loop-if-runtime-available");
    assertStepBefore(file, steps, "product-physical-truth-lock-if-function-use-or-scale-sensitive", "product-physics-fact-gate-if-function-use-or-scale-sensitive");
    assertStepBefore(file, steps, "copy-strategy-gate", "marketing-quality-gate");
    assertStepBefore(file, steps, "localized-copy-qa-gate-if-locale-needs-review", "marketing-quality-gate");
    assertStepBefore(file, steps, "localized-copy-qa-gate-if-locale-needs-review", "text-layout-proof-gate-before-final-raster-if-visible-copy");
    assertStepBefore(file, steps, "text-layout-proof-gate-before-final-raster-if-visible-copy", "compact-image-set-blueprint");
    assertStepBefore(file, steps, "anchor-batch-generation-loop-if-runtime-available", "anchor-batch-qa-decision-record");
    assertStepBefore(file, steps, "anchor-batch-qa-decision-record", "continue-missing-assets-only");
    assertStepBefore(file, steps, "identity-consistency-gate", "surface-material-transfer-proof-before-final-generation-if-triggered");
    assertStepBefore(file, steps, "surface-material-transfer-proof-before-final-generation-if-triggered", "surface-material-transfer-gate-if-triggered");
    assertStepBefore(file, steps, "surface-material-transfer-gate-if-triggered", "marketing-quality-gate");
    assertStepBefore(file, steps, "product-physics-fact-gate-if-function-use-or-scale-sensitive", "adaptive-natural-image-finish-batch-all-generated-images");
    assertStepBefore(file, steps, "text-layout-proof-gate-before-final-export-if-visible-copy", "localized-final-visible-text-qa-if-locale-needs-review");
    assertStepBefore(file, steps, "localized-final-visible-text-qa-if-locale-needs-review", "marketing-quality-gate");
    assertStepBefore(file, steps, "product-background-card-consistency-gate", "adaptive-natural-image-finish-batch-all-generated-images");
    assertStepBefore(file, steps, "adaptive-natural-image-finish-batch-all-generated-images", "post-natural-finish-visible-text-regression-review-if-copy");
    assertStepBefore(file, steps, "post-natural-finish-visible-text-regression-review-if-copy", "marketing-quality-gate");
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

record("automatic image provider contract", () => {
  const runtimePath = path.join(skillRoot, "scripts", "thinkai-image-runtime.mjs");
  const resolverPath = path.join(skillRoot, "scripts", "resolve-image-provider.mjs");
  const configurePath = path.join(skillRoot, "scripts", "configure-image-provider.mjs");
  if (!fs.existsSync(runtimePath)) throw new Error("scripts/thinkai-image-runtime.mjs is missing.");
  if (!fs.existsSync(resolverPath) || !fs.existsSync(configurePath)) throw new Error("provider resolver/configurer is missing.");
  const runtime = fs.readFileSync(runtimePath, "utf8");
  for (const token of [
    'DEFAULT_BASE_URL = "https://www.thinkai.tv/v1"',
    'DEFAULT_MODEL = "gpt-image-2"',
    "THINKAI_API_KEY",
    "spawn(\"curl\"",
    "progress-file",
    "withHeartbeat",
    "publicFailure",
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
  const configDir = tmpDir("sp-verify-provider-config-");
  const configOut = run(process.execPath, [
    "scripts/configure-image-provider.mjs",
    "--config", path.join(configDir, "image-provider.json"),
    "--api-key", "verify-key",
  ]);
  const configSummary = JSON.parse(configOut);
  const config = readJson(path.join(configDir, "image-provider.json"));
  if (configSummary.provider.model !== "gpt-image-2" || config.third_party.model !== "gpt-image-2") {
    throw new Error("provider config script must write default model gpt-image-2.");
  }
  if (config.third_party.api_key !== "verify-key") {
    throw new Error("provider config script did not write the supplied API key.");
  }
  const codexConfig = path.join(configDir, "config.toml");
  fs.writeFileSync(codexConfig, 'model_provider = "acme"\n[model_providers.acme]\nbase_url = "https://images.example/v1"\nenv_key = "ACME_IMAGE_KEY"\n');
  process.env.ACME_IMAGE_KEY = "verify-provider-key";
  const resolution = JSON.parse(run(process.execPath, ["scripts/resolve-image-provider.mjs", "--config", path.join(configDir, "missing.json"), "--codex-config", codexConfig]));
  delete process.env.ACME_IMAGE_KEY;
  if (resolution.selected_mode !== "third_party_proxy" || resolution.provider.base_url !== "https://images.example/v1" || resolution.provider.api_key_env !== "ACME_IMAGE_KEY") {
    throw new Error("provider resolver should use current Codex third-party provider configuration.");
  }
  const nativeResolution = JSON.parse(run(process.execPath, ["scripts/resolve-image-provider.mjs", "--config", path.join(configDir, "missing.json"), "--codex-config", path.join(configDir, "no-config.toml")]));
  if (nativeResolution.selected_mode !== "native_codex") throw new Error("provider resolver should default to native Codex without a third-party provider.");
  const priorCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(configDir, "codex-home");
  process.env.ACME_IMAGE_KEY = "verify-provider-key";
  const sharedConfigPath = path.join(process.env.CODEX_HOME, "sellerpilot-product-image-industrial", "image-provider.json");
  fs.mkdirSync(path.dirname(sharedConfigPath), { recursive: true });
  fs.writeFileSync(sharedConfigPath, JSON.stringify({ third_party: { enabled: true, name: "Acme", base_url: "https://images.example/v1", model: "acme-image", api_key_env: "ACME_IMAGE_KEY" } }));
  const genericRuntime = JSON.parse(run(process.execPath, ["scripts/thinkai-image-runtime.mjs", "--prompt", "verify generic provider", "--output-dir", path.join(configDir, "generic-runtime"), "--dry-run"]));
  if (genericRuntime.provider !== "third-party-openai-compatible-image-runtime" || genericRuntime.base_url !== "https://images.example/v1" || genericRuntime.model !== "acme-image") {
    throw new Error("runtime should load the shared resolved third-party provider config.");
  }
  if (priorCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = priorCodexHome;
  delete process.env.ACME_IMAGE_KEY;
  const progressDir = tmpDir("sp-verify-thinkai-progress-");
  run(process.execPath, [
    "scripts/thinkai-image-runtime.mjs",
    "--prompt", "verify progress dry run",
    "--output-dir", progressDir,
    "--progress-file", path.join(progressDir, "progress.json"),
    "--dry-run",
  ]);
  const progress = readJson(path.join(progressDir, "progress.json"));
  if (progress.status !== "dry_run" || progress.runtime?.heartbeat_seconds !== 30) {
    throw new Error("ThinkAI runtime dry run must write a run-scoped safe progress status.");
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

record("generation spec and anchor controller smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-generation-control-"), "run");
  const specDir = path.join(runDir, "generation-spec");
  run(process.execPath, ["scripts/resolve-generation-spec.mjs", "--out-dir", specDir, "--platform", "Ozon", "--category", "apparel"]);
  const spec = readJson(path.join(specDir, "generation-spec.json"));
  if (spec.required_ratio !== "3:4" || spec.requested_size !== "1920x2560") {
    throw new Error("Ozon generation spec must resolve the required 3:4 portrait request before generation.");
  }
  fs.mkdirSync(path.join(runDir, "generated-assets"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "generated-assets", "generation-progress.json"), "{}\n");
  fs.writeFileSync(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"), JSON.stringify({ qa_decision: "pending" }));
  const jobsPath = path.join(runDir, "jobs.json");
  fs.writeFileSync(jobsPath, JSON.stringify({ jobs: [{ id: "IMG-01", anchor: true }, { id: "IMG-02", anchor: true }, { id: "IMG-03", anchor: true }, { id: "IMG-04", anchor: false }] }));
  run(process.execPath, ["scripts/generation-execution-controller.mjs", "--run-dir", runDir, "--jobs", jobsPath]);
  const anchorState = readJson(path.join(runDir, "generated-assets", "execution-controller-state.json"));
  if (anchorState.anchor_job_ids.length !== 2 || !anchorState.demoted_anchor_job_ids.includes("IMG-03")) {
    throw new Error("Controller must cap anchor batch to two jobs and demote overflow anchors.");
  }
  const blocked = spawnSync(process.execPath, ["scripts/generation-execution-controller.mjs", "--run-dir", runDir, "--jobs", jobsPath, "--continue-after-anchor-pass"], { cwd: skillRoot });
  if (blocked.status === 0) throw new Error("Controller must block remaining jobs before anchor approval.");
  fs.writeFileSync(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"), JSON.stringify({ qa_decision: "continue" }));
  run(process.execPath, ["scripts/generation-execution-controller.mjs", "--run-dir", runDir, "--jobs", jobsPath, "--continue-after-anchor-pass"]);
  const state = readJson(path.join(runDir, "generated-assets", "execution-controller-state.json"));
  if (state.status !== "remaining_ready" || state.concurrency !== 2) throw new Error("Controller must permit only bounded remaining generation after anchor QA.");
});

record("phase tracer and child progress reconcile smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-phase-trace-"), "run");
  const assetsDir = path.join(runDir, "generated-assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "generation-progress.json"), JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "not_started",
    created_at: "2026-07-09T09:00:00.000Z",
    updated_at: "2026-07-09T09:00:00.000Z",
    image_count: 3,
  }, null, 2));
  fs.writeFileSync(path.join(assetsDir, "anchor-batch-qa-decision.json"), JSON.stringify({ qa_decision: "continue" }));
  fs.mkdirSync(path.join(assetsDir, "anchor-01"), { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "anchor-01", "image.png"), "fake-image");
  fs.writeFileSync(path.join(assetsDir, "progress-anchor-01.json"), JSON.stringify({
    status: "completed",
    updated_at: "2026-07-09T09:00:06.000Z",
    runtime: {
      completed_images: [{ image_path: path.join(assetsDir, "anchor-01", "image.png"), actual_size: "1200x1200" }],
      meaningful_progress_events: [
        { event: "request_started", at: "2026-07-09T09:00:00.000Z" },
        { event: "provider_first_byte_received", at: "2026-07-09T09:00:01.000Z" },
        { event: "response_received", at: "2026-07-09T09:00:04.000Z" },
        { event: "download_started", at: "2026-07-09T09:00:04.500Z" },
        { event: "asset_verified", at: "2026-07-09T09:00:06.000Z" },
      ],
    },
  }, null, 2));
  fs.writeFileSync(path.join(assetsDir, "progress-remaining-01.json"), JSON.stringify({
    status: "failed",
    updated_at: "2026-07-09T09:00:08.000Z",
    runtime: {
      failure: { code: "provider_request_failed" },
      meaningful_progress_events: [
        { event: "request_started", at: "2026-07-09T09:00:07.000Z" },
        { event: "provider_first_byte_received", at: "2026-07-09T09:00:08.000Z" },
      ],
    },
  }, null, 2));
  fs.writeFileSync(path.join(assetsDir, "progress-remaining-02.json"), JSON.stringify({
    status: "generating",
    updated_at: "2026-07-09T09:00:09.000Z",
    runtime: {
      meaningful_progress_events: [
        { event: "request_started", at: "2026-07-09T09:00:09.000Z" },
      ],
    },
  }, null, 2));

  run(process.execPath, ["scripts/production-phase-tracer.mjs", "--run-dir", runDir, "--now", "2026-07-09T09:00:10.000Z"]);
  const trace = readJson(path.join(runDir, "telemetry", "phase-trace.json"));
  if (trace.status !== "needs_attention" || trace.snapshot.child_progress_files !== 3) {
    throw new Error("phase tracer should detect stale main progress and count child progress files.");
  }
  if (trace.metrics.provider_first_byte_ms.p50 !== 1000) {
    throw new Error("phase tracer should compute provider first byte metrics from meaningful progress events.");
  }
  run(process.execPath, ["scripts/reconcile-generation-progress.mjs", "--run-dir", runDir, "--from-child-progress"]);
  const reconciled = readJson(path.join(assetsDir, "generation-progress.json"));
  if (reconciled.status !== "runtime_in_progress" || reconciled.completed_images.length !== 1 || reconciled.failed_images.length !== 1 || reconciled.pending_images.length !== 1) {
    throw new Error("child progress reconcile should restore completed, failed, and pending job evidence.");
  }
  if (reconciled.anchor_batch?.qa_decision !== "continue") {
    throw new Error("child progress reconcile should preserve anchor batch QA evidence.");
  }
});

record("asset reuse telemetry and ready auto-close smoke", () => {
  const root = tmpDir("sp-verify-asset-reuse-");
  const sourceRun = path.join(root, "source-run");
  const runDir = path.join(root, "revision-run");
  const assetsDir = path.join(runDir, "generated-assets");
  const finalDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  fs.mkdirSync(path.join(sourceRun, "generated-assets", "remaining-1"), { recursive: true });
  fs.mkdirSync(path.join(sourceRun, "generated-assets", "remaining-2"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "remaining-1"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "remaining-2"), { recursive: true });
  fs.mkdirSync(finalDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "export"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "copy"), { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "00-task-context.yaml"), [
    "run_id: verify-asset-reuse",
    "platform: Etsy",
    "category: personalized cosmetic bag",
    "",
  ].join("\n"));
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [sourceRun, runDir] = process.argv.slice(1);
    (async () => {
      for (const id of ['remaining-1', 'remaining-2']) {
        await sharp({create:{width:1200,height:1200,channels:4,background:id === 'remaining-1' ? '#f5ebe3' : '#eee4db'}}).png().toFile(sourceRun + '/generated-assets/' + id + '/image.png');
        await sharp({create:{width:1200,height:1200,channels:4,background:id === 'remaining-1' ? '#f5ebe3' : '#eee4db'}}).png().toFile(runDir + '/generated-assets/' + id + '/image.png');
      }
      await sharp({create:{width:1200,height:1200,channels:4,background:'#fff7f0'}}).png().toFile(runDir + '/final-images/IMG-01-personalized-hero.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#eee4db'}}).png().toFile(runDir + '/final-images/IMG-02-detail-view.png');
    })().catch((e)=>{ console.error(e); process.exit(1); });
  `, sourceRun, runDir], { cwd: skillRoot, stdio: "inherit" });
  for (const id of ["remaining-1", "remaining-2"]) {
    fs.writeFileSync(path.join(assetsDir, id, "summary.json"), JSON.stringify({
      status: "generated",
      provider: "thinkai-openai-compatible-image-runtime",
      output_dir: path.join(sourceRun, "generated-assets", id),
      images: [{ image_path: path.join(sourceRun, "generated-assets", id, "image.png") }],
    }, null, 2));
  }
  fs.writeFileSync(path.join(qaDir, "failed-asset-repair-map.json"), JSON.stringify({
    status: "repair_completed",
    failure_review: { repair_strategy: "reuse approved base assets and rerender local embroidery text only" },
    keep_assets: [
      "generated-assets/remaining-1/image.png",
      "generated-assets/remaining-2/image.png",
    ],
    rerender_only: ["IMG-01-personalized-hero.png"],
    regenerate_provider_assets: [],
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "export", "final-image-lineage.json"), JSON.stringify({
    images: [
      {
        file: "IMG-01-personalized-hero.png",
        source_type: "local_text_overlay",
        derived_from: "generated-assets/remaining-1/image.png",
        transformation_type: "local_embroidery_text_overlay",
        render_method: "local_overlay",
        text_overlay_proof: "qa/personalized-text-compositor-contract-report.json",
        personalized_text_items: [{ role: "name", exact_text: "Olivia" }],
      },
      {
        file: "IMG-02-detail-view.png",
        source_type: "derived_from_approved_generated_asset",
        derived_from: "generated-assets/remaining-2/image.png",
        transformation_type: "approved_asset_reuse_crop",
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "final-visible-text-review.json"), JSON.stringify({ status: "pass", allowlist: ["Olivia"] }));
  fs.writeFileSync(path.join(runDir, "copy", "personalized-text-compositor-contract.json"), JSON.stringify({
    render_method: "local_overlay",
    font_family: "verify embroidery font",
    personalized_text_items: [{ role: "name", exact_text: "Olivia" }],
    final_visible_text_review: { status: "pass" },
  }, null, 2));
  for (const [file, body] of Object.entries({
    "marketing-quality-gate-report.json": { status: "pass", findings: [] },
    "copy-strategy-gate-report.json": { status: "pass", findings: [] },
    "product-background-card-consistency-gate-report.json": { status: "pass", findings: [] },
    "text-layout-proof-gate-report.json": { status: "pass", findings: [] },
  })) {
    fs.writeFileSync(path.join(qaDir, file), JSON.stringify(body, null, 2));
  }
  run(process.execPath, ["scripts/image-set-export-gate.mjs", "--run-dir", runDir, "--image-dir", finalDir, "--out-dir", qaDir, "--expected-count", "2", "--require-square"]);
  writeIdentityConsistencyPass(runDir, ["IMG-01-personalized-hero.png", "IMG-02-detail-view.png"]);
  run(process.execPath, ["scripts/personalized-text-compositor-contract.mjs", "--run-dir", runDir]);
  run(process.execPath, ["scripts/final-image-lineage-gate.mjs", "--run-dir", runDir]);
  fs.writeFileSync(path.join(assetsDir, "generation-progress.json"), JSON.stringify({
    schema_version: "sellerpilot.generation_progress.v1",
    status: "not_started",
    image_count: 2,
  }, null, 2));
  run(process.execPath, ["scripts/record-asset-reuse.mjs", "--run-dir", runDir, "--write-progress"]);
  const reuse = readJson(path.join(assetsDir, "asset-reuse-manifest.json"));
  if (reuse.reuse_count !== 2 || !reuse.records.every((item) => item.original_source_path?.includes("source-run"))) {
    throw new Error("asset reuse manifest should record current assets and original source run paths.");
  }
  run(process.execPath, ["scripts/reconcile-generation-progress.mjs", "--run-dir", runDir, "--from-child-progress"]);
  const progress = readJson(path.join(assetsDir, "generation-progress.json"));
  if (progress.status !== "runtime_completed" || progress.completed_images.length !== 2 || !progress.completed_images.every((item) => item.source_type === "asset_reuse")) {
    throw new Error("reconcile should treat reused approved assets as completed synthetic progress.");
  }
  run(process.execPath, ["scripts/production-phase-tracer.mjs", "--run-dir", runDir, "--now", "2026-07-09T10:00:00.000Z"]);
  const trace = readJson(path.join(runDir, "telemetry", "phase-trace.json"));
  if (trace.snapshot.reused_jobs !== 2 || trace.metrics.provider_total_ms.count !== 0) {
    throw new Error("phase tracer should separate reused assets from current-run provider metrics.");
  }
  if (!("asset_reuse_ms" in trace.metrics.phase_duration_ms) || !("local_compositor_ms" in trace.metrics.phase_duration_ms)) {
    throw new Error("phase tracer should report asset_reuse_ms and local_compositor_ms phases.");
  }
  const close = run(process.execPath, ["scripts/runtime-watchdog.mjs", "--run-dir", runDir, "--auto-close-ready", "--skip-tldraw", "--now", "2026-07-09T10:00:00.000Z"]);
  const closeOut = JSON.parse(close);
  if (closeOut.classification !== "auto_closed_ready_handoff") {
    throw new Error(`watchdog should auto-close ready runs, got ${closeOut.classification}`);
  }
  const finalGate = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (finalGate.status !== "pass" || !fs.existsSync(path.join(runDir, "overview", "SET-OVERVIEW-contact-sheet.png"))) {
    throw new Error("watchdog auto-close should create overview and pass final delivery gate.");
  }
});

record("production orchestrator dag cache smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-orchestrator-"), "run");
  fs.mkdirSync(path.join(runDir, "orchestration"), { recursive: true });
  const taskFile = path.join(runDir, "orchestration", "tasks.json");
  const writeTaskScript = "require('fs').writeFileSync(process.argv[1], process.argv[2])";
  fs.writeFileSync(taskFile, JSON.stringify({
    tasks: [
      {
        id: "source-preflight",
        phase: "source_preflight",
        outputs: ["source-preflight.txt"],
        command: [process.execPath, "-e", writeTaskScript, path.join(runDir, "source-preflight.txt"), "source"],
      },
      {
        id: "platform-profile",
        phase: "platform",
        outputs: ["platform.txt"],
        command: [process.execPath, "-e", writeTaskScript, path.join(runDir, "platform.txt"), "platform"],
      },
      {
        id: "identity-lock",
        phase: "identity",
        depends_on: ["source-preflight", "platform-profile"],
        inputs: ["source-preflight.txt", "platform.txt"],
        outputs: ["identity.txt"],
        command: [process.execPath, "-e", writeTaskScript, path.join(runDir, "identity.txt"), "identity"],
      },
    ],
  }, null, 2));
  run(process.execPath, ["scripts/production-orchestrator.mjs", "--run-dir", runDir, "--tasks", taskFile, "--execute", "--concurrency", "2"]);
  const first = readJson(path.join(runDir, "orchestration", "production-orchestrator-state.json"));
  if (first.status !== "completed" || first.tasks.filter((item) => item.status === "completed").length !== 3) {
    throw new Error("production orchestrator should execute a dependent DAG to completion.");
  }
  const identity = first.tasks.find((item) => item.id === "identity-lock");
  if (!identity || identity.depends_on.length !== 2 || !Number.isFinite(identity.ms)) {
    throw new Error("production orchestrator should preserve dependency and timing evidence.");
  }
  run(process.execPath, ["scripts/production-orchestrator.mjs", "--run-dir", runDir, "--tasks", taskFile, "--execute", "--concurrency", "2"]);
  const second = readJson(path.join(runDir, "orchestration", "production-orchestrator-state.json"));
  if (second.status !== "completed" || second.tasks.filter((item) => item.status === "cached").length !== 3) {
    throw new Error("production orchestrator should reuse unchanged task outputs by hash.");
  }
});

record("provider instability, lineage, and personalized text smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-lineage-provider-"), "run");
  const assetsDir = path.join(runDir, "generated-assets");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  const exportDir = path.join(runDir, "export");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  fs.mkdirSync(exportDir, { recursive: true });
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Etsy",
    "--category", "personalized cosmetic bag",
    "--run-id", "verify-lineage-provider",
  ]);
  fs.mkdirSync(path.join(assetsDir, "approved-source"), { recursive: true });
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [assetDir, imageDir] = process.argv.slice(1);
    (async () => {
      await sharp({create:{width:1200,height:1200,channels:4,background:'#f4ede6'}}).png().toFile(assetDir + '/image.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#f4ede6'}}).png().toFile(imageDir + '/IMG-01-provider-generated.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#eee5dc'}}).png().toFile(imageDir + '/IMG-02-derived-gift-scene.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#fff7f0'}}).png().toFile(imageDir + '/IMG-03-local-text-overlay.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#f8f1ea'}}).png().toFile(imageDir + '/IMG-04-provider-detail.png');
    })().catch((e)=>{ console.error(e); process.exit(1); });
  `, path.join(assetsDir, "approved-source"), imageDir], { cwd: skillRoot, stdio: "inherit" });

  fs.writeFileSync(path.join(assetsDir, "progress-gift.json"), JSON.stringify({ status: "failed", runtime: { failure: { code: "provider_request_failed" } } }));
  fs.writeFileSync(path.join(assetsDir, "progress-gift-retry.json"), JSON.stringify({ status: "failed", runtime: { failure: { code: "provider_request_failed" } } }));
  const blocked = spawnSync(process.execPath, ["scripts/provider-instability-circuit-breaker.mjs", "--run-dir", runDir], { cwd: skillRoot });
  if (blocked.status === 0) throw new Error("provider circuit breaker should block unresolved repeated provider failures.");

  fs.writeFileSync(path.join(qaDir, "failed-asset-repair-map.json"), JSON.stringify({
    status: "completed",
    repairs: {
      "progress-gift.json": "final-images/IMG-02-derived-gift-scene.png",
      "progress-gift-retry.json": "final-images/IMG-02-derived-gift-scene.png",
    },
  }, null, 2));
  run(process.execPath, ["scripts/provider-instability-circuit-breaker.mjs", "--run-dir", runDir]);
  const providerReport = readJson(path.join(qaDir, "provider-instability-circuit-breaker-report.json"));
  if (providerReport.status !== "pass_with_warnings" || providerReport.decision.stop_provider_retries) {
    throw new Error("provider circuit breaker should allow repaired failures while preserving warnings.");
  }

  fs.mkdirSync(path.join(runDir, "copy"), { recursive: true });
  fs.writeFileSync(path.join(qaDir, "final-visible-text-review.json"), JSON.stringify({ status: "pass", reviewed_text: ["Olivia", "06.16.2026"] }));
  fs.writeFileSync(path.join(runDir, "copy", "personalized-text-compositor-contract.json"), JSON.stringify({
    render_method: "local_overlay",
    font_family: "Snell Roundhand",
    personalized_text_items: [
      { role: "name", exact_text: "Olivia" },
      { role: "date", exact_text: "06.16.2026" },
    ],
  }, null, 2));
  run(process.execPath, ["scripts/personalized-text-compositor-contract.mjs", "--run-dir", runDir]);

  fs.writeFileSync(path.join(exportDir, "final-image-lineage.json"), JSON.stringify({
    images: [
      { file: "IMG-01-provider-generated.png", source_type: "provider_generated", generated_asset_path: "generated-assets/approved-source/image.png" },
      { file: "IMG-02-derived-gift-scene.png", source_type: "derived_from_approved_generated_asset", derived_from: "generated-assets/approved-source/image.png", transformation_type: "crop_tone_adjust", repair_of_progress_ids: ["progress-gift.json", "progress-gift-retry.json"] },
      { file: "IMG-03-local-text-overlay.png", source_type: "local_text_overlay", derived_from: "generated-assets/approved-source/image.png", transformation_type: "local_text_overlay", render_method: "local_overlay", text_overlay_proof: "qa/personalized-text-compositor-contract-report.json", personalized_text_items: [{ role: "name", exact_text: "Olivia" }] },
      { file: "IMG-04-provider-detail.png", source_type: "provider_generated", generated_asset_path: "generated-assets/approved-source/image.png" },
    ],
  }, null, 2));

  fs.writeFileSync(path.join(qaDir, "marketing-quality-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "copy-strategy-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "product-background-card-consistency-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(qaDir, "text-layout-proof-gate-report.json"), JSON.stringify({ status: "pass", findings: [] }));
  fs.writeFileSync(path.join(assetsDir, "anchor-batch-qa-decision.json"), JSON.stringify({ qa_decision: "pass" }));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "4",
    "--require-square",
  ]);
  writeIdentityConsistencyPass(runDir, [
    "IMG-01-provider-generated.png",
    "IMG-02-derived-gift-scene.png",
    "IMG-03-local-text-overlay.png",
    "IMG-04-provider-detail.png",
  ]);
  const manifest = readJson(path.join(exportDir, "final-images-manifest.json"));
  const derived = manifest.images.find((item) => item.file === "IMG-02-derived-gift-scene.png");
  if (derived?.lineage?.source_type !== "derived_from_approved_generated_asset" || !derived.lineage.repair_of_progress_ids?.length) {
    throw new Error("final image manifest should include derived lineage and repair progress ids.");
  }
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(exportDir, "final-images-manifest.json"),
    "--out-dir", path.join(runDir, "overview"),
  ]);
  fs.writeFileSync(path.join(assetsDir, "generation-progress.json"), JSON.stringify({
    status: "final_exported",
    image_count: 4,
    completed_images: manifest.images.map((item) => ({ file: item.file, path: item.path })),
    failed_images: [],
    pending_images: [],
    anchor_batch: { qa_decision: "pass" },
  }, null, 2));
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const missingLineageGate = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!missingLineageGate.findings.some((item) => item.type === "missing-final-image-lineage-gate")) {
    throw new Error("final delivery gate should require lineage gate when manifest contains derived lineage.");
  }
  run(process.execPath, ["scripts/final-image-lineage-gate.mjs", "--run-dir", runDir]);
  run(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir]);
  const finalReport = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!["pass", "pass_with_warnings"].includes(finalReport.status)) {
    throw new Error(`final delivery should pass after lineage and personalized text gates, got ${finalReport.status}`);
  }
});

record("historical lineage backfill smoke", () => {
  const runDir = path.join(tmpDir("sp-verify-lineage-backfill-"), "run");
  const assetsDir = path.join(runDir, "generated-assets");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  fs.mkdirSync(path.join(assetsDir, "anchor-01"), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, "derived-gift-scene"), { recursive: true });
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Etsy",
    "--category", "personalized cosmetic bag",
    "--run-id", "verify-lineage-backfill",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [assetsDir, imageDir] = process.argv.slice(1);
    (async () => {
      await sharp({create:{width:1200,height:1200,channels:4,background:'#eee6dd'}}).png().toFile(assetsDir + '/anchor-01/image.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#f4ebe3'}}).png().toFile(assetsDir + '/derived-gift-scene/image.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#fff8f0'}}).png().toFile(imageDir + '/IMG-01-personalized-hero.png');
      await sharp({create:{width:1200,height:1200,channels:4,background:'#f4ebe3'}}).png().toFile(imageDir + '/IMG-02-gift-scene.png');
    })().catch((e)=>{ console.error(e); process.exit(1); });
  `, assetsDir, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(assetsDir, "progress-anchor-01.json"), JSON.stringify({
    status: "completed",
    runtime: { completed_images: [{ image_path: path.join(assetsDir, "anchor-01", "image.png") }] },
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "failed-asset-repair-map.json"), JSON.stringify({
    status: "completed",
    repairs: { "progress-gift-scene.json": "final-images/IMG-02-gift-scene.png" },
  }, null, 2));
  fs.writeFileSync(path.join(qaDir, "final-visible-text-review.json"), JSON.stringify({
    status: "pass",
    allowlist: ["Olivia", "06.16.2026"],
  }, null, 2));
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
  ]);
  const oldManifest = readJson(path.join(runDir, "export", "final-images-manifest.json"));
  if (oldManifest.images.some((item) => item.lineage?.source_type && item.lineage.source_type !== "unknown" && !item.lineage.repair_map)) {
    throw new Error("fixture should start with incomplete historical lineage.");
  }
  run(process.execPath, [
    "scripts/backfill-final-image-lineage.mjs",
    "--run-dir", runDir,
    "--font-family", "recorded_from_existing_final_export",
  ]);
  run(process.execPath, ["scripts/personalized-text-compositor-contract.mjs", "--run-dir", runDir]);
  run(process.execPath, [
    "scripts/image-set-export-gate.mjs",
    "--run-dir", runDir,
    "--image-dir", imageDir,
    "--out-dir", qaDir,
    "--expected-count", "2",
    "--require-square",
  ]);
  const manifest = readJson(path.join(runDir, "export", "final-images-manifest.json"));
  const hero = manifest.images.find((item) => item.file === "IMG-01-personalized-hero.png");
  const repaired = manifest.images.find((item) => item.file === "IMG-02-gift-scene.png");
  if (hero?.lineage?.source_type !== "local_text_overlay" || hero.lineage.text_overlay_proof !== "qa/personalized-text-compositor-contract-report.json") {
    throw new Error("backfill should mark personalized hero as local_text_overlay with text proof.");
  }
  if (!["derived_from_approved_generated_asset", "local_text_overlay"].includes(repaired?.lineage?.source_type) || !repaired.lineage.repair_of_progress_ids?.includes("progress-gift-scene.json")) {
    throw new Error("backfill should preserve repaired image progress id lineage.");
  }
  run(process.execPath, ["scripts/final-image-lineage-gate.mjs", "--run-dir", runDir]);
  const lineageGate = readJson(path.join(qaDir, "final-image-lineage-gate-report.json"));
  if (lineageGate.status !== "pass") throw new Error(`backfilled lineage gate should pass, got ${lineageGate.status}`);
});

record("provider telemetry sample guard smoke", () => {
  const root = tmpDir("sp-verify-provider-telemetry-");
  const runA = path.join(root, "run-a");
  const runB = path.join(root, "run-b");
  for (const runDir of [runA, runB]) fs.mkdirSync(path.join(runDir, "telemetry"), { recursive: true });
  fs.writeFileSync(path.join(runA, "telemetry", "phase-trace.json"), JSON.stringify({
    status: "needs_attention",
    run_dir: runA,
    snapshot: { child_progress_files: 1, completed_jobs: 1, failed_jobs: 0, pending_jobs: 0 },
    metrics: { provider_first_byte_ms: { count: 1 } },
    generation_jobs: [{ id: "anchor-01", status: "completed", total_ms: 3000, provider_first_byte_ms: 1000, provider_response_ms: 2500, download_ms: 500 }],
  }, null, 2));
  fs.writeFileSync(path.join(runB, "telemetry", "phase-trace.json"), JSON.stringify({
    status: "needs_attention",
    run_dir: runB,
    snapshot: { child_progress_files: 1, completed_jobs: 0, failed_jobs: 1, pending_jobs: 0 },
    metrics: { provider_first_byte_ms: { count: 0 } },
    generation_jobs: [{ id: "remaining-01", status: "failed", total_ms: 2000 }],
  }, null, 2));
  run(process.execPath, [
    "scripts/provider-telemetry-summary.mjs",
    "--runs-root", root,
    "--out-dir", path.join(root, "summary-default"),
  ]);
  const insufficient = readJson(path.join(root, "summary-default", "provider-telemetry-summary.json"));
  if (insufficient.status !== "insufficient_sample" || insufficient.decision.may_tune_global_timeouts_or_concurrency) {
    throw new Error("provider telemetry summary should block global tuning when sample is insufficient.");
  }
  run(process.execPath, [
    "scripts/provider-telemetry-summary.mjs",
    "--runs-root", root,
    "--min-runs", "1",
    "--min-meaningful-jobs", "1",
    "--out-dir", path.join(root, "summary-ready"),
  ]);
  const ready = readJson(path.join(root, "summary-ready", "provider-telemetry-summary.json"));
  if (ready.status !== "ready" || ready.metrics.provider_first_byte_ms.p50 !== 1000 || !ready.decision.may_tune_global_timeouts_or_concurrency) {
    throw new Error("provider telemetry summary should allow tuning only when sample thresholds are met.");
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
    "--prepare-only",
    "--dry-run",
  ]);
  const parsed = JSON.parse(out);
  if (parsed.status !== "dry_run") throw new Error("shared service dry-run should not start server.");
  if (!parsed.templateSync?.source_hash) throw new Error("shared service should report template source hash.");
  if (!parsed.templateSync?.changed) throw new Error("new shared root should report template sync changed=true.");
  const service = fs.readFileSync(path.join(skillRoot, "scripts", "start-tldraw-shared-service.mjs"), "utf8");
  if (service.includes('spawnSync("npm", ["install"')) {
    throw new Error("runtime canvas startup must not run npm install; installation belongs to prepare-only sync.");
  }
  for (const token of ["--prepare-only", 'spawnSync("npm", ["ci", "--no-audit", "--no-fund"]', "blocked_canvas_dependencies_not_prepared", '"--strictPort"']) {
    if (!service.includes(token)) throw new Error(`shared canvas service missing preparation contract: ${token}`);
  }
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
  if (out.includes(dir) || out.includes(cachePath) || out.includes("skill_root") || out.includes("remote_url")) {
    throw new Error("update checker default output must not expose local paths or diagnostics.");
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
  if (cachedOut.includes(dir) || cachedOut.includes(cachePath) || cachedOut.includes("skill_root") || cachedOut.includes("remote_url")) {
    throw new Error("update checker cached default output must stay path-safe.");
  }
  const diagnosticOut = run(process.execPath, [
    "scripts/check-skill-update.mjs",
    "--skill-root", dir,
    "--cache-file", cachePath,
    "--cache-ttl-hours", "24",
    "--include-diagnostics",
  ]);
  const diagnostic = JSON.parse(diagnosticOut);
  if (diagnostic.diagnostics?.skill_root !== dir || diagnostic.diagnostics?.cache_file !== cachePath) {
    throw new Error("update checker diagnostics mode should expose internal paths only when requested.");
  }
});

record("skill sync release metadata branch smoke", () => {
  const dir = tmpDir("sp-verify-sync-release-");
  const dest = path.join(dir, "installed-skill");
  const syncOut = run(process.execPath, [
    "scripts/sync-to-codex-skill.mjs",
    "--source", skillRoot,
    "--dest", dest,
    "--skill-name", "sellerpilot-product-image-industrial",
    "--remote-branch", "codex/test-branch",
    "--skip-verify",
    "--no-backup",
    "--skip-runtime-prepare",
  ]);
  if (syncOut.includes(dir) || syncOut.includes(dest) || syncOut.includes(skillRoot) || syncOut.includes("source_path") || syncOut.includes("dest_path")) {
    throw new Error("sync script default output must not expose local source, destination, or release paths.");
  }
  const release = readJson(path.join(dest, ".sellerpilot-skill-release.json"));
  if (release.remote_branch !== "codex/test-branch") {
    throw new Error("sync release metadata should preserve the configured remote branch for update checks.");
  }
  if (!release.local_commit || !release.remote_url) {
    throw new Error("sync release metadata should include local commit and remote url.");
  }
  if (fs.existsSync(path.join(dest, "compatibility-aliases"))) {
    throw new Error("main skill sync must exclude migration alias templates so Codex cannot discover nested duplicate skills.");
  }
  const installedCopy = path.join(dir, "installed-copy");
  fs.mkdirSync(installedCopy, { recursive: true });
  fs.copyFileSync(path.join(dest, "SKILL.md"), path.join(installedCopy, "SKILL.md"));
  fs.copyFileSync(path.join(dest, "package.json"), path.join(installedCopy, "package.json"));
  fs.copyFileSync(path.join(dest, ".sellerpilot-skill-release.json"), path.join(installedCopy, ".sellerpilot-skill-release.json"));
  const installedDest = path.join(dir, "installed-copy-sync");
  run(process.execPath, [
    "scripts/sync-to-codex-skill.mjs",
    "--source", installedCopy,
    "--dest", installedDest,
    "--skill-name", "sellerpilot-product-image-industrial",
    "--skip-verify",
    "--no-backup",
    "--skip-runtime-prepare",
  ]);
  const resyncedRelease = readJson(path.join(installedDest, ".sellerpilot-skill-release.json"));
  if (!resyncedRelease.local_commit || !resyncedRelease.remote_url) {
    throw new Error("syncing an installed no-git copy must preserve existing release metadata.");
  }
  const pkg = readJson(path.join(skillRoot, "package.json"));
  const syncThinkAi = pkg.scripts?.["sync:thinkai"] || "";
  if (syncThinkAi.includes("$(")) {
    throw new Error("sync:thinkai must be cross-platform and avoid Bash command substitution.");
  }
  for (const required of ["scripts/sync-compatibility-aliases.mjs"]) {
    if (!syncThinkAi.includes(required)) {
      throw new Error(`sync:thinkai should include ${required}.`);
    }
  }
  if (pkg.scripts?.["paths:codex"] !== "node scripts/codex-path-info.mjs") {
    throw new Error("package.json should expose paths:codex for OS-aware Codex install paths.");
  }
  // Alias directories intentionally have no .git directory. This validates
  // development-clone fallback metadata for lightweight compatibility aliases.
  if (!fs.existsSync(path.join(skillRoot, ".git"))) return;
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
    "--skip-runtime-prepare",
  ]);
  const distLikeRelease = readJson(path.join(distLikeDest, ".sellerpilot-skill-release.json"));
  if (!distLikeRelease.local_commit || distLikeRelease.remote_branch !== "codex/test-branch") {
    throw new Error("sync release metadata should preserve branch and local commit for dist-like sources without .git.");
  }
  const distLikeFallbackDest = path.join(dir, "dist-like-installed-fallback");
  run(process.execPath, [
    "scripts/sync-to-codex-skill.mjs",
    "--source", distLikeSource,
    "--dest", distLikeFallbackDest,
    "--skill-name", "sellerpilot-product-image-industrial-thinkai",
    "--skip-verify",
    "--no-backup",
    "--skip-runtime-prepare",
  ]);
  const fallbackRelease = readJson(path.join(distLikeFallbackDest, ".sellerpilot-skill-release.json"));
  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (!fallbackRelease.local_commit || !fallbackRelease.remote_branch) {
    throw new Error("sync release metadata should infer local commit and branch for dist-like sources from the repo cwd.");
  }
  if (currentBranch !== "HEAD" && fallbackRelease.remote_branch !== currentBranch) {
    throw new Error("dist-like sync without --remote-branch should track the current repo branch.");
  }
});

record("codex path info smoke", () => {
  const out = run(process.execPath, ["scripts/codex-path-info.mjs"]);
  const report = JSON.parse(out);
  if (!report.platform || !report.os_type || !report.codex_home || !report.skills_dir) {
    throw new Error("codex path info should include platform, os type, codex home, and skills dir.");
  }
  if (!report.installed_skills?.sellerpilot_product_image_industrial || Object.keys(report.installed_skills).length !== 1) {
    throw new Error("codex path info should expose only the single user-facing SellerPilot skill.");
  }
  if (!report.image_provider_config?.endsWith(path.join("sellerpilot-product-image-industrial", "image-provider.json"))) {
    throw new Error("codex path info should include the shared image provider config path.");
  }
  const dir = tmpDir("sp-verify-codex-paths-");
  const customOut = run(process.execPath, ["scripts/codex-path-info.mjs", "--codex-home", dir]);
  const custom = JSON.parse(customOut);
  if (custom.codex_home !== path.resolve(dir) || !custom.skills_dir.startsWith(path.resolve(dir))) {
    throw new Error("codex path info should honor --codex-home for custom installs.");
  }
});

record("production update gate contract", () => {
  const skill = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const agents = fs.readFileSync(path.join(skillRoot, "AGENTS.md"), "utf8");
  const readme = fs.readFileSync(path.join(skillRoot, "README.md"), "utf8");
  const generationPolicy = fs.readFileSync(path.join(skillRoot, "references", "gpt-built-in-image-generation-policy.md"), "utf8");
  const reviewCanvas = fs.readFileSync(path.join(skillRoot, "references", "review-canvas.md"), "utf8");
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
  if (!agents.includes("insufficient_sample") || !agents.includes("不得改全局 provider 参数")) {
    throw new Error("AGENTS.md must require provider telemetry sample guard before global tuning.");
  }
  if (!skill.includes("provider-telemetry-summary.mjs") || !readme.includes("npm run telemetry:provider")) {
    throw new Error("SKILL.md/README.md must document provider telemetry summary sample guard.");
  }
  if (!skill.includes("backfill-final-image-lineage.mjs") || !readme.includes("npm run lineage:backfill")) {
    throw new Error("SKILL.md/README.md must document historical final-image lineage backfill.");
  }
  if (!skill.includes("request user authorization") || !skill.includes("Do not say \"sandbox 禁止\"")) {
    throw new Error("SKILL.md must require user authorization prompts for missing permissions without exposing sandbox wording.");
  }
  if (!agents.includes("权限不足") || !agents.includes("必须用用户能理解的能力名请求授权")) {
    throw new Error("AGENTS.md must require user authorization when permissions are insufficient.");
  }
  if (!readme.includes("先用用户能理解的能力名请求授权") || !readme.includes("不要出现 `sandbox`")) {
    throw new Error("README.md must document safe user authorization prompts for permission failures.");
  }
  if (!generationPolicy.includes("ask the user for authorization") || !reviewCanvas.includes("authorize starting a temporary local review service")) {
    throw new Error("Runtime references must require authorization before rerunning permission-blocked steps.");
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
  if (singleQuality.selected_mode !== "single_image_quality_production") {
    throw new Error(`single high-quality image should route to single_image_quality_production, got ${singleQuality.selected_mode}`);
  }
  if (!singleQuality.execution_policy.required_quality_path.includes("single-image-generation")) {
    throw new Error("single quality production should use the single-image path.");
  }
  if (!singleQuality.execution_policy.required_quality_path.includes("post-generation-tldraw-auto-start")) {
    throw new Error("single-image final delivery must auto-start tldraw before handoff.");
  }
  if (singleQuality.execution_policy.required_quality_path.includes("anchor-batch-imagegen") || singleQuality.execution_policy.required_quality_path.includes("overview-contact-sheet")) {
    throw new Error("single quality production should not require anchor batch or delivery overview.");
  }

  const standardSingleDir = path.join(dir, "single-standard");
  run(process.execPath, [
    "scripts/production-mode-router.mjs",
    "--out-dir", standardSingleDir,
    "--user-text", "生成一张商品主图",
    "--image-count", "1",
  ]);
  const standardSingle = readJson(path.join(standardSingleDir, "production-mode-router-report.json"));
  if (standardSingle.selected_mode !== "single_image_quality_production") {
    throw new Error(`normal single final image should not silently route to fast_generation, got ${standardSingle.selected_mode}`);
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
  if (progress.next_action !== "resolve provider-compatible platform ratio, build compact image-set planning, then run anchor batch") {
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
  writeIdentityConsistencyPass(runDir, ["IMG-01-main-product.png", "IMG-02-detail-structure.png"]);
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
  writeIdentityConsistencyPass(singleRunDir, ["IMG-01-main-product.png"]);
  run(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", singleRunDir]);
  const singleFinalGate = readJson(path.join(singleQaDir, "final-delivery-gate-report.json"));
  if (singleFinalGate.status !== "pass") {
    throw new Error("final gate should pass intentional single-image delivery without a delivery overview.");
  }
  if (singleFinalGate.findings.some((item) => item.type === "missing-delivery-overview")) {
    throw new Error("final gate should not require delivery overview for intentional single-image delivery.");
  }
});

record("artifact integrity gate blocks corrupted machine json", () => {
  const runDir = path.join(tmpDir("sp-verify-artifact-integrity-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Etsy",
    "--category", "bridal bag",
    "--run-id", "verify-artifact-integrity",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const dir = process.argv[1];
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff'}}).png().toFile(dir + '/IMG-01-main-product.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee'}}).png().toFile(dir + '/IMG-02-detail-product.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.mkdirSync(path.join(runDir, "generated-assets"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "generated-assets", "generation-progress.json"), JSON.stringify({
    status: "planned",
    completed_images: [],
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "generated-assets", "anchor-batch-qa-decision.json"), [
    "{",
    "  \"status\": \"pass\"",
    "}",
    "*** Begin Patch",
    "anchor-batch-qa-decision.json planned",
    "*** End Patch",
  ].join("\n"));
  spawnSync(process.execPath, ["scripts/production-artifact-integrity-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const report = readJson(path.join(qaDir, "production-artifact-integrity-gate-report.json"));
  if (report.status !== "fail" || !report.findings.some((item) => item.type === "corrupt-anchor-batch-decision-json")) {
    throw new Error("artifact integrity gate should catch corrupted anchor-batch decision JSON.");
  }
  if (!report.findings.some((item) => item.type === "stale-generation-progress-artifact")) {
    throw new Error("artifact integrity gate should catch final images with stale planned progress.");
  }
  run(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", runDir]);
  const decision = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (decision.loop_decision.return_node !== "artifact-integrity-repair") {
    throw new Error(`artifact corruption should route to artifact-integrity-repair, got ${decision.loop_decision.return_node}`);
  }
  if (!decision.loop_decision.do_not_rerun.includes("provider-retry")) {
    throw new Error("artifact corruption route should forbid provider retry.");
  }
});

record("identity consistency gate blocks legacy fallback until per-image review passes", () => {
  const runDir = path.join(tmpDir("sp-verify-identity-consistency-"), "run");
  const imageDir = path.join(runDir, "final-images");
  const qaDir = path.join(runDir, "qa");
  const sourceDir = path.join(runDir, "source-original");
  const blueprintDir = path.join(runDir, "blueprint");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(blueprintDir, { recursive: true });
  run(process.execPath, [
    "scripts/create-run-skeleton.mjs",
    "--out-dir", runDir,
    "--platform", "Etsy",
    "--category", "mother of pearl bamboo handle bridal bag",
    "--run-id", "verify-identity-consistency",
  ]);
  execFileSync(process.execPath, ["-e", `
    const sharp = require(${JSON.stringify(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp"))});
    const [sourceDir, imageDir] = process.argv.slice(1);
    (async () => { await Promise.all([
      sharp({create:{width:1200,height:1200,channels:4,background:'#f7eee4'}}).png().toFile(sourceDir + '/source.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#fff7ef'}}).png().toFile(imageDir + '/IMG-01-bridal-main-cover.png'),
      sharp({create:{width:1200,height:1200,channels:4,background:'#eee5da'}}).png().toFile(imageDir + '/IMG-02-garden-wedding-guest.png')
    ]); })().catch((e)=>{ console.error(e); process.exit(1); });
  `, sourceDir, imageDir], { cwd: skillRoot, stdio: "inherit" });
  fs.writeFileSync(path.join(blueprintDir, "02-identity-lock.yaml"), [
    "identity_lock:",
    "  must_preserve:",
    "    silhouette: half-moon mother-of-pearl bag body",
    "    material_appearance: dense pearlescent shell discs",
    "    strap_or_handle: bamboo segmented top handle",
    "    hardware: small gold-tone end caps",
    "",
  ].join("\n"));
  fs.mkdirSync(path.join(runDir, "export"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "export", "final-image-lineage.json"), JSON.stringify({
    images: [
      { file: "IMG-01-bridal-main-cover.png", source_type: "provider_generated", generated_asset_path: "generated-assets/anchor-01/image.png" },
      { file: "IMG-02-garden-wedding-guest.png", source_type: "legacy_fallback_needs_identity_review", approved_source_path: "generated-assets/legacy-02/image.png", requires_identity_review: true },
    ],
  }, null, 2));
  for (const [file, body] of Object.entries({
    "marketing-quality-gate-report.json": { status: "pass", findings: [] },
    "copy-strategy-gate-report.json": { status: "pass", findings: [] },
    "product-background-card-consistency-gate-report.json": { status: "pass", findings: [] },
  })) {
    fs.writeFileSync(path.join(qaDir, file), JSON.stringify(body, null, 2));
  }
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
  run(process.execPath, [
    "scripts/create-delivery-overview.mjs",
    "--run-dir", runDir,
    "--manifest", path.join(runDir, "export", "final-images-manifest.json"),
    "--out-dir", path.join(runDir, "overview"),
    "--title", "Verify Identity Overview",
  ]);
  spawnSync(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir], { cwd: skillRoot });
  const missingGate = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (!missingGate.findings.some((item) => item.source_report === "identity-consistency-gate-report.json")) {
    throw new Error("final gate should require identity-consistency-gate when identity lock/fallback lineage exists.");
  }
  spawnSync(process.execPath, ["scripts/identity-consistency-gate.mjs", "--run-dir", runDir, "--source", path.join(sourceDir, "source.png")], { cwd: skillRoot });
  const missingReview = readJson(path.join(qaDir, "identity-consistency-gate-report.json"));
  if (missingReview.status !== "fail" || !missingReview.findings.some((item) => item.type === "legacy-fallback-needs-identity-review")) {
    throw new Error("identity consistency gate should block legacy fallback without per-image pass review.");
  }
  fs.writeFileSync(path.join(qaDir, "identity-consistency-visual-review.json"), JSON.stringify({
    status: "pass",
    images: [
      { file: "IMG-01-bridal-main-cover.png", status: "pass", notes: "Matches source silhouette, pearl shell density, bamboo handle, and gold end caps." },
      { file: "IMG-02-garden-wedding-guest.png", status: "pass", notes: "Legacy fallback reviewed against source and accepted for temporary delivery." },
    ],
  }, null, 2));
  run(process.execPath, ["scripts/identity-consistency-gate.mjs", "--run-dir", runDir, "--source", path.join(sourceDir, "source.png")]);
  run(process.execPath, ["scripts/final-delivery-gate.mjs", "--run-dir", runDir]);
  const finalGate = readJson(path.join(qaDir, "final-delivery-gate-report.json"));
  if (finalGate.status !== "pass") {
    throw new Error(`final gate should pass after per-image identity review passes, got ${finalGate.status}`);
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

record("surface material transfer lock, gate, prompt layer, and routing smoke", () => {
  const dir = tmpDir("sp-verify-surface-material-");
  const source = path.join(dir, "nail-source.png");
  fs.writeFileSync(source, "fixture");
  run(process.execPath, [
    "scripts/create-surface-material-lock.mjs", "--run-dir", dir,
    "--category", "press-on nails", "--source-images", source,
  ]);
  const lockPath = path.join(dir, "surface-material", "canonical-material-lock.json");
  const qaDir = path.join(dir, "qa");
  fs.mkdirSync(qaDir, { recursive: true });
  const missing = spawnSync(process.execPath, ["scripts/surface-material-transfer-gate.mjs", "--lock", lockPath, "--out-dir", qaDir], { cwd: skillRoot });
  if (missing.status === 0) throw new Error("surface material gate should block without transfer proof and visual review.");
  const lock = readJson(lockPath);
  const material = lock.per_material[0];
  material.source_gradient_direction = "left_deep_blue_to_right_silver";
  material.shape_class = "short_rounded_nail";
  material.source_contamination_removal = { status: "pass", evidence_ref: "surface-material/mask-material-01.png" };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  const proofPath = path.join(dir, "surface-material", "material-transfer-proof.json");
  fs.writeFileSync(proofPath, JSON.stringify({ transfers: [{ source_material_id: material.id, target_nail_region: "right-index", target_mask_ref: "masks/right-index.png", orientation_mapping: "source left-to-right maps cuticle-to-tip", projection_evidence_ref: "proof/right-index-projection.png" }] }, null, 2));
  const reviewPath = path.join(qaDir, "surface-material-visual-review.json");
  fs.writeFileSync(reviewPath, JSON.stringify({ reviews: [{ source_material_id: material.id, target_image: "final-images/IMG-01-main.png", target_nail_region: "right-index", palette_status: "pass", lightness_status: "pass", color_temperature_status: "pass", gradient_direction_status: "pass", shape_status: "pass", source_contamination_status: "pass", reviewed_by: "codex_visual" }] }, null, 2));
  run(process.execPath, ["scripts/surface-material-transfer-gate.mjs", "--lock", lockPath, "--transfer-proof", proofPath, "--visual-review", reviewPath, "--out-dir", qaDir]);
  if (readJson(path.join(qaDir, "surface-material-transfer-gate-report.json")).status !== "pass") throw new Error("complete surface material evidence should pass.");
  const stackPath = path.join(dir, "nail-stack.json");
  const baseLayers = { execution_contract_layer: { provider: "gpt-image-2", output_filename: "IMG-01.png" }, product_identity_layer: { identity_lock_ref: "identity", must_preserve: ["nail art"] }, fact_boundary_layer: { supported_claims: ["press-on nail"] }, commerce_goal_layer: { buyer_question: "How does it look worn?", image_job: "hand scene" }, context_layer: { platform: "Amazon", category: "press-on nails" }, creative_concept_layer: { visual_concept: "accurate material" }, photography_treatment_layer: { camera_angle: "macro", lighting_direction: "soft" }, layout_copy_layer: { layout_intent: "clean" }, negative_qa_layer: { negative_prompt: ["no gradient reversal"], qa_expectations: { material: "strict" } } };
  fs.writeFileSync(stackPath, JSON.stringify({ prompt_layer_stack: { prompt_layer_architect: { decision_basis: { product_category: "press-on nails" } }, layers: baseLayers, layer_review: { generic_prompt_risk: "low" } } }, null, 2));
  const thinLayer = spawnSync(process.execPath, ["scripts/prompt-layer-gate.mjs", "--stack", stackPath, "--out-dir", qaDir], { cwd: skillRoot });
  if (thinLayer.status === 0) throw new Error("nail prompt should require a surface material transfer layer.");
  for (const name of fs.readdirSync(qaDir)) {
    if (/-report\.json$/.test(name)) fs.unlinkSync(path.join(qaDir, name));
  }
  fs.writeFileSync(path.join(qaDir, "surface-material-transfer-gate-report.json"), JSON.stringify({ status: "fail", findings: [{ severity: "fail", type: "gradient-direction-drift", message: "fixture" }] }, null, 2));
  spawnSync(process.execPath, ["scripts/qa-loop-router.mjs", "--run-dir", dir], { cwd: skillRoot });
  const routed = readJson(path.join(qaDir, "qa-loop-routing-decision.json"));
  if (routed.loop_decision.return_node !== "surface-material-transfer") throw new Error("gradient direction drift should route to surface-material-transfer.");
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
    "scripts/start-tldraw-shared-service.mjs",
    "--shared-root", sharedRoot,
    "--prepare-only",
  ], { maxBuffer: 50 * 1024 * 1024 });
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
