/**
 * Additional coverage for image rasterization beyond __image_contract__.test.ts:
 * dithering coverage of a flat mid-grey, invert combined with dither, a 1x1
 * source image, and a box whose aspect ratio differs sharply from the source
 * image (confirming fill-the-box behaviour rather than letterboxing).
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { CanvasFactory, CanvasLike, ImageDecoder } from "../core/canvas.ts";
import { SCHEMA_VERSION, type ImageElement, type LabelDocument } from "../core/document.ts";
import { getPixel, type MonoRaster } from "../core/raster.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument } from "./index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;
const nodeDecoder: ImageDecoder = (src) => loadImage(src);

function solidPng(width: number, height: number, r: number, g: number, b: number): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

function docWith(element: ImageElement): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "img",
    name: "img",
    sizeId: "2x1",
    orientation: "portrait",
    dpi: DPI,
    elements: [element],
  };
}

function image(overrides: Partial<ImageElement> & { src: string }): ImageElement {
  return {
    id: "i",
    kind: "image",
    x: 0,
    y: 0,
    widthPx: 100,
    heightPx: 100,
    rotation: 0,
    halftone: "threshold",
    threshold: 128,
    invert: false,
    ...overrides,
  };
}

function countInk(raster: MonoRaster, x0: number, y0: number, x1: number, y1: number): number {
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (getPixel(raster, x, y)) n++;
  }
  return n;
}

const render = (doc: LabelDocument) =>
  rasterizeDocument(doc, { createCanvas: nodeCanvas, decodeImage: nodeDecoder });

describe("dithering coverage", () => {
  it("dithers a mid-grey to roughly half coverage", async () => {
    const grey = solidPng(60, 60, 128, 128, 128);
    const raster = await render(
      docWith(image({ src: grey, halftone: "dither", widthPx: 60, heightPx: 60 })),
    );

    const on = countInk(raster, 0, 0, 60, 60);
    const total = 60 * 60;
    const coverage = on / total;

    // Floyd-Steinberg on a flat 50% grey should land close to 50% ink,
    // with generous tolerance for the boundary case (grey exactly equals
    // the default threshold, which biases the very first pixels).
    expect(coverage).toBeGreaterThan(0.3);
    expect(coverage).toBeLessThan(0.7);
  });

  it("invert plus dither roughly complements the non-inverted coverage", async () => {
    // Use a grey clearly below the default threshold so dithering isn't
    // sitting exactly on the boundary.
    const grey = solidPng(50, 50, 80, 80, 80);

    const normal = await render(
      docWith(image({ src: grey, halftone: "dither", widthPx: 50, heightPx: 50 })),
    );
    const inverted = await render(
      docWith(image({ src: grey, halftone: "dither", invert: true, widthPx: 50, heightPx: 50 })),
    );

    const onNormal = countInk(normal, 0, 0, 50, 50);
    const onInverted = countInk(inverted, 0, 0, 50, 50);
    const total = 50 * 50;

    // A dark grey dithers mostly black; inverting should flip that to
    // mostly white, so the inverted coverage must be substantially lower.
    expect(onNormal).toBeGreaterThan(total * 0.6);
    expect(onInverted).toBeLessThan(onNormal);
  });

  it("does not throw on a 1x1 source image", async () => {
    const src = solidPng(1, 1, 0, 0, 0);
    const raster = await render(docWith(image({ src, widthPx: 20, heightPx: 20 })));

    expect(countInk(raster, 0, 0, 20, 20)).toBe(400);
  });

  it("fills the box rather than letterboxing when aspect ratios differ sharply", async () => {
    // A tall, narrow source image stretched into a short, wide box.
    const src = solidPng(4, 400, 0, 0, 0);
    const raster = await render(docWith(image({ src, x: 0, y: 0, widthPx: 200, heightPx: 20 })));

    // Corners of the box should be inked -- if the renderer letterboxed to
    // preserve the source aspect ratio, these corners would be blank.
    expect(getPixel(raster, 1, 1)).toBe(true);
    expect(getPixel(raster, 198, 1)).toBe(true);
    expect(getPixel(raster, 1, 18)).toBe(true);
    expect(getPixel(raster, 198, 18)).toBe(true);
    // Outside the box entirely.
    expect(getPixel(raster, 1, 25)).toBe(false);
  });
});
