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

Runs verification by default, backs up the installed skill, rsyncs this project
to the Codex skill directory, and verifies the source/destination diff is clean.`);
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
  run("rsync", ["-a", `${dest}/`, `${backupDir}/`], { cwd: source, stdio: "inherit" });
}

fs.mkdirSync(dest, { recursive: true });
console.log(`Syncing ${source} -> ${dest}`);
run("rsync", [
  "-a",
  "--delete",
  "--exclude", ".git/",
  "--exclude", "node_modules/",
  "--exclude", "runs/",
  "--exclude", "outputs/",
  "--exclude", "dist/",
  "--exclude", ".DS_Store",
  "--exclude", ".thinkai-image-runtime.json",
  `${source}/`,
  `${dest}/`,
], { cwd: source, stdio: "inherit" });

console.log("Verifying source and installed skill are identical...");
run("diff", [
  "-qr",
  "--exclude", ".git",
  "--exclude", "node_modules",
  "--exclude", "runs",
  "--exclude", "outputs",
  "--exclude", "dist",
  "--exclude", ".cache",
  "--exclude", ".sellerpilot-skill-release.json",
  "--exclude", ".thinkai-image-runtime.json",
  "--exclude", ".DS_Store",
  source,
  dest,
], { cwd: source, stdio: "inherit" });

const releaseMetadata = buildReleaseMetadata({ source, dest });
fs.writeFileSync(path.join(dest, ".sellerpilot-skill-release.json"), JSON.stringify(releaseMetadata, null, 2));

console.log(JSON.stringify({
  status: "synced",
  source,
  dest,
  backup: backupDir,
  release: releaseMetadata,
}, null, 2));

function buildReleaseMetadata({ source: sourceDir, dest: destDir }) {
  const packageJson = readJson(path.join(sourceDir, "package.json")) || {};
  return {
    schema_version: "sellerpilot.skill_release.v1",
    skill_name: skillName,
    package_version: packageJson.version || "",
    source_path: sourceDir,
    dest_path: destDir,
    local_commit: gitValue(sourceDir, ["rev-parse", "HEAD"]),
    local_branch: gitValue(sourceDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    remote_url: gitValue(sourceDir, ["config", "--get", "remote.origin.url"]) || normalizeGitUrl(packageJson.repository?.url) || "",
    remote_branch: args["remote-branch"] || detectRemoteBranch(sourceDir) || "main",
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
