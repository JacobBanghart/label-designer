import { useCallback, useEffect, useRef, useState } from "react";

import { isShapeElement, isTextElement } from "../core/document.ts";
import { LABEL_SIZES, resolveGeometry, type LabelSizeId } from "../core/label.ts";
import { getTransport } from "../core/transport.ts";
import { useEditor } from "../editor/store.ts";
import { rasterizeDocument } from "../raster/index.ts";
import { downloadJson, importJson, load, save } from "../storage/local.ts";
import { Inspector } from "./Inspector.tsx";
import { LabelCanvas, type Tool } from "./LabelCanvas.tsx";
import { ShapeInspector } from "./ShapeInspector.tsx";
import { MonoPreview } from "./MonoPreview.tsx";
import { useElementSize } from "./useElementSize.ts";

/** Breathing room around the label inside the stage area, in CSS pixels. */
const CANVAS_MARGIN = 48;
/** Drawing tools, in toolbar order. Each is drag-to-draw on the canvas. */
const TOOLS = [
  { kind: "rect", label: "Rect", hint: "Rectangle (R) -- drag on the label" },
  { kind: "ellipse", label: "Ellipse", hint: "Ellipse (O) -- drag on the label" },
  { kind: "line", label: "Line", hint: "Line (L) -- drag on the label" },
  { kind: "arrow", label: "Arrow", hint: "Arrow (A) -- drag on the label" },
  { kind: "freehand", label: "Pen", hint: "Freehand pen (P) -- drag on the label" },
] as const;

/** Single-key tool shortcuts. `null` is the select/move tool. */
const TOOL_KEYS: Record<string, Tool> = {
  v: null,
  r: "rect",
  o: "ellipse",
  l: "line",
  a: "arrow",
  p: "freehand",
};

/** Used for the first paint, before the ResizeObserver has measured. */
const FALLBACK_SCALE = 0.4;

