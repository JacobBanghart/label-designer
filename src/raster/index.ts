/**
 * Rasterizer -- converts a LabelDocument (or raw RGBA pixels) into a packed
 * 1bpp MonoRaster, the canonical render artifact for all print transports.
 */

import {
  domCanvasFactory,
  domImageDecoder,
  type CanvasFactory,
  type Ctx2D,
  type DecodedImage,
  type ImageDecoder,
} from "../core/canvas.ts";
import {
  isImageElement,
  isPolylineElement,
  isTextElement,
  type Element,
  type ElementBase,
  type EllipseElement,
  type ImageElement,
  type LabelDocument,
  type PolylineElement,
  type RectElement,
  type TextElement,
} from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { createMonoRaster, setPixel, type MonoRaster } from "../core/raster.ts";

export interface RasterizeOptions {
  /** Injected in Node tests; defaults to the DOM factory in the browser. */
  createCanvas?: CanvasFactory;
  /** Injected in Node tests; defaults to the DOM decoder in the browser. */
  decodeImage?: ImageDecoder;
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

/**
 * Break a single token that is too wide for the box into character-wrapped
 * chunks.
 *
 * Letting an over-wide word overflow would push it off the label, and anything
 * past the edge is simply not printed -- a silent data loss on something like an
 * order number. Breaking mid-token is ugly but visible. This also matches how
 * Konva lays out text in the editor, which keeps the canvas WYSIWYG.
 */
function breakLongWord(ctx: Ctx2D, word: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const char of word) {
    const candidate = current + char;
    if (current !== "" && ctx.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current !== "") chunks.push(current);

  return chunks;
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

    let current = "";
    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current !== "") lines.push(current);

      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
      } else {
        // Too wide even alone: split it and carry the remainder forward.
        const chunks = breakLongWord(ctx, word, maxWidth);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] ?? "";
      }
    }
    lines.push(current);
  }

  return lines;
}

/**
 * Every element -- text and shapes alike -- rotates about its centre. This
 * wraps that shared save/translate/rotate/restore convention so `draw` can
 * work purely in box-local coordinates, where (0, 0) is the box centre and
 * the top-left corner is (-widthPx / 2, -heightPx / 2).
 */
function withElementBox<T extends ElementBase>(
  ctx: Ctx2D,
  el: T,
  draw: (widthPx: number, heightPx: number) => void,
): void {
  ctx.save();

  const centreX = el.x + el.widthPx / 2;
  const centreY = el.y + el.heightPx / 2;
  ctx.translate(centreX, centreY);
  ctx.rotate((el.rotation * Math.PI) / 180);

  draw(el.widthPx, el.heightPx);

  ctx.restore();
}

function drawTextElement(ctx: Ctx2D, el: TextElement): void {
  withElementBox(ctx, el, (widthPx, heightPx) => {
    ctx.fillStyle = "#000000";
    ctx.font = buildFont(el);
    ctx.textBaseline = "top";
    ctx.textAlign = el.align;

    const lines = wrapText(ctx, el.text, widthPx);
    const lineHeight = el.fontSizePx * 1.2;

    // Local box coords, relative to the (now-translated) centre.
    const localLeft = -widthPx / 2;
    const localTop = -heightPx / 2;

    let drawX: number;
    if (el.align === "center") drawX = localLeft + widthPx / 2;
    else if (el.align === "right") drawX = localLeft + widthPx;
    else drawX = localLeft;

    for (let i = 0; i < lines.length; i++) {
      const y = localTop + i * lineHeight;
      ctx.fillText(lines[i]!, drawX, y);
    }
  });
}

/**
 * Build a rectangle path in box-local coordinates (centred on the origin),
 * with corners rounded to `radius`. Built from line/quadraticCurveTo segments
 * since `Ctx2D` has no `roundRect`.
 */
function buildRoundedRectPath(ctx: Ctx2D, widthPx: number, heightPx: number, radius: number): void {
  const left = -widthPx / 2;
  const top = -heightPx / 2;
  const right = widthPx / 2;
  const bottom = heightPx / 2;

  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(left, top, widthPx, heightPx);
    return;
  }

  ctx.moveTo(left + radius, top);
  ctx.lineTo(right - radius, top);
  ctx.quadraticCurveTo(right, top, right, top + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(left + radius, bottom);
  ctx.quadraticCurveTo(left, bottom, left, bottom - radius);
  ctx.lineTo(left, top + radius);
  ctx.quadraticCurveTo(left, top, left + radius, top);
  ctx.closePath();
}

function drawRectElement(ctx: Ctx2D, el: RectElement): void {
  withElementBox(ctx, el, (widthPx, heightPx) => {
    if (widthPx <= 0 || heightPx <= 0) return;

    // Clamp so the radius can never exceed half the smaller side -- past that
    // point the "corner" arcs would overlap and self-intersect.
    const radius = Math.max(0, Math.min(el.cornerRadiusPx, widthPx / 2, heightPx / 2));
    buildRoundedRectPath(ctx, widthPx, heightPx, radius);

    if (el.filled) {
      ctx.fillStyle = "#000000";
      ctx.fill();
    }
    if (el.strokeWidthPx > 0) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = el.strokeWidthPx;
      ctx.stroke();
    }
  });
}

