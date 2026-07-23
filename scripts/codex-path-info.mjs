#!/usr/bin/env node
import os from "node:os";
import path from "node:path";

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

const args = parseArgs(process.argv);
const codexHome = path.resolve(args["codex-home"] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const skillsDir = path.join(codexHome, "skills");
const baseSkill = path.join(skillsDir, "sellerpilot-product-image-industrial");
const providerConfig = path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json");
const report = {
  schema_version: "sellerpilot.codex_path_info.v1",
  platform: process.platform,
  os_type: os.type(),
  homedir: os.homedir(),
  codex_home: codexHome,
  skills_dir: skillsDir,
  installed_skills: {
    sellerpilot_product_image_industrial: baseSkill,
  },
  image_provider_config: providerConfig,
  shell_examples: shellExamples({ codexHome, skillsDir, baseSkill }),
};

console.log(JSON.stringify(report, null, 2));

function shellExamples(paths) {
  if (process.platform === "win32") {
    return {
      powershell_codex_home: `$env:CODEX_HOME="${paths.codexHome}"`,
      powershell_open_skills_dir: `explorer "${paths.skillsDir}"`,
      powershell_configure_image_provider: `cd "${paths.baseSkill}"; npm run configure:image-provider -- --api-key "<YOUR_THINKAI_IMAGE_API_KEY>"`,
    };
  }
  return {
    sh_codex_home: `export CODEX_HOME="${paths.codexHome}"`,
    sh_open_skills_dir: `open "${paths.skillsDir}" || xdg-open "${paths.skillsDir}"`,
    sh_configure_image_provider: `cd "${paths.baseSkill}" && npm run configure:image-provider -- --api-key "<YOUR_THINKAI_IMAGE_API_KEY>"`,
  };
}
