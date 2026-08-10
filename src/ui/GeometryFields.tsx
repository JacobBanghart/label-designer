/**
 * Numeric position and size, in real units.
 *
 * Two problems this solves. First, there was no way to place an element
 * precisely at all -- only dragging and arrow-nudging, which is hopeless when
 * you want something exactly half an inch from the edge. Second, the whole app
 * is about physical size, but every number in the UI was raw device pixels;
 * "62px" means nothing to a person holding a 4x6 label.
 *
 * Values are stored as device pixels and converted only for display, so the
 * document never accumulates rounding drift from unit changes.
 */

import type { Element } from "../core/document.ts";
import { pxToUnit, unitPrecision, unitStep, unitToPx, type DisplayUnit } from "../core/units.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  element: Element;
  unit: DisplayUnit;
  dpi: number;
  dispatch: (action: EditorAction) => void;
}

export function GeometryFields({ element, unit, dpi, dispatch }: Props) {
  const update = (patch: Partial<Element>) => dispatch({ type: "update", id: element.id, patch });

  const show = (px: number) => Number(pxToUnit(px, unit, dpi).toFixed(unitPrecision(unit)));
  const step = unitStep(unit);

  const field = (label: string, value: number, apply: (px: number) => Partial<Element>) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={show(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          apply(unitToPx(next, unit, dpi));
        }}
      />
    </label>
  );

  return (
    <>
      <div className="field-row">
        {field("X", element.x, (x) => {
          update({ x });
          return {};
        })}
        {field("Y", element.y, (y) => {
          update({ y });
          return {};
        })}
      </div>
      <div className="field-row">
        {field("Width", element.widthPx, (widthPx) => {
          // A zero-size box is unselectable and invisible; keep at least a dot.
          update({ widthPx: Math.max(1, widthPx) });
          return {};
        })}
        {field("Height", element.heightPx, (heightPx) => {
          update({ heightPx: Math.max(1, heightPx) });
          return {};
        })}
      </div>
    </>
  );
}
