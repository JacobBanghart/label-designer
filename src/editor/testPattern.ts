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

import {
  SCHEMA_VERSION,
  type Element,
  type ImageElement,
  type LabelDocument,
} from "../core/document.ts";
import { resolveGeometry, type LabelSizeId, type Orientation } from "../core/label.ts";
import { DPI } from "../core/units.ts";
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

/**
 * A calibration label for tuning a directly-connected printer.
 *
 * Deliberately asymmetric in both axes: you cannot tell a 180-degree flip from
 * a correct print if the artwork is symmetric, which is exactly the mistake
 * that makes rotation problems hard to diagnose.
 *
 *   - "TOP" sits against the top edge, so a flip is unmistakable
 *   - an arrow runs left to right, so a mirror is unmistakable
 *   - corner ticks at a known inset show registration offset
 *   - a small tonal ramp shows whether darkness is in a usable range
 */
export function createAlignmentDoc(sizeId: LabelSizeId, orientation: Orientation): LabelDocument {
  const geometry = resolveGeometry(sizeId, orientation, DPI);
  const { widthPx: W, heightPx: H, dpi } = geometry;
  const inset = Math.round(dpi * 0.1);
  const tick = Math.max(2, Math.round(dpi * 0.012));
  const arm = Math.round(dpi * 0.22);
  const font = Math.max(14, Math.round(Math.min(W, H) * 0.13));

  const solid = (id: string, x: number, y: number, w: number, h: number): Element => ({
    id,
    kind: "rect",
    x,
    y,
    widthPx: Math.max(1, Math.round(w)),
    heightPx: Math.max(1, Math.round(h)),
    rotation: 0,
    strokeWidthPx: 0,
    filled: true,
    cornerRadiusPx: 0,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: nextId("doc"),
    name: "Printer alignment",
    sizeId,
    orientation,
    dpi,
    elements: [
      // Bar hard against the top edge: the single clearest flip indicator.
      solid("topbar", 0, 0, W, Math.round(dpi * 0.05)),
      {
        id: "top",
        kind: "text",
        x: inset,
        y: Math.round(dpi * 0.09),
        widthPx: W - inset * 2,
        heightPx: font * 1.4,
        rotation: 0,
        text: "TOP",
        fontSizePx: font,
        fontFamily: "sans-serif",
        bold: true,
        italic: false,
        align: "center",
        verticalAlign: "top",
      },
      {
        id: "arrow",
        kind: "arrow",
        x: inset,
        y: Math.round(H * 0.55),
        widthPx: W - inset * 2 - arm,
        heightPx: 0,
        rotation: 0,
        strokeWidthPx: Math.max(2, Math.round(dpi * 0.02)),
        points: [0, 0.5, 1, 0.5],
        arrowHeadPx: Math.round(dpi * 0.09),
      },
      // Corner ticks at a known inset, for reading registration offset.
      solid("c1h", inset, inset, arm, tick),
      solid("c1v", inset, inset, tick, arm),
      solid("c2h", W - inset - arm, inset, arm, tick),
      solid("c2v", W - inset - tick, inset, tick, arm),
      solid("c3h", inset, H - inset - tick, arm, tick),
      solid("c3v", inset, H - inset - arm, tick, arm),
      solid("c4h", W - inset - arm, H - inset - tick, arm, tick),
      solid("c4v", W - inset - tick, H - inset - arm, tick, arm),
    ],
  };
}
