/**
 * A halftone test pattern, generated at runtime.
 *
 * Checking 1-bit output by eye needs something with known tones in it. A smooth
 * gradient shows whether dithering is working at all; a stepped wedge shows
 * *which* tones actually survive at the current darkness setting, which is the
 * question you have when a photo prints too dark or washes out.
 *
 * Generated rather than shipped as an asset so it is exact at any size and adds
 * nothing to the bundle.
 */

import type { ImageElement, LabelDocument } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { nextId } from "./operations.ts";

/** Number of discrete patches in the step wedge. */
const STEPS = 11;

/**
 * Draw the pattern: a smooth ramp on top, a stepped wedge below it, and
 * solid black/white end caps for reference.
 */
export function renderTestPattern(width = 700, height = 300): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const rampHeight = Math.round(height * 0.45);
  const wedgeTop = rampHeight + Math.round(height * 0.06);
  const wedgeHeight = height - wedgeTop;

  // Continuous ramp, black on the left.
  for (let x = 0; x < width; x++) {
    const value = Math.round((x / Math.max(1, width - 1)) * 255);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(x, 0, 1, rampHeight);
  }

  // Stepped wedge, same direction, so the two can be compared directly.
  const stepWidth = width / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const value = Math.round((i / (STEPS - 1)) * 255);
    ctx.fillStyle = `rgb(${value},${value},${value})`;
    ctx.fillRect(Math.round(i * stepWidth), wedgeTop, Math.ceil(stepWidth), wedgeHeight);
  }

  return canvas.toDataURL("image/png");
}

/**
 * A test-pattern image element sized to the label.
 *
 * Defaults to dither, since threshold renders the whole pattern as two flat
 * blocks -- correct, but it tells you nothing.
 */
export function createTestPatternElement(doc: LabelDocument): ImageElement | null {
  const src = renderTestPattern();
  if (!src) return null;

  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const widthPx = Math.round(geometry.widthPx * 0.8);
  const heightPx = Math.round(widthPx * (300 / 700));

  return {
    id: nextId("image"),
    kind: "image",
    x: Math.round((geometry.widthPx - widthPx) / 2),
    y: Math.round((geometry.heightPx - heightPx) / 2),
    widthPx,
    heightPx,
    rotation: 0,
    src,
    halftone: "dither",
    threshold: 128,
    invert: false,
  };
}
