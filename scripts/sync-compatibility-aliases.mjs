#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const aliases = ["sellerpilot-product-image-industrial-thinkai", "sellerpilot-product-image-industrial-proxy"];
for (const name of aliases) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "sync-to-codex-skill.mjs"), "--source", path.join(root, "compatibility-aliases", name), "--skill-name", name, "--skip-verify"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to sync ${name}`);
  console.log(result.stdout.trim());
}
