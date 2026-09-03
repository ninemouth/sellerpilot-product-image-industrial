import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { probeSourceVerificationDependencies } from "../scripts/lib/source-verification-dependencies.mjs";
import { sourceVerificationInstallArgs } from "../scripts/lib/package-manager.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("fresh GitHub source requires locked verification dependencies", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-source-deps-missing-"));
  const report = probeSourceVerificationDependencies({ source, modules: ["sellerpilot-fixture-module"] });
  assert.deepEqual(report, { status: "install_required", missing: ["sellerpilot-fixture-module"] });
});

test("source dependency probe requires modules to load, not merely exist", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "sellerpilot-source-deps-ready-"));
  const moduleRoot = path.join(source, "node_modules", "sellerpilot-fixture-module");
  await fs.mkdir(moduleRoot, { recursive: true });
  await fs.writeFile(path.join(moduleRoot, "package.json"), JSON.stringify({ name: "sellerpilot-fixture-module", main: "index.js" }));
  await fs.writeFile(path.join(moduleRoot, "index.js"), "module.exports = { ready: true };\n");
  assert.deepEqual(
    probeSourceVerificationDependencies({ source, modules: ["sellerpilot-fixture-module"] }),
    { status: "ready", missing: [] },
  );
  await fs.writeFile(path.join(moduleRoot, "index.js"), "throw new Error('native load failed');\n");
  assert.equal(probeSourceVerificationDependencies({ source, modules: ["sellerpilot-fixture-module"] }).status, "install_required");
});

test("npm source verification install includes optional locked dependencies", () => {
  assert.deepEqual(sourceVerificationInstallArgs("npm"), ["ci", "--include=optional", "--no-audit", "--no-fund"]);
  assert.deepEqual(sourceVerificationInstallArgs("pnpm"), ["install", "--frozen-lockfile"]);
});

test("GitHub updater refuses to change the installation without explicit approval", () => {
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "update-from-github.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).status, "approval_required");
});
