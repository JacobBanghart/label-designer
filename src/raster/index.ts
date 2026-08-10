/**
 * Rasterizer -- converts a LabelDocument (or raw RGBA pixels) into a packed
 * 1bpp MonoRaster, the canonical render artifact for all print transports.
 */

import { domCanvasFactory, type CanvasFactory, type Ctx2D } from "../core/canvas.ts";
import { isTextElement, type LabelDocument, type TextElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { createMonoRaster, setPixel, type MonoRaster } from "../core/raster.ts";

export interface RasterizeOptions {
  /** Injected in Node tests; defaults to the DOM factory in the browser. */
  createCanvas?: CanvasFactory;
  /** Luminance below this is burned. 0-255, default 128. */
  threshold?: number;
}

const DEFAULT_THRESHOLD = 128;

/**
 * Convert RGBA pixel data to a packed 1bpp MonoRaster.
 *
 * Fully transparent pixels are white. Luminance is the standard perceptual
 * weighting; anything at or below `threshold` becomes a set bit (burn).
 */
export function thresholdImageData(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dpi: number,
  options?: RasterizeOptions,
): MonoRaster {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const raster = createMonoRaster(width, height, dpi);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const a = rgba[i + 3]!;

      const alpha = a / 255;
      // Composite against white, then take perceptual luminance.
      const rc = r * alpha + 255 * (1 - alpha);
      const gc = g * alpha + 255 * (1 - alpha);
      const bc = b * alpha + 255 * (1 - alpha);
      const luminance = 0.299 * rc + 0.587 * gc + 0.114 * bc;

      if (luminance <= threshold) {
        setPixel(raster, x, y, true);
      }
    }
  }

  return raster;
}

function buildFont(el: TextElement): string {
  const parts: string[] = [];
  if (el.italic) parts.push("italic");
  if (el.bold) parts.push("bold");
  parts.push(`${el.fontSizePx}px`);
  parts.push(el.fontFamily);
  return parts.join(" ");
}

/** Wrap `text` into lines that fit within `maxWidth`, measured via `ctx`. */
function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  // Respect explicit newlines as hard breaks, then word-wrap within each.
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const word = words[i]!;
      const candidate = `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
}

function drawTextElement(ctx: Ctx2D, el: TextElement): void {
  ctx.save();

  const centreX = el.x + el.widthPx / 2;
  const centreY = el.y + el.heightPx / 2;
  ctx.translate(centreX, centreY);
  ctx.rotate((el.rotation * Math.PI) / 180);

  ctx.fillStyle = "#000000";
  ctx.font = buildFont(el);
  ctx.textBaseline = "top";
  ctx.textAlign = el.align;

  const lines = wrapText(ctx, el.text, el.widthPx);
  const lineHeight = el.fontSizePx * 1.2;

  // Local box coords, relative to the (now-translated) centre.
  const localLeft = -el.widthPx / 2;
  const localTop = -el.heightPx / 2;

  let drawX: number;
  if (el.align === "center") drawX = localLeft + el.widthPx / 2;
  else if (el.align === "right") drawX = localLeft + el.widthPx;
  else drawX = localLeft;

  for (let i = 0; i < lines.length; i++) {
    const y = localTop + i * lineHeight;
    ctx.fillText(lines[i]!, drawX, y);
  }

  ctx.restore();
}

/**
 * Render a LabelDocument to a MonoRaster at the document's DPI.
 *
 * Renders directly to a 2D context -- NOT through Konva. See src/core/canvas.ts
 * for why. Output dimensions come from resolveGeometry(), so landscape
 * orientation swaps width and height.
 */
export async function rasterizeDocument(
  doc: LabelDocument,
  options?: RasterizeOptions,
): Promise<MonoRaster> {
  const geometry = resolveGeometry(doc.sizeId, doc.orientation, doc.dpi);
  const createCanvas = options?.createCanvas ?? domCanvasFactory;

  const canvas = createCanvas(geometry.widthPx, geometry.heightPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, geometry.widthPx, geometry.heightPx);

  for (const el of doc.elements) {
    if (isTextElement(el)) {
      drawTextElement(ctx, el);
    }
    // Other kinds are reserved for future implementation; skip silently.
  }

  const imageData = ctx.getImageData(0, 0, geometry.widthPx, geometry.heightPx);
  return thresholdImageData(imageData.data, geometry.widthPx, geometry.heightPx, doc.dpi, options);
}
