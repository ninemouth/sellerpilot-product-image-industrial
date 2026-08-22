#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { skillRootFrom } from "./lib/skill-paths.mjs";
import { normalizeSha256, skillContentSha256 } from "./lib/skill-release-integrity.mjs";

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
node scripts/check-skill-update.mjs [--skill-root /abs/skill] [--remote URL] [--branch main] [--cache-ttl-hours 24] [--timeout-ms 1500] [--include-diagnostics]

Checks whether the installed SellerPilot skill appears behind its GitHub
remote. The check is cache-first and best-effort; it must never block image
generation or QA when the network is slow/unavailable.

Default stdout is safe to summarize to a user and omits local paths, cache
locations, raw remote errors, and install/source directories. Use
--include-diagnostics only for internal debugging.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (args.help) usage();

const skillRoot = path.resolve(args["skill-root"] || resolveDefaultSkillRoot());
const cacheFile = path.resolve(args["cache-file"] || path.join(skillRoot, ".cache", "skill-update-status.json"));
const ttlMs = Math.max(0, Number(args["cache-ttl-hours"] ?? 24) * 60 * 60 * 1000);
const timeoutMs = Math.max(250, Number(args["timeout-ms"] ?? 1500));
const release = readJson(path.join(skillRoot, ".sellerpilot-skill-release.json")) || {};
const pkg = readJson(path.join(skillRoot, "package.json")) || {};
const remote = args.remote || release.remote_url || normalizeGitUrl(pkg.repository?.url) || "https://github.com/ninemouth/sellerpilot-product-image-industrial.git";
const branch = args.branch || release.remote_branch || "main";
const includeDiagnostics = Boolean(args["include-diagnostics"]);
const local = getLocalRevision(skillRoot, release, pkg);
const cached = readJson(cacheFile);

if (!args.force
  && local.integrity_status === "verified"
  && cached?.checked_at
  && cached.local?.content_sha256 === local.content_sha256
  && ttlMs > 0
  && Date.now() - Date.parse(cached.checked_at) < ttlMs) {
  const output = makeOutputReport({ report: cached, cacheHit: true, includeDiagnostics });
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

const remoteResult = getRemoteRevision({ remote, branch, timeoutMs, override: args["remote-commit"], skip: args["skip-remote"] });
const revisionRelation = getRevisionRelation({ skillRoot, sourcePath: release.source_path, localCommit: local.commit, remoteCommit: remoteResult.commit });
const status = decideStatus(local, remoteResult, revisionRelation);
const requiresRepair = ["installed_content_mismatch", "unknown_local_integrity", "dirty_source_install", "divergent_revision"].includes(status);
const requiresPublish = status === "local_ahead_of_remote";
const report = {
  schema_version: "sellerpilot.skill_update_status.v2",
  status,
  needs_update: ["update_available", "revision_mismatch"].includes(status) || requiresRepair,
  requires_repair: requiresRepair,
  requires_publish: requiresPublish,
  checked_at: new Date().toISOString(),
  cache_hit: false,
  local: publicLocal(local),
  remote: {
    branch,
    commit: remoteResult.commit,
    status: remoteResult.status,
    relation: revisionRelation,
    error_summary: publicRemoteErrorSummary(remoteResult),
  },
  user_message: userMessage(status),
  install_hint: status === "update_available"
    ? "Ask whether to update the SellerPilot product image skill before starting production."
    : status === "revision_mismatch" ? "Review local and remote revisions before changing or using the installation for production."
    : requiresPublish ? "Push and review the clean local release commit before claiming the remote distribution is current."
    : requiresRepair ? "Repair the installed Skill from a clean reviewed source commit before production." : "",
  non_blocking_policy: requiresRepair
    ? "Installed-content integrity failures block production. Remote-only unknown/timeout states remain non-blocking but cannot be reported as current."
    : "If only the remote check is unknown or timed out, continue the image workflow and surface a concise note without claiming the Skill is current.",
  diagnostics: {
    skill_root: skillRoot,
    cache_file: cacheFile,
    remote_url: remote,
    local,
    remote: {
      url: remote,
      branch,
      commit: remoteResult.commit,
      status: remoteResult.status,
      relation: revisionRelation,
      source: remoteResult.source || "",
      error: remoteResult.error || null,
    },
  },
};

fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(makeOutputReport({ report, cacheHit: false, includeDiagnostics }), null, 2));
if (args["fail-on-update"] && (report.needs_update || report.requires_repair)) process.exitCode = 1;

