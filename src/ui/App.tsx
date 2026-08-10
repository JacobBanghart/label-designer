import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isImageElement,
  isShapeElement,
  isTextElement,
  type LabelDocument,
} from "../core/document.ts";
import {
  LABEL_SIZES,
  resolveGeometry,
  supportsOrientation,
  type LabelSizeId,
} from "../core/label.ts";
import { getTransport } from "../core/transport.ts";
import { useEditor } from "../editor/store.ts";
import { createDocument, nextId } from "../editor/operations.ts";
import { outOfBoundsIds } from "../editor/bounds.ts";
import { rasterizeDocument } from "../raster/index.ts";
import { importJson } from "../storage/local.ts";
import { exportJson, exportPdf, exportPng } from "../editor/exporters.ts";
import { createImageElement, readImageFile } from "../editor/importImage.ts";
import { createTestPatternElement } from "../editor/testPattern.ts";
import {
  loadActive,
  loadLibrary,
  nextUntitledName,
  removeFromLibrary,
  reorderLibrary,
  saveToLibrary,
  setActiveId,
  type Library,
} from "../storage/library.ts";
import { useAutosave, type AutosaveResult } from "../storage/useAutosave.ts";
import { Inspector } from "./Inspector.tsx";
import { LabelCanvas, type Tool } from "./LabelCanvas.tsx";
import { ShapeInspector } from "./ShapeInspector.tsx";
import { ImageInspector } from "./ImageInspector.tsx";
import { MultiInspector } from "./MultiInspector.tsx";
import { LibraryPanel } from "./LibraryPanel.tsx";
import { PrinterPanel } from "./PrinterPanel.tsx";
import { MonoPreview } from "./MonoPreview.tsx";
import { InlineTextEditor } from "./InlineTextEditor.tsx";
import { useElementSize } from "./useElementSize.ts";
import { useDisplayUnit } from "./useDisplayUnit.ts";
import { DISPLAY_UNITS, type DisplayUnit } from "../core/units.ts";

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
  const [initialDoc] = useState(() => loadActive() ?? undefined);
  const { doc, selected, selectedElements, selectedIds, dispatch, canUndo, canRedo } =
    useEditor(initialDoc);
  const [copies, setCopies] = useState(1);
  const [status, setStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stageRef, stageSize] = useElementSize<HTMLElement>();
  const imageRef = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [unit, setUnit] = useDisplayUnit();
  const [usbConnected, setUsbConnected] = useState(false);
  const [library, setLibrary] = useState<Library>(() => loadLibrary());

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
  /*
   * Autosave is debounced: the write path is synchronous and a library holding
   * image labels is megabytes, which drops frames while typing. A pending save
   * is flushed when the page hides, so debouncing cannot cost the last edit.
   */
  const persist = useCallback((next: LabelDocument) => {
    // Quota exhaustion is realistic once a label carries images. Silently not
    // saving would be the worst possible response, so this throws and the
    // result handler surfaces it.
    saveToLibrary(next);
    setLibrary(loadLibrary());
  }, []);

  const onSaveResult = useCallback(({ error }: AutosaveResult) => setSaveError(error), []);

  useAutosave(doc, persist, onSaveResult);

  /** Import one or more dropped/selected image files. */
  const importImages = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          setStatus(`${file.name} is not an image.`);
          continue;
        }
        const imported = await readImageFile(file);
        if (!imported) {
          setStatus(`Could not read ${file.name}.`);
          continue;
        }
        dispatch({ type: "addElement", element: createImageElement(doc, imported) });
      }
    },
    [dispatch, doc],
  );

  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

  /*
   * Content outside the label is clipped on print with no error and no trace,
   * which makes it the most dangerous failure mode here -- the design still
   * looks complete on screen. Surfaced rather than left to be discovered on a
   * printed label.
   */
  const clippedIds = useMemo(() => outOfBoundsIds(doc), [doc]);

  // The text element being edited inline, if it still exists (undo can remove it).
  const editingElement = useMemo(() => {
    const found = doc.elements.find((el) => el.id === editingId);
    return found && isTextElement(found) ? found : null;
  }, [doc, editingId]);

  // Fit the label to whatever room the stage area has, leaving a margin. Capped
  // at 1:1 so a small label on a big screen is not blown up past its real
  // resolution, which would just show interpolation artefacts.
  const scale = Math.min(
    1,
    stageSize.width > 0 ? (stageSize.width - CANVAS_MARGIN) / geometry.widthPx : FALLBACK_SCALE,
    stageSize.height > 0 ? (stageSize.height - CANVAS_MARGIN) / geometry.heightPx : FALLBACK_SCALE,
  );

  /*
   * Switching labels autosaves first (the effect above already wrote the
   * current doc), so there is no explicit save button to forget. Opening is
   * therefore always safe.
   */
  const handleOpen = useCallback(
    (next: LabelDocument) => {
      setActiveId(next.id);
      dispatch({ type: "load", doc: next });
      setStatus(null);
    },
    [dispatch],
  );

  const handleNew = useCallback(() => {
    const fresh = {
      ...createDocument(doc.sizeId, doc.orientation),
      name: nextUntitledName(loadLibrary()),
    };
    saveToLibrary(fresh);
    setLibrary(loadLibrary());
    dispatch({ type: "load", doc: fresh });
  }, [dispatch, doc.sizeId, doc.orientation]);

  const handleDuplicate = useCallback(() => {
    // New id and a distinct name, otherwise the copy overwrites the original
    // on the next autosave.
    const copy = { ...doc, id: nextId("doc"), name: `${doc.name} copy` };
    saveToLibrary(copy);
    setLibrary(loadLibrary());
    dispatch({ type: "load", doc: copy });
  }, [dispatch, doc]);

  const handleDelete = useCallback(
    (id: string) => {
      const remaining = removeFromLibrary(id);
      setLibrary(remaining);
      if (id !== doc.id) return;

      // Deleting the open label has to leave something on screen.
      const next = loadActive() ?? createDocument();
      dispatch({ type: "load", doc: next });
    },
    [dispatch, doc.id],
  );

  const handlePrint = useCallback(async () => {
    // Prefer the direct connection when there is one: it skips the dialog, the
    // OS driver, and every layer that has caused a printing bug here.
    const transport = getTransport(usbConnected ? "webusb" : "pdf");
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
  }, [doc, copies, usbConnected]);

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

          <label htmlFor="unit">Units</label>
          <select
            id="unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as DisplayUnit)}
            title="Unit used for positions and sizes"
          >
            {DISPLAY_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          {supportsOrientation(doc.sizeId) && (
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
          )}
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
          <button
            type="button"
            onClick={() => imageRef.current?.click()}
            title="Add an image (or drop one on the label)"
          >
            Image
          </button>
          <button
            type="button"
            onClick={() => {
              const element = createTestPatternElement(doc);
              if (element) dispatch({ type: "addElement", element });
            }}
            title="Add a gradient and step wedge for checking 1-bit output"
          >
            Test pattern
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
          {/*
            Three explicit buttons rather than one "Export": PDF and PNG are the
            artifacts you hand to someone or archive, JSON is the save file.
            Collapsing them lost that distinction and surprised people who
            expected a printable file.
          */}
          <span className="group-label">Export</span>
          <button
            type="button"
            onClick={async () => {
              setStatus("Exporting PDF...");
              try {
                await exportPdf(doc);
                setStatus(null);
              } catch (err) {
                setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="Print-ready PDF at the label's exact physical size"
          >
            PDF
          </button>
          <button
            type="button"
            onClick={async () => {
              setStatus("Exporting PNG...");
              try {
                await exportPng(doc);
                setStatus(null);
              } catch (err) {
                setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
              }
            }}
            title="1-bit PNG at the label's native resolution"
          >
            PNG
          </button>
          <button type="button" onClick={() => exportJson(doc)} title="The design, for re-import">
            JSON
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} title="Open a .json label">
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

          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (event) => {
              if (event.target.files) await importImages(event.target.files);
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
          <button
            type="button"
            className="primary"
            onClick={handlePrint}
            title={
              usbConnected
                ? "Send straight to the connected printer, no dialog"
                : "Open the system print dialog"
            }
          >
            {usbConnected ? "Print (USB)" : "Print"}
          </button>
        </div>
      </header>

      <div className="body">
        <main
          className={dragOver ? "stage-area drag-over" : "stage-area"}
          ref={stageRef}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (event) => {
            event.preventDefault();
            setDragOver(false);
            if (event.dataTransfer.files.length) await importImages(event.dataTransfer.files);
          }}
        >
          <div className="stage-meta">
            {geometry.widthIn}&Prime; &times; {geometry.heightIn}&Prime; &middot; {geometry.widthPx}{" "}
            &times; {geometry.heightPx} px @ {doc.dpi} DPI
          </div>
          {/*
            Wrapper sized to the scaled label so the inline text editor can be
            absolutely positioned over the exact Konva coordinates.
          */}
          <div
            className="stage-canvas"
            style={{ width: geometry.widthPx * scale, height: geometry.heightPx * scale }}
          >
            <LabelCanvas
              doc={doc}
              selectedIds={selectedIds}
              clippedIds={clippedIds}
              editingId={editingId}
              onEditStart={(id) => {
                dispatch({ type: "beginGesture" });
                setEditingId(id);
              }}
              scale={scale}
              tool={tool}
              onToolUsed={() => setTool(null)}
              dispatch={dispatch}
            />
            {editingElement && (
              <InlineTextEditor
                element={editingElement}
                scale={scale}
                onChange={(text) =>
                  dispatch({
                    type: "update",
                    id: editingElement.id,
                    patch: { text },
                    transient: true,
                  })
                }
                onCommit={() => setEditingId(null)}
              />
            )}
          </div>

          {/*
            Overlaid rather than stacked below the canvas. These messages appear
            and disappear as you work, and in the flow they changed the measured
            size of the stage area -- which recomputes the canvas scale and makes
            the label visibly jump. An overlay cannot disturb the layout it
            floats over.
          */}
          <div className="stage-messages">
            {clippedIds.length > 0 && (
              <div className="warning">
                <span>
                  {clippedIds.length} element{clippedIds.length === 1 ? "" : "s"} extend
                  {clippedIds.length === 1 ? "s" : ""} past the label and will be cut off when
                  printed.
                </span>
                {/*
                  These buttons are the only handles on a strayed element: the
                  canvas is sized to the label, so anything lying fully outside it
                  cannot be clicked at all.
                */}
                <button
                  type="button"
                  onClick={() => dispatch({ type: "selectMany", ids: clippedIds })}
                >
                  Select
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "clampIntoBounds", ids: clippedIds })}
                >
                  Move onto label
                </button>
              </div>
            )}
            {status && <p className="status">{status}</p>}
            {saveError && <p className="error">{saveError}</p>}
          </div>
        </main>

        <aside className="sidebar">
          {selectedElements.length > 1 ? (
            <MultiInspector elements={selectedElements} dispatch={dispatch} />
          ) : selected && isTextElement(selected) ? (
            <Inspector element={selected} unit={unit} dpi={doc.dpi} dispatch={dispatch} />
          ) : selected && isShapeElement(selected) ? (
            <ShapeInspector element={selected} unit={unit} dpi={doc.dpi} dispatch={dispatch} />
          ) : selected && isImageElement(selected) ? (
            <ImageInspector element={selected} unit={unit} dpi={doc.dpi} dispatch={dispatch} />
          ) : (
            <div className="empty">
              <p>Nothing selected.</p>
              <p className="hint">
                Add a text element, or click one on the label to edit it. Drag to move, use the
                handles to resize and rotate.
              </p>
            </div>
          )}

          <PrinterPanel onConnectedChange={setUsbConnected} />

          <LibraryPanel
            library={library}
            activeId={doc.id}
            onOpen={handleOpen}
            onNew={handleNew}
            onDuplicate={handleDuplicate}
            onDelete={handleDelete}
            onReorder={(ids) => setLibrary(reorderLibrary(ids))}
          />

          {showPreview && (
            <div className="preview-panel">
              <h2>Printer output</h2>
              <p className="hint">
                Exactly what gets burned &mdash; 1 bit, no grey. Set the print dialog to
                &ldquo;Actual size&rdquo; or output will be rescaled.
              </p>
              <MonoPreview doc={doc} displayWidth={220} onExpand={() => setPreviewExpanded(true)} />
            </div>
          )}
        </aside>
      </div>

      {previewExpanded && (
        <div
          className="preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Printer output, full size"
          onClick={() => setPreviewExpanded(false)}
        >
          <div className="preview-modal-inner" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>
                Printer output &mdash; {geometry.widthPx} &times; {geometry.heightPx} px @ {doc.dpi}{" "}
                DPI
              </h2>
              <button type="button" onClick={() => setPreviewExpanded(false)}>
                Close
              </button>
            </header>
            <p className="hint">
              Exactly the pixels that get burned. Set the print dialog to &ldquo;Actual size&rdquo;
              or output will be rescaled.
            </p>
            {/* Rendered at 1:1 device pixels, which is the only honest way to
                judge 1-bit output; the container scrolls rather than scaling. */}
            <div className="preview-modal-scroll">
              <MonoPreview doc={doc} displayWidth={geometry.widthPx} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
