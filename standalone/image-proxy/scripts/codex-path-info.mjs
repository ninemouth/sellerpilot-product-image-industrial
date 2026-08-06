#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

const args = parseArgs(process.argv);
const codexHome = path.resolve(args["codex-home"] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const skillName = "image-proxy";
const skillsDir = path.join(codexHome, "skills");
const configDir = path.join(codexHome, skillName);
const report = {
  schema_version: "codex.third_party_image_proxy_path_info.v1",
  platform: process.platform,
  os_type: os.type(),
  codex_home: codexHome,
  skills_dir: skillsDir,
  installed_skill: path.join(skillsDir, skillName),
  provider_config: path.join(configDir, "image-provider.json"),
  shell_examples: process.platform === "win32"
    ? {
        powershell_open_skill: `Set-Location "${path.join(skillsDir, skillName)}"`,
        powershell_configure: `node scripts/configure-image-provider-interactive.mjs`,
      }
    : {
        sh_open_skill: `cd "${path.join(skillsDir, skillName)}"`,
        sh_configure: `node scripts/configure-image-provider-interactive.mjs`,
      },
};
console.log(JSON.stringify(report, null, 2));

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}
