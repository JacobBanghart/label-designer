/**
 * The editing surface.
 *
 * The Konva stage works in DEVICE PIXELS at the label's DPI (a 4x6 at 203 DPI
 * is 812x1218), and is scaled down only for display. Keeping the model at
 * device resolution means what the editor stores is exactly what the rasterizer
 * renders -- no unit conversion, no rounding drift.
 */

import { useEffect, useRef, useState } from "react";
import { Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
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
import { boundingBox, computeSnap, type Guide } from "../editor/snapping.ts";

/** Magnetic pull radius, in SCREEN pixels; divided by scale at use. */
const SNAP_SCREEN_PX = 7;

/**
 * Breathing room kept around the label when it is scaled to fit, in screen px.
 * Only used to compute the fit scale; the drawable area is the whole panel.
 */
export const FIT_MARGIN_PX = 48;

/**
 * Angles the rotate handle snaps to.
 *
 * Multiples of 15 cover everything a label is realistically set to -- upright,
 * the two sideways orientations, upside down, and the diagonals a banner gets
 * -- while staying fine enough not to feel like it is fighting the pointer.
 */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

/**
 * How close to a snap angle the handle has to be before it takes hold.
 *
 * Deliberately well under half the 15 degree step: at half, every angle is
 * inside some snap's pull and free rotation becomes unreachable.
 */
const ROTATION_SNAP_TOLERANCE = 5;

/** null means the select/move tool. */
export type Tool = ShapeKind | null;

interface Props {
  doc: LabelDocument;
  selectedIds: readonly string[];
  /** Elements that would be clipped on print. */
  clippedIds: readonly string[];
  /** Element currently being edited inline, if any. */
  editingId: string | null;
  onEditStart: (id: string) => void;
  scale: number;
  /** Stage size in SCREEN pixels. The stage fills the panel, not just the label. */
  stageWidth: number;
  stageHeight: number;
  /** Where the label sits within the stage, in LABEL pixels. */
  offsetX: number;
  offsetY: number;
  /** Right- or middle-drag pans the view by this many screen pixels. */
  onPanBy: (dx: number, dy: number) => void;
  tool: Tool;
  onToolUsed: () => void;
  dispatch: (action: EditorAction) => void;
}

export function LabelCanvas({
  doc,
  selectedIds,
  clippedIds,
  editingId,
  onEditStart,
  scale,
  stageWidth,
  stageHeight,
  offsetX,
  offsetY,
  onPanBy,
  tool,
  onToolUsed,
  dispatch,
}: Props) {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Points of the stroke currently being drawn, in label coordinates. Held in
  // component state rather than the document so an in-progress gesture never
  // enters undo history.
  const [draft, setDraft] = useState<number[] | null>(null);

  // Shift bypasses rotation snapping, for the rare angle that is not a multiple
  // of 15. Read from the window rather than the transform event because Konva
  // does not re-evaluate the snap props mid-gesture from the event itself.
  const [freeRotate, setFreeRotate] = useState(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setFreeRotate(event.shiftKey);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    // A window that loses focus mid-drag never delivers the keyup.
    const clear = () => setFreeRotate(false);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  // Alignment guides for the drag in progress. Also view-only state.
  const [guides, setGuides] = useState<readonly Guide[]>([]);

  // Rubber-band rectangle, in label coordinates, while selecting.
  const [marquee, setMarquee] = useState<[number, number, number, number] | null>(null);

  /*
   * Panning with the right (or middle) button.
   *
   * Kept in a ref rather than state: it updates on every mousemove and none of
   * it needs to trigger a render -- the pan itself lives in the parent.
   */
  const panning = useRef<{ x: number; y: number } | null>(null);
  const [panActive, setPanActive] = useState(false);

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

  /**
   * Finish a rubber-band selection.
   *
   * Selects anything the band INTERSECTS rather than fully contains -- on a
   * label the elements are large relative to the canvas, and requiring full
   * containment makes the gesture feel broken.
   */
  function commitMarquee(additive: boolean) {
    if (!marquee) return;
    const [x1, y1, x2, y2] = marquee;
    setMarquee(null);

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);

    // A click rather than a drag: leave the selection as the mousedown set it.
    if (right - left < 3 && bottom - top < 3) return;

    const hit = doc.elements
      .filter((element) => {
        const box = boundingBox(element);
        return box.left < right && box.right > left && box.top < bottom && box.bottom > top;
      })
      .map((element) => element.id);

    const ids = additive ? [...new Set([...selectedIds, ...hit])] : hit;
    dispatch({ type: "selectMany", ids });
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
    // Stage coordinates include the offset that centres the label; label space
    // does not. Everything outside this function works in label coordinates.
    return [position.x / scale - offsetX, position.y / scale - offsetY];
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

    const nodes = selectedIds
      .map((id) => layer.findOne(`#${id}`))
      .filter((node): node is Konva.Node => Boolean(node));
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, doc]);

  return (
    <Stage
      ref={stageRef}
      width={stageWidth}
      height={stageHeight}
      scaleX={scale}
      scaleY={scale}
      onContextMenu={(event) => {
        // The right button pans, so its menu would fire on every pan release.
        event.evt.preventDefault();
      }}
      onMouseDown={(event) => {
        // Right or middle button starts a pan and does nothing else: it must not
        // draw, select, or clear the selection.
        if (event.evt.button === 2 || event.evt.button === 1) {
          event.evt.preventDefault();
          panning.current = { x: event.evt.clientX, y: event.evt.clientY };
          setPanActive(true);
          return;
        }
        if (tool) {
          handleDrawStart();
          return;
        }
        if (event.target !== event.target.getStage()) return;

        // Empty space: begin a rubber-band selection. Shift keeps the current
        // selection so a marquee can extend it.
        if (!event.evt.shiftKey) dispatch({ type: "select", id: null });
        const point = pointerInLabelSpace();
        if (point) setMarquee([point[0], point[1], point[0], point[1]]);
      }}
      onMouseMove={(event) => {
        if (panning.current) {
          onPanBy(event.evt.clientX - panning.current.x, event.evt.clientY - panning.current.y);
          panning.current = { x: event.evt.clientX, y: event.evt.clientY };
          return;
        }
        handleDrawMove();
        if (!marquee) return;
        const point = pointerInLabelSpace();
        if (point) setMarquee([marquee[0], marquee[1], point[0], point[1]]);
        void event;
      }}
      onMouseUp={(event) => {
        if (panning.current) {
          panning.current = null;
          setPanActive(false);
          return;
        }
        handleDrawEnd();
        commitMarquee(event.evt.shiftKey);
      }}
      onMouseLeave={() => {
        panning.current = null;
        setPanActive(false);
        handleDrawEnd();
        setMarquee(null);
      }}
      onWheel={(event) => {
        /*
         * Wheel over a selected text element resizes its type.
         *
         * Deliberately narrow: it only fires when exactly one text element is
         * selected AND the pointer is over it. Hijacking the wheel any more
         * broadly would steal scrolling from a zoomed-in canvas, which is the
         * other thing the wheel is for here.
         */
        if (selectedIds.length !== 1) return;
        const element = doc.elements.find((el) => el.id === selectedIds[0]);
        if (!element || !isTextElement(element)) return;

        const point = pointerInLabelSpace();
        if (!point) return;
        const box = boundingBox(element);
        const inside =
          point[0] >= box.left &&
          point[0] <= box.right &&
          point[1] >= box.top &&
          point[1] <= box.bottom;
        if (!inside) return;

        event.evt.preventDefault();
        // Proportional so big type changes fast and small type stays adjustable.
        const step = Math.max(1, Math.round(element.fontSizePx * 0.06));
        const delta = event.evt.deltaY < 0 ? step : -step;
        dispatch({
          type: "update",
          id: element.id,
          patch: { fontSizePx: Math.max(4, element.fontSizePx + delta) },
        });
      }}
      onTouchStart={handleDrawStart}
      onTouchMove={handleDrawMove}
      onTouchEnd={handleDrawEnd}
      style={{
        // The workspace, not the label. The label itself is drawn inside.
        background: "transparent",
        cursor: panActive ? "grabbing" : tool ? "crosshair" : "default",
      }}
    >
      <Layer ref={layerRef}>
        {/* Shifted so label coordinates stay label coordinates everywhere else:
            only this one Group knows about the workspace padding. */}
        <Group x={offsetX} y={offsetY}>
          {/* The label surface. Anything outside it will not print. */}
          <Rect
            x={0}
            y={0}
            width={geometry.widthPx}
            height={geometry.heightPx}
            fill={geometry.shape === "round" ? "#eceef2" : "#ffffff"}
            shadowColor="#000000"
            shadowOpacity={0.25}
            shadowBlur={6 / scale}
            shadowOffsetY={1 / scale}
            listening={false}
          />
          {geometry.shape === "round" && (
            <Ellipse
              x={geometry.widthPx / 2}
              y={geometry.heightPx / 2}
              radiusX={geometry.widthPx / 2}
              radiusY={geometry.heightPx / 2}
              fill="#ffffff"
              listening={false}
            />
          )}

          {/*
          Clip to the die-cut, mirroring what the rasterizer does. Without this
          the editor would happily show artwork in the corners of a round label
          that silently vanishes on print.
        */}
          <Group
            clipFunc={
              geometry.shape === "round"
                ? (ctx) => {
                    ctx.beginPath();
                    ctx.ellipse(
                      geometry.widthPx / 2,
                      geometry.heightPx / 2,
                      geometry.widthPx / 2,
                      geometry.heightPx / 2,
                      0,
                      0,
                      Math.PI * 2,
                    );
                    ctx.closePath();
                  }
                : undefined
            }
          >
            {doc.elements.map((element) => (
              <ElementNode
                key={element.id}
                element={element}
                // Hidden while its DOM editor is open, so the text is not drawn twice.
                hidden={element.id === editingId}
                dispatch={dispatch}
                onSelect={(additive) =>
                  dispatch(
                    additive
                      ? { type: "toggleSelect", id: element.id }
                      : selectedIds.includes(element.id)
                        ? { type: "selectMany", ids: selectedIds }
                        : { type: "select", id: element.id },
                  )
                }
                onEditStart={onEditStart}
                onDragPosition={onDragPosition}
                onDragDone={onDragDone}
              />
            ))}
          </Group>

          {/* Live preview of the stroke being drawn. Not part of the document,
            so it never enters undo history. */}
          {draft && tool && <DraftPreview tool={tool} points={draft} doc={doc} />}

          {/* Anything that will be clipped on print, outlined so it cannot be
            missed. Drawn above the artwork but below the guides. */}
          {doc.elements
            .filter((element) => clippedIds.includes(element.id))
            .map((element) => {
              const box = boundingBox(element);
              return (
                <Rect
                  key={`clip-${element.id}`}
                  x={box.left}
                  y={box.top}
                  width={box.right - box.left}
                  height={box.bottom - box.top}
                  stroke="#b42318"
                  strokeWidth={2 / scale}
                  dash={[8 / scale, 5 / scale]}
                  listening={false}
                />
              );
            })}

          {marquee && (
            <Rect
              x={Math.min(marquee[0], marquee[2])}
              y={Math.min(marquee[1], marquee[3])}
              width={Math.abs(marquee[2] - marquee[0])}
              height={Math.abs(marquee[3] - marquee[1])}
              fill="rgba(79,70,229,0.08)"
              stroke="#4f46e5"
              strokeWidth={1 / scale}
              listening={false}
            />
          )}

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
            rotationSnaps={freeRotate ? [] : ROTATION_SNAPS}
            rotationSnapTolerance={ROTATION_SNAP_TOLERANCE}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 10 || newBox.height < 10 ? oldBox : newBox
            }
          />
        </Group>
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
  /** Hidden while its inline DOM editor is open, to avoid drawing the text twice. */
  hidden?: boolean;
  dispatch: (action: EditorAction) => void;
  onSelect: (additive: boolean) => void;
  onEditStart: (id: string) => void;
  onDragPosition: (moving: Element) => { dx: number; dy: number };
  onDragDone: () => void;
}

