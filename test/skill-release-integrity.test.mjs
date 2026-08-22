import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { skillContentSha256 } from "../scripts/lib/skill-release-integrity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checker = path.join(repositoryRoot, "scripts", "check-skill-update.mjs");

test("content digest is deterministic, includes executable content, and excludes runtime metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-integrity-"));
  await fs.mkdir(path.join(root, "scripts"), { recursive: true });
  await fs.writeFile(path.join(root, "SKILL.md"), "first\n");
  await fs.writeFile(path.join(root, "scripts", "run.mjs"), "console.log('ok')\n", { mode: 0o755 });
  const first = skillContentSha256(root);
  await fs.writeFile(path.join(root, ".sellerpilot-skill-release.json"), "{}\n");
  await fs.mkdir(path.join(root, ".cache"), { recursive: true });
  await fs.writeFile(path.join(root, ".cache", "status.json"), "{}\n");
  assert.equal(skillContentSha256(root), first);
  await fs.writeFile(path.join(root, "SKILL.md"), "second\n");
  assert.notEqual(skillContentSha256(root), first);
});

test("update checker invalidates a current cache when installed bytes drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-update-check-"));
  const cacheFile = path.join(root, ".cache", "status.json");
  const commit = "a".repeat(40);
  await fs.writeFile(path.join(root, "SKILL.md"), "release content\n");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sellerpilot-product-image-industrial", version: "0.1.0" }));
  const contentSha256 = skillContentSha256(root);
  await fs.writeFile(path.join(root, ".sellerpilot-skill-release.json"), JSON.stringify({
    schema_version: "sellerpilot.skill_release.v2",
    local_commit: commit,
    local_branch: "main",
    remote_branch: "main",
    content_sha256: contentSha256,
    source_dirty: false,
  }));

  const current = runChecker(root, cacheFile, commit, 24);
  assert.equal(current.status, "current");
  assert.equal(current.local.integrity_status, "verified");
  assert.equal(current.requires_repair, false);

  await fs.writeFile(path.join(root, "SKILL.md"), "drifted content\n");
  const drifted = runChecker(root, cacheFile, commit, 24);
  assert.equal(drifted.cache_hit, false);
  assert.equal(drifted.status, "installed_content_mismatch");
  assert.equal(drifted.local.integrity_status, "mismatch");
  assert.equal(drifted.needs_update, true);
  assert.equal(drifted.requires_repair, true);
});

test("update checker distinguishes a clean local release ahead of the remote", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-local-ahead-"));
  const cacheFile = path.join(root, ".cache", "status.json");
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "sellerpilot-product-image-industrial", version: "0.1.0" }));
  await fs.writeFile(path.join(root, "SKILL.md"), "remote release\n");
  git(root, ["init"]);
  git(root, ["add", "package.json", "SKILL.md"]);
  git(root, ["-c", "user.name=Release Test", "-c", "user.email=release-test@example.invalid", "commit", "-m", "remote release"]);
  const remoteCommit = git(root, ["rev-parse", "HEAD"]).trim();
  await fs.writeFile(path.join(root, "SKILL.md"), "local reviewed release\n");
  git(root, ["add", "SKILL.md"]);
  git(root, ["-c", "user.name=Release Test", "-c", "user.email=release-test@example.invalid", "commit", "-m", "local release"]);
  const localCommit = git(root, ["rev-parse", "HEAD"]).trim();
  await fs.writeFile(path.join(root, ".sellerpilot-skill-release.json"), JSON.stringify({
    schema_version: "sellerpilot.skill_release.v2",
    source_path: root,
    local_commit: localCommit,
    local_branch: "main",
    remote_branch: "main",
    content_sha256: skillContentSha256(root),
    source_dirty: false,
  }));

  const report = runChecker(root, cacheFile, remoteCommit, 0);
  assert.equal(report.status, "local_ahead_of_remote");
  assert.equal(report.remote.relation, "local_ahead");
  assert.equal(report.needs_update, false);
  assert.equal(report.requires_publish, true);
  assert.equal(report.requires_repair, false);
});

test("source package command checks the installed Skill under CODEX_HOME by default", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-codex-home-"));
  const installedRoot = path.join(codexHome, "skills", "sellerpilot-product-image-industrial");
  await fs.mkdir(installedRoot, { recursive: true });
  await fs.writeFile(path.join(installedRoot, "SKILL.md"), "installed release\n");
  await fs.writeFile(path.join(installedRoot, "package.json"), JSON.stringify({ name: "sellerpilot-product-image-industrial", version: "0.1.0" }));
  const commit = "b".repeat(40);
  await fs.writeFile(path.join(installedRoot, ".sellerpilot-skill-release.json"), JSON.stringify({
    schema_version: "sellerpilot.skill_release.v2",
    local_commit: commit,
    local_branch: "main",
    remote_branch: "main",
    content_sha256: skillContentSha256(installedRoot),
    source_dirty: false,
  }));

  const result = spawnSync(process.execPath, [checker, "--remote-commit", commit, "--cache-ttl-hours", "0"], {
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: codexHome },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "current");
  assert.equal(report.local.integrity_status, "verified");
  assert.equal(report.requires_repair, false);
});

function runChecker(skillRoot, cacheFile, remoteCommit, cacheTtlHours) {
  const result = spawnSync(process.execPath, [checker,
    "--skill-root", skillRoot,
    "--cache-file", cacheFile,
    "--remote-commit", remoteCommit,
    "--cache-ttl-hours", String(cacheTtlHours),
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
