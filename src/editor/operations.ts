/**
 * Pure document operations.
 *
 * Every function returns a NEW document; none mutate. See the immutability rule
 * in src/core/document.ts -- undo/redo depends on it.
 */

import {
  SCHEMA_VERSION,
  type Element,
  type LabelDocument,
  type TextElement,
} from "../core/document.ts";
import { resolveGeometry, type LabelSizeId, type Orientation } from "../core/label.ts";
import { DPI } from "../core/units.ts";

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
      return el.kind === "text"
        ? { ...scaled, fontSizePx: Math.max(8, Math.round(el.fontSizePx * scaleFont)) }
        : scaled;
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