function drawEllipseElement(ctx: Ctx2D, el: EllipseElement): void {
  withElementBox(ctx, el, (widthPx, heightPx) => {
    if (widthPx <= 0 || heightPx <= 0) return;

    ctx.beginPath();
    ctx.ellipse(0, 0, widthPx / 2, heightPx / 2, 0, 0, Math.PI * 2);
    ctx.closePath();

    if (el.filled) {
      ctx.fillStyle = "#000000";
      ctx.fill();
    }
    if (el.strokeWidthPx > 0) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = el.strokeWidthPx;
      ctx.stroke();
    }
  });
}

type Point = readonly [number, number];

/**
 * Midpoint-based quadratic smoothing: each raw vertex becomes a curve control
 * point, and the curve passes through the midpoint between consecutive
 * vertices rather than through the vertices themselves. This reads far better
 * for freehand pen input than raw `lineTo` segments, which look jagged.
 */
function drawSmoothedPath(ctx: Ctx2D, pts: readonly Point[]): void {
  ctx.moveTo(pts[0]![0], pts[0]![1]);

  if (pts.length === 2) {
    ctx.lineTo(pts[1]![0], pts[1]![1]);
    return;
  }

  for (let i = 1; i < pts.length - 1; i++) {
    const curr = pts[i]!;
    const next = pts[i + 1]!;
    const midX = (curr[0] + next[0]) / 2;
    const midY = (curr[1] + next[1]) / 2;
    ctx.quadraticCurveTo(curr[0], curr[1], midX, midY);
  }

  const last = pts[pts.length - 1]!;
  ctx.lineTo(last[0], last[1]);
}

/** Draw a filled triangular arrowhead of `length`, tip at `to`, oriented along `from -> to`. */
function drawArrowHead(ctx: Ctx2D, from: Point, to: Point, length: number): void {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return;

  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7; // ~25.7 degrees half-angle, a typical arrowhead shape.

  const leftX = to[0] - length * Math.cos(angle - spread);
  const leftY = to[1] - length * Math.sin(angle - spread);
  const rightX = to[0] - length * Math.cos(angle + spread);
  const rightY = to[1] - length * Math.sin(angle + spread);

  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = "#000000";
  ctx.fill();
}

function drawPolylineElement(ctx: Ctx2D, el: PolylineElement): void {
  // Fewer than two points (four numbers) is a degenerate path: render nothing.
  if (el.points.length < 4) return;

  withElementBox(ctx, el, (widthPx, heightPx) => {
    const localLeft = -widthPx / 2;
    const localTop = -heightPx / 2;

    const pts: Point[] = [];
    for (let i = 0; i + 1 < el.points.length; i += 2) {
      const nx = el.points[i]!;
      const ny = el.points[i + 1]!;
      pts.push([localLeft + nx * widthPx, localTop + ny * heightPx]);
    }
    if (pts.length < 2) return;

    if (el.strokeWidthPx > 0) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = el.strokeWidthPx;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      if (el.kind === "freehand") {
        drawSmoothedPath(ctx, pts);
      } else {
        ctx.moveTo(pts[0]![0], pts[0]![1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
      }
      ctx.stroke();
    }

    if (el.kind === "arrow" && el.arrowHeadPx > 0) {
      drawArrowHead(ctx, pts[pts.length - 2]!, pts[pts.length - 1]!, el.arrowHeadPx);
    }
  });
}

/**
 * Perceptual luminance of a pixel, alpha-composited against white. Shared
 * between `thresholdImageData` and the per-image halftoning below so both
 * treat transparency identically.
 */
function pixelLuminance(rgba: Uint8ClampedArray, i: number): number {
  const r = rgba[i]!;
  const g = rgba[i + 1]!;
  const b = rgba[i + 2]!;
  const a = rgba[i + 3]!;
  const alpha = a / 255;
  const rc = r * alpha + 255 * (1 - alpha);
  const gc = g * alpha + 255 * (1 - alpha);
  const bc = b * alpha + 255 * (1 - alpha);
  return 0.299 * rc + 0.587 * gc + 0.114 * bc;
}

/**
 * Floyd-Steinberg error diffusion. Quantises `lum` (raster order, one entry
 * per pixel) to 0/255 in place semantics, writing a black/white mask.
 * Pure black/white input has zero quantisation error at every pixel, so
 * nothing is pushed to neighbours and the input survives unchanged -- no
 * special-casing needed for that guarantee.
 */
function floydSteinbergDither(
  lum: Float64Array,
  width: number,
  height: number,
  threshold: number,
  mask: Uint8Array,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const old = lum[idx]!;
      const isBlack = old <= threshold;
      mask[idx] = isBlack ? 1 : 0;
      const err = old - (isBlack ? 0 : 255);
      if (err === 0) continue;

      if (x + 1 < width) lum[idx + 1] = lum[idx + 1]! + (err * 7) / 16;
      if (y + 1 < height) {
        if (x - 1 >= 0) lum[idx - 1 + width] = lum[idx - 1 + width]! + (err * 3) / 16;
        lum[idx + width] = lum[idx + width]! + (err * 5) / 16;
        if (x + 1 < width) lum[idx + 1 + width] = lum[idx + 1 + width]! + (err * 1) / 16;
      }
    }
  }
}

