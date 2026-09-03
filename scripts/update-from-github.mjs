#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

function usage() {
  console.error("Usage: node scripts/update-from-github.mjs --confirm-update [--branch main] [--remote URL] [--dest /abs/installed-skill] [--include-diagnostics]");
  process.exit(2);
}

const args = parseArgs(process.argv);
if (args.help) usage();
if (!args["confirm-update"]) {
  console.log(JSON.stringify({
    status: "approval_required",
    user_message: "Ask the user to approve the SellerPilot Skill update before changing the installed version.",
  }, null, 2));
  process.exit(2);
}

const scriptRoot = skillRootFrom(import.meta.url);
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const defaultInstalledRoot = fs.existsSync(path.join(scriptRoot, ".sellerpilot-skill-release.json"))
  ? scriptRoot
  : path.join(codexHome, "skills", "sellerpilot-product-image-industrial");
const installedRoot = path.resolve(args.dest || defaultInstalledRoot);
const installedRelease = readJson(path.join(installedRoot, ".sellerpilot-skill-release.json")) || {};
const installedPackage = readJson(path.join(installedRoot, "package.json")) || {};
const remote = String(args.remote || installedRelease.remote_url || installedPackage.repository?.url || "https://github.com/ninemouth/sellerpilot-product-image-industrial.git").replace(/^git\+/, "");
const branch = String(args.branch || installedRelease.remote_branch || "main");
const includeDiagnostics = Boolean(args["include-diagnostics"]);
let tempRoot = "";
let rollbackRoot = "";
let stage = "update_check";
let rollbackRestored = false;

try {
  if (!fs.existsSync(path.join(installedRoot, "SKILL.md"))) fail("No installed SellerPilot Skill was found to update.");
  const before = runJson(process.execPath, [path.join(installedRoot, "scripts", "check-skill-update.mjs"), "--skill-root", installedRoot, "--cache-ttl-hours", "0"], { timeoutMs: 10_000 });
  if (before.status === "current") {
    console.log(JSON.stringify({ status: "current", changed: false, user_message: "SellerPilot Product Image is already current." }, null, 2));
    process.exit(0);
  }
  const repairableBootstrapStatuses = new Set(["unknown_local_revision", "unknown_local_integrity", "dirty_source_install"]);
  if (before.status !== "update_available" && !repairableBootstrapStatuses.has(before.status)) {
    fail(`Update cannot proceed safely from status ${before.status || "unknown"}; review the revision state first.`);
  }

  stage = "github_source";
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sellerpilot-github-update-"));
  const source = path.join(tempRoot, "source");
  run("git", ["clone", "--depth", "1", "--single-branch", "--branch", branch, remote, source], { timeoutMs: 120_000 });
  const remoteCommit = run("git", ["rev-parse", "HEAD"], { cwd: source, timeoutMs: 10_000 }).trim();

  stage = "verified_sync";
  rollbackRoot = path.join(tempRoot, "installed-rollback");
  fs.cpSync(installedRoot, rollbackRoot, { recursive: true });
  run(process.execPath, [
    path.join(source, "scripts", "sync-to-codex-skill.mjs"),
    "--source", source,
    "--dest", installedRoot,
    "--remote-branch", branch,
    "--no-provider-config-prompt",
  ], { cwd: source, timeoutMs: 45 * 60_000 });

  stage = "installed_readback";
  const after = runJson(process.execPath, [
    path.join(installedRoot, "scripts", "check-skill-update.mjs"),
    "--skill-root", installedRoot,
    "--remote-commit", remoteCommit,
    "--cache-ttl-hours", "0",
  ], { timeoutMs: 10_000 });
  if (after.status !== "current" || after.local?.integrity_status !== "verified") {
    fail("The updated Skill did not pass installed revision and integrity readback.");
  }

  const output = {
    status: repairableBootstrapStatuses.has(before.status) ? "repaired" : "updated",
    changed: true,
    previous_status: before.status,
    installed_status: after.status,
    integrity_status: after.local.integrity_status,
    commit: remoteCommit,
    source_dependencies: "locked_install_verified",
    release_verification: "passed",
    user_message: "SellerPilot Product Image was updated from GitHub, fully verified, and read back successfully.",
  };
  if (includeDiagnostics) output.diagnostics = { branch, remote, installed_root: installedRoot };
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  if (rollbackRoot && fs.existsSync(rollbackRoot) && ["verified_sync", "installed_readback"].includes(stage)) {
    try {
      fs.rmSync(installedRoot, { recursive: true, force: true });
      fs.cpSync(rollbackRoot, installedRoot, { recursive: true });
      rollbackRestored = true;
    } catch {}
  }
  console.error(JSON.stringify({
    status: "update_failed",
    stage,
    installed_change_unverified: ["verified_sync", "installed_readback"].includes(stage) && !rollbackRestored,
    rollback_status: rollbackRestored ? "restored" : "not_required_or_unavailable",
    user_message: stage === "update_check"
      ? "The installed Skill state could not be verified, so no update was attempted."
      : stage === "github_source"
        ? "The verified GitHub source could not be prepared, so the installed Skill was not changed."
        : rollbackRestored
          ? "The update did not complete verification, so the previous installed Skill was restored automatically."
          : "The update did not complete verification; do not use the new installation for production until it is repaired from the preserved backup.",
    ...(includeDiagnostics ? { diagnostics: { error: String(error?.message || error) } } : {}),
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: options.timeoutMs || 30 * 60_000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
}

function runJson(command, commandArgs, options = {}) {
  const output = run(command, commandArgs, options).trim();
  const start = output.lastIndexOf("\n{");
  try { return JSON.parse(start >= 0 ? output.slice(start + 1) : output); }
  catch { throw new Error("Command did not return a readable status report."); }
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function fail(message) { throw new Error(message); }
