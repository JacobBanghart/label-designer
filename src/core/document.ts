/**
 * The document model.
 *
 * IMMUTABILITY IS A HARD RULE. Undo/redo is a stack of Document snapshots, so
 * nothing anywhere may mutate a Document, an Element, or any nested value in
 * place. Always produce a new object. Violating this silently breaks history.
 *
 * The Element union enumerates EVERY planned element kind, including ones the
 * MVP does not implement. This is deliberate: it means adding shapes or
 * barcodes later does not change a shared type that other modules switch on.
 */

import type { LabelSizeId, Orientation } from "./label.ts";

/**
 * Bumped whenever the persisted shape changes. Saved designs are migrated on
 * load. Present from day one because real designs will exist before the schema
 * settles.
 */
export const SCHEMA_VERSION = 1;

export interface ElementBase {
  id: string;
  /** Top-left position in device pixels, relative to the label origin. */
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  /** Clockwise rotation in degrees about the element's centre. */
  rotation: number;
}

export type TextAlign = "left" | "center" | "right";

export interface TextElement extends ElementBase {
  kind: "text";
  text: string;
  /** Font size in device pixels at the document's DPI. */
  fontSizePx: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
}

/*
 * ---------------------------------------------------------------------------
 * Reserved kinds -- NOT implemented in the MVP.
 *
 * Their payloads are intentionally minimal. Do not flesh these out
 * speculatively. In particular `barcode` and `qr` are placeholders: barcode
 * *management* tooling is still being designed, and a barcode may end up
 * referencing a managed entity rather than carrying a raw value. Reserving the
 * kind costs nothing; guessing the payload costs a migration.
 * ---------------------------------------------------------------------------
 */
export interface ReservedElement extends ElementBase {
  kind: "rect" | "ellipse" | "line" | "arrow" | "freehand" | "image" | "barcode" | "qr";
}

export type Element = TextElement | ReservedElement;

export type ElementKind = Element["kind"];

export interface LabelDocument {
  schemaVersion: number;
  id: string;
  name: string;
  sizeId: LabelSizeId;
  orientation: Orientation;
  dpi: number;
  elements: readonly Element[];
}

export function isTextElement(el: Element): el is TextElement {
  return el.kind === "text";
}
