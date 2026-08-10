/**
 * STUB -- implemented by the rasterizer agent.
 *
 * These signatures are fixed by src/raster/__contract__.test.ts. Implement the
 * bodies; do not change the exported names or parameter shapes.
 */

import type { CanvasFactory } from "../core/canvas.ts";
import type { LabelDocument } from "../core/document.ts";
import type { MonoRaster } from "../core/raster.ts";

export interface RasterizeOptions {
  /** Injected in Node tests; defaults to the DOM factory in the browser. */
  createCanvas?: CanvasFactory;
  /** Luminance below this is burned. 0-255, default 128. */
  threshold?: number;
}

/**
 * Convert RGBA pixel data to a packed 1bpp MonoRaster.
 *
 * Fully transparent pixels are white. Luminance is the standard perceptual
 * weighting; anything at or below `threshold` becomes a set bit (burn).
 */
export function thresholdImageData(
  _rgba: Uint8ClampedArray,
  _width: number,
  _height: number,
  _dpi: number,
  _options?: RasterizeOptions,
): MonoRaster {
  throw new Error("not implemented");
}

/**
 * Render a LabelDocument to a MonoRaster at the document's DPI.
 *
 * Renders directly to a 2D context -- NOT through Konva. See src/core/canvas.ts
 * for why. Output dimensions come from resolveGeometry(), so landscape
 * orientation swaps width and height.
 */
export function rasterizeDocument(
  _doc: LabelDocument,
  _options?: RasterizeOptions,
): Promise<MonoRaster> {
  throw new Error("not implemented");
}
