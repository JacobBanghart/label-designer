/**
 * Label stock sizes and orientation.
 *
 * MVP supports 4x6 and 2x1 only. "Canvas rotation" is an orientation toggle:
 * it swaps width and height, so 4x6 becomes 6x4. It changes the *output*
 * dimensions, not just the editing view.
 */

import { DPI, inToPx } from "./units.ts";

export type LabelSizeId = "4x6" | "2x1";
export type Orientation = "portrait" | "landscape";

export interface LabelSize {
  id: LabelSizeId;
  label: string;
  /** Nominal dimensions in inches, in portrait orientation. */
  widthIn: number;
  heightIn: number;
}

export const LABEL_SIZES: readonly LabelSize[] = [
  { id: "4x6", label: '4" x 6"', widthIn: 4, heightIn: 6 },
  { id: "2x1", label: '2" x 1"', widthIn: 2, heightIn: 1 },
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
  };
}
