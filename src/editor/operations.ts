/**
 * Pure document operations.
 *
 * Every function returns a NEW document; none mutate. See the immutability rule
 * in src/core/document.ts -- undo/redo depends on it.
 */

import {
  SCHEMA_VERSION,
  isShapeElement,
  type Element,
  type LabelDocument,
  type PolylineElement,
  type ShapeElement,
  type TextElement,
} from "../core/document.ts";

import { resolveGeometry, type LabelSizeId, type Orientation } from "../core/label.ts";
import { DPI } from "../core/units.ts";

/** The drawing tools the toolbar offers. */
export type ShapeKind = ShapeElement["kind"];

/** Below this, a drag is treated as a stray click rather than a shape. */
const MIN_DRAG_PX = 4;

let idCounter = 0;

/** Monotonic, collision-free within a session. Not persisted across reloads. */
export function nextId(prefix = "el"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function createDocument(
  sizeId: LabelSizeId = "4x6",
  orientation: Orientation = "portrait",
): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nextId("doc"),
    name: "Untitled label",
    sizeId,
    orientation,
    dpi: DPI,
    elements: [],
  };
}

/** A text element sized and centred sensibly for the given document. */
export function createTextElement(doc: LabelDocument, text = "Text"): TextElement {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  // Roughly 60% of the label width, and tall enough for a couple of lines.
  const widthPx = Math.round(geometry.widthPx * 0.6);
  const fontSizePx = Math.max(16, Math.round(geometry.heightPx * 0.06));
  const heightPx = Math.round(fontSizePx * 1.2 * 2);

  return {
    id: nextId("text"),
    kind: "text",
    x: Math.round((geometry.widthPx - widthPx) / 2),
    y: Math.round((geometry.heightPx - heightPx) / 2),
    widthPx,
    heightPx,
    rotation: 0,
    text,
    fontSizePx,
    fontFamily: "sans-serif",
    bold: false,
    italic: false,
    align: "left",
  };
}

/** Default outline thickness, scaled so it stays visible on a small label. */
function defaultStroke(doc: LabelDocument): number {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  // ~0.6% of the short edge, floored at 2px so it survives 1-bit thresholding.
  return Math.max(2, Math.round(Math.min(geometry.widthPx, geometry.heightPx) * 0.006));
}

/**
 * A shape sized and centred sensibly for the given document.
 *
 * Used by the toolbar's click-to-add path. Drag-to-draw builds its own geometry
 * from the gesture instead.
 */
export function createShapeElement(doc: LabelDocument, kind: ShapeKind): ShapeElement {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const widthPx = Math.round(geometry.widthPx * 0.4);
  const heightPx = Math.round(geometry.heightPx * 0.2);
  const x = Math.round((geometry.widthPx - widthPx) / 2);
  const y = Math.round((geometry.heightPx - heightPx) / 2);
  const strokeWidthPx = defaultStroke(doc);
  const base = { id: nextId(kind), x, y, widthPx, heightPx, rotation: 0, strokeWidthPx };

  switch (kind) {
    case "rect":
      return { ...base, kind, filled: false, cornerRadiusPx: 0 };
    case "ellipse":
      return { ...base, kind, filled: false };
    case "line":
    case "arrow":
      return {
        ...base,
        kind,
        // Horizontal, spanning the box, vertically centred.
        points: [0, 0.5, 1, 0.5],
        arrowHeadPx: kind === "arrow" ? Math.max(8, strokeWidthPx * 4) : 0,
      };
    case "freehand":
      return { ...base, kind, points: [], arrowHeadPx: 0 };
  }
}

/**
 * Build a polyline element from a drag gesture in label coordinates.
 *
 * The bounding box comes from the points' extent, and the points are then
 * normalised into it. A perfectly straight horizontal or vertical stroke yields
 * a zero-height or zero-width box, which is legal -- callers must not divide by
 * a dimension without guarding.
 */
export function polylineFromPoints(
  doc: LabelDocument,
  kind: "line" | "arrow" | "freehand",
  absolutePoints: readonly number[],
): PolylineElement | null {
  if (absolutePoints.length < 4) return null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < absolutePoints.length - 1; i += 2) {
    xs.push(absolutePoints[i]!);
    ys.push(absolutePoints[i + 1]!);
  }

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthPx = Math.round(maxX - minX);
  const heightPx = Math.round(maxY - minY);
  if (widthPx < MIN_DRAG_PX && heightPx < MIN_DRAG_PX) return null;

  const normalised: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    normalised.push(widthPx === 0 ? 0.5 : (xs[i]! - minX) / (maxX - minX));
    normalised.push(heightPx === 0 ? 0.5 : (ys[i]! - minY) / (maxY - minY));
  }

  const strokeWidthPx = defaultStroke(doc);
  return {
    id: nextId(kind),
    kind,
    x: Math.round(minX),
    y: Math.round(minY),
    widthPx,
    heightPx,
    rotation: 0,
    strokeWidthPx,
    points: normalised,
    arrowHeadPx: kind === "arrow" ? Math.max(8, strokeWidthPx * 4) : 0,
  };
}

