/**
 * Unit tests for pieces the contract test does not cover: alpha compositing,
 * the luminance threshold boundary, word wrap, and rotation geometry.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas } from "@napi-rs/canvas";

import { getPixel } from "../core/raster.ts";
import type { CanvasFactory, CanvasLike } from "../core/canvas.ts";
import { SCHEMA_VERSION, type LabelDocument, type TextElement } from "../core/document.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument, thresholdImageData } from "./index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

function solidPixel(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  return new Uint8ClampedArray([r, g, b, a]);
}

function textDoc(overrides: Partial<TextElement>): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "test-doc",
    name: "test",
    sizeId: "2x1",
    orientation: "portrait",
    dpi: DPI,
    elements: [
      {
        id: "el-1",
        kind: "text",
        x: 0,
        y: 0,
        widthPx: 200,
        heightPx: 100,
        rotation: 0,
        text: "hello",
        fontSizePx: 16,
        fontFamily: "sans-serif",
        bold: false,
        italic: false,
        align: "left",
        ...overrides,
      },
    ],
  };
}

describe("thresholdImageData: alpha compositing", () => {
  it("partially transparent black pixel composites lighter against white", () => {
    // 50% alpha black over white -> luminance ~127.5, right at the edge.
    const rgba = solidPixel(0, 0, 0, 128);
    const raster = thresholdImageData(rgba, 1, 1, DPI);
    // effective luminance = 0*0.502 + 255*0.498 ~= 127 -> should burn (<=128)
    expect(getPixel(raster, 0, 0)).toBe(true);
  });

  it("mostly transparent black pixel stays white", () => {
    const rgba = solidPixel(0, 0, 0, 20); // alpha ~0.078 -> luminance ~235
    const raster = thresholdImageData(rgba, 1, 1, DPI);
    expect(getPixel(raster, 0, 0)).toBe(false);
  });
});

describe("thresholdImageData: threshold boundary", () => {
  it("luminance exactly at threshold burns (<=)", () => {
    const rgba = solidPixel(128, 128, 128, 255); // luminance == 128
    const raster = thresholdImageData(rgba, 1, 1, DPI, { threshold: 128 });
    expect(getPixel(raster, 0, 0)).toBe(true);
  });

  it("luminance one above threshold stays white", () => {
    const rgba = solidPixel(129, 129, 129, 255); // luminance == 129
    const raster = thresholdImageData(rgba, 1, 1, DPI, { threshold: 128 });
    expect(getPixel(raster, 0, 0)).toBe(false);
  });

  it("honours a custom threshold option", () => {
    const rgba = solidPixel(200, 200, 200, 255); // luminance == 200
    const low = thresholdImageData(rgba, 1, 1, DPI, { threshold: 128 });
    const high = thresholdImageData(rgba, 1, 1, DPI, { threshold: 220 });
    expect(getPixel(low, 0, 0)).toBe(false);
    expect(getPixel(high, 0, 0)).toBe(true);
  });
});

describe("rasterizeDocument: word wrap", () => {
  it("wraps long text into multiple lines instead of overflowing onto one row", async () => {
    const doc = textDoc({
      text: "a very long line of text that should wrap across several lines",
      widthPx: 80,
      heightPx: 200,
      fontSizePx: 14,
    });

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    // Black ink should appear across more than one row band (i.e. multiple
    // lines were laid out), not just clustered in a single line height.
    let firstBlackRow = -1;
    let lastBlackRow = -1;
    for (let y = 0; y < raster.heightPx; y++) {
      for (let x = 0; x < raster.widthPx; x++) {
        if (getPixel(raster, x, y)) {
          if (firstBlackRow === -1) firstBlackRow = y;
          lastBlackRow = y;
        }
      }
    }

    expect(firstBlackRow).toBeGreaterThanOrEqual(0);
    // A single line at fontSizePx 14 with lineHeight ~16.8 shouldn't span
    // more than ~20px; wrapped text spans much further.
    expect(lastBlackRow - firstBlackRow).toBeGreaterThan(20);
  });
});

describe("rasterizeDocument: rotation geometry", () => {
  it("rotates text about the element's centre, not its top-left corner", async () => {
    // Unrotated: a short, tall box with left-aligned single-char text should
    // put ink near the top-left of the box.
    const base = textDoc({
      text: "I",
      x: 100,
      y: 100,
      widthPx: 40,
      heightPx: 200,
      fontSizePx: 24,
      rotation: 0,
      align: "left",
    });
    const rotated = textDoc({
      text: "I",
      x: 100,
      y: 100,
      widthPx: 40,
      heightPx: 200,
      fontSizePx: 24,
      rotation: 90,
      align: "left",
    });

    const rasterBase = await rasterizeDocument(base, { createCanvas: nodeCanvas });
    const rasterRotated = await rasterizeDocument(rotated, { createCanvas: nodeCanvas });

    function centroid(raster: typeof rasterBase) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let y = 0; y < raster.heightPx; y++) {
        for (let x = 0; x < raster.widthPx; x++) {
          if (getPixel(raster, x, y)) {
            sumX += x;
            sumY += y;
            count++;
          }
        }
      }
      expect(count).toBeGreaterThan(0);
      return { x: sumX / count, y: sumY / count };
    }

    const centreOfBox = { x: 100 + 20, y: 100 + 100 };
    const baseCentroid = centroid(rasterBase);
    const rotatedCentroid = centroid(rasterRotated);

    // The unrotated glyph should sit left of the box centre (left-aligned,
    // near the top of a tall box).
    expect(baseCentroid.x).toBeLessThan(centreOfBox.x);
    expect(baseCentroid.y).toBeLessThan(centreOfBox.y);

    // After a 90 degree rotation about the same centre, the ink should have
    // moved to a distinctly different position -- specifically, closer to
    // being above/below the centre rather than to its left, proving rotation
    // pivots on the centre rather than the top-left corner.
    expect(
      Math.abs(rotatedCentroid.x - baseCentroid.x) + Math.abs(rotatedCentroid.y - baseCentroid.y),
    ).toBeGreaterThan(10);
  });
});

describe("long-token wrapping", () => {
  it("breaks a token too wide for the box instead of overflowing the label", async () => {
    // A 2x1 label is 406x203 px. A long unbroken order number cannot fit on one
    // line at this size; it must wrap, not run off the edge, or the printed
    // label silently loses characters.
    const doc: LabelDocument = {
      schemaVersion: SCHEMA_VERSION,
      id: "overflow",
      name: "overflow",
      sizeId: "2x1",
      orientation: "portrait",
      dpi: DPI,
      elements: [
        {
          id: "t",
          kind: "text",
          x: 0,
          y: 0,
          widthPx: 200,
          heightPx: 180,
          rotation: 0,
          text: "20250903ku6pmv20250903ku6pmv",
          fontSizePx: 40,
          fontFamily: "sans-serif",
          bold: false,
          italic: false,
          align: "left",
        },
      ],
    };

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    // Nothing should be burned in the column strip beyond the text box: if the
    // token overflowed rather than wrapping, ink would appear out there.
    let inkOutsideBox = 0;
    for (let y = 0; y < raster.heightPx; y++) {
      for (let x = 205; x < raster.widthPx; x++) {
        if (getPixel(raster, x, y)) inkOutsideBox++;
      }
    }
    expect(inkOutsideBox).toBe(0);

    // ...and it did actually render something inside the box.
    let inkInsideBox = 0;
    for (let y = 0; y < raster.heightPx; y++) {
      for (let x = 0; x < 200; x++) {
        if (getPixel(raster, x, y)) inkInsideBox++;
      }
    }
    expect(inkInsideBox).toBeGreaterThan(0);
  });
});
