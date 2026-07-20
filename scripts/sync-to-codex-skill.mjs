#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error(`Usage:
node scripts/sync-to-codex-skill.mjs [--source /abs/skill] [--dest /abs/codex/skill] [--remote-branch branch] [--skip-verify] [--no-backup] [--skip-runtime-prepare] [--include-diagnostics]

Runs verification by default, backs up the installed skill, copies this project
to the Codex skill directory, and verifies source/destination content matches.

Default stdout is safe to summarize to a user and omits local source,
destination, backup, and Codex home paths. Use --include-diagnostics only for
internal debugging.`);
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || source,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
    maxBuffer: 50 * 1024 * 1024,
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

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

const args = parseArgs(process.argv);
if (args.help) usage();
const includeDiagnostics = Boolean(args["include-diagnostics"]);

const source = path.resolve(args.source || new URL("..", import.meta.url).pathname);
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const skillName = String(args["skill-name"] || "sellerpilot-product-image-industrial");
const dest = path.resolve(args.dest || path.join(codexHome, "skills", skillName));
const backupRoot = path.resolve(args["backup-root"] || path.join(codexHome, "skill-backups"));
const syncExcludes = new Set([
  ".git",
  "node_modules",
  "runs",
  "outputs",
  "dist",
  "compatibility-aliases",
  ".cache",
  ".DS_Store",
  ".sellerpilot-skill-release.json",
  ".thinkai-image-runtime.json",
]);

if (!fs.existsSync(path.join(source, "SKILL.md"))) {
  throw new Error(`Source does not look like a skill folder: ${source}`);
}

if (!args["skip-verify"]) {
  console.log("Running skill verification...");
  run(process.execPath, [path.join(source, "scripts", "verify-skill.mjs")], { cwd: source, stdio: "inherit" });
}

let backupDir = null;
if (fs.existsSync(dest) && !args["no-backup"]) {
  fs.mkdirSync(backupRoot, { recursive: true });
  backupDir = path.join(backupRoot, `${skillName}-${timestamp()}`);
  console.log(includeDiagnostics ? `Backing up installed skill to ${backupDir}` : "Backing up installed skill.");
  copyTree(dest, backupDir, { deleteExtra: false, excludes: new Set() });
}

fs.mkdirSync(dest, { recursive: true });
console.log(includeDiagnostics ? `Syncing ${source} -> ${dest}` : "Syncing development skill to installed Codex skill.");
copyTree(source, dest, { deleteExtra: true, excludes: syncExcludes });

console.log("Verifying source and installed skill are identical...");
const differences = compareTrees(source, dest, syncExcludes);
if (differences.length) {
  throw new Error(`Installed skill differs from source:\n${differences.slice(0, 40).join("\n")}`);
}

const releaseMetadata = buildReleaseMetadata({ source, dest });
fs.writeFileSync(path.join(dest, ".sellerpilot-skill-release.json"), JSON.stringify(releaseMetadata, null, 2));

const naturalRuntimeRoot = path.join(codexHome, "sellerpilot-product-image-industrial", "natural-image-runtime");
const naturalRuntimeScript = path.join(dest, "scripts", "prepare-natural-image-runtime.mjs");
let naturalRuntimePreparationReport = { status: "not_applicable", ready: false };
if (fs.existsSync(naturalRuntimeScript) && !args["skip-runtime-prepare"]) {
  console.log("Checking and preparing natural image finish dependencies...");
  const preparation = run(process.execPath, [
    naturalRuntimeScript,
    "--prepare",
    "--skill-root", dest,
    "--runtime-root", naturalRuntimeRoot,
  ], { cwd: dest });
  naturalRuntimePreparationReport = parseLastJson(preparation);
  if (!naturalRuntimePreparationReport || !["prepared", "already_prepared"].includes(naturalRuntimePreparationReport.status)) {
    throw new Error("Natural image finish dependency preparation did not complete.");
  }
} else if (args["skip-runtime-prepare"]) {
  naturalRuntimePreparationReport = { status: "skipped", ready: false };
}

const canvasRoot = path.join(codexHome, "sellerpilot-product-image-industrial", "canvas-service");
const canvasScript = path.join(dest, "scripts", "start-tldraw-shared-service.mjs");
let canvasPreparationReport = { status: "not_applicable" };
if (fs.existsSync(canvasScript)) {
  console.log("Preparing shared tldraw canvas dependencies...");
  const canvasPreparation = run(process.execPath, [canvasScript, "--shared-root", canvasRoot, "--prepare-only"], { cwd: dest });
  canvasPreparationReport = parseLastJson(canvasPreparation);
  if (!canvasPreparationReport || !["prepared", "already_prepared"].includes(canvasPreparationReport.status)) {
    throw new Error("Shared tldraw canvas dependency preparation did not complete.");
  }
}

const safeSummary = {
  status: "synced",
  skill_name: skillName,
  release: publicReleaseMetadata(releaseMetadata),
  natural_image_runtime_preparation: publicNaturalRuntimePreparation(naturalRuntimePreparationReport),
  canvas_preparation: publicCanvasPreparation(canvasPreparationReport),
  user_message: "SellerPilot product image skill was verified and synced.",
};
if (includeDiagnostics) {
  safeSummary.diagnostics = {
    source,
    dest,
    backup: backupDir,
    release: releaseMetadata,
    paths: {
      os: process.platform,
      codex_home: codexHome,
      skills_dir: path.join(codexHome, "skills"),
      installed_skill: dest,
      natural_image_runtime: naturalRuntimeRoot,
    },
  };
}
console.log(JSON.stringify(safeSummary, null, 2));

function copyTree(src, target, { deleteExtra, excludes }) {
  fs.mkdirSync(target, { recursive: true });
  const sourceNames = new Set(fs.readdirSync(src).filter((name) => !excludes.has(name)));
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludes.has(entry.name)) continue;
    const sourcePath = path.join(src, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, { deleteExtra, excludes });
    } else if (entry.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(sourcePath);
      fs.rmSync(targetPath, { recursive: true, force: true });
      fs.symlinkSync(linkTarget, targetPath);
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      try {
        fs.chmodSync(targetPath, fs.statSync(sourcePath).mode);
      } catch {}
    }
  }
  if (!deleteExtra) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    // Private runtime config stays local, but alias templates must be removed
    // from an installed main skill so Codex cannot recursively discover them.
    if (excludes.has(entry.name) && entry.name !== "compatibility-aliases") continue;
    if (!sourceNames.has(entry.name)) {
      fs.rmSync(path.join(target, entry.name), { recursive: true, force: true });
    }
  }
}

function compareTrees(left, right, excludes, relative = "") {
  const differences = [];
  const leftEntries = readDirMap(left, excludes);
  const rightEntries = readDirMap(right, excludes);
  const names = new Set([...leftEntries.keys(), ...rightEntries.keys()]);
  for (const name of [...names].sort()) {
    const rel = path.join(relative, name);
    const leftEntry = leftEntries.get(name);
    const rightEntry = rightEntries.get(name);
    if (!leftEntry) {
      differences.push(`Only in installed: ${rel}`);
      continue;
    }
    if (!rightEntry) {
      differences.push(`Only in source: ${rel}`);
      continue;
    }
    const leftPath = path.join(left, name);
    const rightPath = path.join(right, name);
    if (leftEntry.isDirectory() !== rightEntry.isDirectory()) {
      differences.push(`Type differs: ${rel}`);
      continue;
    }
    if (leftEntry.isDirectory()) {
      differences.push(...compareTrees(leftPath, rightPath, excludes, rel));
    } else if (!sameFile(leftPath, rightPath)) {
      differences.push(`File differs: ${rel}`);
    }
  }
  return differences;
}

function readDirMap(dir, excludes) {
  const entries = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!excludes.has(entry.name)) entries.set(entry.name, entry);
  }
  return entries;
}

function sameFile(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (leftStat.size !== rightStat.size) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function buildReleaseMetadata({ source: sourceDir, dest: destDir }) {
  const packageJson = readJson(path.join(sourceDir, "package.json")) || {};
  const existingRelease = readJson(path.join(sourceDir, ".sellerpilot-skill-release.json")) || {};
  const fallbackGitRoot = process.cwd();
  return {
    schema_version: "sellerpilot.skill_release.v1",
    skill_name: skillName,
    package_version: packageJson.version || "",
    source_path: sourceDir,
    dest_path: destDir,
    local_commit: gitValue(sourceDir, ["rev-parse", "HEAD"]) || existingRelease.local_commit || gitValue(fallbackGitRoot, ["rev-parse", "HEAD"]),
    local_branch: gitValue(sourceDir, ["rev-parse", "--abbrev-ref", "HEAD"]) || existingRelease.local_branch || gitValue(fallbackGitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    remote_url: gitValue(sourceDir, ["config", "--get", "remote.origin.url"]) || existingRelease.remote_url || gitValue(fallbackGitRoot, ["config", "--get", "remote.origin.url"]) || normalizeGitUrl(packageJson.repository?.url) || "",
    remote_branch: args["remote-branch"] || existingRelease.remote_branch || detectRemoteBranch(sourceDir) || detectRemoteBranch(fallbackGitRoot) || "main",
    synced_at: new Date().toISOString(),
  };
}

function publicReleaseMetadata(releaseMetadata) {
  return {
    schema_version: releaseMetadata.schema_version,
    package_version: releaseMetadata.package_version,
    local_commit: releaseMetadata.local_commit,
    local_branch: releaseMetadata.local_branch,
    remote_branch: releaseMetadata.remote_branch,
    synced_at: releaseMetadata.synced_at,
  };
}

function publicCanvasPreparation(report) {
  return {
    status: report?.status || "unknown",
    dependency: {
      status: report?.dependency?.status || "",
      lock_hash: report?.dependency?.lock_hash || "",
      would_install: Boolean(report?.dependency?.would_install),
    },
    templateSync: {
      source_hash: report?.templateSync?.source_hash || "",
      previous_hash: report?.templateSync?.previous_hash || null,
      changed: Boolean(report?.templateSync?.changed),
      dry_run: Boolean(report?.templateSync?.dry_run),
    },
  };
}

function publicNaturalRuntimePreparation(report) {
  return {
    status: report?.status || "unknown",
    ready: Boolean(report?.ready),
    dependency: {
      python: report?.dependency?.python || "",
      ffmpeg: report?.dependency?.ffmpeg || "",
      python_packages: report?.dependency?.python_packages || "",
      requirements_sha256: report?.dependency?.requirements_sha256 || "",
      processor_sha256: report?.dependency?.processor_sha256 || "",
    },
    installation: {
      python_packages: report?.installation?.python_packages || "",
      ffmpeg: report?.installation?.ffmpeg || "",
    },
  };
}

function detectRemoteBranch(cwd) {
  const upstream = gitValue(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream) return upstream.replace(/^[^/]+\//, "");
  const branch = gitValue(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : "";
}

function gitValue(cwd, gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function normalizeGitUrl(value) {
  return String(value || "").replace(/^git\+/, "");
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseLastJson(output) {
  const text = String(output || "").trim();
  const start = text.lastIndexOf("\n{");
  try {
    return JSON.parse(start >= 0 ? text.slice(start + 1) : text);
  } catch {
    return null;
  }
}