function ElementNode({
  element,
  hidden,
  dispatch,
  onSelect,
  onEditStart,
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
      visible={!hidden}
      id={element.id}
      x={element.x + element.widthPx / 2}
      y={element.y + element.heightPx / 2}
      offsetX={element.widthPx / 2}
      offsetY={element.heightPx / 2}
      width={element.widthPx}
      height={element.heightPx}
      rotation={element.rotation}
      draggable
      onMouseDown={(event) => onSelect(event.evt.shiftKey)}
      onTap={() => onSelect(false)}
      onDblClick={() => {
        if (isTextElement(element)) onEditStart(element.id);
      }}
      onDblTap={() => {
        if (isTextElement(element)) onEditStart(element.id);
      }}
      onDragStart={(event) => {
        onSelect(event.evt.shiftKey);
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
      {/*
        Text and images are solid content, so the whole box should be grabbable.
        Shapes deliberately are NOT: a box-wide hit area turns an outline-only
        rectangle into a click sink that swallows every empty-space click inside
        it -- which makes rubber-band selection impossible under a frame or
        background box. Shapes hit-test against their own stroke and fill.
      */}
      {isShapeElement(element) ? null : (
        <Rect width={element.widthPx} height={element.heightPx} fill="transparent" />
      )}
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
        // Konva needs an explicit height for verticalAlign to mean anything.
        height={element.heightPx}
        verticalAlign={element.verticalAlign}
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
