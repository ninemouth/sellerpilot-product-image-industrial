import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AssetRecordType, Tldraw, createShapeId, toRichText } from "tldraw";
import "tldraw/tldraw.css";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get("session") || "";
const STORAGE_SCOPE = SESSION_ID || "local";
const COMPLETION_KEY = `sellerpilot.review.completion.v1:${STORAGE_SCOPE}`;
const MANIFEST_URL = SESSION_ID
  ? `/sessions/${encodeURIComponent(SESSION_ID)}/data/import-manifest.json`
  : "/data/import-manifest.json";
const COMPLETE_REVIEW_API_URL = SESSION_ID
  ? `/api/sessions/${encodeURIComponent(SESSION_ID)}/complete-review`
  : "/api/workspace/complete-review";

const REGIONS = [
  ["A-product-subject", "A product"],
  ["B-background", "B background"],
  ["C-main-title", "C title"],
  ["D-subtitle", "D subtitle"],
  ["E-selling-point-labels", "E labels"],
  ["F-decoration", "F decoration"],
  ["G-people-scene", "G scene"],
  ["H-overall-style", "H overall"],
];

const ISSUE_TYPES = [
  ["keep", "Keep"],
  ["modify", "Modify"],
  ["regenerate", "Regenerate"],
  ["rerender-layout", "Rerender layout"],
  ["copy-adjust", "Copy adjust"],
  ["scene-asset-required", "Need scene asset"],
  ["identity-drift", "Identity drift"],
];

const PRIORITIES = [
  ["P0", "P0 blocker"],
  ["P1", "P1 important"],
  ["P2", "P2 polish"],
];