/**
 * Reduce RGBA pixels of an on-label-sized image to a black/white mask,
 * applying the per-image threshold, halftone mode, and invert. This is what
 * makes the document-level threshold pass a no-op for image pixels: they are
 * already pure black or pure white by the time they land on the main canvas.
 */
function computeHalftoneMask(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  el: ImageElement,
): Uint8Array {
  const n = width * height;
  const lum = new Float64Array(n);
  for (let p = 0; p < n; p++) lum[p] = pixelLuminance(rgba, p * 4);

  const mask = new Uint8Array(n);
  if (el.halftone === "dither") {
    floydSteinbergDither(lum, width, height, el.threshold, mask);
  } else {
    for (let p = 0; p < n; p++) mask[p] = lum[p]! <= el.threshold ? 1 : 0;
  }

  if (el.invert) {
    for (let p = 0; p < n; p++) mask[p] = mask[p] ? 0 : 1;
  }

  return mask;
}

function drawImageElement(
  ctx: Ctx2D,
  el: ImageElement,
  decoded: DecodedImage,
  createCanvas: CanvasFactory,
): void {
  // A failed decode costs only this element: render nothing for it.
  if (decoded === undefined) return;

  withElementBox(ctx, el, (widthPx, heightPx) => {
    if (widthPx <= 0 || heightPx <= 0) return;

    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));

    // Render the source image at its on-label pixel size so halftoning
    // operates at the resolution it will actually print at.
    const srcCanvas = createCanvas(w, h);
    const srcCtx = srcCanvas.getContext("2d");
    if (!srcCtx) return;
    srcCtx.drawImage(decoded, 0, 0, w, h);
    const { data } = srcCtx.getImageData(0, 0, w, h);

    const mask = computeHalftoneMask(data, w, h, el);

    // Paint the mask onto a second offscreen canvas as hard black on a
    // transparent background, then composite that onto the main canvas.
    // Transparent pixels fall back to whatever is already there (white),
    // which is exactly what "clear" would have given us -- Ctx2D has no
    // clearRect/putImageData, so this reuses the primitives every other
    // element already relies on.
    const outCanvas = createCanvas(w, h);
    const outCtx = outCanvas.getContext("2d");
    if (!outCtx) return;
    outCtx.fillStyle = "#000000";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) outCtx.fillRect(x, y, 1, 1);
      }
    }

    ctx.drawImage(
      outCanvas as unknown as DecodedImage,
      -widthPx / 2,
      -heightPx / 2,
      widthPx,
      heightPx,
    );
  });
}

/** Dispatch a single element to its drawing routine. */
function drawElement(
  ctx: Ctx2D,
  el: Element,
  images: ReadonlyMap<string, DecodedImage>,
  createCanvas: CanvasFactory,
): void {
  if (isTextElement(el)) {
    drawTextElement(ctx, el);
  } else if (el.kind === "rect") {
    drawRectElement(ctx, el);
  } else if (el.kind === "ellipse") {
    drawEllipseElement(ctx, el);
  } else if (isPolylineElement(el)) {
    drawPolylineElement(ctx, el);
  } else if (isImageElement(el)) {
    drawImageElement(ctx, el, images.get(el.id), createCanvas);
  }
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
  const decodeImage = options?.decodeImage ?? domImageDecoder;

  // Decoding is async; drawing is not (Ctx2D is synchronous). Resolve every
  // image up front into a Map keyed by element id, then run the drawing pass
  // synchronously below. A decode failure is caught per-element so one broken
  // image can't throw and take down the whole label.
  const images = new Map<string, DecodedImage>();
  await Promise.all(
    doc.elements.filter(isImageElement).map(async (el) => {
      try {
        images.set(el.id, await decodeImage(el.src));
      } catch {
        // Left unset: drawImageElement treats a missing entry as "render nothing".
      }
    }),
  );

  const canvas = createCanvas(geometry.widthPx, geometry.heightPx);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, geometry.widthPx, geometry.heightPx);

  /*
   * Round stock: clip everything to the die-cut circle.
   *
   * The printer still feeds a rectangular area, so ink outside the circle lands
   * on the backing liner rather than the label -- it smears, and on a
   * direct-thermal roll it is simply wasted. Clipping here rather than in the
   * editor means the guarantee holds no matter what produced the document.
   */
  if (geometry.shape === "round") {
    ctx.beginPath();
    ctx.ellipse(
      geometry.widthPx / 2,
      geometry.heightPx / 2,
      geometry.widthPx / 2,
      geometry.heightPx / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.clip();
  }

  for (const el of doc.elements) {
    drawElement(ctx, el, images, createCanvas);
  }

  const imageData = ctx.getImageData(0, 0, geometry.widthPx, geometry.heightPx);
  return thresholdImageData(imageData.data, geometry.widthPx, geometry.heightPx, doc.dpi, options);
}
