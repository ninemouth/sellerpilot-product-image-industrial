#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function usage() {
  console.error(`Usage:
node scripts/post-generation-tldraw-launcher.mjs --run-dir /abs/run [--manifest /abs/run/export/final-images-manifest.json] [--session-id run-id] [--title "..."] [--no-auto-start]

Creates the run-scoped tldraw review workspace from the current final-images
manifest and starts/reuses the shared tldraw service by default. Use after
final images are exported and the delivery overview has been created, before
final user handoff.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args["run-dir"]) usage();

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const runDir = path.resolve(args["run-dir"]);
const manifest = path.resolve(args.manifest || path.join(runDir, "export", "final-images-manifest.json"));
const outDir = path.resolve(args["out-dir"] || path.join(runDir, "review-workspace"));
const qaDir = path.join(runDir, "qa");
const sessionId = safeSessionId(args["session-id"] || readRunId(runDir) || path.basename(runDir));
const title = args.title || "商品图审核工作台";

fs.mkdirSync(qaDir, { recursive: true });
if (!fs.existsSync(manifest)) {
  const report = writeReport({
    status: "blocked_missing_manifest",
    runDir,
    outDir,
    sessionId,
    manifest,
    url: null,
    message: "Cannot auto-start tldraw after generation because export/final-images-manifest.json is missing.",
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  const argv = [
    path.join(skillRoot, "scripts", "create-tldraw-review-workspace.mjs"),
    "--out-dir", outDir,
    "--manifest", manifest,
    "--run-dir", runDir,
    "--title", title,
    "--session-id", sessionId,
  ];
  if (args["shared-root"]) argv.push("--shared-root", args["shared-root"]);
  if (args["wait-ms"]) argv.push("--wait-ms", String(args["wait-ms"]));
  if (args["no-install"]) argv.push("--no-install");
  if (args["no-auto-start"]) argv.push("--no-auto-start");

  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });
  const parsed = parseLastJson(result.stdout);
  const autoStart = !args["no-auto-start"];
  const ready = autoStart
    ? parsed?.status === "created_and_started" && parsed?.autoStartResult?.status === "ready" && parsed?.url
    : parsed?.status === "created";
  const status = ready
    ? autoStart ? "ready" : "created_no_auto_start"
    : "blocked_canvas_auto_start";
  const report = writeReport({
    status,
    runDir,
    outDir,
    sessionId,
    manifest,
    url: parsed?.url || null,
    autoStart,
    workspace_result: parsed,
    message: ready
      ? autoStart ? "Post-generation tldraw workspace is ready." : "Post-generation tldraw workspace files were created without auto-start."
      : "Post-generation tldraw workspace could not be started. Keep the workspace files and report the blocked reason.",
    error: result.status === 0 ? null : (result.stderr || result.stdout || `create-tldraw-review-workspace exited ${result.status}`),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!ready) process.exitCode = 1;
}

function writeReport(report) {
  const full = {
    schema_version: "sellerpilot.post_generation_tldraw_launch.v1",
    checked_at: new Date().toISOString(),
    ...report,
  };
  fs.mkdirSync(path.join(outDir, "data"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "data", "post-generation-tldraw-launch-report.json"), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(qaDir, "post-generation-tldraw-launch-report.json"), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(qaDir, "post-generation-tldraw-launch-report.md"), toMarkdown(full));
  return full;
}

function toMarkdown(report) {
  return [
    "# Post-Generation tldraw Launch Report",
    "",
    `- Status: ${report.status}`,
    `- Run dir: ${report.runDir}`,
    `- Manifest: ${report.manifest}`,
    `- Workspace: ${report.outDir}`,
    `- Session: ${report.sessionId}`,
    `- URL: ${report.url || "none"}`,
    `- Message: ${report.message}`,
    "",
  ].join("\n");
}

function parseLastJson(output) {
  const text = String(output || "").trim();
  if (!text) return null;
  const start = text.lastIndexOf("\n{");
  const json = start >= 0 ? text.slice(start + 1) : text;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readRunId(dir) {
  const jsonPath = path.join(dir, "run-context.json");
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8")).run_id || "";
  } catch {
    const yamlPath = path.join(dir, "00-task-context.yaml");
    try {
      return fs.readFileSync(yamlPath, "utf8").match(/^run_id:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
    } catch {
      return "";
    }
  }
}

function safeSessionId(value) {
  return String(value || "session")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "session";
}
