#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv);
const skillRoot = path.resolve(args["skill-root"] || new URL("..", import.meta.url).pathname);
const codexHome = path.resolve(args["codex-home"] || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const runtimeRoot = path.resolve(args["runtime-root"] || path.join(codexHome, "sellerpilot-product-image-industrial", "natural-image-runtime"));
const requirements = path.join(skillRoot, "runtime", "natural-image-finish", "requirements.txt");
const processor = path.join(skillRoot, "scripts", "natural-image-finish.py");
const reportPath = path.join(runtimeRoot, "preparation-report.json");
const includeDiagnostics = Boolean(args["include-diagnostics"]);
const dryRun = Boolean(args["dry-run"]);
const checkOnly = Boolean(args.check) && !args.prepare;

if (args.help) usage();
if (!fs.existsSync(requirements)) throw new Error("Natural image finish requirements are missing from the skill.");
if (!fs.existsSync(processor)) throw new Error("Natural image finish processor is missing from the skill.");

const python = findPython();
let ffmpeg = findCommand(process.env.SELLERPILOT_FFMPEG || "ffmpeg");
const requirementsHash = sha256File(requirements);
const processorHash = sha256File(processor);
let installation = { python_packages: "not_needed", ffmpeg: "not_needed" };
let status = "missing_dependencies";
let reason = "";

if (!python) {
  status = "blocked";
  reason = "Python 3.10 or newer is required to prepare the natural image runtime.";
} else if (!ffmpeg && !checkOnly && !dryRun) {
  const result = installFfmpeg();
  installation.ffmpeg = result.status;
  ffmpeg = findCommand(process.env.SELLERPILOT_FFMPEG || "ffmpeg");
  if (!ffmpeg) {
    status = "blocked";
    reason = result.reason || "FFmpeg automatic installation did not complete.";
  }
}

const venvPython = python ? runtimePython(runtimeRoot) : "";
if (!reason && python) {
  if (dryRun) {
    status = ffmpeg ? "would_prepare" : "would_install_dependencies";
  } else if (checkRuntime({ venvPython, ffmpeg, requirementsHash, processorHash })) {
    status = "already_prepared";
  } else if (checkOnly) {
    status = "missing_dependencies";
    reason = ffmpeg
      ? "The prepared Python runtime is missing or stale. Run the skill install/update preparation step."
      : "FFmpeg and the prepared Python runtime are missing. Run the skill install/update preparation step.";
  } else if (ffmpeg) {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    if (!fs.existsSync(venvPython)) {
      run(python.command, [...python.args, "-m", "venv", path.join(runtimeRoot, "venv")]);
    }
    run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", "pip"]);
    run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", requirements]);
    installation.python_packages = "installed";
    const selfCheckReport = selfCheck(venvPython, ffmpeg);
    writeJson(path.join(runtimeRoot, "runtime-marker.json"), {
      schema_version: "sellerpilot.natural_image_runtime_marker.v1",
      prepared_at: new Date().toISOString(),
      requirements_sha256: requirementsHash,
      processor_sha256: processorHash,
      versions: selfCheckReport.versions,
      pipeline_smoke: selfCheckReport.pipeline_smoke,
    });
    status = "prepared";
  }
}

const publicReport = {
  schema_version: "sellerpilot.natural_image_runtime_preparation.v1",
  status,
  ready: ["prepared", "already_prepared"].includes(status),
  dependency: {
    python: python ? "available" : "missing",
    ffmpeg: ffmpeg ? "available" : "missing",
    python_packages: ["prepared", "already_prepared"].includes(status) ? "available" : "missing_or_stale",
    requirements_sha256: requirementsHash,
    processor_sha256: processorHash,
  },
  installation,
  reason: reason || null,
  user_message: ["prepared", "already_prepared"].includes(status)
    ? "Natural image finish dependencies are ready."
    : "Natural image finish dependencies require preparation.",
};

if (!dryRun) {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  writeJson(reportPath, {
    ...publicReport,
    checked_at: new Date().toISOString(),
    diagnostics: {
      skill_root: skillRoot,
      runtime_root: runtimeRoot,
      python: python?.display || null,
      runtime_python: fs.existsSync(venvPython) ? venvPython : null,
      ffmpeg: ffmpeg || null,
    },
  });
}

if (includeDiagnostics) {
  publicReport.diagnostics = {
    skill_root: skillRoot,
    runtime_root: runtimeRoot,
    report_path: reportPath,
    python: python?.display || null,
    runtime_python: fs.existsSync(venvPython) ? venvPython : null,
    ffmpeg: ffmpeg || null,
  };
}

console.log(JSON.stringify(publicReport, null, 2));
if (["blocked", "missing_dependencies"].includes(status)) process.exitCode = 1;

function checkRuntime({ venvPython: executable, ffmpeg: ffmpegPath, requirementsHash: expectedHash, processorHash: expectedProcessorHash }) {
  if (!executable || !fs.existsSync(executable) || !ffmpegPath) return false;
  const marker = readJson(path.join(runtimeRoot, "runtime-marker.json"));
  if (marker?.requirements_sha256 !== expectedHash) return false;
  if (marker?.processor_sha256 !== expectedProcessorHash) return false;
  try {
    selfCheck(executable, ffmpegPath);
    return true;
  } catch {
    return false;
  }
}

function selfCheck(executable, ffmpegPath) {
  const result = run(executable, [processor, "--self-check", "--ffmpeg", ffmpegPath]);
  const parsed = JSON.parse(result.trim());
  if (parsed.status !== "ready") throw new Error("Natural image finish self-check did not report ready.");
  if (parsed.pipeline_smoke?.status !== "pass") throw new Error("Natural image finish pipeline smoke did not pass.");
  return parsed;
}

function findPython() {
  const candidates = [];
  if (process.env.SELLERPILOT_PYTHON) candidates.push({ command: process.env.SELLERPILOT_PYTHON, args: [] });
  if (process.platform === "win32") candidates.push({ command: "py", args: ["-3"] }, { command: "python", args: [] });
  else candidates.push({ command: "python3", args: [] }, { command: "python", args: [] });
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf8" });
    if (result.status !== 0) continue;
    const [major, minor] = result.stdout.trim().split(/\s+/).map(Number);
    if (major === 3 && minor >= 10) return { ...candidate, display: [candidate.command, ...candidate.args].join(" ") };
  }
  return null;
}

