/**
 * Physical-unit and DPI math.
 *
 * Thermal printers are 1-bit devices. Every dimension in this app is expressed
 * in *device pixels at the target DPI* so that output is never resampled --
 * resampling a 1-bit image is what turns crisp text and barcode bars into grey
 * mush. Inches exist only at the UI boundary.
 */

/** Target device resolution. The reference Rollo prints at 203 DPI. */
export const DPI = 203;

/** Inches -> device pixels, rounded to a whole pixel. */
export function inToPx(inches: number, dpi: number = DPI): number {
  return Math.round(inches * dpi);
}

/** Device pixels -> inches. */
export function pxToIn(px: number, dpi: number = DPI): number {
  return px / dpi;
}

/** Inches -> PDF points (1 pt = 1/72 in). Used for exact page geometry. */
export function inToPt(inches: number): number {
  return inches * 72;
}
