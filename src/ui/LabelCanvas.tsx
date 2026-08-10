/**
 * The editing surface.
 *
 * The Konva stage works in DEVICE PIXELS at the label's DPI (a 4x6 at 203 DPI
 * is 812x1218), and is scaled down only for display. Keeping the model at
 * device resolution means what the editor stores is exactly what the rasterizer
 * renders -- no unit conversion, no rounding drift.
 */

import { useEffect, useRef } from "react";
import { Group, Layer, Rect, Stage, Text, Transformer } from "react-konva";
import type Konva from "konva";

import { isTextElement, type Element, type LabelDocument } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  doc: LabelDocument;
  selectedId: string | null;
  scale: number;
  dispatch: (action: EditorAction) => void;
}

export function LabelCanvas({ doc, selectedId, scale, dispatch }: Props) {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

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
      width={geometry.widthPx * scale}
      height={geometry.heightPx * scale}
      scaleX={scale}
      scaleY={scale}
      onMouseDown={(event) => {
        // Clicking empty space clears the selection.
        if (event.target === event.target.getStage()) dispatch({ type: "select", id: null });
      }}
      style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}
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

interface ElementNodeProps {
  element: Element;
  dispatch: (action: EditorAction) => void;
  onSelect: () => void;
}

function ElementNode({ element, dispatch, onSelect }: ElementNodeProps) {
  // Reserved kinds are not renderable yet; skip rather than crash.
  if (!isTextElement(element)) return null;

  const fontStyle = [element.italic ? "italic" : "", element.bold ? "bold" : ""]
    .filter(Boolean)
    .join(" ");

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
        dispatch({
          type: "update",
          id: element.id,
          patch: {
            x: Math.round(event.target.x() - element.widthPx / 2),
            y: Math.round(event.target.y() - element.heightPx / 2),
          },
          transient: true,
        });
      }}
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
      {/* Invisible hit area so the whole box is grabbable, not just the glyphs. */}
      <Rect width={element.widthPx} height={element.heightPx} fill="transparent" />
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
    </Group>
  );
}
