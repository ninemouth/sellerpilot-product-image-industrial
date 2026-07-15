---
name: sellerpilot-product-image-industrial-proxy
description: Compatibility alias for SellerPilot Product Image. Loads the single main skill and uses its configured third-party OpenAI-compatible image provider.
---

# SellerPilot Product Image Proxy Compatibility Alias

This is a compatibility entrypoint, not a separate production skill. Load and follow `${CODEX_HOME}/skills/sellerpilot-product-image-industrial/SKILL.md` as the single source of workflow, QA, canvas, material-transfer, and store-memory behavior.

Resolve the provider through the main skill with `--provider third_party_proxy`. Use the saved OpenAI-compatible endpoint/model/key environment variable; do not silently replace it with another provider. When no endpoint is configured, use the ThinkAI default endpoint and `gpt-image-2`; ask only for the missing API key.
