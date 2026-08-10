/**
 * Round label stock: ink must never land outside the die-cut circle, because
 * the printer feeds a rectangular area and anything beyond the circle hits the
 * backing liner rather than the label.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas } from "@napi-rs/canvas";

import type { CanvasFactory, CanvasLike } from "../core/canvas.ts";
import { SCHEMA_VERSION, type LabelDocument } from "../core/document.ts";
import type { LabelSizeId } from "../core/label.ts";
import { resolveGeometry } from "../core/label.ts";
import { getPixel } from "../core/raster.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument } from "./index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

/** A filled rectangle covering the whole label, which must get clipped. */
function floodDoc(sizeId: LabelSizeId): LabelDocument {
  const geometry = resolveGeometry(sizeId, "portrait");
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "flood",
    name: "flood",
    sizeId,
    orientation: "portrait",
    dpi: DPI,
    elements: [
      {
        id: "fill",
        kind: "rect",
        x: 0,
        y: 0,
        widthPx: geometry.widthPx,
        heightPx: geometry.heightPx,
        rotation: 0,
        strokeWidthPx: 0,
        filled: true,
        cornerRadiusPx: 0,
      },
    ],
  };
}

describe("round labels", () => {
  it("clips ink to the circle, leaving the corners clean", async () => {
    const raster = await rasterizeDocument(floodDoc("round144"), { createCanvas: nodeCanvas });

    // Centre is inside the circle.
    expect(getPixel(raster, Math.floor(raster.widthPx / 2), Math.floor(raster.heightPx / 2))).toBe(
      true,
    );

    // All four corners lie outside it.
    expect(getPixel(raster, 1, 1)).toBe(false);
    expect(getPixel(raster, raster.widthPx - 2, 1)).toBe(false);
    expect(getPixel(raster, 1, raster.heightPx - 2)).toBe(false);
    expect(getPixel(raster, raster.widthPx - 2, raster.heightPx - 2)).toBe(false);
  });

  it("burns roughly the area of a circle, not a square", async () => {
    const raster = await rasterizeDocument(floodDoc("round108"), { createCanvas: nodeCanvas });

    let ink = 0;
    for (let y = 0; y < raster.heightPx; y++) {
      for (let x = 0; x < raster.widthPx; x++) if (getPixel(raster, x, y)) ink++;
    }

    const area = raster.widthPx * raster.heightPx;
    // pi/4 is about 0.785; allow slack for antialiasing at the rim.
    expect(ink / area).toBeGreaterThan(0.74);
    expect(ink / area).toBeLessThan(0.82);
  });

  it("leaves rectangular stock unclipped", async () => {
    const raster = await rasterizeDocument(floodDoc("2x1"), { createCanvas: nodeCanvas });

    expect(getPixel(raster, 1, 1)).toBe(true);
    expect(getPixel(raster, raster.widthPx - 2, raster.heightPx - 2)).toBe(true);
  });

  it("keeps round stock square", async () => {
    const geometry = resolveGeometry("round144", "portrait");
    expect(geometry.widthPx).toBe(geometry.heightPx);
    expect(geometry.shape).toBe("round");
  });
});
