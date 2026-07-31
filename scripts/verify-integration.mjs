#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const skillRoot = path.resolve(new URL("..", import.meta.url).pathname);
const timeoutMs = Math.max(30_000, Number(process.env.SELLERPILOT_INTEGRATION_TIMEOUT_MS || 180_000));
const filterIndex = process.argv.indexOf("--filter");
const suiteIndex = process.argv.indexOf("--suite");
const reportIndex = process.argv.indexOf("--report");
const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : null;
const reportPath = reportIndex >= 0 ? path.resolve(process.argv[reportIndex + 1] || "") : null;
if (filterIndex >= 0 && suiteIndex >= 0) fail("Use either --filter or --suite, not both.");
if (reportIndex >= 0 && !process.argv[reportIndex + 1]) fail("--report requires a JSON output path.");
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : resolveSuiteFilter(suite);
const startedAt = Date.now();
const verifierArgs = [path.join(skillRoot, "scripts", "verify-skill.mjs"), ...(filter ? ["--filter", filter] : [])];
const child = spawn(process.execPath, verifierArgs, { cwd: skillRoot, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
let timedOut = false;
let terminated = false;
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout = keepTail(stdout, chunk.toString("utf8")); });
child.stderr.on("data", (chunk) => { stderr = keepTail(stderr, chunk.toString("utf8")); });
const heartbeat = setInterval(() => {
  console.log(JSON.stringify({ status: "running", elapsed_ms: Date.now() - startedAt, timeout_ms: timeoutMs, suite: suite || "legacy_integration", filter: filter || null }));
}, 15_000);
const timer = setTimeout(() => {
  timedOut = true;
  terminate("SIGTERM");
  setTimeout(() => terminate("SIGKILL"), 5_000).unref();
}, timeoutMs);
child.on("error", (error) => {
  stderr = keepTail(stderr, error.message);
});
child.on("close", (code, signal) => {
  clearTimeout(timer);
  clearInterval(heartbeat);
  const summary = { status: timedOut ? "timeout" : code === 0 ? "pass" : "fail", suite: suite || "legacy_integration", filter: filter || null, duration_ms: Date.now() - startedAt, timeout_ms: timeoutMs, exit_code: code, signal: signal || null, stdout_tail: stdout || null, stderr_tail: stderr || null };
  if (timedOut) {
    summary.message = "Integration verifier exceeded its lifecycle budget and its process group was terminated.";
    writeReport(summary);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }
  if (code !== 0) {
    writeReport(summary);
    console.error(JSON.stringify(summary, null, 2));
    process.exitCode = code || 1;
  } else {
    writeReport(summary);
    console.log(JSON.stringify(summary, null, 2));
  }
});

function terminate(signal) {
  if (!child.pid || (terminated && signal !== "SIGKILL")) return;
  terminated = true;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); return; } catch {}
  }
  child.kill(signal);
}

function keepTail(current, next) {
  return `${current}${next}`.slice(-12_000);
}

function writeReport(summary) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ schema_version: "sellerpilot.integration_verification_report.v1", generated_at: new Date().toISOString(), ...summary }, null, 2)}\n`);
}

function resolveSuiteFilter(name) {
  if (!name) return null;
  const registryPath = path.join(skillRoot, "contracts", "integration-suite-registry.json");
  let registry;
  try { registry = JSON.parse(fs.readFileSync(registryPath, "utf8")); } catch { fail("Integration suite registry is unreadable."); }
  const entry = registry?.suites?.[name];
  if (!entry || !Array.isArray(entry.filters) || !entry.filters.length) fail(`Unknown integration suite: ${name}.`);
  return entry.filters.join(",");
}

function fail(message) { console.error(message); process.exit(2); }
