/**
 * CONTRACT TEST -- DO NOT EDIT.
 *
 * This defines the rasterizer's interface from the outside. If it looks wrong,
 * stop and report it rather than changing it: it is what guarantees the
 * transports can consume your output without ever referencing your module.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas } from "@napi-rs/canvas";

import { assertValidRaster, bytesPerRow, getPixel } from "../core/raster.ts";
import type { CanvasFactory, CanvasLike } from "../core/canvas.ts";
import { resolveGeometry } from "../core/label.ts";
import { simicOrderLabel } from "../core/fixtures/index.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument, thresholdImageData } from "./index.ts";

/** Node-side canvas so rasterizeDocument can render text headlessly. */
const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

describe("thresholdImageData", () => {
  it("converts RGBA pixels to a valid packed 1bpp raster", () => {
    // 8x2 checkerboard of pure black / pure white, fully opaque.
    const width = 8;
    const height = 2;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const value = (x + y) % 2 === 0 ? 0 : 255;
        rgba[i] = value;
        rgba[i + 1] = value;
        rgba[i + 2] = value;
        rgba[i + 3] = 255;
      }
    }

    const raster = thresholdImageData(rgba, width, height, DPI);

    assertValidRaster(raster);
    expect(raster.widthPx).toBe(width);
    expect(raster.heightPx).toBe(height);
    expect(raster.dpi).toBe(DPI);

    // Dark pixels must come back as set bits (1 = burn).
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(getPixel(raster, x, y)).toBe((x + y) % 2 === 0);
      }
    }
  });

  it("pads rows to whole bytes for widths that are not a multiple of 8", () => {
    const width = 13;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4);
    rgba.fill(255);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;

    const raster = thresholdImageData(rgba, width, height, DPI);

    assertValidRaster(raster);
    expect(bytesPerRow(width)).toBe(2);
    expect(raster.bits.length).toBe(2 * height);
  });

  it("treats fully transparent pixels as white, not black", () => {
    const rgba = new Uint8ClampedArray(8 * 1 * 4); // all zeroes: black but alpha 0
    const raster = thresholdImageData(rgba, 8, 1, DPI);

    for (let x = 0; x < 8; x++) {
      expect(getPixel(raster, x, 0)).toBe(false);
    }
  });
});

describe("rasterizeDocument", () => {
  it("produces a raster matching the document's resolved label geometry", async () => {
    const doc = simicOrderLabel();
    const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    assertValidRaster(raster);
    expect(raster.widthPx).toBe(geometry.widthPx);
    expect(raster.heightPx).toBe(geometry.heightPx);
    expect(raster.dpi).toBe(doc.dpi);
  });

  it("swaps dimensions for landscape orientation", async () => {
    const doc = { ...simicOrderLabel(), orientation: "landscape" as const };

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    assertValidRaster(raster);
    // 4x6 at 203 DPI rotated -> 6in wide, 4in tall.
    expect(raster.widthPx).toBe(resolveGeometry("4x6", "landscape").widthPx);
    expect(raster.heightPx).toBe(resolveGeometry("4x6", "landscape").heightPx);
  });

  it("renders text as some black pixels rather than a blank label", async () => {
    const doc = simicOrderLabel();

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    const anyBlack = raster.bits.some((byte) => byte !== 0);
    expect(anyBlack).toBe(true);
  });
});
