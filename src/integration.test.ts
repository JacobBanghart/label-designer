/**
 * End-to-end pipeline test.
 *
 * The module contracts each verify one hop. This verifies the whole chain --
 * LabelDocument -> MonoRaster -> PDF -- and specifically that physical
 * dimensions survive it intact. That is the property the entire project is
 * organised around: a 4x6 label must come out of the far end as exactly 4x6
 * inches, because any scaling destroys 1-bit thermal output.
 *
 * It is the automated stand-in for measuring a printed label with calipers.
 */

import { describe, expect, it } from "vite-plus/test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import type { CanvasFactory, CanvasLike } from "./core/canvas.ts";
import { simicOrderLabel } from "./core/fixtures/index.ts";
import { resolveGeometry, type LabelSizeId, type Orientation } from "./core/label.ts";
import { assertValidRaster } from "./core/raster.ts";
import { inToPt } from "./core/units.ts";
import { createDocument, createTextElement, addElement } from "./editor/operations.ts";
import { rasterizeDocument } from "./raster/index.ts";
import { buildPdf } from "./transports/pdf/index.ts";

const nodeCanvas: CanvasFactory = (width, height) =>
  createCanvas(width, height) as unknown as CanvasLike;

/** Millimetre-scale tolerance in points; 0.5pt is well under a printer dot. */
const TOLERANCE_PT = 0.5;

async function pageSizeOf(sizeId: LabelSizeId, orientation: Orientation) {
  const base = createDocument(sizeId, orientation);
  const doc = addElement(base, createTextElement(base, "Calibration"));

  const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });
  assertValidRaster(raster);

  const pdf = await PDFDocument.load(await buildPdf(raster));
  const page = pdf.getPage(0);
  return { width: page.getWidth(), height: page.getHeight(), raster };
}

describe("document -> raster -> pdf", () => {
  it("preserves 4x6 portrait dimensions exactly", async () => {
    const { width, height, raster } = await pageSizeOf("4x6", "portrait");

    expect(raster.widthPx).toBe(812);
    expect(raster.heightPx).toBe(1218);
    expect(width).toBeCloseTo(inToPt(4), TOLERANCE_PT);
    expect(height).toBeCloseTo(inToPt(6), TOLERANCE_PT);
  });

  it("preserves 4x6 landscape dimensions exactly", async () => {
    const { width, height } = await pageSizeOf("4x6", "landscape");

    expect(width).toBeCloseTo(inToPt(6), TOLERANCE_PT);
    expect(height).toBeCloseTo(inToPt(4), TOLERANCE_PT);
  });

  it("preserves 2x1 dimensions exactly", async () => {
    const { width, height, raster } = await pageSizeOf("2x1", "portrait");

    expect(raster.widthPx).toBe(406);
    expect(raster.heightPx).toBe(203);
    expect(width).toBeCloseTo(inToPt(2), TOLERANCE_PT);
    expect(height).toBeCloseTo(inToPt(1), TOLERANCE_PT);
  });

  it("round-trips the reference order label with ink on the page", async () => {
    const doc = simicOrderLabel();
    const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);

    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });
    expect(raster.bits.some((byte) => byte !== 0)).toBe(true);

    const pdf = await PDFDocument.load(await buildPdf(raster));
    const page = pdf.getPage(0);

    expect(page.getWidth()).toBeCloseTo(inToPt(geometry.widthIn), TOLERANCE_PT);
    expect(page.getHeight()).toBeCloseTo(inToPt(geometry.heightIn), TOLERANCE_PT);
  });

  it("emits one page per copy through the full pipeline", async () => {
    const doc = simicOrderLabel();
    const raster = await rasterizeDocument(doc, { createCanvas: nodeCanvas });

    const pdf = await PDFDocument.load(await buildPdf(raster, { copies: 4 }));
    expect(pdf.getPageCount()).toBe(4);
  });
});
