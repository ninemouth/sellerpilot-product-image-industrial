---
name: image-proxy
description: Generate or edit raster images through an explicitly configured OpenAI-compatible third-party image provider, including ThinkAI by default, with dry-run request snapshots, source-image and mask uploads, progress files, secure local key configuration, and downloaded output verification. Use when the user asks to use a third-party image proxy, ThinkAI, an OpenAI-compatible image endpoint, or the image-proxy skill; do not use it for native Codex image generation or a full ecommerce production workflow.
---

# Image Proxy

Use this skill as an independent provider execution layer. It sends a finalized prompt to one configured OpenAI-compatible image endpoint, optionally uploads source/reference images and a PNG mask for edits, downloads the returned image assets, and writes request/response/summary evidence in the requested output directory.

## Scope and boundaries

- Use only when the user explicitly selects this skill or a third-party image provider.
- Use the configured endpoint and model exactly. The default profile is ThinkAI at `https://www.thinkai.tv/v1` with `gpt-image-2`; this is a default, not a claim that the provider is available or that the API key is configured.
- Never silently fall back to native Codex image generation, another provider, or a guessed endpoint.
- Never print, echo, commit, or include an API key in prompts, request snapshots, progress files, summaries, or diagnostics. Prefer environment variables or masked local entry through the interactive configurator.
- This skill does not perform product fact extraction, platform research, buyer-facing copy strategy, identity/physics/marketing QA, tldraw review, publishing, uploading, or platform operations. It is intentionally independent from any ecommerce production skill.
- A successful provider response proves only that the provider returned decodable image bytes. It does not prove product identity, visual quality, platform compliance, or commercial performance.

## Execution workflow

1. Treat the user’s prompt as the provider request. If the prompt contains unsupported product facts, safety claims, or exact text that must be reliable, stop and resolve those facts before calling the provider.
2. Resolve the local provider status without exposing secrets:

   ```bash
   node scripts/resolve-provider.mjs
   ```

   `status: ready` means a key is available to this local process. `configuration_required` means configuration is needed; it is not permission to switch providers.

3. Configure the provider once when needed. Prefer the environment variable for CI or shell use:

   ```bash
   export THINKAI_IMAGE_API_KEY="<key>"
   ```

   For a persistent local configuration, pass the key over stdin or use the masked OS dialog. The config file is stored under the Codex home in the standalone skill namespace and is written with mode `600`:

   ```bash
   printf '%s\n' '<key>' | node scripts/configure-image-provider.mjs --api-key-stdin
   node scripts/configure-image-provider-interactive.mjs
   ```

   Do not put a real key in shell history, chat, or a committed file. Use `--base-url`, `--model`, `--name`, and `--api-key-env` only for an explicitly selected compatible provider.

4. Run a dry-run before the first real request or whenever the endpoint/model/size changes. A dry-run writes `request.json` and `summary.json` and never calls the network:

   ```bash
   node scripts/openai-compatible-image-runtime.mjs \
     --prompt "<final prompt>" \
     --output-dir /abs/output \
     --size 2k \
     --quality hd \
     --dry-run
   ```

5. Execute generation or edit only after the dry-run request is correct:

   ```bash
   node scripts/openai-compatible-image-runtime.mjs \
     --prompt "<final prompt>" \
     --output-dir /abs/output \
     --size 2k \
     --quality hd \
     --progress-file /abs/output/progress.json
   ```

   Add `--image /abs/source.png` once per source/reference image to use `/images/edits`; add `--mask /abs/mask.png` for a PNG edit mask. Use `--n N` for multiple provider outputs. The runtime accepts `1k`, `2k`, `4k`, or an explicit `WIDTHxHEIGHT` size.

6. Read `summary.json`, check that `status` is `generated`, and verify the listed image files exist and are decodable. Keep `request.json`, `response.json`, `summary.json`, and `progress.json` with the run when an audit trail is useful. If a request fails, preserve the output directory and retry only after changing the provider-visible evidence or fixing the reported configuration/transport issue.

## Provider configuration and paths

Use the path helper before giving installation or configuration instructions on a different operating system:

```bash
node scripts/codex-path-info.mjs
```

The default configuration location is:

- macOS/Linux: `$CODEX_HOME/skills/image-proxy` for the installed skill and `$CODEX_HOME/image-proxy/image-provider.json` for the shared local provider config; when `CODEX_HOME` is unset, Codex uses `~/.codex`.
- Windows: `%CODEX_HOME%\skills\image-proxy` and `%CODEX_HOME%\image-proxy\image-provider.json`; when unset, Codex uses `%USERPROFILE%\.codex`.

The runtime also accepts `--config /abs/config.json`. A config may be either the standalone shape written by the configurator:

```json
{
  "provider_mode": "third_party_proxy",
  "third_party": {
    "enabled": true,
    "name": "ThinkAI",
    "base_url": "https://www.thinkai.tv/v1",
    "model": "gpt-image-2",
    "api_key_env": "THINKAI_IMAGE_API_KEY"
  }
}
```

or a flat object with `base_url`, `model`, `api_key_env`, and optional `api_key`. Keep `api_key` out of version control; an environment variable is preferred.

## Resources

- Read [references/provider-contract.md](references/provider-contract.md) when adapting the endpoint, debugging a response shape, or deciding whether a source image should be sent as an edit input.
- Run `npm run verify` from this skill directory for a network-free smoke test. It checks frontmatter, scripts, generation/edit dry-runs, secure configuration plumbing, custom-provider resolution, and masked configuration behavior.
