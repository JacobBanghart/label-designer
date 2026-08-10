/**
 * The editing surface.
 *
 * The Konva stage works in DEVICE PIXELS at the label's DPI (a 4x6 at 203 DPI
 * is 812x1218), and is scaled down only for display. Keeping the model at
 * device resolution means what the editor stores is exactly what the rasterizer
 * renders -- no unit conversion, no rounding drift.
 */

import { useEffect, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";

import {
  isImageElement,
  isShapeElement,
  isTextElement,
  type Element,
  type LabelDocument,
} from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import type { EditorAction } from "../editor/store.ts";
import { boxElementFromDrag, polylineFromPoints, type ShapeKind } from "../editor/operations.ts";
import { ShapeNode } from "./ShapeNode.tsx";
import { ImageNode } from "./ImageNode.tsx";
import { computeSnap, type Guide } from "../editor/snapping.ts";

/** Magnetic pull radius, in SCREEN pixels; divided by scale at use. */
const SNAP_SCREEN_PX = 7;

/** null means the select/move tool. */
export type Tool = ShapeKind | null;

interface Props {
  doc: LabelDocument;
  selectedId: string | null;
  scale: number;
  tool: Tool;
  onToolUsed: () => void;
  dispatch: (action: EditorAction) => void;
}

export function LabelCanvas({ doc, selectedId, scale, tool, onToolUsed, dispatch }: Props) {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Points of the stroke currently being drawn, in label coordinates. Held in
  // component state rather than the document so an in-progress gesture never
  // enters undo history.
  const [draft, setDraft] = useState<number[] | null>(null);

  // Alignment guides for the drag in progress. Also view-only state.
  const [guides, setGuides] = useState<readonly Guide[]>([]);

  /*
   * Snap an element being dragged, and record the guides to draw.
   *
   * The threshold is divided by the display scale so the magnetic pull is a
   * constant number of SCREEN pixels. In label space it would be ~8px on a
   * zoomed-out 4x6 and feel far stronger than on a 2x1.
   */
  function onDragPosition(moving: Element) {
    if (snapDisabled.current) {
      setGuides([]);
      return { dx: 0, dy: 0 };
    }
    const result = computeSnap(moving, doc.elements, geometry, SNAP_SCREEN_PX / scale);
    setGuides(result.guides);
    return result;
  }

  function onDragDone() {
    setGuides([]);
  }

  // Holding Alt suspends snapping, the usual convention for nudging something
  // into a position the guides keep pulling it out of.
  const snapDisabled = useRef(false);
  useEffect(() => {
    const set = (event: KeyboardEvent) => {
      snapDisabled.current = event.altKey;
    };
    window.addEventListener("keydown", set);
    window.addEventListener("keyup", set);
    return () => {
      window.removeEventListener("keydown", set);
      window.removeEventListener("keyup", set);
    };
  }, []);

  /** Pointer position in label device pixels, undoing the display scale. */
  function pointerInLabelSpace(): [number, number] | null {
    const stage = stageRef.current;
    const position = stage?.getPointerPosition();
    if (!position) return null;
    return [position.x / scale, position.y / scale];
  }

  function handleDrawStart() {
    if (!tool) return;
    const point = pointerInLabelSpace();
    if (!point) return;
    setDraft([point[0], point[1]]);
  }

  function handleDrawMove() {
    if (!tool || !draft) return;
    const point = pointerInLabelSpace();
    if (!point) return;

    setDraft((current) => {
      if (!current) return current;
      // Freehand accumulates every sample; the others are two-point gestures
      // where the second point simply tracks the cursor.
      if (tool === "freehand") return [...current, point[0], point[1]];
      return [current[0]!, current[1]!, point[0], point[1]];
    });
  }

  function handleDrawEnd() {
    if (!tool || !draft) return;
    const points = draft;
    setDraft(null);

    const element =
      tool === "rect" || tool === "ellipse"
        ? boxElementFromDrag(doc, tool, points)
        : polylineFromPoints(doc, tool, points);

    // A click without a drag produces a degenerate element; drop it rather than
    // leaving an invisible zero-size shape on the label.
    if (element) dispatch({ type: "addElement", element });
    onToolUsed();
  }

  // Attach the transformer to whichever node is selected.
  useEffect(() => {
    const transformer = transformerRef.current;
    const layer = layerRef.current;
    if (!transformer || !layer) return;

    const node = selectedId ? layer.findOne(`#${selectedId}`) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, doc]);

  return (
    <Stage
      ref={stageRef}
      width={geometry.widthPx * scale}
      height={geometry.heightPx * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(event) => {
        if (tool) {
          handleDrawStart();
          return;
        }
        // Clicking empty space clears the selection.
        if (event.target === event.target.getStage()) dispatch({ type: "select", id: null });
      }}
      onMouseMove={handleDrawMove}
      onMouseUp={handleDrawEnd}
      onMouseLeave={handleDrawEnd}
      onTouchStart={handleDrawStart}
      onTouchMove={handleDrawMove}
      onTouchEnd={handleDrawEnd}
      style={{
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        cursor: tool ? "crosshair" : "default",
      }}
    >
      <Layer ref={layerRef}>
        {/* The label boundary. Anything outside it will not print. */}
        <Rect
          x={0}
          y={0}
          width={geometry.widthPx}
          height={geometry.heightPx}
          fill="#ffffff"
          listening={false}
        />

        {doc.elements.map((element) => (
          <ElementNode
            key={element.id}
            element={element}
            dispatch={dispatch}
            onSelect={() => dispatch({ type: "select", id: element.id })}
            onDragPosition={onDragPosition}
            onDragDone={onDragDone}
          />
        ))}

        {/* Live preview of the stroke being drawn. Not part of the document,
            so it never enters undo history. */}
        {draft && tool && <DraftPreview tool={tool} points={draft} doc={doc} />}

        {guides.map((guide) => (
          <Line
            key={`${guide.orientation}-${guide.position}`}
            points={
              guide.orientation === "vertical"
                ? [guide.position, 0, guide.position, geometry.heightPx]
                : [0, guide.position, geometry.widthPx, guide.position]
            }
            stroke="#e0218a"
            strokeWidth={1 / scale}
            dash={[6 / scale, 4 / scale]}
            listening={false}
          />
        ))}

        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio={false}
          // Handles are drawn in stage space, so counter-scale them to stay a
          // usable size no matter how far the label is zoomed out.
          anchorSize={10 / scale}
          borderStrokeWidth={1 / scale}
          anchorStrokeWidth={1 / scale}
          rotateAnchorOffset={24 / scale}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 10 || newBox.height < 10 ? oldBox : newBox
          }
        />
      </Layer>
    </Stage>
  );
}

