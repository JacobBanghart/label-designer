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

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

/**
 * Units the UI can display.
 *
 * Device pixels are the storage format and the only unit that is exact -- the
 * others round. `px` stays available for anyone who wants to think in printer
 * dots, but inches and millimetres are what a physical label is measured in.
 */
export type DisplayUnit = "in" | "mm" | "px";

export const DISPLAY_UNITS: readonly DisplayUnit[] = ["in", "mm", "px"];

/** Sensible input step per unit, so arrow keys move by something useful. */
export function unitStep(unit: DisplayUnit): number {
  return unit === "in" ? 0.05 : unit === "mm" ? 1 : 1;
}

/** Decimal places worth showing. Beyond this is noise at 203 DPI. */
export function unitPrecision(unit: DisplayUnit): number {
  return unit === "in" ? 3 : unit === "mm" ? 1 : 0;
}

export function pxToUnit(px: number, unit: DisplayUnit, dpi: number = DPI): number {
  if (unit === "px") return px;
  const inches = px / dpi;
  return unit === "in" ? inches : inches * MM_PER_INCH;
}

export function unitToPx(value: number, unit: DisplayUnit, dpi: number = DPI): number {
  if (unit === "px") return Math.round(value);
  const inches = unit === "in" ? value : value / MM_PER_INCH;
  return Math.round(inches * dpi);
}

/** Font sizes are conventionally points, whatever unit lengths are shown in. */
export function pxToPt(px: number, dpi: number = DPI): number {
  return (px / dpi) * PT_PER_INCH;
}

export function ptToPx(pt: number, dpi: number = DPI): number {
  return Math.round((pt / PT_PER_INCH) * dpi);
}
