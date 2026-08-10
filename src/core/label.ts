/**
 * Label stock sizes and orientation.
 *
 * MVP supports 4x6 and 2x1 only. "Canvas rotation" is an orientation toggle:
 * it swaps width and height, so 4x6 becomes 6x4. It changes the *output*
 * dimensions, not just the editing view.
 */

import { DPI, inToPx } from "./units.ts";

export type LabelSizeId = "4x6" | "2x1" | "round108" | "round144";
export type Orientation = "portrait" | "landscape";

/**
 * Round stock is still described by a bounding box -- the printer feeds a
 * rectangular area and the die-cut is circular within it. What changes is that
 * anything outside the circle must not be printed, because it would land on the
 * backing rather than the label.
 */
export type LabelShape = "rect" | "round";

export interface LabelSize {
  id: LabelSizeId;
  label: string;
  shape: LabelShape;
  /** Nominal dimensions in inches, in portrait orientation. */
  widthIn: number;
  heightIn: number;
}

/**
 * NOTE ON THE ROUND SIZES: these correspond to the Rollo driver's `Round108`
 * and `Round144` media options, read as 1.08in and 1.44in diameters. That
 * reading is inferred from the option names and has NOT been checked against
 * physical stock -- verify with calipers before trusting it for a real print
 * run, and correct the numbers here if they are wrong.
 */
export const LABEL_SIZES: readonly LabelSize[] = [
  { id: "4x6", label: '4" x 6"', shape: "rect", widthIn: 4, heightIn: 6 },
  { id: "2x1", label: '2" x 1"', shape: "rect", widthIn: 2, heightIn: 1 },
  { id: "round108", label: '1.08" round', shape: "round", widthIn: 1.08, heightIn: 1.08 },
  { id: "round144", label: '1.44" round', shape: "round", widthIn: 1.44, heightIn: 1.44 },
];

export function getLabelSize(id: LabelSizeId): LabelSize {
  const size = LABEL_SIZES.find((s) => s.id === id);
  if (!size) throw new Error(`Unknown label size: ${id}`);
  return size;
}

/** Resolved physical + pixel geometry for a label at a given orientation. */
export interface LabelGeometry {
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  shape: LabelShape;
}

/**
 * True when rotating the canvas would do anything.
 *
 * A round label is square-bounded, so an orientation toggle only spins the
 * contents while the page stays identical -- confusing rather than useful, so
 * the UI hides it.
 */
export function supportsOrientation(id: LabelSizeId): boolean {
  const size = getLabelSize(id);
  return size.shape !== "round" && size.widthIn !== size.heightIn;
}

export function resolveGeometry(
  id: LabelSizeId,
  orientation: Orientation,
  dpi: number = DPI,
): LabelGeometry {
  const size = getLabelSize(id);
  const swap = orientation === "landscape";
  const widthIn = swap ? size.heightIn : size.widthIn;
  const heightIn = swap ? size.widthIn : size.heightIn;
  return {
    widthIn,
    heightIn,
    widthPx: inToPx(widthIn, dpi),
    heightPx: inToPx(heightIn, dpi),
    dpi,
    shape: size.shape,
  };
}
