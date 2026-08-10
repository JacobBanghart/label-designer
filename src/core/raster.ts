/**
 * MonoRaster -- the canonical render artifact.
 *
 * THIS IS THE CENTRAL CONTRACT OF THE PROJECT. Every print transport consumes a
 * MonoRaster and nothing else. It is deliberately NOT a PNG or a PDF: printer
 * command languages (ZPL, ESC/POS) want a packed bitmap, so terminating the
 * pipeline in an image format would mean retrofitting rasterization underneath
 * a pipeline never built for it.
 *
 * Bit layout: 1 bit per pixel, MSB first within each byte, rows padded out to a
 * whole number of bytes. A set bit (1) means BURN (black). This matches how
 * thermal command languages express raster data, so transports need no
 * bit-twiddling beyond slicing rows.
 */

/** Bytes occupied by a single row of `widthPx` pixels, padded to a byte boundary. */
export function bytesPerRow(widthPx: number): number {
  return Math.ceil(widthPx / 8);
}

export interface MonoRaster {
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Packed 1bpp, MSB-first, rows padded to bytesPerRow(widthPx). 1 = black. */
  bits: Uint8Array;
}

/** Allocate an all-white raster of the given size. */
export function createMonoRaster(widthPx: number, heightPx: number, dpi: number): MonoRaster {
  return {
    widthPx,
    heightPx,
    dpi,
    bits: new Uint8Array(bytesPerRow(widthPx) * heightPx),
  };
}

/** Read a single pixel. True means black. */
export function getPixel(raster: MonoRaster, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= raster.widthPx || y >= raster.heightPx) return false;
  const byteIndex = y * bytesPerRow(raster.widthPx) + (x >> 3);
  const mask = 0x80 >> (x & 7);
  return (raster.bits[byteIndex]! & mask) !== 0;
}

/** Set a single pixel. Mutates -- rasters are build-then-freeze, unlike documents. */
export function setPixel(raster: MonoRaster, x: number, y: number, black: boolean): void {
  if (x < 0 || y < 0 || x >= raster.widthPx || y >= raster.heightPx) return;
  const byteIndex = y * bytesPerRow(raster.widthPx) + (x >> 3);
  const mask = 0x80 >> (x & 7);
  if (black) raster.bits[byteIndex]! |= mask;
  else raster.bits[byteIndex]! &= ~mask;
}

/** Validate structural invariants. Throws with a specific message on failure. */
export function assertValidRaster(raster: MonoRaster): void {
  const expected = bytesPerRow(raster.widthPx) * raster.heightPx;
  if (raster.bits.length !== expected) {
    throw new Error(
      `MonoRaster bits length ${raster.bits.length} does not match ` +
        `${raster.widthPx}x${raster.heightPx} (expected ${expected} bytes)`,
    );
  }
  if (raster.widthPx <= 0 || raster.heightPx <= 0) {
    throw new Error(`MonoRaster has non-positive dimensions: ${raster.widthPx}x${raster.heightPx}`);
  }
  if (raster.dpi <= 0) {
    throw new Error(`MonoRaster has non-positive dpi: ${raster.dpi}`);
  }
}
