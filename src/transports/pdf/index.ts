/**
 * PDF print transport.
 *
 * Builds a print-ready PDF from a MonoRaster and, in a browser, sends it to
 * the system print dialog via a hidden iframe. See src/transports/pdf/png.ts
 * for how the 1bpp raster is encoded into an embeddable image without any
 * resampling.
 */

import { PDFDocument } from "pdf-lib";

import type { MonoRaster } from "../../core/raster.ts";
import { assertValidRaster } from "../../core/raster.ts";
import { DPI, inToPt } from "../../core/units.ts";
import type {
  PrintOptions,
  PrintResult,
  PrintTransport,
  TransportCaps,
} from "../../core/transport.ts";

import { encodeMonoRasterAsPng } from "./png.ts";

/**
 * Build a print-ready PDF from a MonoRaster.
 *
 * The page must be sized to the raster's exact physical dimensions
 * (widthPx / dpi inches, converted to points via inToPt) and the image placed
 * 1:1 filling the page. Any scaling resamples a 1-bit image into grey mush,
 * which is the whole failure mode this project exists to avoid.
 *
 * Rows are read via bytesPerRow(), not widthPx / 8 -- padding bits at the end
 * of each row must be ignored.
 */
export async function buildPdf(raster: MonoRaster, options?: PrintOptions): Promise<Uint8Array> {
  assertValidRaster(raster);

  const copies = options?.copies ?? 1;
  if (!Number.isFinite(copies) || copies < 1) {
    throw new Error(`buildPdf: invalid copies count: ${copies}`);
  }

  const widthPt = inToPt(raster.widthPx / raster.dpi);
  const heightPt = inToPt(raster.heightPx / raster.dpi);

  const pdfDoc = await PDFDocument.create();
  const pngBytes = await encodeMonoRasterAsPng(raster);
  const embeddedImage = await pdfDoc.embedPng(pngBytes);

  for (let i = 0; i < copies; i++) {
    const page = pdfDoc.addPage([widthPt, heightPt]);
    page.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: widthPt,
      height: heightPt,
    });
  }

  return pdfDoc.save();
}

/** Open `bytes` (a PDF) in a hidden iframe and trigger the browser print dialog. */
function printPdfBytes(bytes: Uint8Array): Promise<PrintResult> {
  return new Promise((resolve) => {
    try {
      if (typeof document === "undefined" || typeof window === "undefined") {
        resolve({ ok: false, message: "No browser environment available to print in." });
        return;
      }

      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";

      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        // Give the print dialog a moment to open before removing the iframe.
        setTimeout(() => {
          iframe.remove();
        }, 1000);
      };

      iframe.onload = () => {
        try {
          const contentWindow = iframe.contentWindow;
          if (!contentWindow) {
            cleanup();
            resolve({ ok: false, message: "Print iframe has no content window." });
            return;
          }
          contentWindow.focus();
          contentWindow.print();
          cleanup();
          resolve({ ok: true });
        } catch (err) {
          cleanup();
          resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
        }
      };

      iframe.onerror = () => {
        cleanup();
        resolve({ ok: false, message: "Failed to load PDF into print iframe." });
      };

      iframe.src = url;
      document.body.appendChild(iframe);
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}

export const pdfTransport: PrintTransport = {
  id: "pdf",
  label: "Print dialog (PDF)",

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  },

  capabilities(): TransportCaps {
    return {
      dpi: DPI,
      maxWidthPx: null,
      usesSystemDialog: true,
    };
  },

  async print(raster: MonoRaster, options: PrintOptions): Promise<PrintResult> {
    try {
      const bytes = await buildPdf(raster, options);
      return await printPdfBytes(bytes);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