function App() {
  const editorRef = useRef(null);
  const importedManifestKeyRef = useRef("");
  const [manifest, setManifest] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [regionLabel, setRegionLabel] = useState("H-overall-style");
  const [issueType, setIssueType] = useState("modify");
  const [priority, setPriority] = useState("P1");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("loading manifest");
  const [completion, setCompletion] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    fetch(MANIFEST_URL)
      .then((response) => response.json())
      .then((data) => {
        setManifest(data);
        setSelectedImageId(data.images?.[0]?.id || "");
        setStatus("ready");
      })
      .catch((error) => setStatus(`manifest error: ${error.message}`));
  }, []);

  const images = manifest?.images || [];

  const cards = useMemo(() => {
    return images.map((image, index) => ({
      ...image,
      src: resolveImageSrc(image.src),
      assetId: AssetRecordType.createId(`sellerpilot-${safeId(image.id || index)}`),
      shapeId: createShapeId(`sellerpilot-image-${safeId(image.id || index)}`),
      x: 80 + (index % 4) * 380,
      y: 120 + Math.floor(index / 4) * 470,
      width: 320,
      height: 390,
    }));
  }, [images]);

  const selectedImage = cards.find((image) => image.id === selectedImageId);

  const importImagesIntoTldraw = useCallback((editor, nextCards) => {
    if (!editor || !nextCards.length) return;
    const manifestKey = nextCards.map((card) => `${card.id}:${card.src}`).join("|");
    if (importedManifestKeyRef.current === manifestKey) return;
    importedManifestKeyRef.current = manifestKey;

    const assets = [];
    const shapes = [];
    const labelShapes = [];
    for (const card of nextCards) {
      if (!editor.getAsset(card.assetId)) {
        assets.push({
          id: card.assetId,
          typeName: "asset",
          type: "image",
          props: {
            w: card.width,
            h: card.width,
            name: card.copied_file || card.file || card.id,
            isAnimated: false,
            mimeType: "image/png",
            src: card.src,
          },
          meta: {
            sellerpilot_image_id: card.id,
            original_path: card.path || "",
          },
        });
      }
      if (!editor.getShape(card.shapeId)) {
        shapes.push({
          id: card.shapeId,
          type: "image",
          x: card.x,
          y: card.y,
          isLocked: true,
          meta: {
            sellerpilot_layer: "image-floor-layer",
            sellerpilot_image_id: card.id,
          },
          props: {
            assetId: card.assetId,
            w: card.width,
            h: card.width,
            playing: false,
            url: "",
            crop: null,
            flipX: false,
            flipY: false,
            altText: card.copied_file || card.file || card.id,
          },
        });
      }
      const labelId = createShapeId(`sellerpilot-label-${safeId(card.id)}`);
      if (!editor.getShape(labelId)) {
        labelShapes.push({
          id: labelId,
          type: "text",
          x: card.x,
          y: card.y + card.width + 14,
          isLocked: true,
          meta: {
            sellerpilot_layer: "image-floor-label",
            sellerpilot_image_id: card.id,
          },
          props: {
            color: "black",
            size: "s",
            font: "draw",
            textAlign: "start",
            w: card.width,
            richText: toRichText(`${card.id} · ${card.copied_file || card.file || ""}`),
            scale: 1,
            autoSize: false,
          },
        });
      }
    }

    if (assets.length) editor.createAssets(assets);
    if (shapes.length) editor.createShapes(shapes);
    if (labelShapes.length) editor.createShapes(labelShapes);
    const imageShapeIds = nextCards.map((card) => card.shapeId);
    const labelShapeIds = nextCards.map((card) => createShapeId(`sellerpilot-label-${safeId(card.id)}`));
    editor.sendToBack([...imageShapeIds, ...labelShapeIds]);
    editor.selectNone();
    editor.setCurrentTool("draw");
    setTimeout(() => {
      try {
        editor.zoomToFit({ animation: { duration: 220 }, inset: 80 });
      } catch {
        editor.zoomToFit({ animation: { duration: 220 } });
      }
    }, 80);
    setStatus("ready: tldraw canvas with locked image floor");
  }, []);

  useEffect(() => {
    if (editorRef.current && cards.length) {
      importImagesIntoTldraw(editorRef.current, cards);
    }
  }, [cards, importImagesIntoTldraw]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    if (cards.length) importImagesIntoTldraw(editor, cards);
  }, [cards, importImagesIntoTldraw]);

  const addAnnotation = () => {
    if (!selectedImageId || !comment.trim()) return;
    const item = {
      id: `ann-${Date.now()}`,
      image_id: selectedImageId,
      image_file: selectedImage?.copied_file || selectedImage?.file || "",
      source_file: selectedImage?.file || "",
      image_path: selectedImage?.path || "",
      region: regionLabel,
      issue_type: issueType,
      priority,
      comment: comment.trim(),
      status: issueType === "keep" ? "closed" : "open",
      created_at: new Date().toISOString(),
      source: "sellerpilot-tldraw-review-workspace",
    };
    setAnnotations((current) => [item, ...current]);
    setComment("");
    setStatus("structured annotation added");
  };

  const clearAnnotations = () => {
    setAnnotations([]);
    localStorage.removeItem(COMPLETION_KEY);
    setCompletion(null);
    setStatus("structured annotations cleared; tldraw marks remain on canvas");
  };

  const exportAnnotations = () => {
    downloadJson("annotations.json", buildAnnotationsPayload({ manifest, annotations }));
    setStatus("annotations exported");
  };

  const exportCanvasState = () => {
    downloadJson("canvas-state.json", buildCanvasStatePayload({ manifest, editor: editorRef.current, cards }));
    setStatus("tldraw canvas state exported");
  };

  const completeReview = async () => {
    const payload = buildCompletionPayload({
      manifest,
      annotations,
      editor: editorRef.current,
      cards,
      selectedImageId,
    });
    localStorage.setItem(COMPLETION_KEY, JSON.stringify(payload));
    window.__SELLERPILOT_REVIEW_COMPLETION__ = payload;
    setCompletion(payload);
    downloadJson("review-completion.json", payload);
    try {
      const response = await fetch(COMPLETE_REVIEW_API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      window.__SELLERPILOT_REVIEW_HANDOFF_RESULT__ = result;
      setStatus("review complete: saved to Codex handoff files");
    } catch (error) {
      setStatus(`review complete: download ready; auto handoff save failed: ${error.message}`);
    }
  };

  const focusSelectedImage = () => {
    if (!editorRef.current || !selectedImage) return;
    editorRef.current.select(selectedImage.shapeId);
    editorRef.current.zoomToSelection({ animation: { duration: 220 } });
    editorRef.current.selectNone();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">SP</span>
          <div>
            <h1>{manifest?.workspace?.title || "SellerPilot Review"}</h1>
            <p>{SESSION_ID ? `session ${SESSION_ID} · ${status}` : status}</p>
          </div>
        </div>

        <div className="top-controls">
          <label className="compact-field">
            Image
            <select value={selectedImageId} onChange={(event) => setSelectedImageId(event.target.value)}>
              {cards.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.id} · {image.copied_file || image.file}
                </option>
              ))}
            </select>
          </label>
          <button onClick={focusSelectedImage}>Focus Image</button>
          <button onClick={() => editorRef.current?.setCurrentTool("draw")}>Pen</button>
          <button onClick={() => editorRef.current?.setCurrentTool("arrow")}>Arrow</button>
          <button onClick={() => editorRef.current?.setCurrentTool("geo")}>Shape</button>
          <button onClick={() => editorRef.current?.setCurrentTool("text")}>Text</button>
          <button onClick={() => setFormOpen((value) => !value)}>{formOpen ? "Hide Form" : "Form"}</button>
          <button onClick={exportAnnotations}>Export JSON</button>
          <button onClick={exportCanvasState}>Export State</button>
          <button className="primary action-complete-review" onClick={completeReview}>Complete Review</button>
        </div>
      </header>

      <main className="workspace">
        {formOpen ? (
          <section className="review-toolbar" aria-label="Optional structured image standard form">
            <label>
              Region
              <select value={regionLabel} onChange={(event) => setRegionLabel(event.target.value)}>
                {REGIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Standard
              <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
                {ISSUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="comment-field">
              Revision instruction
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="可选：补充结构化批注，画布上的自由标注仍以 tldraw snapshot 为准。"
              />
            </label>
            <button className="primary" onClick={addAnnotation}>Add Standard</button>
            <button onClick={clearAnnotations}>Clear Structured</button>
          </section>
        ) : null}

        <section className="selected-summary">
          <strong>{selectedImage?.id || "No image selected"}</strong>
          <span>{selectedImage?.copied_file || selectedImage?.file || ""}</span>
          <span>{annotations.filter((item) => item.image_id === selectedImageId).length} structured notes</span>
          <span className="scale-lock">True tldraw canvas: images are locked floor shapes; marks stay above</span>
          {completion ? <span className="review-complete-ready">handoff ready · review-completion.json</span> : null}
        </section>

        <section className="tldraw-shell" aria-label="Native tldraw review canvas">
          <Tldraw onMount={handleMount} persistenceKey={`sellerpilot-tldraw-review:${STORAGE_SCOPE}`} />
        </section>
      </main>
    </div>
  );
}

