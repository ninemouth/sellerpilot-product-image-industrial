import fs from "node:fs";
import path from "node:path";

export const TLDRAW_TEMPLATE_FILES = [
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.js",
  "src",
];

export function copyTldrawAppTemplate(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  const copied = [];
  for (const name of TLDRAW_TEMPLATE_FILES) {
    const source = path.join(sourceDir, name);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(destinationDir, name);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      fs.rmSync(destination, { recursive: true, force: true });
      fs.cpSync(source, destination, { recursive: true, filter: (file) => !file.split(path.sep).includes("node_modules") });
    } else {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
    copied.push(name);
  }
  return copied;
}

export function linkOrCopyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    const sourceStat = fs.statSync(source);
    const destinationStat = fs.statSync(destination);
    if (sourceStat.size === destinationStat.size && sourceStat.mtimeMs === destinationStat.mtimeMs) return "reused";
    fs.rmSync(destination, { force: true });
  }
  try {
    fs.linkSync(source, destination);
    return "hardlink";
  } catch {
    fs.copyFileSync(source, destination);
    return "copy";
  }
}
