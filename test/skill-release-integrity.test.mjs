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
