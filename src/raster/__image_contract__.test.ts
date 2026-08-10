/**
 * CONTRACT TEST -- DO NOT EDIT.
 *
 * Defines image rasterization and halftoning. If it looks wrong, stop and
 * report it rather than changing it.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import type { CanvasFactory, CanvasLike, ImageDecoder } from "../core/canvas.ts";
import { SCHEMA_VERSION, type ImageElement, type LabelDocument } from "../core/document.ts";
import { getPixel, type MonoRaster } from "../core/raster.ts";
import { DPI } from "../core/units.ts";

import { rasterizeDocument, thresholdImageData } from "./index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;
const nodeDecoder: ImageDecoder = (src) => loadImage(src);

/** A solid PNG data URI of the given colour, built without touching the DOM. */
function solidPng(width: number, height: number, r: number, g: number, b: number): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** A left-to-right black-to-white ramp, for exercising halftoning. */
function rampPng(width: number, height: number): string {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  for (let x = 0; x < width; x++) {
    const value = Math.round((x / Math.max(1, width - 1)) * 255);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(x, 0, 1, height);
  }
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
    x: 50,
    y: 50,
    widthPx: 100,
    heightPx: 100,
    rotation: 0,
    halftone: "threshold",
    threshold: 128,
    invert: false,
    ...overrides,
  };
}

function countInk(raster: MonoRaster): number {
  let n = 0;
  for (let y = 0; y < raster.heightPx; y++) {
    for (let x = 0; x < raster.widthPx; x++) if (getPixel(raster, x, y)) n++;
  }
  return n;
}

const render = (doc: LabelDocument) =>
  rasterizeDocument(doc, { createCanvas: nodeCanvas, decodeImage: nodeDecoder });

describe("image elements", () => {
  it("burns a dark image and leaves a light one blank", async () => {
    const dark = await render(docWith(image({ src: solidPng(20, 20, 0, 0, 0) })));
    const light = await render(docWith(image({ src: solidPng(20, 20, 255, 255, 255) })));

    expect(getPixel(dark, 100, 100)).toBe(true);
    expect(getPixel(light, 100, 100)).toBe(false);
  });

  it("scales the image into the element box", async () => {
    const raster = await render(
      docWith(image({ src: solidPng(4, 4, 0, 0, 0), x: 10, y: 10, widthPx: 60, heightPx: 40 })),
    );

    // Inside the box.
    expect(getPixel(raster, 40, 30)).toBe(true);
    // Just outside it.
    expect(getPixel(raster, 80, 30)).toBe(false);
    expect(getPixel(raster, 40, 60)).toBe(false);
  });

  it("honours invert", async () => {
    const raster = await render(
      docWith(image({ src: solidPng(20, 20, 255, 255, 255), invert: true })),
    );

    expect(getPixel(raster, 100, 100)).toBe(true);
  });

  it("respects a per-image threshold", async () => {
    const grey = solidPng(20, 20, 100, 100, 100); // luminance 100

    const strict = await render(docWith(image({ src: grey, threshold: 50 })));
    const loose = await render(docWith(image({ src: grey, threshold: 200 })));

    expect(getPixel(strict, 100, 100)).toBe(false);
    expect(getPixel(loose, 100, 100)).toBe(true);
  });

  it("rotates about the centre like every other element", async () => {
    const src = solidPng(20, 20, 0, 0, 0);
    const base = { src, x: 103, y: 86, widthPx: 200, heightPx: 30 };

    const flat = await render(docWith(image({ ...base, rotation: 0 })));
    const turned = await render(docWith(image({ ...base, rotation: 90 })));

    expect(getPixel(flat, 203, 101)).toBe(true);
    expect(getPixel(turned, 203, 101)).toBe(true);
    expect(getPixel(flat, 290, 101)).toBe(true);
    expect(getPixel(turned, 290, 101)).toBe(false);
  });

  it("does not throw on an undecodable source, and prints nothing", async () => {
    const raster = await render(docWith(image({ src: "data:image/png;base64,not-a-real-png" })));

    expect(countInk(raster)).toBe(0);
  });
});

describe("dithering", () => {
  it("renders midtones as a mix of set and clear pixels", async () => {
    // A flat 50% grey is either all-on or all-off under a threshold, but under
    // Floyd-Steinberg it must break up into a pattern.
    const grey = solidPng(40, 40, 128, 128, 128);

    const raster = await render(
      docWith(image({ src: grey, halftone: "dither", x: 0, y: 0, widthPx: 120, heightPx: 120 })),
    );

    let on = 0;
    let off = 0;
    for (let y = 10; y < 110; y++) {
      for (let x = 10; x < 110; x++) {
        if (getPixel(raster, x, y)) on++;
        else off++;
      }
    }

    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
  });

  it("preserves overall lightness across a gradient", async () => {
    const raster = await render(
      docWith(
        image({
          src: rampPng(200, 40),
          halftone: "dither",
          x: 0,
          y: 0,
          widthPx: 200,
          heightPx: 40,
        }),
      ),
    );

    // The dark end must carry substantially more ink than the light end.
    let darkEnd = 0;
    let lightEnd = 0;
    for (let y = 2; y < 38; y++) {
      for (let x = 2; x < 40; x++) if (getPixel(raster, x, y)) darkEnd++;
      for (let x = 160; x < 198; x++) if (getPixel(raster, x, y)) lightEnd++;
    }

    expect(darkEnd).toBeGreaterThan(lightEnd * 3);
  });

  it("leaves pure black and pure white untouched", async () => {
    const black = await render(
      docWith(image({ src: solidPng(20, 20, 0, 0, 0), halftone: "dither" })),
    );
    const white = await render(
      docWith(image({ src: solidPng(20, 20, 255, 255, 255), halftone: "dither" })),
    );

    expect(getPixel(black, 100, 100)).toBe(true);
    expect(getPixel(white, 100, 100)).toBe(false);
  });
});

describe("thresholdImageData still behaves", () => {
  it("keeps its existing signature and semantics", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    const raster = thresholdImageData(rgba, 2, 1, DPI);

    expect(getPixel(raster, 0, 0)).toBe(true);
    expect(getPixel(raster, 1, 0)).toBe(false);
  });
});
