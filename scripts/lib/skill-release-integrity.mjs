import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SKILL_SYNC_EXCLUDES = new Set([
  ".git",
  "node_modules",
  "runs",
  "outputs",
  "work",
  "dist",
  "compatibility-aliases",
  ".cache",
  ".DS_Store",
  ".sellerpilot-skill-release.json",
  ".thinkai-image-runtime.json",
]);

export function skillContentSha256(root, excludes = SKILL_SYNC_EXCLUDES) {
  const hash = crypto.createHash("sha256");
  visit(path.resolve(root), "");
  return hash.digest("hex");

  function visit(directory, relativeDirectory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !excludes.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name);
      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        visit(absolutePath, path.join(relativeDirectory, entry.name));
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${fs.readlinkSync(absolutePath)}\0`);
      } else if (entry.isFile()) {
        const mode = fs.statSync(absolutePath).mode & 0o777;
        hash.update(`file\0${relativePath}\0${mode.toString(8)}\0`);
        hash.update(fs.readFileSync(absolutePath));
        hash.update("\0");
      }
    }
  }
}

export function normalizeSha256(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(text) ? text : "";
}