/**
 * The shape currently under the cursor mid-drag.
 *
 * Built through the same constructors the commit path uses, so what you see
 * while dragging is exactly what lands in the document on mouse-up.
 */
function DraftPreview({
  tool,
  points,
  doc,
}: {
  tool: ShapeKind;
  points: number[];
  doc: LabelDocument;
}) {
  const element =
    tool === "rect" || tool === "ellipse"
      ? boxElementFromDrag(doc, tool, points)
      : polylineFromPoints(doc, tool, points);

  if (!element) return null;

  return (
    <Group
      x={element.x + element.widthPx / 2}
      y={element.y + element.heightPx / 2}
      offsetX={element.widthPx / 2}
      offsetY={element.heightPx / 2}
      opacity={0.55}
      listening={false}
    >
      <ShapeNode element={element} />
    </Group>
  );
}

interface ElementNodeProps {
  element: Element;
  dispatch: (action: EditorAction) => void;
  onSelect: () => void;
  onDragPosition: (moving: Element) => { dx: number; dy: number };
  onDragDone: () => void;
}

function ElementNode({
  element,
  dispatch,
  onSelect,
  onDragPosition,
  onDragDone,
}: ElementNodeProps) {
  // Reserved kinds (image/barcode/qr) are not renderable yet; skip rather than
  // crash, matching what the rasterizer does.
  const content = renderContent(element);
  if (content === null) return null;

  return (
    /*
     * Konva rotates a node about its ORIGIN, but the document model defines
     * rotation about the element's CENTRE (see src/core/document.ts, and the
     * rasterizer which implements it). Reconcile by positioning the group at
     * the element's centre and pushing the origin back out via offset -- then
     * Konva's rotation pivot matches the model's, and the editor is WYSIWYG.
     *
     * The consequence is that node.x()/node.y() report the CENTRE, so every
     * write-back below subtracts half the box again.
     */
    <Group
      id={element.id}
      x={element.x + element.widthPx / 2}
      y={element.y + element.heightPx / 2}
      offsetX={element.widthPx / 2}
      offsetY={element.heightPx / 2}
      width={element.widthPx}
      height={element.heightPx}
      rotation={element.rotation}
      draggable
      onMouseDown={onSelect}
      onTap={onSelect}
      onDragStart={() => {
        onSelect();
        dispatch({ type: "beginGesture" });
      }}
      onDragMove={(event) => {
        const node = event.target;
        const raw = {
          x: Math.round(node.x() - element.widthPx / 2),
          y: Math.round(node.y() - element.heightPx / 2),
        };

        const snap = onDragPosition({ ...element, ...raw });
        const next = { x: raw.x + Math.round(snap.dx), y: raw.y + Math.round(snap.dy) };

        // Move the Konva node too, not just the document. Without this the node
        // sits under the cursor while the document says otherwise, and the
        // element visibly lags or jitters against the snap.
        node.x(next.x + element.widthPx / 2);
        node.y(next.y + element.heightPx / 2);

        dispatch({ type: "update", id: element.id, patch: next, transient: true });
      }}
      onDragEnd={onDragDone}
      onTransformStart={() => dispatch({ type: "beginGesture" })}
      onTransformEnd={(event) => {
        const node = event.target;
        // Konva reports resizes as a scale factor; bake it into the element's
        // dimensions and reset the node's scale so it never compounds.
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);

        const widthPx = Math.max(10, Math.round(element.widthPx * scaleX));
        const heightPx = Math.max(10, Math.round(element.heightPx * scaleY));

        dispatch({
          type: "update",
          id: element.id,
          patch: {
            // node.x()/y() are the centre (see the offset note above), and the
            // box just changed size, so convert back using the NEW half-extents.
            x: Math.round(node.x() - widthPx / 2),
            y: Math.round(node.y() - heightPx / 2),
            widthPx,
            heightPx,
            rotation: Math.round(node.rotation()),
          },
          transient: true,
        });
      }}
    >
      {/* Invisible hit area so the whole box is grabbable, not just the ink. */}
      <Rect width={element.widthPx} height={element.heightPx} fill="transparent" />
      {content}
    </Group>
  );
}

/** The visual for one element, or null if its kind is not renderable yet. */
function renderContent(element: Element) {
  if (isTextElement(element)) {
    const fontStyle = [element.italic ? "italic" : "", element.bold ? "bold" : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <Text
        text={element.text}
        width={element.widthPx}
        fontSize={element.fontSizePx}
        fontFamily={element.fontFamily}
        fontStyle={fontStyle || "normal"}
        align={element.align}
        lineHeight={1.2}
        fill="#000000"
        listening={false}
      />
    );
  }

  if (isShapeElement(element)) return <ShapeNode element={element} />;
  if (isImageElement(element)) return <ImageNode element={element} />;

  return null;
}
