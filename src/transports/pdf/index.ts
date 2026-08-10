/**
 * STUB -- implemented by the PDF transport agent.
 *
 * These signatures are fixed by src/transports/pdf/__contract__.test.ts.
 * Implement the bodies; do not change the exported names or parameter shapes.
 */

import type { MonoRaster } from "../../core/raster.ts";
import type {
  PrintOptions,
  PrintResult,
  PrintTransport,
  TransportCaps,
} from "../../core/transport.ts";

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
export function buildPdf(_raster: MonoRaster, _options?: PrintOptions): Promise<Uint8Array> {
  throw new Error("not implemented");
}

export const pdfTransport: PrintTransport = {
  id: "pdf",
  label: "Print dialog (PDF)",

  isAvailable(): Promise<boolean> {
    throw new Error("not implemented");
  },

  capabilities(): TransportCaps {
    throw new Error("not implemented");
  },

  print(_raster: MonoRaster, _options: PrintOptions): Promise<PrintResult> {
    throw new Error("not implemented");
  },
};
