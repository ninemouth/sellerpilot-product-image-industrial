---
name: sellerpilot-product-image-industrial-proxy
description: Migration-only compatibility entrypoint for SellerPilot Product Image. Prefer the single main skill and its automatic provider routing.
---

# SellerPilot Product Image Proxy Migration Alias

This is a legacy migration template, not the standalone provider skill. The supported user-facing entrypoint remains `sellerpilot-product-image-industrial`; when a user explicitly requests direct third-party provider execution, use `standalone/image-proxy` instead.

When explicitly installed for a legacy user, load the main skill and resolve the provider with `--provider third_party_proxy`. Do not duplicate workflows, QA, canvas, or store-memory logic. The compatibility sync command no longer installs this alias because it would collide with the standalone skill name.
