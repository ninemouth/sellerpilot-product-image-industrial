#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv);
if (args.help) usage();
if (args["dry-run"]) {
  console.log(JSON.stringify({ status: "ready", interaction: interactionForPlatform(), key_output: "never_printed", configuration_transport: "stdin" }, null, 2));
  process.exit(0);
}

const prompt = openSecurePrompt();
if (prompt.status !== 0) {
  console.error("Local third-party image provider key entry was cancelled or could not open.");
  process.exit(prompt.status || 1);
}
const key = parsePromptOutput(prompt.stdout);
if (!key) {
  console.error("No image API key was entered; local configuration was unchanged.");
  process.exit(2);
}
const skillRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configure = path.join(skillRoot, "scripts", "configure-image-provider.mjs");
const forwarded = [configure, "--api-key-stdin"];
for (const flag of ["config", "name", "base-url", "model", "api-key-env"]) if (args[flag]) forwarded.push(`--${flag}`, String(args[flag]));
const configured = spawnSync(process.execPath, forwarded, { input: `${key}\n`, encoding: "utf8" });
if (configured.status !== 0) {
  console.error("The image provider key was not saved to the local configuration.");
  process.exit(configured.status || 1);
}
const result = safeJson(configured.stdout) || {};
console.log(JSON.stringify({ status: "configured", provider_mode: result.provider_mode || "third_party_proxy", provider: result.provider || null, key_source: interactionForPlatform(), key_output: "never_printed" }, null, 2));

function parseArgs(argv) { const result = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; i += 1; } } return result; }
function interactionForPlatform() { return process.platform === "darwin" ? "macos_hidden_password_dialog" : process.platform === "win32" ? "windows_password_masked_dialog" : "linux_password_dialog"; }
function openSecurePrompt() {
  if (process.platform === "darwin") {
    const dialog = 'display dialog "Paste your image API key. It updates only the local Codex provider configuration and is never printed." default answer "" with hidden answer buttons {"Cancel", "Save"} default button "Save" with title "Codex Image Provider Setup"';
    return spawnSync("osascript", ["-e", dialog], { encoding: "utf8" });
  }
  if (process.platform === "win32") return openWindowsPasswordDialog();
  return openLinuxPasswordDialog();
}
function openWindowsPasswordDialog() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$f=New-Object Windows.Forms.Form; $f.Text="Codex Image Provider Setup"; $f.Width=460; $f.Height=165; $f.StartPosition="CenterScreen"; $f.Topmost=$true',
    '$l=New-Object Windows.Forms.Label; $l.Text="Paste your image API key. It stays in local provider configuration."; $l.AutoSize=$true; $l.Left=16; $l.Top=16; $f.Controls.Add($l)',
    '$t=New-Object Windows.Forms.TextBox; $t.Left=16; $t.Top=43; $t.Width=410; $t.UseSystemPasswordChar=$true; $f.Controls.Add($t)',
    '$ok=New-Object Windows.Forms.Button; $ok.Text="Save"; $ok.Left=270; $ok.Top=82; $ok.DialogResult=[Windows.Forms.DialogResult]::OK; $f.AcceptButton=$ok; $f.Controls.Add($ok)',
    '$cancel=New-Object Windows.Forms.Button; $cancel.Text="Cancel"; $cancel.Left=350; $cancel.Top=82; $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel; $f.CancelButton=$cancel; $f.Controls.Add($cancel)',
    'if($f.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){exit 1}; [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t.Text)))',
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const shell = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8" });
  return shell.error?.code === "ENOENT" ? spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8" }) : shell;
}
function openLinuxPasswordDialog() {
  const zenity = spawnSync("zenity", ["--password", "--title=Codex Image Provider Setup", "--text=Paste your image API key. It stays in local provider configuration."], { encoding: "utf8" });
  if (zenity.error?.code !== "ENOENT") return zenity;
  return spawnSync("kdialog", ["--password", "Paste your image API key. It stays in local provider configuration."], { encoding: "utf8" });
}
function parsePromptOutput(value) {
  if (process.platform === "darwin") { const match = String(value || "").match(/text returned:(.*)$/s); return match ? match[1].trim() : ""; }
  if (process.platform === "win32") { try { return Buffer.from(String(value || "").trim(), "base64").toString("utf8").trim(); } catch { return ""; } }
  return String(value || "").trim();
}
function safeJson(value) { try { return JSON.parse(String(value || "")); } catch { return null; } }
function usage() { console.error("Usage: node scripts/configure-image-provider-interactive.mjs [--config /abs/image-provider.json] [--base-url URL] [--model MODEL] [--api-key-env NAME] [--dry-run]"); process.exit(2); }
