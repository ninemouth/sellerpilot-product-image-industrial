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
node scripts/sync-to-codex-skill.mjs [--source /abs/skill] [--dest /abs/codex/skill] [--remote-branch branch] [--skip-verify] [--no-backup]

Runs verification by default, backs up the installed skill, copies this project
to the Codex skill directory, and verifies source/destination content matches.`);
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
  console.log(`Backing up installed skill to ${backupDir}`);
  copyTree(dest, backupDir, { deleteExtra: false, excludes: new Set() });
}

fs.mkdirSync(dest, { recursive: true });
console.log(`Syncing ${source} -> ${dest}`);
copyTree(source, dest, { deleteExtra: true, excludes: syncExcludes });

console.log("Verifying source and installed skill are identical...");
const differences = compareTrees(source, dest, syncExcludes);
if (differences.length) {
  throw new Error(`Installed skill differs from source:\n${differences.slice(0, 40).join("\n")}`);
}

const releaseMetadata = buildReleaseMetadata({ source, dest });
fs.writeFileSync(path.join(dest, ".sellerpilot-skill-release.json"), JSON.stringify(releaseMetadata, null, 2));

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

console.log(JSON.stringify({
  status: "synced",
  source,
  dest,
  backup: backupDir,
  release: releaseMetadata,
  canvas_preparation: canvasPreparationReport,
  paths: {
    os: process.platform,
    codex_home: codexHome,
    skills_dir: path.join(codexHome, "skills"),
    installed_skill: dest,
  },
}, null, 2));

function copyTree(src, target, { deleteExtra, excludes }) {
  fs.mkdirSync(target, { recursive: true });
  const sourceNames = new Set(fs.readdirSync(src));
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
    if (excludes.has(entry.name)) continue;
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
