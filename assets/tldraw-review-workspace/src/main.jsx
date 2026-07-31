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
  ["modify", "需要调整"],
  ["identity-drift", "商品不像原图"],
  ["surface-material-transfer-drift", "颜色、材质或图案不对"],
  ["copy-adjust", "文字需要修改"],
  ["rerender-layout", "排版需要调整"],
  ["scene-asset-required", "场景不自然"],
  ["regenerate", "重新生成这张图"],
];

const PRIORITIES = [
  ["P0", "必须修复"],
  ["P1", "建议修复"],
  ["P2", "细节优化"],
];

const QUICK_FEEDBACK = [
  ["identity-drift", "商品不像原图", "保持原本外形、结构和关键细节", "P0"],
  ["surface-material-transfer-drift", "颜色 / 材质 / 图案不对", "恢复原图的颜色、材质或图案", "P0"],
  ["copy-adjust", "文字不清楚或不合适", "修改图片中的买家文案与文字排版", "P1"],
  ["rerender-layout", "排版或重点不清楚", "调整构图、留白、层级或商品占比", "P1"],
  ["scene-asset-required", "场景不自然", "使用更真实、符合商品用途的场景", "P1"],
  ["regenerate", "这张图需要重做", "按原商品重新生成这张图片", "P0"],
];

