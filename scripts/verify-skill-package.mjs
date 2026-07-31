#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const skillPath = path.join(skillRoot, "SKILL.md");
const metadataPath = path.join(skillRoot, "agents", "openai.yaml");
const skill = fs.readFileSync(skillPath, "utf8");
const metadata = fs.readFileSync(metadataPath, "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter) fail("SKILL.md must begin with closed YAML frontmatter.");

const lines = frontmatter[1].split("\n");
const values = Object.fromEntries(lines.filter((line) => /^[a-z][a-z-]*:\s*/.test(line)).map((line) => {
  const index = line.indexOf(":");
  return [line.slice(0, index), line.slice(index + 1).trim()];
}));
const allowed = new Set(["name", "description"]);
for (const key of Object.keys(values)) if (!allowed.has(key)) fail(`SKILL.md frontmatter has unsupported field: ${key}`);
if (values.name !== "sellerpilot-product-image-industrial") fail("SKILL.md name must be sellerpilot-product-image-industrial.");
if (!values.description || values.description.length > 1024 || /[<>]/.test(values.description)) fail("SKILL.md description is missing or invalid.");
if (!/^interface:\n(?:[ \t]+.*\n)+$/m.test(metadata)) fail("agents/openai.yaml must include an interface block.");
for (const required of [
  'display_name: "SellerPilot Product Image"',
  'short_description: "Generate and review ecommerce product images from simple requests, with industrial workflow, QA gates, and optional tldraw canvas."',
  'default_prompt: "Use $sellerpilot-product-image-industrial',
]) if (!metadata.includes(required)) fail(`agents/openai.yaml is missing expected interface metadata: ${required}`);

console.log(JSON.stringify({ status: "pass", skill: values.name, checks: 7 }, null, 2));

function fail(message) { console.error(message); process.exit(1); }
