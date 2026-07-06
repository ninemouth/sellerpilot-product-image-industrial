import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const SESSION_ID = params.get("session") || "";
const STORAGE_SCOPE = SESSION_ID || "local";
const STORAGE_KEY = `sellerpilot.review.workspace.v2:${STORAGE_SCOPE}`;
const COMPLETION_KEY = `sellerpilot.review.completion.v1:${STORAGE_SCOPE}`;
const MANIFEST_URL = SESSION_ID
  ? `/sessions/${encodeURIComponent(SESSION_ID)}/data/import-manifest.json`
  : "/data/import-manifest.json";

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

const DRAW_TOOLS = [
  ["pen", "Pen"],
  ["box", "Box"],
  ["arrow", "Arrow"],
  ["note", "Note"],
  ["select", "Select"],
];

function App() {
  const boardRef = useRef(null);
  const [manifest, setManifest] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState("");
  const [regionLabel, setRegionLabel] = useState("H-overall-style");
  const [issueType, setIssueType] = useState("modify");
  const [priority, setPriority] = useState("P1");
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("loading manifest");
  const [completion, setCompletion] = useState(null);
  const [activeTool, setActiveTool] = useState("pen");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [drawDraft, setDrawDraft] = useState(null);

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
      if (parsed.selectedImageId) setSelectedImageId(parsed.selectedImageId);
    } catch {
      // Ignore stale local storage.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ annotations, selectedImageId }));
  }, [annotations, selectedImageId]);

  const images = manifest?.images || [];
  const selectedImage = images.find((image) => image.id === selectedImageId);

  const cards = useMemo(() => {
    return images.map((image, index) => ({
      ...image,
      src: resolveImageSrc(image.src),
      x: 32 + (index % 3) * 372,
      y: 32 + Math.floor(index / 3) * 452,
      width: 332,
      height: 408,
    }));
  }, [images]);

  const boardSize = useMemo(() => {
    const rows = Math.max(1, Math.ceil(cards.length / 3));
    return {
      width: Math.max(1160, Math.min(3, Math.max(cards.length, 1)) * 372 + 24),
      height: rows * 452 + 32,
    };
  }, [cards.length]);

  const selectedAnnotations = annotations.filter((item) => item.image_id === selectedImageId);

  const addAnnotation = (overrides = {}) => {
    const targetImageId = overrides.image_id || selectedImageId;
    const targetImage = images.find((image) => image.id === targetImageId) || selectedImage;
    const finalComment = (overrides.comment || comment || drawingFallbackComment(overrides.tool || activeTool)).trim();
    if (!targetImageId || !finalComment) return;
    const item = {
      id: `ann-${Date.now()}`,
      image_id: targetImageId,
      image_file: targetImage?.copied_file || targetImage?.file || "",
      source_file: targetImage?.file || "",
      image_path: targetImage?.path || "",
      region: overrides.region || regionLabel,
      issue_type: overrides.issue_type || issueType,
      priority: overrides.priority || priority,
      comment: comment.trim(),
      status: (overrides.issue_type || issueType) === "keep" ? "closed" : "open",
      created_at: new Date().toISOString(),
      source: "sellerpilot-review-workspace",
      draw_tool: overrides.tool || null,
      drawing: overrides.drawing || null,
    };
    item.comment = finalComment;
    setAnnotations((current) => [item, ...current]);
    setComment("");
    setStatus("annotation added");
  };

  const addDrawingAnnotation = ({ card, drawing, tool }) => {
    const prompted = window.prompt("批注说明：这块区域希望如何修改？", drawingFallbackComment(tool));
    const finalComment = (prompted || drawingFallbackComment(tool)).trim();
    addAnnotation({
      image_id: card.id,
      comment: finalComment,
      tool,
      drawing,
      issue_type: tool === "note" ? "modify" : issueType,
    });
  };

  const closeAnnotation = (id) => {
    setAnnotations((current) => current.map((item) => (
      item.id === id ? { ...item, status: "closed", closed_at: new Date().toISOString() } : item
    )));
  };

  const clearAnnotations = () => {
    setAnnotations([]);
    localStorage.removeItem(COMPLETION_KEY);
    setCompletion(null);
    setStatus("annotations cleared");
  };

  const exportAnnotations = () => {
    downloadJson("annotations.json", buildAnnotationsPayload({ manifest, annotations }));
    setStatus("annotations exported");
  };

  const exportCanvasState = () => {
    downloadJson("canvas-state.json", buildCanvasStatePayload({ manifest, cards, boardSize }));
    setStatus("canvas state exported");
  };

  const completeReview = async () => {
    setStatus("capturing review handoff");
    const screenshot = await captureReviewPng({ manifest, cards, annotations, boardSize });
    const payload = buildCompletionPayload({
      manifest,
      annotations,
      cards,
      boardSize,
      selectedImageId,
      screenshot,
    });
    localStorage.setItem(COMPLETION_KEY, JSON.stringify(payload));
    window.__SELLERPILOT_REVIEW_COMPLETION__ = payload;
    setCompletion(payload);
    downloadDataUrl(payload.review_screenshot.filename, screenshot.data_url);
    downloadJson("review-completion.json", payload);
    setStatus("review complete: screenshot and JSON handoff ready");
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
              {images.map((image) => (
                <option key={image.id} value={image.id}>
                  {image.id} · {image.copied_file || image.file}
                </option>
              ))}
            </select>
          </label>
          <div className="drawing-toolbar" aria-label="Board annotation tools">
            {DRAW_TOOLS.map(([value, label]) => (
              <button
                key={value}
                className={activeTool === value ? "active-tool" : ""}
                onClick={() => setActiveTool(value)}
                title={`${label} annotation tool`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="priority-field">
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button onClick={() => setAdvancedOpen((value) => !value)}>
            {advancedOpen ? "Hide Form" : "Form"}
          </button>
          <button onClick={exportAnnotations}>Export JSON</button>
          <button onClick={exportCanvasState}>Export State</button>
          <button className="primary action-complete-review" onClick={completeReview}>Complete Review</button>
        </div>
      </header>

      <main className="workspace">
        <section className={`review-toolbar ${advancedOpen ? "open" : "collapsed"}`} aria-label="Advanced structured image standard form">
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
              placeholder="写批注：直接描述这张图的修改标准、风险、希望改成什么..."
            />
          </label>
          <button className="primary" onClick={() => addAnnotation()}>Add Standard</button>
          <button onClick={clearAnnotations}>Clear</button>
        </section>

        <section className="selected-summary">
          <strong>{selectedImage?.id || "No image selected"}</strong>
          <span>{selectedImage?.copied_file || selectedImage?.file || ""}</span>
          <span>{selectedAnnotations.length} active image notes</span>
          <span className="scale-lock">Scale locked: image layer and standards move together</span>
          {completion ? <span className="review-complete-ready">handoff ready · {completion.review_screenshot.filename}</span> : null}
        </section>

        <section className="board-viewport" aria-label="Review board without independent canvas zoom">
          <div
            ref={boardRef}
            className="review-board"
            style={{ width: boardSize.width, height: boardSize.height }}
          >
            <div className="image-floor-layer">
              {cards.map((card) => (
                <ImageTile
                  key={card.id}
                  card={card}
                  selected={card.id === selectedImageId}
                  onSelect={setSelectedImageId}
                />
              ))}
            </div>

            <div className="standard-overlay-layer" aria-hidden="true">
              {cards.map((card) => (
                <StandardOverlay
                  key={card.id}
                  card={card}
                  selected={card.id === selectedImageId}
                  annotations={annotations.filter((item) => item.image_id === card.id)}
                  activeTool={activeTool}
                  draft={drawDraft?.image_id === card.id ? drawDraft : null}
                  onSelect={setSelectedImageId}
                  onDraftChange={setDrawDraft}
                  onAddDrawing={addDrawingAnnotation}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="annotation-dock">
          <div className="dock-heading">
            <h2>Image Modification Standards</h2>
            <span>{annotations.length} total</span>
          </div>
          <div className="annotation-list">
            {annotations.length === 0 ? <p>No standards added yet.</p> : annotations.map((item) => (
              <article key={item.id} className={item.status === "closed" ? "closed" : ""}>
                <div>
                  <strong>{item.priority} · {item.image_id}</strong>
                  <span>{item.region} · {item.issue_type}</span>
                </div>
                <p>{item.comment}</p>
                {item.status !== "closed" ? <button onClick={() => closeAnnotation(item.id)}>Mark Done</button> : null}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ImageTile({ card, selected, onSelect }) {
  return (
    <button
      className={`image-tile ${selected ? "selected" : ""}`}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      onClick={() => onSelect(card.id)}
      title={card.path}
    >
      <span>{card.id}</span>
      <img src={card.src} alt={card.file} />
      <strong>{card.copied_file || card.file}</strong>
      <small>{card.role_hint || "general"}</small>
    </button>
  );
}

function StandardOverlay({ card, selected, annotations, activeTool, draft, onSelect, onDraftChange, onAddDrawing }) {
  const openAnnotations = annotations.filter((item) => item.status !== "closed").slice(0, 4);
  const drawingAnnotations = annotations.filter((item) => item.status !== "closed" && item.drawing);
  const handlePointerDown = (event) => {
    onSelect(card.id);
    if (activeTool === "select") return;
    const point = panelPoint(event.currentTarget, event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onDraftChange({
      image_id: card.id,
      tool: activeTool,
      start: point,
      current: point,
      points: [point],
    });
  };
  const handlePointerMove = (event) => {
    if (!draft || draft.image_id !== card.id) return;
    const point = panelPoint(event.currentTarget, event);
    onDraftChange({
      ...draft,
      current: point,
      points: draft.tool === "pen" ? [...(draft.points || []), point] : draft.points,
    });
  };
  const handlePointerUp = (event) => {
    if (!draft || draft.image_id !== card.id) return;
    const point = panelPoint(event.currentTarget, event);
    const completed = {
      ...draft,
      current: point,
      points: draft.tool === "pen" ? [...(draft.points || []), point] : draft.points,
    };
    onDraftChange(null);
    if (!isMeaningfulDrawing(completed)) return;
    onAddDrawing({
      card,
      tool: completed.tool,
      drawing: drawingPayload(completed, card),
    });
  };
  return (
    <div
      className={`standards-panel ${selected ? "selected" : ""} tool-${activeTool}`}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="standard-chip">{selected ? `${activeTool} tool` : "tap to annotate"}</div>
      <div className="region-strip">
        {REGIONS.map(([value, label]) => (
          <span key={value}>{label.split(" ")[0]}</span>
        ))}
      </div>
      <svg className="drawing-layer" viewBox={`0 0 ${card.width} ${card.height}`} aria-hidden="true">
        <defs>
          <marker id={`arrow-${card.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#0e7c7b" />
          </marker>
        </defs>
        {drawingAnnotations.map((item) => (
          <AnnotationShape key={item.id} annotation={item} card={card} markerId={`arrow-${card.id}`} />
        ))}
        {draft ? <AnnotationShape annotation={{ drawing: drawingPayload(draft, card), priority: "P1" }} card={card} markerId={`arrow-${card.id}`} draft /> : null}
      </svg>
      <div className="annotation-markers">
        {openAnnotations.map((item, index) => (
          <span key={item.id} className={`marker ${item.priority.toLowerCase()}`} style={{ top: 72 + index * 34 }}>
            {item.priority} {item.region.slice(0, 1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnnotationShape({ annotation, markerId, draft = false }) {
  const drawing = annotation.drawing || {};
  const className = `draw-shape ${annotation.priority?.toLowerCase() || "p1"} ${draft ? "draft" : ""}`;
  if (drawing.tool === "pen") {
    return <polyline className={className} points={(drawing.points || []).map((p) => `${p.x},${p.y}`).join(" ")} />;
  }
  if (drawing.tool === "box") {
    const rect = normalizedRect(drawing.start, drawing.end);
    return <rect className={className} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx="6" />;
  }
  if (drawing.tool === "arrow") {
    return <line className={className} x1={drawing.start.x} y1={drawing.start.y} x2={drawing.end.x} y2={drawing.end.y} markerEnd={`url(#${markerId})`} />;
  }
  if (drawing.tool === "note") {
    return (
      <g className={className}>
        <circle cx={drawing.start.x} cy={drawing.start.y} r="13" />
        <text x={drawing.start.x} y={drawing.start.y + 4} textAnchor="middle">!</text>
      </g>
    );
  }
  return null;
}

function buildAnnotationsPayload({ manifest, annotations }) {
  return {
    schema_version: "sellerpilot.review_annotations.v1",
    exported_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    annotations,
    canvas_note: "Generated images are the bottom floor layer; image standards and annotations float above them. The review board has no independent zoom.",
  };
}

function buildCanvasStatePayload({ manifest, cards, boardSize }) {
  return {
    schema_version: "sellerpilot.canvas_state.v2",
    updated_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    board: {
      width: boardSize.width,
      height: boardSize.height,
      zoom_policy: "locked-no-independent-canvas-zoom",
      layer_order: ["image-floor-layer", "drawing-layer", "standard-overlay-layer", "top-controls"],
    },
    fallback_layout: cards.map((card) => ({
      image_id: card.id,
      file: card.file,
      copied_file: card.copied_file,
      path: card.path,
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
    })),
  };
}

function buildCompletionPayload({ manifest, annotations, cards, boardSize, selectedImageId, screenshot }) {
  return {
    schema_version: "sellerpilot.review_completion.v1",
    completed_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    selected_image_id: selectedImageId,
    annotations,
    annotation_count: annotations.length,
    open_annotation_count: annotations.filter((item) => item.status !== "closed").length,
    canvas_state: buildCanvasStatePayload({ manifest, cards, boardSize }),
    review_screenshot: {
      filename: screenshot.filename,
      mime_type: "image/png",
      width: screenshot.width,
      height: screenshot.height,
      data_url: screenshot.data_url,
    },
    next_codex_step: "Capture this review-completion payload or screenshot, parse annotations into generation tasks, and revise only affected assets.",
  };
}

async function captureReviewPng({ manifest, cards, annotations, boardSize }) {
  const scale = 1;
  const canvas = document.createElement("canvas");
  canvas.width = boardSize.width * scale;
  canvas.height = (boardSize.height + 220) * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#eef3f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101820";
  ctx.font = "700 24px Arial";
  ctx.fillText(manifest?.workspace?.title || "SellerPilot Review", 32, 36);
  ctx.font = "13px Arial";
  ctx.fillStyle = "#4c5967";
  ctx.fillText("Layer order: generated images on bottom, standards and annotations above, no independent canvas zoom.", 32, 60);

  for (const card of cards) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, card.x, card.y + 56, card.width, card.height, 8);
    ctx.fill();
    ctx.strokeStyle = "#b7c5d3";
    ctx.stroke();
    ctx.fillStyle = "#0e7c7b";
    roundRect(ctx, card.x + 14, card.y + 70, 72, 26, 13);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 13px Arial";
    ctx.fillText(card.id, card.x + 26, card.y + 88);
    try {
      const image = await loadImage(card.src);
      ctx.drawImage(image, card.x + 16, card.y + 104, card.width - 32, card.width - 32);
    } catch {
      ctx.fillStyle = "#dfe7ef";
      ctx.fillRect(card.x + 16, card.y + 104, card.width - 32, card.width - 32);
      ctx.fillStyle = "#4c5967";
      ctx.fillText("image unavailable in screenshot", card.x + 30, card.y + 248);
    }
    ctx.fillStyle = "#101820";
    ctx.font = "700 12px Arial";
    ctx.fillText(card.copied_file || card.file, card.x + 16, card.y + card.height + 36);

    const cardDrawings = annotations.filter((item) => item.image_id === card.id && item.status !== "closed" && item.drawing);
    for (const item of cardDrawings) {
      drawCanvasAnnotation(ctx, item, card);
    }
    const cardNotes = annotations.filter((item) => item.image_id === card.id && item.status !== "closed").slice(0, 3);
    cardNotes.forEach((item, index) => {
      const y = card.y + 112 + index * 30;
      ctx.fillStyle = item.priority === "P0" ? "#c92a2a" : item.priority === "P1" ? "#0e7c7b" : "#596579";
      roundRect(ctx, card.x + card.width - 100, y, 84, 22, 11);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 11px Arial";
      ctx.fillText(`${item.priority} ${item.region.slice(0, 1)}`, card.x + card.width - 88, y + 15);
    });
  }

  const listY = boardSize.height + 92;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 32, listY, Math.min(1020, boardSize.width - 64), 104, 8);
  ctx.fill();
  ctx.fillStyle = "#101820";
  ctx.font = "700 16px Arial";
  ctx.fillText("Open revision standards", 52, listY + 30);
  ctx.font = "12px Arial";
  ctx.fillStyle = "#4c5967";
  annotations.slice(0, 4).forEach((item, index) => {
    ctx.fillText(`${item.priority} ${item.image_id} ${item.region}: ${truncate(item.comment, 112)}`, 52, listY + 54 + index * 18);
  });

  return {
    filename: `sellerpilot-review-${Date.now()}.png`,
    data_url: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
  };
}

function panelPoint(element, event) {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp(Math.round(event.clientX - rect.left), 0, Math.round(rect.width)),
    y: clamp(Math.round(event.clientY - rect.top), 0, Math.round(rect.height)),
  };
}

function isMeaningfulDrawing(draft) {
  if (draft.tool === "note") return true;
  if (draft.tool === "pen") return (draft.points || []).length > 3;
  const dx = Math.abs((draft.current?.x || 0) - (draft.start?.x || 0));
  const dy = Math.abs((draft.current?.y || 0) - (draft.start?.y || 0));
  return dx + dy > 8;
}

function drawingPayload(draft, card) {
  const start = draft.start || { x: 0, y: 0 };
  const end = draft.current || start;
  return {
    tool: draft.tool,
    coordinate_space: "image_card",
    card_width: card.width,
    card_height: card.height,
    start,
    end,
    points: (draft.points || []).slice(-240),
  };
}

function drawingFallbackComment(tool) {
  const labels = {
    pen: "按画笔圈出的区域修改。",
    box: "按框选区域修改。",
    arrow: "按箭头指向的位置修改。",
    note: "按标记位置修改。",
    select: "按所选图片修改。",
  };
  return labels[tool] || "按画板标注修改。";
}

function normalizedRect(start, end) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.max(1, Math.abs(start.x - end.x)),
    height: Math.max(1, Math.abs(start.y - end.y)),
  };
}

function drawCanvasAnnotation(ctx, item, card) {
  const drawing = item.drawing || {};
  ctx.save();
  ctx.strokeStyle = item.priority === "P0" ? "#c92a2a" : item.priority === "P2" ? "#596579" : "#0e7c7b";
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.94;
  const offsetY = 56;
  if (drawing.tool === "pen" && Array.isArray(drawing.points) && drawing.points.length) {
    ctx.beginPath();
    drawing.points.forEach((point, index) => {
      const x = card.x + point.x;
      const y = card.y + offsetY + point.y;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else if (drawing.tool === "box") {
    const rect = normalizedRect(drawing.start, drawing.end);
    ctx.strokeRect(card.x + rect.x, card.y + offsetY + rect.y, rect.width, rect.height);
  } else if (drawing.tool === "arrow") {
    drawArrow(ctx, card.x + drawing.start.x, card.y + offsetY + drawing.start.y, card.x + drawing.end.x, card.y + offsetY + drawing.end.y);
  } else if (drawing.tool === "note") {
    ctx.beginPath();
    ctx.arc(card.x + drawing.start.x, card.y + offsetY + drawing.start.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 16px Arial";
    ctx.fillText("!", card.x + drawing.start.x - 3, card.y + offsetY + drawing.start.y + 6);
  }
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 14 * Math.cos(angle - Math.PI / 6), y2 - 14 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - 14 * Math.cos(angle + Math.PI / 6), y2 - 14 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  downloadBlob(filename, blob);
}

function downloadDataUrl(filename, dataUrl) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
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

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

createRoot(document.getElementById("root")).render(<App />);
