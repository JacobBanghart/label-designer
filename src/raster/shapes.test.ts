/**
 * Unit tests for shape rendering beyond what the shapes contract covers:
 * corner-radius clamping, stroke+fill combined, zero-dimension boxes, and
 * arrowhead orientation on a non-horizontal arrow.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas } from "@napi-rs/canvas";

import type { CanvasFactory, CanvasLike } from "../core/canvas.ts";
import { SCHEMA_VERSION, type Element, type LabelDocument } from "../core/document.ts";
import { getPixel, type MonoRaster } from "../core/raster.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument } from "./index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

function docWith(...elements: Element[]): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "shapes-extra",
    name: "shapes-extra",
    sizeId: "2x1",
    orientation: "portrait",
    dpi: DPI,
    elements,
  };
}

function countInk(raster: MonoRaster): number {
  let n = 0;
  for (let y = 0; y < raster.heightPx; y++) {
    for (let x = 0; x < raster.widthPx; x++) {
      if (getPixel(raster, x, y)) n++;
    }
  }
  return n;
}

describe("rect: corner radius clamping", () => {
  it("clamps an oversized cornerRadiusPx to half the smaller side instead of throwing or self-intersecting", async () => {
    // A 40x100 box with a radius requested far bigger than either half-side.
    // If unclamped, the rounded-corner geometry would misbehave (overlapping
    // arcs); the key requirement is that it renders sane content and doesn't
    // throw.
    const raster = await rasterizeDocument(
      docWith({
        id: "r",
        kind: "rect",
        x: 100,
        y: 50,
        widthPx: 40,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 0,
        filled: true,
        cornerRadiusPx: 10_000,
      }),
      { createCanvas: nodeCanvas },
    );

    // Centre of the box should still be burned -- a sane clamp keeps a filled
    // shape roughly box-shaped rather than collapsing to nothing.
    expect(getPixel(raster, 120, 100)).toBe(true);
  });
});

describe("rect: stroke and fill together", () => {
  it("applies both the fill and the outline when both are requested", async () => {
    const filledOnly = await rasterizeDocument(
      docWith({
        id: "r",
        kind: "rect",
        x: 50,
        y: 50,
        widthPx: 100,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 0,
        filled: true,
        cornerRadiusPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    const filledAndStroked = await rasterizeDocument(
      docWith({
        id: "r",
        kind: "rect",
        x: 50,
        y: 50,
        widthPx: 100,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 10,
        filled: true,
        cornerRadiusPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    // The stroke extends beyond the fill-only box (half the stroke width
    // straddles the edge), so ink outside the fill-only box's edge should
    // appear only once a stroke is added.
    expect(getPixel(filledOnly, 48, 100)).toBe(false);
    expect(getPixel(filledAndStroked, 48, 100)).toBe(true);
    // Both still burn the interior -- fill wasn't dropped in favour of the
    // stroke.
    expect(getPixel(filledAndStroked, 100, 100)).toBe(true);
  });
});

describe("polyline: zero-dimension box", () => {
  it("renders a perfectly vertical line whose box has zero width without dividing by zero", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "v",
        kind: "line",
        x: 100,
        y: 20,
        widthPx: 0,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 4,
        points: [0.5, 0, 0.5, 1],
        arrowHeadPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(getPixel(raster, 100, 70)).toBe(true);
  });

  it("does not throw and stays blank for a zero-area rect", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "z",
        kind: "rect",
        x: 50,
        y: 50,
        widthPx: 0,
        heightPx: 0,
        rotation: 0,
        strokeWidthPx: 4,
        filled: true,
        cornerRadiusPx: 5,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(countInk(raster)).toBe(0);
  });
});

describe("polyline: arrowhead orientation", () => {
  it("places arrowhead ink near the endpoint of a diagonal arrow, not along the original horizontal axis", async () => {
    // A steep diagonal segment from top-left to bottom-right of its box.
    const raster = await rasterizeDocument(
      docWith({
        id: "a",
        kind: "arrow",
        x: 20,
        y: 20,
        widthPx: 160,
        heightPx: 160,
        rotation: 0,
        strokeWidthPx: 3,
        points: [0, 0, 1, 1],
        arrowHeadPx: 20,
      }),
      { createCanvas: nodeCanvas },
    );

    // The endpoint in device pixels is (20 + 160, 20 + 160) = (180, 180).
    // A correctly oriented arrowhead spreads ink around that corner, in
    // particular above/left of it along the diagonal, not off to the side on
    // a horizontal axis.
    let inkNearTip = 0;
    for (let y = 160; y <= 180; y++) {
      for (let x = 160; x <= 180; x++) {
        if (x < raster.widthPx && y < raster.heightPx && getPixel(raster, x, y)) inkNearTip++;
      }
    }
    expect(inkNearTip).toBeGreaterThan(0);

    // And no ink should appear far off-axis near the *top-right* corner of the
    // box, which is where a (wrongly) horizontally-oriented arrowhead based on
    // the bounding box -- rather than the actual segment direction -- might
    // mistakenly place a wing.
    let inkAtWrongCorner = 0;
    for (let y = 20; y <= 30; y++) {
      for (let x = 170; x <= 180; x++) {
        if (x < raster.widthPx && y < raster.heightPx && getPixel(raster, x, y)) inkAtWrongCorner++;
      }
    }
    expect(inkAtWrongCorner).toBe(0);
  });
});
