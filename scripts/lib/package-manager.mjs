import fs from "node:fs";
import { spawnSync } from "node:child_process";

const SUPPORTED = new Set(["npm", "pnpm"]);

export function resolvePackageManager({ cwd, requested } = {}) {
  const explicit = String(requested || process.env.SELLERPILOT_PACKAGE_MANAGER || "").trim().toLowerCase();
  if (explicit && !SUPPORTED.has(explicit)) {
    return unavailable(`Unsupported package manager ${explicit}. Use npm or pnpm.`);
  }

  const hasNpmLock = fs.existsSync(`${cwd}/package-lock.json`);
  const hasPnpmLock = fs.existsSync(`${cwd}/pnpm-lock.yaml`);
  const available = {
    npm: commandAvailable("npm"),
    pnpm: commandAvailable("pnpm"),
  };
  const selected = explicit || (hasPnpmLock ? "pnpm" : hasNpmLock ? "npm" : available.npm ? "npm" : "pnpm");

  if (!available[selected]) {
    return unavailable(`${selected} is required by this installation but is not available.`, { selected, hasNpmLock, hasPnpmLock, available });
  }
  if (selected === "npm" && hasPnpmLock && !hasNpmLock) {
    return unavailable("This installation has pnpm-lock.yaml but no package-lock.json; use pnpm to preserve the locked dependency graph.", { selected, hasNpmLock, hasPnpmLock, available });
  }
  if (selected === "pnpm" && hasNpmLock && !hasPnpmLock) {
    return unavailable("This installation has package-lock.json but no pnpm-lock.yaml; use npm to preserve the locked dependency graph.", { selected, hasNpmLock, hasPnpmLock, available });
  }

  return {
    status: "ready",
    command: selected,
    lockfile: hasPnpmLock ? "pnpm-lock.yaml" : hasNpmLock ? "package-lock.json" : null,
    selected_by: explicit ? "explicit" : hasPnpmLock || hasNpmLock ? "lockfile" : "available_command",
  };
}

export function scriptArgs(manager, script, extra = []) {
  return ["run", script, ...extra];
}

export function cleanInstallArgs(manager) {
  return manager === "pnpm"
    ? ["install", "--frozen-lockfile"]
    : ["ci", "--no-audit", "--no-fund"];
}

export function sourceVerificationInstallArgs(manager) {
  return manager === "pnpm"
    ? ["install", "--frozen-lockfile"]
    : ["ci", "--include=optional", "--no-audit", "--no-fund"];
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  return result.status === 0;
}

function unavailable(message, details = {}) {
  return { status: "unavailable", message, ...details };
}
