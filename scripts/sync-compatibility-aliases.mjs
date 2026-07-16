#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
const aliases = ["sellerpilot-product-image-industrial-thinkai", "sellerpilot-product-image-industrial-proxy"].filter((name) => !only || name === only);
for (const name of aliases) {
  const template = path.join(root, "compatibility-aliases", `${name}.md`);
  if (!fs.existsSync(template)) throw new Error(`Missing alias template: ${template}`);
  const source = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  fs.copyFileSync(template, path.join(source, "SKILL.md"));
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "sync-to-codex-skill.mjs"), "--source", source, "--skill-name", name, "--skip-verify"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to sync ${name}`);
  console.log(result.stdout.trim());
}
