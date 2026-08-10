/**
 * Property panel for drawing elements.
 *
 * Deliberately sparse: 1-bit output means there is no colour, no opacity, and
 * no gradient to expose. Thickness, fill, and corner radius is the whole
 * vocabulary.
 */

import { isFilledShape, isPolylineElement, type ShapeElement } from "../core/document.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  element: ShapeElement;
  dispatch: (action: EditorAction) => void;
}

const LABELS: Record<ShapeElement["kind"], string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  freehand: "Freehand",
};

export function ShapeInspector({ element, dispatch }: Props) {
  const update = (patch: Partial<ShapeElement>) =>
    dispatch({ type: "update", id: element.id, patch });

  return (
    <div className="inspector">
      <h2>{LABELS[element.kind]}</h2>

      <div className="field-row">
        <label className="field">
          <span>Stroke (px)</span>
          <input
            type="number"
            min={0}
            max={60}
            value={element.strokeWidthPx}
            onChange={(event) => update({ strokeWidthPx: Math.max(0, Number(event.target.value)) })}
          />
        </label>

        <label className="field">
          <span>Rotation</span>
          <input
            type="number"
            step={15}
            value={element.rotation}
            onChange={(event) => update({ rotation: Number(event.target.value) || 0 })}
          />
        </label>
      </div>

      {isFilledShape(element) && (
        <div className="field">
          <span>Fill</span>
          <div className="segmented">
            <button
              type="button"
              className={!element.filled ? "active" : ""}
              onClick={() => update({ filled: false })}
            >
              Outline
            </button>
            <button
              type="button"
              className={element.filled ? "active" : ""}
              onClick={() => update({ filled: true })}
            >
              Solid
            </button>
          </div>
        </div>
      )}

      {element.kind === "rect" && (
        <label className="field">
          <span>Corner radius (px)</span>
          <input
            type="number"
            min={0}
            max={Math.round(Math.min(element.widthPx, element.heightPx) / 2)}
            value={element.cornerRadiusPx}
            onChange={(event) =>
              update({ cornerRadiusPx: Math.max(0, Number(event.target.value)) })
            }
          />
        </label>
      )}

      {element.kind === "arrow" && (
        <label className="field">
          <span>Arrowhead (px)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={element.arrowHeadPx}
            onChange={(event) => update({ arrowHeadPx: Math.max(0, Number(event.target.value)) })}
          />
        </label>
      )}

      {isPolylineElement(element) && (
        <p className="hint">
          {element.points.length / 2} points. Resize the box to scale the path &mdash; the points
          are stored relative to it.
        </p>
      )}

      <div className="field-row">
        <button
          type="button"
          onClick={() => dispatch({ type: "reorder", id: element.id, direction: "backward" })}
        >
          Send back
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "reorder", id: element.id, direction: "forward" })}
        >
          Bring forward
        </button>
      </div>

      <button
        type="button"
        className="danger"
        onClick={() => dispatch({ type: "remove", id: element.id })}
      >
        Delete element
      </button>
    </div>
  );
}
