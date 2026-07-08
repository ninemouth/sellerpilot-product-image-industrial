import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react(), sellerpilotReviewHandoffPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: false,
  },
});

function sellerpilotReviewHandoffPlugin() {
  return {
    name: "sellerpilot-review-handoff",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "POST") return next();
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/complete-review$/);
        const workspaceMatch = url.pathname === "/api/workspace/complete-review";
        if (!sessionMatch && !workspaceMatch) return next();

        try {
          const payload = await readJsonBody(req, 25 * 1024 * 1024);
          const root = server.config.root || process.cwd();
          const result = sessionMatch
            ? saveSessionCompletion({ root, sessionId: decodeURIComponent(sessionMatch[1]), payload })
            : saveWorkspaceCompletion({ workspaceDir: root, payload });
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 500, {
            status: "error",
            error: error.message,
          });
        }
      });
    },
  };
}

function saveSessionCompletion({ root, sessionId, payload }) {
  const safeId = safeSessionId(sessionId);
  if (safeId !== sessionId) throw new Error("Invalid session id.");
  const sessionDir = path.resolve(root, "public", "sessions", safeId);
  assertInside(path.resolve(root, "public", "sessions"), sessionDir);
  const sessionDataDir = path.join(sessionDir, "data");
  const manifestPath = path.join(sessionDataDir, "import-manifest.json");
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest) throw new Error(`Session manifest not found for ${safeId}.`);
  const workspaceDir = manifest.workspace?.workspace_dir ? path.resolve(manifest.workspace.workspace_dir) : "";
  const saved = [];
  saved.push(...writeCompletionFiles({ dataDir: sessionDataDir, payload, sessionId: safeId, workspaceDir }));
  if (workspaceDir) {
    saved.push(...writeCompletionFiles({ dataDir: path.join(workspaceDir, "data"), payload, sessionId: safeId, workspaceDir }));
  }
  return {
    status: "saved",
    session_id: safeId,
    workspace_dir: workspaceDir,
    saved_files: saved,
    ready_file: workspaceDir ? path.join(workspaceDir, "data", "review-completion-ready.json") : path.join(sessionDataDir, "review-completion-ready.json"),
    next_codex_step: "Run wait-for-review-completion.mjs to parse review-completion.json into generation-tasks.json, then revise only affected assets.",
  };
}

function saveWorkspaceCompletion({ workspaceDir, payload }) {
  const dataDir = path.join(path.resolve(workspaceDir), "data");
  const saved = writeCompletionFiles({ dataDir, payload, sessionId: payload.workspace?.session_id || "", workspaceDir });
  return {
    status: "saved",
    workspace_dir: workspaceDir,
    saved_files: saved,
    ready_file: path.join(dataDir, "review-completion-ready.json"),
    next_codex_step: "Run wait-for-review-completion.mjs to parse review-completion.json into generation-tasks.json, then revise only affected assets.",
  };
}

function writeCompletionFiles({ dataDir, payload, sessionId, workspaceDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const savedAt = new Date().toISOString();
  const normalized = {
    ...payload,
    saved_at: savedAt,
    handoff_status: "ready_for_codex",
  };
  const ready = {
    schema_version: "sellerpilot.review_completion_ready.v1",
    status: "ready",
    session_id: sessionId || payload.workspace?.session_id || "",
    workspace_dir: workspaceDir || payload.workspace?.workspace_dir || "",
    saved_at: savedAt,
    completion_file: path.join(dataDir, "review-completion.json"),
    annotations_file: path.join(dataDir, "annotations.json"),
    canvas_state_file: path.join(dataDir, "canvas-state.json"),
    generation_tasks_file: path.join(dataDir, "generation-tasks.json"),
    annotation_count: Array.isArray(payload.annotations) ? payload.annotations.length : 0,
    open_annotation_count: Array.isArray(payload.annotations)
      ? payload.annotations.filter((item) => String(item.status || "open") !== "closed").length
      : 0,
    next_codex_step: "Parse review-completion.json into generation-tasks.json and continue revision only for affected assets.",
  };
  const annotations = {
    schema_version: "sellerpilot.review_annotations.v1",
    exported_at: savedAt,
    workspace: payload.workspace || {},
    annotations: payload.annotations || [],
  };
  const files = [
    ["review-completion.json", normalized],
    ["review-completion-ready.json", ready],
    ["annotations.json", annotations],
  ];
  if (payload.canvas_state) files.push(["canvas-state.json", payload.canvas_state]);
  for (const [name, value] of files) {
    fs.writeFileSync(path.join(dataDir, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  return files.map(([name]) => path.join(dataDir, name));
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Review completion payload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error(`Invalid JSON payload: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value, null, 2));
}

function safeSessionId(value) {
  return String(value || "session")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "session";
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to write outside the tldraw session root.");
  }
}