function resolveDefaultSkillRoot() {
  const scriptRoot = skillRootFrom(import.meta.url);
  if (fs.existsSync(path.join(scriptRoot, ".sellerpilot-skill-release.json"))) return scriptRoot;
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const installedRoot = path.join(codexHome, "skills", "sellerpilot-product-image-industrial");
  if (fs.existsSync(path.join(installedRoot, "SKILL.md"))) return installedRoot;
  return scriptRoot;
}

function getLocalRevision(root, releaseMeta, packageJson) {
  const releaseCommit = normalizeCommit(releaseMeta.local_commit || releaseMeta.source_commit || releaseMeta.commit);
  const gitCommit = gitValue(root, ["rev-parse", "HEAD"]);
  const branchName = releaseMeta.local_branch || gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "";
  const expectedContentSha256 = normalizeSha256(releaseMeta.content_sha256);
  const contentSha256 = skillContentSha256(root);
  const integrityStatus = !expectedContentSha256
    ? "unknown"
    : expectedContentSha256 === contentSha256 ? "verified" : "mismatch";
  return {
    commit: releaseCommit || normalizeCommit(gitCommit),
    source: releaseCommit ? "release_metadata" : gitCommit ? "git" : "unknown",
    branch: branchName,
    package_version: packageJson.version || releaseMeta.package_version || "",
    synced_at: releaseMeta.synced_at || "",
    content_sha256: contentSha256,
    expected_content_sha256: expectedContentSha256,
    integrity_status: integrityStatus,
    source_dirty: releaseMeta.source_dirty === true,
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

function decideStatus(local, remoteResult, revisionRelation) {
  if (!local.commit) return "unknown_local_revision";
  if (local.source_dirty) return "dirty_source_install";
  if (local.integrity_status === "mismatch") return "installed_content_mismatch";
  if (local.integrity_status !== "verified") return "unknown_local_integrity";
  if (remoteResult.status !== "ok" || !remoteResult.commit) return "unknown_remote_revision";
  if (local.commit === remoteResult.commit) return "current";
  if (revisionRelation === "remote_ahead") return "update_available";
  if (revisionRelation === "local_ahead") return "local_ahead_of_remote";
  if (revisionRelation === "divergent") return "divergent_revision";
  return "revision_mismatch";
}

function getRevisionRelation({ skillRoot: installedRoot, sourcePath, localCommit, remoteCommit }) {
  if (!localCommit || !remoteCommit) return "unknown";
  if (localCommit === remoteCommit) return "equal";
  const candidates = [installedRoot, sourcePath].filter(Boolean);
  for (const candidate of candidates) {
    if (!fs.existsSync(path.join(candidate, ".git"))) continue;
    if (!gitObjectExists(candidate, localCommit) || !gitObjectExists(candidate, remoteCommit)) continue;
    if (isAncestor(candidate, localCommit, remoteCommit)) return "remote_ahead";
    if (isAncestor(candidate, remoteCommit, localCommit)) return "local_ahead";
    return "divergent";
  }
  return "unknown";
}

function makeOutputReport({ report, cacheHit, includeDiagnostics: withDiagnostics }) {
  const safe = {
    schema_version: report.schema_version || "sellerpilot.skill_update_status.v2",
    status: report.status || "unknown_remote_revision",
    needs_update: Boolean(report.needs_update),
    requires_repair: Boolean(report.requires_repair),
    requires_publish: Boolean(report.requires_publish),
    checked_at: report.checked_at || "",
    cache_hit: Boolean(cacheHit),
    local: publicLocal(report.local || report.diagnostics?.local || {}),
    remote: publicRemote(report.remote || report.diagnostics?.remote || {}),
    user_message: report.user_message || userMessage(report.status),
    install_hint: report.install_hint || "",
    non_blocking_policy: report.non_blocking_policy || "Remote-only unknown/timeout states are non-blocking, but installed-content integrity failures block production.",
  };
  if (!withDiagnostics) return safe;
  return {
    ...safe,
    diagnostics: report.diagnostics || {
      skill_root: report.skill_root || "",
      cache_file: cacheFile,
      remote_url: report.remote?.url || remote,
      local: report.local || {},
      remote: report.remote || {},
    },
  };
}

function publicLocal(local) {
  return {
    commit: normalizeCommit(local.commit),
    source: safeToken(local.source),
    branch: safeToken(local.branch),
    package_version: safeToken(local.package_version),
    synced_at: safeToken(local.synced_at),
    content_sha256: normalizeSha256(local.content_sha256),
    expected_content_sha256: normalizeSha256(local.expected_content_sha256),
    integrity_status: safeToken(local.integrity_status),
    source_dirty: local.source_dirty === true,
  };
}

function publicRemote(remoteReport) {
  return {
    branch: safeToken(remoteReport.branch || branch),
    commit: normalizeCommit(remoteReport.commit),
    status: safeToken(remoteReport.status),
    relation: safeToken(remoteReport.relation),
    error_summary: publicRemoteErrorSummary(remoteReport),
  };
}

function publicRemoteErrorSummary(remoteReport) {
  if (!remoteReport?.error) return null;
  if (String(remoteReport.error).toLowerCase().includes("timed out")) return "remote_check_timeout";
  return "remote_check_unavailable";
}

function userMessage(status) {
  if (status === "current") return "Installed SellerPilot product image skill is current.";
  if (status === "update_available") return "A newer SellerPilot product image skill version is available; ask the user whether to update before production.";
  if (status === "local_ahead_of_remote") return "Installed SellerPilot Skill matches a clean local release that has not yet reached the configured remote branch.";
  if (status === "divergent_revision") return "Installed and remote SellerPilot revisions have diverged; reconcile and review them before production.";
  if (status === "revision_mismatch") return "Installed and remote SellerPilot revisions differ, but their ancestry could not be proven; review before changing the installation.";
  if (status === "installed_content_mismatch") return "Installed SellerPilot Skill content does not match its release metadata; repair the installation before production.";
  if (status === "unknown_local_integrity") return "Installed SellerPilot Skill integrity cannot be verified because its release metadata has no content digest; repair or resync before production.";
  if (status === "dirty_source_install") return "Installed SellerPilot Skill was synced from a dirty source tree; replace it with a clean reviewed release before production.";
  if (status === "unknown_local_revision") return "Skill version freshness could not be confirmed because the local revision is unknown.";
  if (status === "unknown_remote_revision") return "Skill version freshness could not be confirmed because the remote revision was unavailable.";
  return "Skill update status is unknown.";
}

function safeToken(value) {
  const text = String(value || "").trim();
  return text.includes("/") || text.includes("\\") ? "" : text;
}

function gitValue(root, gitArgs) {
  if (!fs.existsSync(path.join(root, ".git"))) return "";
  const result = spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", timeout: 1000 });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function gitObjectExists(root, commit) {
  const result = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: root, encoding: "utf8", timeout: 1000 });
  return result.status === 0;
}

function isAncestor(root, ancestor, descendant) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, encoding: "utf8", timeout: 1000 });
  return result.status === 0;
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
