#!/usr/bin/env node
import fs from "node:fs";
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
node scripts/check-skill-update.mjs [--skill-root /abs/skill] [--remote URL] [--branch main] [--cache-ttl-hours 24] [--timeout-ms 1500]

Checks whether the installed SellerPilot skill appears behind its GitHub
remote. The check is cache-first and best-effort; it must never block image
generation or QA when the network is slow/unavailable.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (args.help) usage();

const skillRoot = path.resolve(args["skill-root"] || new URL("..", import.meta.url).pathname);
const cacheFile = path.resolve(args["cache-file"] || path.join(skillRoot, ".cache", "skill-update-status.json"));
const ttlMs = Math.max(0, Number(args["cache-ttl-hours"] ?? 24) * 60 * 60 * 1000);
const timeoutMs = Math.max(250, Number(args["timeout-ms"] ?? 1500));
const release = readJson(path.join(skillRoot, ".sellerpilot-skill-release.json")) || {};
const pkg = readJson(path.join(skillRoot, "package.json")) || {};
const remote = args.remote || release.remote_url || normalizeGitUrl(pkg.repository?.url) || "https://github.com/ninemouth/sellerpilot-product-image-industrial.git";
const branch = args.branch || release.remote_branch || "main";
const cached = readJson(cacheFile);

if (!args.force && cached?.checked_at && ttlMs > 0 && Date.now() - Date.parse(cached.checked_at) < ttlMs) {
  console.log(JSON.stringify({ ...cached, cache_hit: true }, null, 2));
  process.exit(0);
}

const local = getLocalRevision(skillRoot, release, pkg);
const remoteResult = getRemoteRevision({ remote, branch, timeoutMs, override: args["remote-commit"], skip: args["skip-remote"] });
const status = decideStatus(local, remoteResult);
const report = {
  schema_version: "sellerpilot.skill_update_status.v1",
  status,
  needs_update: status === "update_available",
  checked_at: new Date().toISOString(),
  cache_hit: false,
  skill_root: skillRoot,
  local,
  remote: {
    url: remote,
    branch,
    commit: remoteResult.commit,
    status: remoteResult.status,
    error: remoteResult.error || null,
  },
  install_hint: status === "update_available"
    ? "Ask Codex to update the skill from https://github.com/ninemouth/sellerpilot-product-image-industrial, or run the repository sync script from the development copy."
    : "",
  non_blocking_policy: "If this check is unknown, timed out, or cached, continue the image workflow and surface only a concise note.",
};

fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (args["fail-on-update"] && report.needs_update) process.exitCode = 1;

function getLocalRevision(root, releaseMeta, packageJson) {
  const releaseCommit = normalizeCommit(releaseMeta.local_commit || releaseMeta.source_commit || releaseMeta.commit);
  const gitCommit = gitValue(root, ["rev-parse", "HEAD"]);
  const branchName = releaseMeta.local_branch || gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "";
  return {
    commit: releaseCommit || normalizeCommit(gitCommit),
    source: releaseCommit ? "release_metadata" : gitCommit ? "git" : "unknown",
    branch: branchName,
    package_version: packageJson.version || releaseMeta.package_version || "",
    synced_at: releaseMeta.synced_at || "",
  };
}

function getRemoteRevision({ remote: remoteUrl, branch: branchName, timeoutMs: waitMs, override, skip }) {
  if (override) return { status: "ok", commit: normalizeCommit(override), source: "override" };
  if (skip) return { status: "skipped", commit: "", source: "skipped" };
  const result = spawnSync("git", ["ls-remote", remoteUrl, `refs/heads/${branchName}`], {
    encoding: "utf8",
    timeout: waitMs,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    return { status: "unknown", commit: "", error: result.error.message };
  }
  if (result.status !== 0) {
    return { status: "unknown", commit: "", error: (result.stderr || result.stdout || `git ls-remote exited ${result.status}`).trim() };
  }
  const commit = normalizeCommit(result.stdout.split(/\s+/)[0]);
  return commit ? { status: "ok", commit, source: "git ls-remote" } : { status: "unknown", commit: "", error: "No remote head returned." };
}

function decideStatus(local, remoteResult) {
  if (!local.commit) return "unknown_local_revision";
  if (remoteResult.status !== "ok" || !remoteResult.commit) return "unknown_remote_revision";
  if (local.commit === remoteResult.commit) return "current";
  return "update_available";
}

function gitValue(root, gitArgs) {
  if (!fs.existsSync(path.join(root, ".git"))) return "";
  const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", timeout: 1000 });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function normalizeGitUrl(value) {
  return String(value || "").replace(/^git\+/, "");
}

function normalizeCommit(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{7,40}$/i.test(text) ? text : "";
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
