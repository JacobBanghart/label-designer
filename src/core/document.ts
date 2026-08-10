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
import type { QrEcc, Symbology } from "./barcode/index.ts";

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
/** Where wrapped lines sit within the element box's height. */
export type VerticalAlign = "top" | "middle" | "bottom";

export interface TextElement extends ElementBase {
  kind: "text";
  text: string;
  /** Font size in device pixels at the document's DPI. */
  fontSizePx: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  /**
   * Merge variable supplying the text, if any. When set, `text` holds the
   * last-resolved value so the document still renders standalone -- exporting a
   * design without its dataset produces a readable label, not empty boxes.
   */
  binding?: string;
}

/*
 * ---------------------------------------------------------------------------
 * Drawing elements.
 *
 * Everything is 1-bit: there is no colour and no grey. A shape is either
 * outlined at some stroke width, filled solid black, or both. That constraint
 * is why these payloads are so small.
 * ---------------------------------------------------------------------------
 */

export interface StrokedElement extends ElementBase {
  /** Outline thickness in device pixels. 0 means no outline. */
  strokeWidthPx: number;
}

export interface RectElement extends StrokedElement {
  kind: "rect";
  filled: boolean;
  cornerRadiusPx: number;
}

export interface EllipseElement extends StrokedElement {
  kind: "ellipse";
  filled: boolean;
}

/**
 * Line, arrow, and freehand all reduce to a polyline.
 *
 * Points are NORMALISED to 0..1 within the element's box, as flat [x, y, x, y,
 * ...] pairs. Normalising means resizing the box scales the path with it for
 * free, and it keeps the geometry independent of the label's DPI.
 */
export interface PolylineElement extends StrokedElement {
  kind: "line" | "arrow" | "freehand";
  points: readonly number[];
  /** Arrowhead length in device pixels. Ignored unless kind is "arrow". */
  arrowHeadPx: number;
}

/**
 * How a greyscale image is reduced to 1 bit.
 *
 * `threshold` is right for line art and logos: hard, clean edges. `dither`
 * (Floyd-Steinberg) is right for photographs, trading spatial resolution for
 * apparent tone. Neither is a good default for the other, so it is per-image.
 */
export type HalftoneMode = "threshold" | "dither";

export interface ImageElement extends ElementBase {
  kind: "image";
  /** PNG data URI. Downscaled at import to at most the label's pixel size. */
  src: string;
  halftone: HalftoneMode;
  /** Luminance cut for `threshold` mode, 0-255. */
  threshold: number;
  /** Swap black and white, for light-on-dark artwork. */
  invert: boolean;
}

/*
 * ---------------------------------------------------------------------------
 * Barcodes.
 *
 * These were reserved without a payload while one question stayed open: whether
 * a barcode would reference a managed entity rather than carry a raw value.
 * That is now decided -- it carries a value. This app prints labels and does
 * not own inventory data; the value arrives literally or from a merge variable,
 * and anything richer belongs in whatever system exported the CSV.
 *
 * The `qr` kind folded into `barcode` with a symbology field, because QR is a
 * symbology like any other and every consumer wants to switch on one kind. No
 * saved document can contain the old kind -- it was never renderable or
 * creatable -- so this needs no migration.
 * ---------------------------------------------------------------------------
 */
export interface BarcodeElement extends ElementBase {
  kind: "barcode";
  symbology: Symbology;
  /** Literal value; ignored when `binding` names a variable. */
  value: string;
  /** QR error-correction level. Ignored by the 1D symbologies. */
  ecc: QrEcc;
  /** Print the value underneath, as retail barcodes do. */
  showText: boolean;
  /** Merge variable supplying the value, if any. */
  binding?: string;
}

export type Element =
  | TextElement
  | RectElement
  | EllipseElement
  | PolylineElement
  | ImageElement
  | BarcodeElement;

export function isImageElement(el: Element): el is ImageElement {
  return el.kind === "image";
}

export function isBarcodeElement(el: Element): el is BarcodeElement {
  return el.kind === "barcode";
}

export type ShapeElement = RectElement | EllipseElement | PolylineElement;

export function isShapeElement(el: Element): el is ShapeElement {
  return el.kind === "rect" || el.kind === "ellipse" || isPolylineElement(el);
}

export function isPolylineElement(el: Element): el is PolylineElement {
  return el.kind === "line" || el.kind === "arrow" || el.kind === "freehand";
}

export function isFilledShape(el: Element): el is RectElement | EllipseElement {
  return el.kind === "rect" || el.kind === "ellipse";
}

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
