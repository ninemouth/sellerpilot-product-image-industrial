#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProviderRegistry } from "./lib/provider-profile-registry.mjs";

const args = parseArgs(process.argv);
if (args.help) usage();
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
const configPath = path.resolve(args.config || path.join(codexHome, "sellerpilot-product-image-industrial", "image-provider.json"));
const state = readProviderRegistry(configPath);
const profiles = state.registry.profiles.filter((profile) => profile.enabled !== false);
if (args["dry-run"]) {
  console.log(JSON.stringify({ status: "ready", interaction: interactionForPlatform(), active_profile_id: state.registry.active_profile_id, profiles: profiles.map(publicProfile) }, null, 2));
  process.exit(0);
}
if (profiles.length < 2) {
  console.error("Add at least one enabled external profile before opening the provider selector.");
  process.exit(2);
}
const selectedId = openPicker(profiles, state.registry.active_profile_id);
if (!selectedId) {
  console.log(JSON.stringify({ status: "cancelled", active_profile_id: state.registry.active_profile_id }, null, 2));
  process.exit(0);
}
const skillRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const selected = spawnSync(process.execPath, [path.join(skillRoot, "scripts", "manage-image-provider-profiles.mjs"), "--action", "select", "--config", configPath, "--id", selectedId], { encoding: "utf8" });
if (selected.status !== 0) {
  console.error("The selected provider profile could not be activated; configuration was unchanged.");
  process.exit(selected.status || 1);
}
process.stdout.write(selected.stdout);

function openPicker(items, activeId) {
  if (process.platform === "darwin") return macPicker(items, activeId);
  if (process.platform === "win32") return windowsPicker(items, activeId);
  return linuxPicker(items, activeId);
}
function macPicker(items, activeId) {
  const choices = items.map((profile) => `${profile.label} (${profile.id})`);
  const defaults = choices.find((choice) => choice.endsWith(`(${activeId})`)) || choices[0];
  const escaped = choices.map((choice) => `"${choice.replace(/"/g, '\\"')}"`).join(", ");
  const dialog = `set selectedItem to choose from list {${escaped}} with title "SellerPilot Image Provider" with prompt "Choose the provider for the next generation run." default items {"${defaults.replace(/"/g, '\\"')}"}\nif selectedItem is false then return ""\nreturn item 1 of selectedItem`;
  const result = spawnSync("osascript", ["-e", dialog], { encoding: "utf8" });
  const label = String(result.stdout || "").trim();
  return items.find((profile) => `${profile.label} (${profile.id})` === label)?.id || "";
}
function windowsPicker(items, activeId) {
  const serialized = Buffer.from(JSON.stringify(items.map(publicProfile))).toString("base64");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    `$items=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${serialized}'))|ConvertFrom-Json`,
    '$f=New-Object Windows.Forms.Form; $f.Text="SellerPilot Image Provider"; $f.Width=480; $f.Height=180; $f.StartPosition="CenterScreen"; $f.Topmost=$true',
    '$l=New-Object Windows.Forms.Label; $l.Text="Choose the provider for the next generation run."; $l.AutoSize=$true; $l.Left=16; $l.Top=16; $f.Controls.Add($l)',
    '$c=New-Object Windows.Forms.ComboBox; $c.Left=16; $c.Top=45; $c.Width=430; $c.DropDownStyle="DropDownList"; foreach($i in $items){[void]$c.Items.Add(($i.label+" ("+$i.id+")")); if($i.id -eq "'+ activeId.replace(/'/g, "''") +'"){$c.SelectedIndex=$c.Items.Count-1}}; if($c.SelectedIndex -lt 0){$c.SelectedIndex=0}; $f.Controls.Add($c)',
    '$ok=New-Object Windows.Forms.Button; $ok.Text="Use provider"; $ok.Left=260; $ok.Top=86; $ok.DialogResult=[Windows.Forms.DialogResult]::OK; $f.AcceptButton=$ok; $f.Controls.Add($ok)',
    '$cancel=New-Object Windows.Forms.Button; $cancel.Text="Cancel"; $cancel.Left=350; $cancel.Top=86; $cancel.DialogResult=[Windows.Forms.DialogResult]::Cancel; $f.CancelButton=$cancel; $f.Controls.Add($cancel)',
    'if($f.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){exit 1}; [Console]::Out.Write($items[$c.SelectedIndex].id)',
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}
function linuxPicker(items, activeId) {
  const rows = items.flatMap((profile) => [profile.id === activeId ? "TRUE" : "FALSE", `${profile.label} (${profile.id})`]);
  const result = spawnSync("zenity", ["--list", "--radiolist", "--title=SellerPilot Image Provider", "--text=Choose the provider for the next generation run.", "--column=", "--column=Provider", ...rows], { encoding: "utf8" });
  const label = String(result.stdout || "").trim();
  return items.find((profile) => `${profile.label} (${profile.id})` === label)?.id || "";
}
function publicProfile(profile) { return { id: profile.id, label: profile.label, kind: profile.kind }; }
function interactionForPlatform() { return process.platform === "darwin" ? "macos_provider_picker" : process.platform === "win32" ? "windows_provider_picker" : "linux_provider_picker"; }
function parseArgs(argv) { const out = {}; for (let i = 2; i < argv.length; i += 1) { if (!argv[i].startsWith("--")) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (!next || next.startsWith("--")) out[key] = true; else { out[key] = next; i += 1; } } return out; }
function usage() { console.error("Usage: node scripts/select-image-provider-interactive.mjs [--config /abs/image-provider.json] [--dry-run]"); process.exit(2); }
