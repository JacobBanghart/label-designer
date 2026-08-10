/**
 * Turning a dropped file into an image element.
 *
 * Downscaling at import is not an optimisation, it is a correctness and
 * storage requirement:
 *
 *   - The printer is 203 DPI. Detail finer than one device pixel cannot be
 *     printed, so keeping a 12-megapixel photo buys nothing.
 *   - Designs live in localStorage as JSON, and a data URI is ~33% larger than
 *     the bytes it encodes. A few full-resolution photos would blow the ~5MB
 *     quota and start failing saves.
 */

import type { ImageElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import type { LabelDocument } from "../core/document.ts";
import { nextId } from "./operations.ts";

/** Anything above this is pointless at 203 DPI on a 4x6 label. */
const MAX_DIMENSION = 1218;

export interface ImportedImage {
  src: string;
  /** Natural size after downscaling, used to preserve aspect ratio. */
  widthPx: number;
  heightPx: number;
}

/**
 * Read a File into a downscaled PNG data URI.
 *
 * Returns null when the file is not a decodable image, rather than throwing --
 * a user dropping a PDF on the canvas should get a message, not a stack trace.
 */
export async function readImageFile(file: File): Promise<ImportedImage | null> {
  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!dataUrl) return null;

  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = dataUrl;
  });
  if (!image || image.naturalWidth === 0) return null;

  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, MAX_DIMENSION);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // White background: transparency has no meaning on a thermal label, and
  // leaving it as zeroed RGBA would composite as black in some paths.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  return { src: canvas.toDataURL("image/png"), widthPx: width, heightPx: height };
}

/** Scale (w, h) down to fit a square of `max`, preserving aspect. Never scales up. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Place an imported image on the label, centred, at most 60% of the label,
 * preserving its aspect ratio.
 */
export function createImageElement(doc: LabelDocument, imported: ImportedImage): ImageElement {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const { width, height } = fitWithin(
    imported.widthPx,
    imported.heightPx,
    Math.round(Math.min(geometry.widthPx, geometry.heightPx) * 0.6),
  );

  return {
    id: nextId("image"),
    kind: "image",
    x: Math.round((geometry.widthPx - width) / 2),
    y: Math.round((geometry.heightPx - height) / 2),
    widthPx: width,
    heightPx: height,
    rotation: 0,
    src: imported.src,
    // Threshold suits logos and line art, which is the overwhelmingly common
    // case for a label. Photographs can be switched to dither in the inspector.
    halftone: "threshold",
    threshold: 128,
    invert: false,
  };
}
