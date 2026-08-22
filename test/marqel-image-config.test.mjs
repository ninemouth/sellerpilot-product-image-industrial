import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildMarqelImageProfile, defaultClientConfigPath, mergeMarqelImageProfile } from "../scripts/sync-marqel-image-config.mjs";

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