function buildAnnotationsPayload({ manifest, annotations }) {
  return {
    schema_version: "sellerpilot.review_annotations.v1",
    exported_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    annotations,
    canvas_note: "Native tldraw freehand, arrow, shape, note, and text marks are stored in canvas-state/review-completion snapshots. Source product images are locked image-floor shapes.",
  };
}

function buildCanvasStatePayload({ manifest, editor, cards }) {
  return {
    schema_version: "sellerpilot.canvas_state.v3",
    updated_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    board: {
      canvas_engine: "native-tldraw",
      image_floor: "locked-tldraw-image-shapes",
      layer_order: ["locked-image-floor-shapes", "native-tldraw-user-marks", "top-controls"],
    },
    tldraw_snapshot: editor?.store?.getSnapshot ? editor.store.getSnapshot() : null,
    image_shapes: cards.map((card) => ({
      image_id: card.id,
      file: card.file,
      copied_file: card.copied_file,
      path: card.path,
      shape_id: card.shapeId,
      asset_id: card.assetId,
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.width,
    })),
  };
}

function buildCompletionPayload({ manifest, annotations, editor, cards, selectedImageId }) {
  const canvasState = buildCanvasStatePayload({ manifest, editor, cards });
  return {
    schema_version: "sellerpilot.review_completion.v2",
    completed_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    selected_image_id: selectedImageId,
    annotations,
    annotation_count: annotations.length,
    open_annotation_count: annotations.filter((item) => item.status !== "closed").length,
    canvas_state: canvasState,
    next_codex_step: "Use the tldraw snapshot plus any structured annotations as revision input. Capture the browser session screenshot when visual evidence is needed, then revise only affected assets.",
  };
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  downloadBlob(filename, blob);
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function resolveImageSrc(src) {
  if (!SESSION_ID || !src || /^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/sessions/")) return src;
  if (src.startsWith("/")) return `/sessions/${encodeURIComponent(SESSION_ID)}${src}`;
  return src;
}

function safeId(value) {
  return String(value || "image")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

createRoot(document.getElementById("root")).render(<App />);