function installFfmpeg() {
  const attempts = process.platform === "darwin"
    ? [["brew", ["install", "ffmpeg"]]]
    : process.platform === "win32"
      ? [
          ["winget", ["install", "--id", "Gyan.FFmpeg", "--exact", "--accept-package-agreements", "--accept-source-agreements"]],
          ["choco", ["install", "ffmpeg", "-y"]],
          ["scoop", ["install", "ffmpeg"]],
        ]
      : linuxInstallAttempts();
  for (const [command, commandArgs] of attempts) {
    if (!findCommand(command)) continue;
    const result = spawnSync(command, commandArgs, { encoding: "utf8", stdio: "pipe", maxBuffer: 20 * 1024 * 1024 });
    if (result.status === 0) return { status: "installed", command };
  }
  return { status: "failed", reason: "No supported package manager could install FFmpeg automatically." };
}

function linuxInstallAttempts() {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return [
      ["apt-get", ["install", "-y", "ffmpeg"]],
      ["dnf", ["install", "-y", "ffmpeg"]],
      ["yum", ["install", "-y", "ffmpeg"]],
      ["pacman", ["-Sy", "--noconfirm", "ffmpeg"]],
    ];
  }
  return [
    ["sudo", ["-n", "apt-get", "install", "-y", "ffmpeg"]],
    ["sudo", ["-n", "dnf", "install", "-y", "ffmpeg"]],
    ["sudo", ["-n", "yum", "install", "-y", "ffmpeg"]],
    ["sudo", ["-n", "pacman", "-Sy", "--noconfirm", "ffmpeg"]],
  ];
}

function runtimePython(root) {
  return process.platform === "win32"
    ? path.join(root, "venv", "Scripts", "python.exe")
    : path.join(root, "venv", "bin", "python");
}

function findCommand(command) {
  if (!command) return "";
  if ((path.isAbsolute(command) || command.includes(path.sep)) && fs.existsSync(command)) return path.resolve(command);
  const directories = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: skillRoot, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} failed while preparing the natural image runtime.`);
  }
  return result.stdout;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; i += 1; }
  }
  return result;
}

function usage() {
  console.error("Usage: node scripts/prepare-natural-image-runtime.mjs [--prepare|--check] [--dry-run] [--runtime-root /abs/runtime] [--include-diagnostics]");
  process.exit(2);
}
