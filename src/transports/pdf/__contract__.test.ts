/**
 * CONTRACT TEST -- DO NOT EDIT.
 *
 * This defines PdfTransport's interface from the outside. If it looks wrong,
 * stop and report it rather than changing it.
 *
 * Note this tests `buildPdf` directly rather than `print()`: printing opens a
 * browser dialog, which cannot run headlessly. The geometry assertions are the
 * point -- they are what a caliper measurement would otherwise have to catch.
 */

import { describe, expect, it } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";

import { goldenRaster, unalignedRaster } from "../../core/fixtures/index.ts";
import { createMonoRaster } from "../../core/raster.ts";
import { inToPt } from "../../core/units.ts";
import { resolveGeometry } from "../../core/label.ts";

import { buildPdf, pdfTransport } from "./index.ts";

describe("pdfTransport", () => {
  it("implements the PrintTransport interface", async () => {
    expect(pdfTransport.id).toBe("pdf");
    expect(typeof pdfTransport.label).toBe("string");
    expect(await pdfTransport.isAvailable()).toBe(true);

    const caps = pdfTransport.capabilities();
    expect(caps.usesSystemDialog).toBe(true);
    expect(caps.dpi).toBeGreaterThan(0);
  });
});

describe("buildPdf", () => {
  it("produces a parseable single-page PDF", async () => {
    const bytes = await buildPdf(goldenRaster());

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });

  it("sizes the page to the raster's exact physical dimensions", async () => {
    // A full 4x6 label at 203 DPI must come out as exactly 4in x 6in of PDF.
    const geometry = resolveGeometry("4x6", "portrait");
    const raster = createMonoRaster(geometry.widthPx, geometry.heightPx, geometry.dpi);

    const pdf = await PDFDocument.load(await buildPdf(raster));
    const page = pdf.getPage(0);

    // Sub-point tolerance: 812px / 203dpi is exactly 4in, but allow for
    // floating point noise rather than demanding bit equality.
    expect(page.getWidth()).toBeCloseTo(inToPt(4), 1);
    expect(page.getHeight()).toBeCloseTo(inToPt(6), 1);
  });

  it("sizes a 2x1 label correctly too", async () => {
    const geometry = resolveGeometry("2x1", "portrait");
    const raster = createMonoRaster(geometry.widthPx, geometry.heightPx, geometry.dpi);

    const pdf = await PDFDocument.load(await buildPdf(raster));
    const page = pdf.getPage(0);

    expect(page.getWidth()).toBeCloseTo(inToPt(2), 1);
    expect(page.getHeight()).toBeCloseTo(inToPt(1), 1);
  });

  it("handles rasters whose width is not a multiple of 8", async () => {
    // Must read rows via bytesPerRow(), not widthPx / 8, and must not print
    // the padding bits at the end of each row.
    const bytes = await buildPdf(unalignedRaster());

    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPage(0);
    expect(page.getWidth()).toBeCloseTo(inToPt(13 / 203), 2);
  });

  it("emits one page per copy", async () => {
    const bytes = await buildPdf(goldenRaster(), { copies: 3 });

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
  });
});