export function App() {
  /*
   * Seed the editor from storage at initialisation rather than restoring in an
   * effect.
   *
   * The effect version has a data-loss race: autosave fires on mount with the
   * empty initial document, before the restore dispatch has committed, and
   * overwrites the saved design. StrictMode's double-mount then reads that
   * empty doc straight back. Seeding means no empty document ever exists.
   */
  const [initialDoc] = useState(() => load() ?? undefined);
  const { doc, selected, selectedId, dispatch, canUndo, canRedo } = useEditor(initialDoc);
  const [copies, setCopies] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stageRef, stageSize] = useElementSize<HTMLElement>();
  const [tool, setTool] = useState<Tool>(null);

  /*
   * Single-key tool switching, the way every drawing app works.
   *
   * Deliberately kept here rather than in useEditor: the tool is view state,
   * not document state, so it must not be undoable. Defers to form fields for
   * the same reason the editor shortcuts do -- typing "r" in the inspector must
   * type an r.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if (key === "escape") {
        setTool(null);
        return;
      }
      if (key === "t") {
        event.preventDefault();
        dispatch({ type: "addText" });
        return;
      }
      const next = TOOL_KEYS[key];
      if (next !== undefined) {
        event.preventDefault();
        setTool(next);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // Autosave. Safe to run unconditionally only because the editor is seeded
  // from storage during initialisation (see useEditor call above) -- there is
  // never a moment where an empty document could be written over saved work.
  useEffect(() => {
    save(doc);
  }, [doc]);

  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

  // Fit the label to whatever room the stage area has, leaving a margin. Capped
  // at 1:1 so a small label on a big screen is not blown up past its real
  // resolution, which would just show interpolation artefacts.
  const scale = Math.min(
    1,
    stageSize.width > 0 ? (stageSize.width - CANVAS_MARGIN) / geometry.widthPx : FALLBACK_SCALE,
    stageSize.height > 0 ? (stageSize.height - CANVAS_MARGIN) / geometry.heightPx : FALLBACK_SCALE,
  );

  const handlePrint = useCallback(async () => {
    const transport = getTransport("pdf");
    if (!transport) {
      setStatus("No print transport registered.");
      return;
    }
    setStatus("Rendering...");
    try {
      const raster = await rasterizeDocument(doc);
      const result = await transport.print(raster, { copies });
      setStatus(
        result.ok ? "Sent to print dialog." : `Print failed: ${result.message ?? "unknown"}`,
      );
    } catch (err) {
      setStatus(`Print failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [doc, copies]);

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="doc-name"
          value={doc.name}
          onChange={(event) => dispatch({ type: "rename", name: event.target.value })}
          aria-label="Label name"
        />

        <div className="group">
          <button type="button" onClick={() => dispatch({ type: "undo" })} disabled={!canUndo}>
            Undo
          </button>
          <button type="button" onClick={() => dispatch({ type: "redo" })} disabled={!canRedo}>
            Redo
          </button>
        </div>

        <div className="group">
          <label htmlFor="size">Size</label>
          <select
            id="size"
            value={doc.sizeId}
            onChange={(event) =>
              dispatch({ type: "setSize", sizeId: event.target.value as LabelSizeId })
            }
          >
            {LABEL_SIZES.map((size) => (
              <option key={size.id} value={size.id}>
                {size.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "setOrientation",
                orientation: doc.orientation === "portrait" ? "landscape" : "portrait",
              })
            }
            title="Rotate the whole label, taking its contents with it"
          >
            Rotate canvas ({doc.orientation})
          </button>
        </div>

        <div className="group tools">
          <button
            type="button"
            className={tool === null ? "active" : ""}
            onClick={() => setTool(null)}
            title="Select and move (V)"
          >
            Select
          </button>
          <button type="button" onClick={() => dispatch({ type: "addText" })} title="Add text (T)">
            Text
          </button>
          {TOOLS.map(({ kind, label, hint }) => (
            <button
              key={kind}
              type="button"
              className={tool === kind ? "active" : ""}
              onClick={() => setTool(tool === kind ? null : kind)}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="group right">
          <button type="button" onClick={() => setShowPreview((value) => !value)}>
            {showPreview ? "Hide" : "Show"} 1-bit preview
          </button>
          <button type="button" onClick={() => downloadJson(doc)}>
            Export
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const parsed = importJson(await file.text());
              if (parsed) {
                dispatch({ type: "load", doc: parsed });
                setStatus(null);
              } else {
                setStatus("That file is not a valid label design.");
              }
              event.target.value = "";
            }}
          />

          <label htmlFor="copies">Copies</label>
          <input
            id="copies"
            type="number"
            min={1}
            max={99}
            value={copies}
            onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
          />
          <button type="button" className="primary" onClick={handlePrint}>
            Print
          </button>
        </div>
      </header>

      <div className="body">
        <main className="stage-area" ref={stageRef}>
          <div className="stage-meta">
            {geometry.widthIn}&Prime; &times; {geometry.heightIn}&Prime; &middot; {geometry.widthPx}{" "}
            &times; {geometry.heightPx} px @ {doc.dpi} DPI
          </div>
          <LabelCanvas
            doc={doc}
            selectedId={selectedId}
            scale={scale}
            tool={tool}
            onToolUsed={() => setTool(null)}
            dispatch={dispatch}
          />
          {status && <p className="status">{status}</p>}
        </main>

        <aside className="sidebar">
          {selected && isTextElement(selected) ? (
            <Inspector element={selected} dispatch={dispatch} />
          ) : selected && isShapeElement(selected) ? (
            <ShapeInspector element={selected} dispatch={dispatch} />
          ) : (
            <div className="empty">
              <p>Nothing selected.</p>
              <p className="hint">
                Add a text element, or click one on the label to edit it. Drag to move, use the
                handles to resize and rotate.
              </p>
            </div>
          )}

          {showPreview && (
            <div className="preview-panel">
              <h2>Printer output</h2>
              <p className="hint">
                Exactly what gets burned &mdash; 1 bit, no grey. Set the print dialog to
                &ldquo;Actual size&rdquo; or output will be rescaled.
              </p>
              <MonoPreview doc={doc} displayWidth={220} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
