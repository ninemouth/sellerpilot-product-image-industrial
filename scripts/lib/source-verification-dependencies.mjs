import { spawnSync } from "node:child_process";

export const SOURCE_VERIFICATION_MODULES = Object.freeze(["sharp"]);

export function probeSourceVerificationDependencies({
  source,
  modules = SOURCE_VERIFICATION_MODULES,
  execPath = process.execPath,
} = {}) {
  const requested = [...new Set(modules.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!source || !requested.length) return { status: "ready", missing: [] };
  const probe = spawnSync(execPath, [
    "-e",
    "for (const name of process.argv.slice(1)) require(name);",
    ...requested,
  ], {
    cwd: source,
    encoding: "utf8",
    windowsHide: true,
  });
  return probe.status === 0
    ? { status: "ready", missing: [] }
    : { status: "install_required", missing: requested };
}
