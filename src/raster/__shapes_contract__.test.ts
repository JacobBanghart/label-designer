/**
 * CONTRACT TEST -- DO NOT EDIT.
 *
 * Defines how drawing elements must rasterize. If it looks wrong, stop and
 * report it rather than changing it.
 *
 * The assertions are all "is this pixel burned", because that is the only
 * thing a thermal printer actually cares about.
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

/** A 2x1 label is 406x203 -- small enough to reason about pixel by pixel. */
function docWith(...elements: Element[]): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "shapes",
    name: "shapes",
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

describe("rect", () => {
  it("outlines without filling when filled is false", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "r",
        kind: "rect",
        x: 50,
        y: 50,
        widthPx: 100,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 4,
        filled: false,
        cornerRadiusPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    // Edge is burned, centre is not.
    expect(getPixel(raster, 100, 50)).toBe(true);
    expect(getPixel(raster, 100, 100)).toBe(false);
  });

  it("fills solid when filled is true", async () => {
    const raster = await rasterizeDocument(
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

    expect(getPixel(raster, 100, 100)).toBe(true);
    // Well outside the box stays clean.
    expect(getPixel(raster, 10, 10)).toBe(false);
  });
});

describe("ellipse", () => {
  it("burns its centre when filled and leaves box corners clean", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "e",
        kind: "ellipse",
        x: 50,
        y: 30,
        widthPx: 120,
        heightPx: 120,
        rotation: 0,
        strokeWidthPx: 0,
        filled: true,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(getPixel(raster, 110, 90)).toBe(true);
    // Corner of the bounding box lies outside the ellipse.
    expect(getPixel(raster, 52, 32)).toBe(false);
  });
});

describe("polyline", () => {
  it("draws a line along the normalised points", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "l",
        kind: "line",
        x: 50,
        y: 50,
        widthPx: 100,
        heightPx: 0,
        rotation: 0,
        strokeWidthPx: 6,
        // Horizontal, left edge to right edge, vertically centred.
        points: [0, 0.5, 1, 0.5],
        arrowHeadPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(getPixel(raster, 100, 50)).toBe(true);
    expect(getPixel(raster, 100, 90)).toBe(false);
  });

  it("puts more ink on an arrow than on the same line, from the head", async () => {
    const base = {
      id: "a",
      x: 50,
      y: 50,
      widthPx: 200,
      heightPx: 0,
      rotation: 0,
      strokeWidthPx: 4,
      points: [0, 0.5, 1, 0.5],
    };

    const line = await rasterizeDocument(docWith({ ...base, kind: "line", arrowHeadPx: 0 }), {
      createCanvas: nodeCanvas,
    });
    const arrow = await rasterizeDocument(docWith({ ...base, kind: "arrow", arrowHeadPx: 24 }), {
      createCanvas: nodeCanvas,
    });

    expect(countInk(arrow)).toBeGreaterThan(countInk(line));
  });

  it("renders a freehand path through its points", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "f",
        kind: "freehand",
        x: 20,
        y: 20,
        widthPx: 160,
        heightPx: 160,
        rotation: 0,
        strokeWidthPx: 5,
        points: [0, 0, 0.5, 0.5, 1, 1],
        arrowHeadPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(countInk(raster)).toBeGreaterThan(0);
  });

  it("ignores a degenerate path with fewer than two points", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "f",
        kind: "freehand",
        x: 20,
        y: 20,
        widthPx: 100,
        heightPx: 100,
        rotation: 0,
        strokeWidthPx: 5,
        points: [0.5, 0.5],
        arrowHeadPx: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(countInk(raster)).toBe(0);
  });
});

describe("reserved kinds", () => {
  it("still skips unimplemented kinds without throwing", async () => {
    const raster = await rasterizeDocument(
      docWith({
        id: "b",
        kind: "barcode",
        x: 10,
        y: 10,
        widthPx: 50,
        heightPx: 50,
        rotation: 0,
      }),
      { createCanvas: nodeCanvas },
    );

    expect(countInk(raster)).toBe(0);
  });
});

describe("rotation", () => {
  it("rotates a shape about its centre, like text", async () => {
    // A wide, short bar rotated 90 degrees should become tall and narrow.
    const element = {
      id: "r",
      kind: "rect" as const,
      x: 103,
      y: 86,
      widthPx: 200,
      heightPx: 30,
      strokeWidthPx: 0,
      filled: true,
      cornerRadiusPx: 0,
    };

    const flat = await rasterizeDocument(docWith({ ...element, rotation: 0 }), {
      createCanvas: nodeCanvas,
    });
    const turned = await rasterizeDocument(docWith({ ...element, rotation: 90 }), {
      createCanvas: nodeCanvas,
    });

    // Centre is burned either way.
    expect(getPixel(flat, 203, 101)).toBe(true);
    expect(getPixel(turned, 203, 101)).toBe(true);

    // A point far along the bar's original long axis is only burned when flat.
    expect(getPixel(flat, 290, 101)).toBe(true);
    expect(getPixel(turned, 290, 101)).toBe(false);
  });
});
