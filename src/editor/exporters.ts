/**
 * Exporting a label as something you can use elsewhere.
 *
 * "Export" used to mean JSON, which is a backup and interchange format -- not
 * what someone means when they want to hand a label to a colleague or archive
 * what they printed. PDF and PNG are the artifacts; JSON is the save file.
 *
 * All three go through the same rasterizer as printing, so an exported file is
 * the same 1-bit output the printer receives, not a prettier approximation.
 */

import type { LabelDocument } from "../core/document.ts";
import { encodeMonoRasterAsPng } from "../core/png.ts";
import { rasterizeDocument } from "../raster/index.ts";
import { buildPdf } from "../transports/pdf/index.ts";

/** Filesystem-safe stem derived from the label's name. */
function fileStem(doc: LabelDocument): string {
  const cleaned = doc.name
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return cleaned || "label";
}

function download(bytes: Uint8Array | string, filename: string, type: string): void {
  // Copy into a plain ArrayBuffer: a Uint8Array over a SharedArrayBuffer is not
  // a valid BlobPart, and TypeScript cannot rule that out from the type alone.
  const part: BlobPart = typeof bytes === "string" ? bytes : new Uint8Array(bytes).slice().buffer;
  const url = URL.createObjectURL(new Blob([part], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * A print-ready PDF, page sized to the label's exact physical dimensions.
 *
 * The same bytes the print button sends, so what you archive is what you
 * printed.
 */
export async function exportPdf(doc: LabelDocument): Promise<void> {
  const raster = await rasterizeDocument(doc);
  const bytes = await buildPdf(raster, { copies: 1 });
  download(bytes, `${fileStem(doc)}.pdf`, "application/pdf");
}

/**
 * A 1-bit PNG at the label's native resolution.
 *
 * Native resolution rather than something larger: upscaling would invent detail
 * the printer cannot produce, and the point of this file is to be an honest
 * record of the output.
 */
export async function exportPng(doc: LabelDocument): Promise<void> {
  const raster = await rasterizeDocument(doc);
  const bytes = await encodeMonoRasterAsPng(raster);
  download(bytes, `${fileStem(doc)}.png`, "image/png");
}

/** The design itself, for re-importing or committing to a repo. */
export function exportJson(doc: LabelDocument): void {
  download(JSON.stringify(doc, null, 2), `${fileStem(doc)}.json`, "application/json");
}
