/**
 * Align and distribute a selection.
 *
 * All of it works on AXIS-ALIGNED BOUNDING BOXES for the same reason snapping
 * does: people align what they can see, and a rotated element's stored box is
 * not where it visually sits.
 */

import type { Element, LabelDocument } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { boundingBox } from "./snapping.ts";

export type AlignEdge = "left" | "centreX" | "right" | "top" | "centreY" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

function moveBy(element: Element, dx: number, dy: number): Element {
  return { ...element, x: Math.round(element.x + dx), y: Math.round(element.y + dy) };
}

/**
 * Align the selection to a shared edge.
 *
 * With two or more elements the target is the extreme of the selection itself
 * (leftmost left edge, and so on). With exactly ONE element there is nothing to
 * align to, so the label is used instead -- which is what people mean by
 * "centre this on the label".
 */
export function alignElements(
  doc: LabelDocument,
  ids: readonly string[],
  edge: AlignEdge,
): LabelDocument {
  const selected = doc.elements.filter((el) => ids.includes(el.id));
  if (selected.length === 0) return doc;

  const boxes = selected.map(boundingBox);
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

  let target: number;
  if (selected.length === 1) {
    switch (edge) {
      case "left":
      case "top":
        target = 0;
        break;
      case "right":
        target = geometry.widthPx;
        break;
      case "bottom":
        target = geometry.heightPx;
        break;
      case "centreX":
        target = geometry.widthPx / 2;
        break;
      case "centreY":
        target = geometry.heightPx / 2;
        break;
    }
  } else {
    switch (edge) {
      case "left":
        target = Math.min(...boxes.map((b) => b.left));
        break;
      case "right":
        target = Math.max(...boxes.map((b) => b.right));
        break;
      case "top":
        target = Math.min(...boxes.map((b) => b.top));
        break;
      case "bottom":
        target = Math.max(...boxes.map((b) => b.bottom));
        break;
      case "centreX":
        target =
          (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
        break;
      case "centreY":
        target =
          (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2;
        break;
    }
  }

  const horizontal = edge === "left" || edge === "centreX" || edge === "right";

  return {
    ...doc,
    elements: doc.elements.map((element) => {
      if (!ids.includes(element.id)) return element;
      const box = boundingBox(element);
      const from =
        edge === "left"
          ? box.left
          : edge === "right"
            ? box.right
            : edge === "top"
              ? box.top
              : edge === "bottom"
                ? box.bottom
                : edge === "centreX"
                  ? box.centreX
                  : box.centreY;

      const delta = target - from;
      return horizontal ? moveBy(element, delta, 0) : moveBy(element, 0, delta);
    }),
  };
}

/**
 * Space the selection evenly between its outermost members.
 *
 * Distributes by CENTRE rather than by gap: gap-based spacing looks wrong when
 * elements differ a lot in size, which on a label they usually do. The two
 * extremes stay put; everything between them moves.
 *
 * Needs at least three elements -- with two there is nothing to distribute.
 */
export function distributeElements(
  doc: LabelDocument,
  ids: readonly string[],
  axis: DistributeAxis,
): LabelDocument {
  const selected = doc.elements.filter((el) => ids.includes(el.id));
  if (selected.length < 3) return doc;

  const horizontal = axis === "horizontal";
  const withCentres = selected
    .map((element) => {
      const box = boundingBox(element);
      return { element, centre: horizontal ? box.centreX : box.centreY };
    })
    .sort((a, b) => a.centre - b.centre);

  const first = withCentres[0]!;
  const last = withCentres[withCentres.length - 1]!;
  const step = (last.centre - first.centre) / (withCentres.length - 1);

  const deltas = new Map<string, number>();
  withCentres.forEach(({ element, centre }, index) => {
    if (index === 0 || index === withCentres.length - 1) return;
    deltas.set(element.id, first.centre + step * index - centre);
  });

  return {
    ...doc,
    elements: doc.elements.map((element) => {
      const delta = deltas.get(element.id);
      if (delta === undefined) return element;
      return horizontal ? moveBy(element, delta, 0) : moveBy(element, 0, delta);
    }),
  };
}
