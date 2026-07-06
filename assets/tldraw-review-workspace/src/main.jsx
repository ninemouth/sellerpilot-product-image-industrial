import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get("session") || "";
const STORAGE_KEY = `sellerpilot.tldraw.review.workspace.v1:${SESSION_ID || "local"}`;
const MANIFEST_URL = SESSION_ID
  ? `/sessions/${encodeURIComponent(SESSION_ID)}/data/import-manifest.json`
  : "/data/import-manifest.json";

function App() {
  const editorRef = useRef(null);
  const [manifest, setManifest] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [regionLabel, setRegionLabel] = useState("H-overall-style");
  const [issueType, setIssueType] = useState("modify");
  const [priority, setPriority] = useState("P1");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("loading manifest");

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

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.annotations)) setAnnotations(parsed.annotations);
    } catch {
      // Ignore stale local storage.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ annotations }));
  }, [annotations]);

  const images = manifest?.images || [];
  const selectedImage = images.find((image) => image.id === selectedImageId);

  const cards = useMemo(() => {
    return images.map((image, index) => ({
      ...image,
      src: resolveImageSrc(image.src),
      x: 64 + (index % 4) * 360,
      y: 96 + Math.floor(index / 4) * 470,
    }));
  }, [images]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
  }, []);

  const addAnnotation = () => {
    if (!selectedImageId || !comment.trim()) return;
    const item = {
      id: `ann-${Date.now()}`,
      image_id: selectedImageId,
      image_file: selectedImage?.file || "",
      image_path: selectedImage?.path || "",
      region: regionLabel,
      issue_type: issueType,
      priority,
      comment: comment.trim(),
      status: "open",
      created_at: new Date().toISOString(),
      source: "tldraw-review-workspace",
    };
    setAnnotations((current) => [item, ...current]);
    setComment("");
  };

  const exportAnnotations = () => {
    const payload = {
      schema_version: "sellerpilot.review_annotations.v1",
      exported_at: new Date().toISOString(),
      workspace: manifest?.workspace || {},
      annotations,
      canvas_note: "Use tldraw arrows, drawings, and sticky notes as visual context; use this JSON as the deterministic Codex handoff.",
    };
    downloadJson("annotations.json", payload);
  };

  const exportCanvasState = () => {
    const snapshot = editorRef.current?.store?.getSnapshot
      ? editorRef.current.store.getSnapshot()
      : null;
    const payload = {
      schema_version: "sellerpilot.canvas_state.v1",
      updated_at: new Date().toISOString(),
      snapshot,
      fallback_layout: cards.map((card) => ({
        image_id: card.id,
        file: card.file,
        path: card.path,
        x: card.x,
        y: card.y,
      })),
    };
    downloadJson("canvas-state.json", payload);
  };

  const clearAnnotations = () => setAnnotations([]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">SP</span>
          <div>
            <h1>{manifest?.workspace?.title || "SellerPilot Review"}</h1>
            <p>{SESSION_ID ? `session ${SESSION_ID} · ${status}` : status}</p>
          </div>
        </div>

        <section className="panel">
          <h2>Images</h2>
          <div className="image-list">
            {images.map((image) => (
              <button
                key={image.id}
                className={image.id === selectedImageId ? "selected" : ""}
                onClick={() => setSelectedImageId(image.id)}
              >
                {image.id} · {image.file}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Annotation</h2>
          <label>
            Region
            <select value={regionLabel} onChange={(event) => setRegionLabel(event.target.value)}>
              <option value="A-product-subject">A product subject</option>
              <option value="B-background">B background</option>
              <option value="C-main-title">C main title</option>
              <option value="D-subtitle">D subtitle</option>
              <option value="E-selling-point-labels">E selling-point labels</option>
              <option value="F-decoration">F decoration</option>
              <option value="G-people-scene">G people/scene</option>
              <option value="H-overall-style">H overall style</option>
            </select>
          </label>
          <label>
            Issue
            <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
              <option value="keep">keep</option>
              <option value="modify">modify</option>
              <option value="regenerate">regenerate</option>
              <option value="rerender-layout">rerender layout</option>
              <option value="copy-adjust">copy adjust</option>
              <option value="scene-asset-required">scene asset required</option>
              <option value="identity-drift">identity drift</option>
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="P0">P0 blocker</option>
              <option value="P1">P1 important</option>
              <option value="P2">P2 polish</option>
            </select>
          </label>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="写批注：哪里不好、为什么、希望怎么改..."
          />
          <button className="primary" onClick={addAnnotation}>Add Annotation</button>
        </section>

        <section className="panel">
          <h2>Export</h2>
          <button onClick={exportAnnotations}>Export annotations.json</button>
          <button onClick={exportCanvasState}>Export canvas-state.json</button>
          <button onClick={clearAnnotations}>Clear annotations</button>
        </section>

        <section className="panel">
          <h2>Open Items</h2>
          <div className="annotation-list">
            {annotations.length === 0 ? <p>No annotations yet.</p> : annotations.map((item) => (
              <article key={item.id}>
                <strong>{item.priority} · {item.image_id}</strong>
                <span>{item.region} · {item.issue_type}</span>
                <p>{item.comment}</p>
              </article>
            ))}
          </div>
        </section>
      </aside>

      <main className="workspace">
        <div className="canvas-layer">
          <Tldraw onMount={handleMount} persistenceKey="sellerpilot-tldraw-review" />
        </div>
        <div className="image-card-layer">
          {cards.map((card) => (
            <ReviewCard key={card.id} card={card} selected={card.id === selectedImageId} onSelect={setSelectedImageId} />
          ))}
        </div>
      </main>
    </div>
  );
}

function ReviewCard({ card, selected, onSelect }) {
  return (
    <button
      className={`review-card ${selected ? "selected" : ""}`}
      style={{ left: card.x, top: card.y }}
      onClick={() => onSelect(card.id)}
      title={card.path}
    >
      <span>{card.id}</span>
      <img src={card.src} alt={card.file} />
      <strong>{card.file}</strong>
    </button>
  );
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
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

createRoot(document.getElementById("root")).render(<App />);
