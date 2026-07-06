# Review Canvas

Use review surfaces in this order:

1. Native Codex/Sites, Figma/FigJam, or plugin widget when available and able to render the actual image assets.
2. Local React + Vite + tldraw review workspace for a controlled infinite-canvas workflow.
3. Durable annotation JSON and screenshots from the tldraw workspace when an interactive server cannot be opened.

## tldraw Review Workspace

Create the workspace:

```bash
node scripts/create-tldraw-review-workspace.mjs \
  --out-dir /abs/run/review-workspace \
  --manifest /abs/run/export/final-images-manifest.json \
  --run-dir /abs/run \
  --title "商品图审核工作台"
```

For normal Codex App use, workspace creation automatically starts or reuses the shared tldraw service. Do not start a separate dev server per chat. Use the run-scoped final-images manifest, not a shared `outputs/` directory.

Preferred one-step launcher when interactive review is the next step or when automatic startup from workspace creation is blocked:

```bash
node scripts/open-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

This command registers the workspace, starts or reuses the shared service, waits for the session URL to respond, and returns the URL only when ready. Use it before telling the user the canvas is available.

Manual two-step equivalent:

```bash
node scripts/register-tldraw-review-session.mjs \
  --workspace-dir /abs/run/review-workspace \
  --session-id run-or-chat-id
```

Then start or reuse the shared service:

```bash
node scripts/start-tldraw-shared-service.mjs \
  --session-id run-or-chat-id
```

This returns a URL like:

```text
http://127.0.0.1:5190/?session=run-or-chat-id
```

Use the isolated workspace launcher only when the shared service is unavailable or strict per-run isolation is required:

```bash
node scripts/start-tldraw-review-workspace.mjs \
  --workspace-dir /abs/run/review-workspace
```

Capabilities:

- Real browser review workspace served through the shared tldraw service session URL.
- Generated image assets are copied into the workspace so browser rendering does not depend on unsafe local file URLs.
- Generated product images render as the bottom floor layer. A-H standards, issue markers, and revision annotations float above the images.
- The review board does not zoom independently. If a future zoom control is added, it must scale the image floor layer and all standard overlays together.
- The image file list lives in the top dropdown. Do not restore a left sidebar.
- Deterministic direct image-standard form fields tied to image IDs, A-H regions, issue type, priority, and revision instruction.
- Exportable `annotations.json`, `canvas-state.json`, `review-completion.json`, and Codex-readable `generation-tasks.json`.
- `Complete Review` action creates a screenshot-oriented browser handoff payload so Codex can capture the session and continue revisions from annotations.

Convert annotations to generation tasks:

```bash
node scripts/parse-canvas-annotations.mjs \
  --annotations /abs/run/review-workspace/data/annotations.json \
  --out /abs/run/review-workspace/data/generation-tasks.json \
  --run-dir /abs/run
```

Use `generation-tasks.json` as structured input to the revision loop. It should route tasks to `localized-copy-pack`, `layout-wireframes`, `scene-asset-production`, `product-identity-lock`, or `failed-output-regeneration` depending on annotation issue type and region.

When the user clicks `Complete Review`, capture the browser state and screenshot:

```bash
node scripts/capture-review-session.mjs \
  --url http://127.0.0.1:5190/?session=run-or-chat-id \
  --out-dir /abs/run/review-workspace/captures
```

The capture JSON records whether a completion payload was present in browser storage. Use the screenshot in the chat when Codex needs visual evidence, and parse either `annotations.json` or the completed payload into revision tasks.

## Launch Policy

- Generate the tldraw workspace automatically when visual review is expected.
- Start or reuse the shared tldraw service automatically for review workspaces so the user receives a ready localhost URL without another prompt.
- Use `--no-auto-start` only for selftests, file-only artifact generation, or explicitly non-interactive audit archives.
- Use `open-tldraw-review-session.mjs` so the final response only presents a verified ready URL.
- Prefer one shared dev server for the whole local Codex user environment. Different chats/runs should be different sessions under `/?session=<session-id>`, not separate servers.
- Use one workspace directory per run for artifacts: `/abs/run/review-workspace`.
- Register each run workspace into the shared service with `register-tldraw-review-session.mjs`.
- Use unique `run_id`/`session_id` values. The register script rejects accidental reuse of a session id that already belongs to another workspace/run unless reuse is explicitly allowed.
- `start-tldraw-shared-service.mjs` reads shared `data/shared-server-state.json` and reuses a live PID instead of starting a duplicate.
- Parallel product-image tasks can share the same canvas service while staying isolated by session ID and session data directory.
- Use `start-tldraw-review-workspace.mjs` only as an isolated fallback. It still starts at most one server per workspace by reading `data/server-state.json`.
- If a task only needs file artifacts or QA reports, pass `--no-auto-start` and create the workspace files without starting the server.

When precise image revision is expected, also create `review/review.html` with A-H editable regions:

- A product subject
- B background
- C main title
- D subtitle
- E selling-point labels
- F decoration
- G people/scene
- H overall style

Use the A-H feedback export as structured input for the Revision Brief.

## Native Codex or Plugin Canvas

- If a native Codex, Creative Production, or app widget review surface is available in the current session and can render the image assets, render it in addition to the tldraw workspace.
- If a widget only receives local filesystem paths and shows placeholders, treat that widget route as failed. Do not present placeholder widgets as a successful review canvas.
- Prefer widget-compatible URLs, uploaded asset IDs, or a saved run directory when the widget requires non-local image references.
- Do not rely only on the widget. Always keep a tldraw workspace files, annotation JSON, completion JSON, or screenshot capture in the run directory so the review state is durable.
- A skill alone cannot guarantee opening a proprietary infinite-canvas UI. That requires a plugin/app/widget integration. This skill therefore ships the local canvas tool as the guaranteed fallback.