/**
 * Build a rect or ellipse from a two-point drag in label coordinates.
 *
 * Returns null for a gesture too small to be a deliberate shape -- a stray
 * click should not leave an invisible speck on the label.
 */
export function boxElementFromDrag(
  doc: LabelDocument,
  kind: "rect" | "ellipse",
  points: readonly number[],
): ShapeElement | null {
  if (points.length < 4) return null;
  const [x1, y1, x2, y2] = points as [number, number, number, number];

  const widthPx = Math.round(Math.abs(x2 - x1));
  const heightPx = Math.round(Math.abs(y2 - y1));
  if (widthPx < MIN_DRAG_PX && heightPx < MIN_DRAG_PX) return null;

  const base = {
    id: nextId(kind),
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    widthPx,
    heightPx,
    rotation: 0,
    strokeWidthPx: defaultStroke(doc),
  };

  return kind === "rect"
    ? { ...base, kind, filled: false, cornerRadiusPx: 0 }
    : { ...base, kind, filled: false };
}

export function addElement(doc: LabelDocument, element: Element): LabelDocument {
  return { ...doc, elements: [...doc.elements, element] };
}

export function updateElement(
  doc: LabelDocument,
  id: string,
  patch: Partial<Element>,
): LabelDocument {
  return {
    ...doc,
    elements: doc.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as Element) : el)),
  };
}

export function removeElement(doc: LabelDocument, id: string): LabelDocument {
  return { ...doc, elements: doc.elements.filter((el) => el.id !== id) };
}

/** Move an element one step forward or backward in paint order. */
export function reorderElement(
  doc: LabelDocument,
  id: string,
  direction: "forward" | "backward",
): LabelDocument {
  const index = doc.elements.findIndex((el) => el.id === id);
  if (index === -1) return doc;
  const target = direction === "forward" ? index + 1 : index - 1;
  if (target < 0 || target >= doc.elements.length) return doc;

  const elements = [...doc.elements];
  const [moved] = elements.splice(index, 1);
  elements.splice(target, 0, moved!);
  return { ...doc, elements };
}

/**
 * Change label size, rescaling element positions proportionally.
 *
 * Without rescaling, switching a 4x6 design to 2x1 would leave every element
 * off-canvas. Proportional mapping keeps the layout recognisable.
 */
export function setLabelSize(doc: LabelDocument, sizeId: LabelSizeId): LabelDocument {
  if (sizeId === doc.sizeId) return doc;
  const from = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const to = resolveGeometry(sizeId, doc.orientation, doc.dpi);
  const scaleX = to.widthPx / from.widthPx;
  const scaleY = to.heightPx / from.heightPx;
  // Uniform scale for font size so text does not distort.
  const scaleFont = Math.min(scaleX, scaleY);

  return {
    ...doc,
    sizeId,
    elements: doc.elements.map((el) => {
      const scaled = {
        ...el,
        x: Math.round(el.x * scaleX),
        y: Math.round(el.y * scaleY),
        widthPx: Math.round(el.widthPx * scaleX),
        heightPx: Math.round(el.heightPx * scaleY),
      };
      // Font size and stroke width are thicknesses, not extents -- scale them
      // uniformly so they do not distort, and floor them so they survive 1-bit
      // thresholding after a big downscale.
      if (el.kind === "text") {
        return { ...scaled, fontSizePx: Math.max(8, Math.round(el.fontSizePx * scaleFont)) };
      }
      if (isShapeElement(el)) {
        return { ...scaled, strokeWidthPx: Math.max(1, Math.round(el.strokeWidthPx * scaleFont)) };
      }
      return scaled;
    }),
  };
}

/**
 * Rotate the canvas between portrait and landscape.
 *
 * Elements rotate with the canvas rather than staying put: a design rotated 90
 * degrees should look like the same design turned sideways, not a scrambled
 * one. An element at (x, y) in a WxH label maps to (H - y - h, x) in the
 * rotated H x W label, and gains 90 degrees of its own rotation.
 */
export function setOrientation(doc: LabelDocument, orientation: Orientation): LabelDocument {
  if (orientation === doc.orientation) return doc;
  const from = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

  return {
    ...doc,
    orientation,
    elements: doc.elements.map((el) => ({
      ...el,
      x: from.heightPx - el.y - el.heightPx,
      y: el.x,
      widthPx: el.heightPx,
      heightPx: el.widthPx,
      rotation: (el.rotation + 90) % 360,
    })),
  };
}

export function renameDocument(doc: LabelDocument, name: string): LabelDocument {
  return { ...doc, name };
}
