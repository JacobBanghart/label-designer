/**
 * Out-of-bounds detection.
 *
 * Anything outside the label is not printed -- it is simply clipped, with no
 * error and no trace. That is the single most dangerous failure mode in this
 * app, because the design still looks complete on screen while the printed
 * label is missing part of it. It has already caught out the person who wrote
 * the warnings about it.
 *
 * Detection works on AXIS-ALIGNED BOUNDING BOXES, matching snapping and
 * alignment: a rotated element's stored box is not where it visually sits.
 */

import type { Element, LabelDocument } from "../core/document.ts";
import { resolveGeometry, type LabelGeometry } from "../core/label.ts";
import { boundingBox } from "./snapping.ts";

/**
 * Sub-pixel slack.
 *
 * Rounding puts elements a fraction of a pixel over the edge routinely, and a
 * warning that fires constantly is a warning nobody reads.
 */
const TOLERANCE_PX = 1;

/** True when any part of the element falls outside the printable area. */
export function isOutOfBounds(element: Element, geometry: LabelGeometry): boolean {
  const box = boundingBox(element);

  if (
    box.left < -TOLERANCE_PX ||
    box.top < -TOLERANCE_PX ||
    box.right > geometry.widthPx + TOLERANCE_PX ||
    box.bottom > geometry.heightPx + TOLERANCE_PX
  ) {
    return true;
  }

  /*
   * Round stock: the printable area is the inscribed circle, so a box can sit
   * inside the bounding rectangle and still hang off the die-cut. Testing the
   * four corners is conservative -- it flags an element whose CORNER escapes
   * even if its ink does not -- which is the right way to be wrong here.
   */
  if (geometry.shape === "round") {
    const radiusX = geometry.widthPx / 2;
    const radiusY = geometry.heightPx / 2;
    const corners: [number, number][] = [
      [box.left, box.top],
      [box.right, box.top],
      [box.left, box.bottom],
      [box.right, box.bottom],
    ];

    return corners.some(([x, y]) => {
      const nx = (x - radiusX) / radiusX;
      const ny = (y - radiusY) / radiusY;
      return nx * nx + ny * ny > 1;
    });
  }

  return false;
}

/** Ids of every element that would be clipped on print. */
export function outOfBoundsIds(doc: LabelDocument): string[] {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  return doc.elements.filter((el) => isOutOfBounds(el, geometry)).map((el) => el.id);
}