function App() {
  const editorRef = useRef(null);
  const importedManifestKeyRef = useRef("");
  const renderedShapeIdsRef = useRef([]);
  const canvasSnapshotsRef = useRef({});
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
      x: 90,
      y: 80,
      width: 900,
      height: 900,
    }));
  }, [images]);

  const selectedImage = cards.find((image) => image.id === selectedImageId);
  const selectedCards = selectedImage ? [selectedImage] : [];
  const openAnnotations = annotations.filter((item) => item.status !== "closed");
  const markedImages = new Set(openAnnotations.map((item) => item.image_id));
  const unmarkedCount = Math.max(0, cards.length - markedImages.size);

  const importImagesIntoTldraw = useCallback((editor, nextCards) => {
    if (!editor || !nextCards.length) return;
    const manifestKey = nextCards.map((card) => `${card.id}:${card.src}`).join("|");
    if (importedManifestKeyRef.current === manifestKey) return;
    importedManifestKeyRef.current = manifestKey;
    if (renderedShapeIdsRef.current.length) editor.deleteShapes(renderedShapeIdsRef.current);

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
    renderedShapeIdsRef.current = [...imageShapeIds, ...labelShapeIds];
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
    setStatus("在大图上圈选或画箭头；未标注图片会自动保留");
  }, []);

  useEffect(() => {
    if (editorRef.current && selectedCards.length) {
      importImagesIntoTldraw(editorRef.current, selectedCards);
    }
  }, [selectedCards, importImagesIntoTldraw]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    if (selectedCards.length) importImagesIntoTldraw(editor, selectedCards);
  }, [selectedCards, importImagesIntoTldraw]);

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
    setStatus("已记录修改意见；可继续在大图上圈选或画箭头说明位置");
  };

  const addQuickFeedback = ([nextIssue, label, instruction, nextPriority]) => {
    if (!selectedImageId) return;
    setIssueType(nextIssue);
    setPriority(nextPriority);
    setComment(instruction);
    setAnnotations((current) => [{
      id: `ann-${Date.now()}`,
      image_id: selectedImageId,
      image_file: selectedImage?.copied_file || selectedImage?.file || "",
      source_file: selectedImage?.file || "",
      image_path: selectedImage?.path || "",
      region: "H-overall-style",
      issue_type: nextIssue,
      priority: nextPriority,
      comment: instruction,
      status: "open",
      created_at: new Date().toISOString(),
      source: "sellerpilot-quick-review-library",
    }, ...current]);
    editorRef.current?.setCurrentTool("arrow");
    setStatus(`已记录“${label}”；现在可在大图上画箭头或圈出具体位置`);
  };

  const captureActiveCanvas = () => {
    if (selectedImageId && editorRef.current?.store?.getSnapshot) canvasSnapshotsRef.current[selectedImageId] = editorRef.current.store.getSnapshot();
  };

  const switchImage = (id) => {
    captureActiveCanvas();
    setSelectedImageId(id);
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
    captureActiveCanvas();
    const payload = buildCompletionPayload({
      manifest,
      annotations,
      editor: editorRef.current,
      cards,
      selectedImageId,
      canvasSnapshots: canvasSnapshotsRef.current,
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
          <span className="review-count">已标注 {openAnnotations.length} 项 · 未标注 {unmarkedCount} 张会保留</span>
          <button onClick={() => editorRef.current?.setCurrentTool("draw")}>圈选 / 手绘</button>
          <button onClick={() => editorRef.current?.setCurrentTool("arrow")}>画箭头</button>
          <button onClick={() => editorRef.current?.setCurrentTool("text")}>补充文字</button>
          <button onClick={() => setFormOpen((value) => !value)}>{formOpen ? "收起补充说明" : "补充说明"}</button>
          <button className="primary action-complete-review" onClick={completeReview}>提交修改给 AI（{openAnnotations.length}）</button>
        </div>
      </header>

      <main className="workspace">
        <section className="review-guidance" aria-label="审核提示与图片导览">
          <div className="review-tip"><strong>这样标注，AI 更容易改对</strong><span>只需选择要改的图片，再点一个常见问题；如有具体位置，请在大图上圈选或画箭头。未标注图片默认保留。</span></div>
          <div className="thumbnail-nav">{cards.map((image) => { const count = annotations.filter((item) => item.image_id === image.id && item.status !== "closed").length; return <button key={image.id} className={`thumbnail-item ${image.id === selectedImageId ? "selected" : ""}`} onClick={() => switchImage(image.id)}><img src={image.src} alt={image.id} /><span>{image.id}{count ? <em>{count}</em> : null}</span></button>; })}</div>
          <div className="quick-feedback"><strong>常见问题</strong>{QUICK_FEEDBACK.map((item) => <button key={item[0]} onClick={() => addQuickFeedback(item)}>{item[1]}</button>)}</div>
        </section>
        {formOpen ? (
          <section className="review-toolbar" aria-label="Optional structured image standard form">
            <label>
              修改位置
              <select value={regionLabel} onChange={(event) => setRegionLabel(event.target.value)}>
                {REGIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              问题类型
              <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
                {ISSUE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              优先级
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="comment-field">
              补充说明
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="可选：补充结构化批注，画布上的自由标注仍以 tldraw snapshot 为准。"
              />
            </label>
            <button className="primary" onClick={addAnnotation}>添加修改意见</button>
            <button onClick={clearAnnotations}>清空本次标注</button>
          </section>
        ) : null}

        <section className="selected-summary">
          <strong>{selectedImage?.id || "未选择图片"}</strong>
          <span>{selectedImage?.copied_file || selectedImage?.file || ""}</span>
          <span>{annotations.filter((item) => item.image_id === selectedImageId && item.status !== "closed").length} 条待修改意见</span>
          <span className="scale-lock">大图审核模式</span>
          {completion ? <span className="review-complete-ready">审核意见已提交</span> : null}
        </section>

        <section className="tldraw-shell" aria-label="Native tldraw review canvas">
          <Tldraw key={selectedImageId} onMount={handleMount} persistenceKey={`sellerpilot-tldraw-review:${STORAGE_SCOPE}:${selectedImageId}`} />
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

function buildCompletionPayload({ manifest, annotations, editor, cards, selectedImageId, canvasSnapshots = {} }) {
  const canvasState = buildCanvasStatePayload({ manifest, editor, cards });
  canvasState.tldraw_snapshots_by_image = canvasSnapshots;
  return {
    schema_version: "sellerpilot.review_completion.v2",
    completed_at: new Date().toISOString(),
    workspace: manifest?.workspace || {},
    selected_image_id: selectedImageId,
    annotations,
    annotation_count: annotations.length,
    open_annotation_count: annotations.filter((item) => item.status !== "closed").length,
    review_policy: { unannotated_images: "keep_approved", annotated_images: "revise_only" },
    implicitly_approved_image_ids: cards.filter((card) => !annotations.some((item) => item.status !== "closed" && item.image_id === card.id)).map((card) => card.id),
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
