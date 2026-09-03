import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import { buildMarqelImageProfile, defaultClientConfigPath, marqelImageProviderStatus, mergeMarqelImageProfile, removeMarqelImageProfile, syncMarqelImageConfig } from "../scripts/sync-marqel-image-config.mjs";

test("documents symmetric non-secret SellerPilot provider chat commands", () => {
  const skill = fs.readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /\$sellerpilot-product-image-industrial status/);
  assert.match(skill, /\$sellerpilot-product-image-industrial provider-status/);
  assert.match(skill, /\$sellerpilot-product-image-industrial sync/);
  assert.match(skill, /sync-config --target-id sellerpilot-image/);
  assert.match(skill, /device-start --sync-target sellerpilot-image/);
  assert.match(skill, /Do not run the `image-proxy` synchronization hook and do not generate an image/);
  assert.match(skill, /sync --set-active/);
});

test("maps the Web-managed sellerpilot image target without printing or changing local provider semantics", () => {
  const profile = buildMarqelImageProfile({ targets: { "sellerpilot-image": { displayName: "团队生图", image: { provider: "third_party_proxy", baseUrl: "https://images.example/v1", model: "image-model", apiKey: "secret-value" } } } });
  assert.equal(profile.id, "marqel-sellerpilot-image");
  assert.equal(profile.base_url, "https://images.example/v1");
  assert.equal(profile.model, "image-model");
  assert.equal(profile.api_key, "secret-value");
  const current = { active_profile_id: "local-team", profiles: [{ id: "local-team", kind: "external", runtime: "openai_images" }] };
  const merged = mergeMarqelImageProfile(current, profile);
  assert.equal(merged.registry.active_profile_id, "local-team");
  assert.equal(merged.registry.profiles.some((item) => item.id === "marqel-sellerpilot-image"), true);
  assert.equal(mergeMarqelImageProfile({ ...current, active_profile_id: "codex-native" }, profile).activated, true);
});

test("uses a Windows Marqel config location and ignores native image mode", () => {
  assert.equal(defaultClientConfigPath({ LOCALAPPDATA: "C:\\Users\\yang\\AppData\\Local" }, "win32", "C:\\Users\\yang"), path.win32.join("C:\\Users\\yang\\AppData\\Local", "Marqel", "codex-client-config.json"));
  assert.equal(buildMarqelImageProfile({ targets: { "sellerpilot-image": { image: { provider: "native_codex" } } } }), null);
});

test("applies, reports, and removes the managed SellerPilot provider without exposing its key", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sellerpilot-managed-config-"));
  const clientConfig = path.join(root, "client.json");
  const providerConfig = path.join(root, "provider.json");
  const digest = "b".repeat(64);
  try {
    fs.writeFileSync(clientConfig, JSON.stringify({ targets:{ "sellerpilot-image":{ deliveryRevision:"scene:4;image:9", deliveryDigest:digest, resolution:{ modelProfileIds:{ imageProfileId:"image-primary" } }, image:{ provider:"Managed", baseUrl:"https://images.example/v1", model:"image-v2", apiKey:"must-not-print" } } } }));
    const applied = syncMarqelImageConfig({ configPath:clientConfig, providerConfigPath:providerConfig });
    assert.equal(applied.status, "applied");
    assert.equal(applied.deliveryDigest, digest);
    assert.equal(applied.providerReady, true);
    assert.equal(JSON.stringify(applied).includes("must-not-print"), false);
    const status = marqelImageProviderStatus({ providerConfigPath:providerConfig });
    assert.equal(status.status, "applied");
    assert.equal(status.keyConfigured, true);
    assert.equal(status.profileActive, true);

    fs.writeFileSync(clientConfig, JSON.stringify({ targets:{} }));
    const removed = syncMarqelImageConfig({ configPath:clientConfig, providerConfigPath:providerConfig });
    assert.equal(removed.status, "not_configured");
    assert.equal(removed.removedManagedProfile, true);
    assert.equal(marqelImageProviderStatus({ providerConfigPath:providerConfig }).keyConfigured, false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test("removing the managed profile restores the native profile only when it was active", () => {
  const current = { active_profile_id:"marqel-sellerpilot-image", profiles:[{ id:"codex-native", kind:"built_in", runtime:"native_codex" }, { id:"marqel-sellerpilot-image", kind:"external", runtime:"openai_images", api_key:"secret" }] };
  const removed = removeMarqelImageProfile(current);
  assert.equal(removed.registry.active_profile_id, "codex-native");
  assert.equal(removed.registry.profiles.some((profile) => profile.id === "marqel-sellerpilot-image"), false);
});
