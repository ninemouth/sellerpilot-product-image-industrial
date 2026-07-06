#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
node scripts/capture-review-session.mjs --url http://127.0.0.1:5190/?session=run-id --out-dir /abs/captures

Captures the current SellerPilot review browser session for Codex revision handoff.
It saves a viewport screenshot plus any Complete Review payload stored in the page.
Pass --browser-path /abs/chrome when Playwright browsers are not installed.`);
  process.exit(2);
}

const args = parseArgs(process.argv);
if (!args.url || !args["out-dir"]) usage();

const outDir = path.resolve(args["out-dir"]);
fs.mkdirSync(outDir, { recursive: true });

const playwright = requireBundled("playwright");
const browserPath = args["browser-path"] ? path.resolve(args["browser-path"]) : findBrowserExecutable();
const launchOptions = browserPath ? { headless: true, executablePath: browserPath } : { headless: true };
let browser;
try {
  browser = await playwright.chromium.launch(launchOptions);
} catch (error) {
  throw new Error([
    `Unable to launch a browser for review capture: ${error.message}`,
    "Install Playwright browsers with `npx playwright install chromium`,",
    "or pass `--browser-path /abs/path/to/Chrome` to reuse a local browser.",
  ].join("\n"));
}
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
try {
  await page.goto(args.url, { waitUntil: "networkidle", timeout: Number(args["wait-ms"] || 20000) });
  await page.waitForSelector(".review-board", { timeout: Number(args["wait-ms"] || 20000) });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = path.join(outDir, `review-session-${timestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const payload = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("sellerpilot.review.completion.v1:"));
    const latestKey = keys.sort().at(-1);
    let completion = window.__SELLERPILOT_REVIEW_COMPLETION__ || null;
    if (!completion && latestKey) {
      try {
        completion = JSON.parse(localStorage.getItem(latestKey));
      } catch {
        completion = null;
      }
    }
    return {
      page_url: window.location.href,
      completion_storage_key: latestKey || "",
      completion,
      status_text: document.querySelector(".brand p")?.textContent || "",
      annotation_count_text: document.querySelector(".dock-heading span")?.textContent || "",
    };
  });
  const payloadPath = path.join(outDir, `review-session-${timestamp}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify({
    schema_version: "sellerpilot.review_session_capture.v1",
    captured_at: new Date().toISOString(),
    url: args.url,
    screenshot_path: screenshotPath,
    ...payload,
  }, null, 2));
  console.log(JSON.stringify({
    status: "ok",
    screenshot: screenshotPath,
    payload: payloadPath,
    hasCompletionPayload: Boolean(payload.completion),
  }, null, 2));
} finally {
  await browser.close();
}

function requireBundled(name) {
  try {
    return require(name);
  } catch {
    const bundled = path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules",
      name,
    );
    return require(bundled);
  }
}

function findBrowserExecutable() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}
