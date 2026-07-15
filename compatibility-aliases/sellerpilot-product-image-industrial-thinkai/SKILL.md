---
name: sellerpilot-product-image-industrial-thinkai
description: Compatibility alias for SellerPilot Product Image. Loads the single main skill and preserves the legacy preference for a configured third-party ThinkAI-compatible image provider.
---

# SellerPilot Product Image ThinkAI Compatibility Alias

This is a compatibility entrypoint, not a separate production skill. Load and follow `${CODEX_HOME}/skills/sellerpilot-product-image-industrial/SKILL.md` as the single source of workflow, QA, canvas, material-transfer, and store-memory behavior. If `CODEX_HOME` is unset, use the platform-appropriate Codex home.

For this legacy alias only, resolve the provider with:

```bash
node <main-skill-root>/scripts/resolve-image-provider.mjs --provider third_party_proxy --run-dir <current-run-dir>
```

Use the resolved third-party OpenAI-compatible provider. Do not load duplicated ThinkAI workflows or create a separate run format. If configuration is missing, ask only for the missing API key; preserve the historical ThinkAI default endpoint `https://www.thinkai.tv/v1` and model `gpt-image-2` unless the user explicitly supplies another endpoint/model.
