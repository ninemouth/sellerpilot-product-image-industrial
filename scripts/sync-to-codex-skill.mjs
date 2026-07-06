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
node scripts/sync-to-codex-skill.mjs [--source /abs/skill] [--dest /abs/codex/skill] [--skip-verify] [--no-backup]

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
const dest = path.resolve(args.dest || path.join(codexHome, "skills", "sellerpilot-product-image-industrial"));
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
  backupDir = path.join(backupRoot, `sellerpilot-product-image-industrial-${timestamp()}`);
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
  "--exclude", ".DS_Store",
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
  "--exclude", ".DS_Store",
  source,
  dest,
], { cwd: source, stdio: "inherit" });

console.log(JSON.stringify({
  status: "synced",
  source,
  dest,
  backup: backupDir,
}, null, 2));
