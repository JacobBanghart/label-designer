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

import { encodeMonoRasterAsPng } from "../../core/png.ts";

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
/**
 * Print by loading an HTML page containing the label image into a same-origin
 * iframe, with an exact @page size.
 *
 * The obvious approach -- put the PDF in an iframe and call print() -- does not
 * work in Chrome. PDFs are rendered by the PDFium plugin, which does not
 * reliably expose print() to the parent frame, and a zero-size hidden iframe
 * may never load the plugin at all, so onload never fires and nothing happens
 * with no error. That silent failure is what this replaces.
 *
 * HTML avoids the plugin entirely. Geometry is preserved by setting @page to the
 * label's exact physical size with zero margin, and sizing the image in inches
 * to match, so there is nothing for the browser to scale.
 */
function printRasterViaHtml(raster: MonoRaster, options: PrintOptions): Promise<PrintResult> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      resolve({ ok: false, message: "No browser environment available to print in." });
      return;
    }

    void (async () => {
      try {
        const png = await encodeMonoRasterAsPng(raster);
        let binary = "";
        for (const byte of png) binary += String.fromCharCode(byte);
        const dataUrl = `data:image/png;base64,${btoa(binary)}`;

        const widthIn = raster.widthPx / raster.dpi;
        const heightIn = raster.heightPx / raster.dpi;
        const copies = Math.max(1, Math.round(options.copies));
        const rotation = options.rotation ?? 0;

        /*
         * A quarter turn swaps which way the page runs, so the @page size has to
         * swap with it -- otherwise the browser scales the content to fit a page
         * of the wrong shape, which is the failure this whole feature exists to
         * avoid.
         */
        const quarter = rotation === 90 || rotation === 270;
        const pageW = quarter ? heightIn : widthIn;
        const pageH = quarter ? widthIn : heightIn;

        const pages = Array.from(
          { length: copies },
          () => `<div class="page"><img src="${dataUrl}" alt=""></div>`,
        ).join("");

        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
          @page { size: ${pageW}in ${pageH}in; margin: 0; }
          html, body { margin: 0; padding: 0; background: #fff; }
          .page {
            width: ${pageW}in;
            height: ${pageH}in;
            position: relative;
            overflow: hidden;
            page-break-after: always;
            break-after: page;
          }
          .page:last-child { page-break-after: auto; break-after: auto; }
          .page img {
            position: absolute;
            left: 50%;
            top: 50%;
            width: ${widthIn}in;
            height: ${heightIn}in;
            /* Rotate about the centre so the artwork stays centred on the page
               whichever way it is turned. */
            transform: translate(-50%, -50%) rotate(${rotation}deg);
            /* Never smooth a 1-bit image; show the real dots. */
            image-rendering: pixelated;
            /* Stop the browser lightening blacks to save ink. */
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        </style></head><body>${pages}</body></html>`;

        const iframe = document.createElement("iframe");
        // Not display:none and not 0x0: some browsers skip layout and loading
        // entirely for those, which is half of why the old version failed.
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.position = "fixed";
        iframe.style.left = "-10000px";
        iframe.style.top = "0";
        iframe.style.width = "1px";
        iframe.style.height = "1px";
        iframe.style.opacity = "0";
        iframe.style.border = "0";

        let settled = false;
        const finish = (result: PrintResult) => {
          if (settled) return;
          settled = true;
          // Leave the iframe alive briefly: removing it while the dialog is
          // open cancels the job in some browsers.
          setTimeout(() => iframe.remove(), 60_000);
          resolve(result);
        };

        iframe.onload = () => {
          const contentWindow = iframe.contentWindow;
          if (!contentWindow) {
            finish({ ok: false, message: "Print frame has no content window." });
            return;
          }
          // Wait for the image itself, not just the document: printing before
          // it decodes yields a blank page.
          const image = contentWindow.document.querySelector("img");
          const go = () => {
            try {
              contentWindow.focus();
              contentWindow.print();
              finish({ ok: true });
            } catch (err) {
              finish({
                ok: false,
                message: err instanceof Error ? err.message : "Could not open the print dialog.",
              });
            }
          };
          if (image && !image.complete) image.addEventListener("load", go, { once: true });
          else go();
        };

        document.body.appendChild(iframe);
        iframe.srcdoc = html;

        // If onload never fires, say so rather than appearing to succeed.
        setTimeout(
          () =>
            finish({ ok: false, message: "The print frame did not load. Try exporting a PDF." }),
          15_000,
        );
      } catch (err) {
        resolve({ ok: false, message: err instanceof Error ? err.message : String(err) });
      }
    })();
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
      return await printRasterViaHtml(raster, options);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
};
