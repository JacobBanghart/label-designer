/**
 * TSPL (TSC Printer Language) encoding.
 *
 * The reference Rollo -- and a great many rebadged thermal printers -- speak
 * TSPL: a plain-text command language ending in a raw 1-bit bitmap. This was
 * established by reading the actual byte stream the vendor CUPS filter emits:
 *
 *   SIZE 51 mm ,26 mm
 *   REFERENCE 0,0
 *   DIRECTION 0,0
 *   GAP 3 mm,0 mm
 *   DENSITY 8
 *   SPEED 6
 *   CLS
 *   BITMAP 0,0,51,203,1,<51 * 203 bytes>
 *   PRINT 1,1
 *
 * Speaking it directly means every setting that used to live in a driver we
 * could not reach -- rotation, darkness, media gap, registration offset -- is
 * just a parameter here. That is the entire point: the failures this replaces
 * were all in layers between the app and the printer.
 *
 * BIT POLARITY IS INVERTED relative to MonoRaster. TSPL treats a set bit as
 * WHITE; MonoRaster treats a set bit as BURN. Verified by counting bits in the
 * vendor filter's output for a mostly-blank label: 83.7% were set.
 */

import { bytesPerRow, type MonoRaster } from "./raster.ts";

/** Rotation applied by the printer itself, via the DIRECTION command. */
export type TsplDirection = 0 | 1;

export interface TsplSettings {
  /** Burn darkness, 0-15. The vendor driver defaults to 8. */
  density: number;
  /** Feed speed, 1-8. The vendor driver defaults to 6. */
  speed: number;
  /** Gap between die-cut labels in millimetres. 0 for continuous stock. */
  gapMm: number;
  /**
   * Print direction. This is the knob that fixes media the printer would
   * otherwise turn 180 degrees -- the exact problem that made 2x1 stock
   * unprintable through the driver.
   */
  direction: TsplDirection;
  /** Registration offset in dots, for stock that sits slightly off-centre. */
  offsetXDots: number;
  offsetYDots: number;
  copies: number;
}

export const DEFAULT_TSPL_SETTINGS: TsplSettings = {
  density: 8,
  speed: 6,
  gapMm: 3,
  direction: 0,
  offsetXDots: 0,
  offsetYDots: 0,
  copies: 1,
};

/** Round up to whole millimetres, as the vendor filter does. */
function dotsToMm(dots: number, dpi: number): number {
  return Math.ceil((dots / dpi) * 25.4);
}

/**
 * Invert a packed 1bpp raster into TSPL's polarity.
 *
 * Padding bits at the end of each row become 1 (white) after inversion, which
 * is what we want -- they must not print.
 */
function toTsplBitmap(raster: MonoRaster): Uint8Array {
  const out = new Uint8Array(raster.bits.length);
  for (let i = 0; i < raster.bits.length; i++) out[i] = ~raster.bits[i]! & 0xff;
  return out;
}

/**
 * Build the complete byte stream for one print job.
 *
 * Returned as bytes rather than a string because the bitmap is binary and must
 * not pass through any text encoding.
 */
export function encodeTspl(raster: MonoRaster, settings: TsplSettings): Uint8Array {
  const widthBytes = bytesPerRow(raster.widthPx);
  const copies = Math.max(1, Math.round(settings.copies));

  const header =
    `SIZE ${dotsToMm(raster.widthPx, raster.dpi)} mm ,${dotsToMm(raster.heightPx, raster.dpi)} mm\n` +
    `REFERENCE ${Math.round(settings.offsetXDots)},${Math.round(settings.offsetYDots)}\n` +
    `DIRECTION ${settings.direction},0\n` +
    `GAP ${settings.gapMm} mm,0 mm\n` +
    `OFFSET 0 mm\n` +
    `DENSITY ${clamp(settings.density, 0, 15)}\n` +
    `SPEED ${clamp(settings.speed, 1, 8)}\n` +
    `CLS\n` +
    `BITMAP 0,0,${widthBytes},${raster.heightPx},1,`;

  const footer = `\nPRINT 1,${copies}\n`;

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(header);
  const bitmap = toTsplBitmap(raster);
  const footerBytes = encoder.encode(footer);

  const out = new Uint8Array(headerBytes.length + bitmap.length + footerBytes.length);
  out.set(headerBytes, 0);
  out.set(bitmap, headerBytes.length);
  out.set(footerBytes, headerBytes.length + bitmap.length);
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
