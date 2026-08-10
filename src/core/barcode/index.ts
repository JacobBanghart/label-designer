/**
 * Barcode encoding and layout, shared by the editor and the rasterizer.
 *
 * THIS MODULE IS THE SINGLE SOURCE OF TRUTH for what a barcode looks like.
 * The editor draws Konva rectangles from `layoutBarcode`, and the rasterizer
 * draws 2D-context rectangles from the same call. That is deliberate: this
 * project has produced three WYSIWYG divergences by implementing the same
 * visual twice, and a barcode that differs between screen and print is not a
 * cosmetic bug -- it scans as the wrong value or not at all.
 *
 * Everything below counts MODULES. A module becomes a whole number of device
 * pixels at layout time and never a fraction, because the render pipeline ends
 * in a 1-bit threshold: a 2.4px bar is antialiased and then thresholded to
 * either 2px or 3px depending on where it happens to land, and a scanner reads
 * the resulting inconsistent bar widths as garbage.
 */

import { canEncodeCode128, encodeCode128 } from "./code128.ts";
import { checkEan13, encodeEan13 } from "./ean13.ts";
import { encodeQr, fitVersion, MAX_VERSION, type QrEcc } from "./qr.ts";

export type { QrEcc } from "./qr.ts";
export { checkEan13, ean13CheckDigit } from "./ean13.ts";

export type Symbology = "code128" | "ean13" | "qr";

export const SYMBOLOGIES: readonly Symbology[] = ["code128", "ean13", "qr"];

export const SYMBOLOGY_LABELS: Record<Symbology, string> = {
  code128: "Code 128",
  ean13: "EAN-13 / UPC-A",
  qr: "QR",
};

/**
 * Quiet zone in modules. Not decoration -- a scanner uses it to find the edge
 * of the symbol, and a barcode butted against artwork frequently will not read.
 */
const QUIET: Record<Symbology, number> = { code128: 10, ean13: 9, qr: 4 };

export interface BarcodeSpec {
  symbology: Symbology;
  value: string;
  /** QR only. Higher levels survive more damage at the cost of capacity. */
  ecc: QrEcc;
}

/* --------------------------------------------------------------------------
 * Validation
 * -------------------------------------------------------------------------- */

/**
 * Why `value` cannot be encoded, or null if it can.
 *
 * Kept separate from encoding so a whole dataset can be checked before anything
 * is printed. Catching a bad value in row 57 after 56 labels have already come
 * off the roll is the failure this exists to prevent.
 */
export function validateBarcode(spec: BarcodeSpec): string | null {
  const value = spec.value;
  if (value.length === 0) return "No value";

  switch (spec.symbology) {
    case "code128":
      return canEncodeCode128(value) ? null : "Code 128 takes printable ASCII only";
    case "ean13": {
      const check = checkEan13(value);
      return check.ok ? null : (check.error ?? "Invalid EAN-13");
    }
    case "qr": {
      const bytes = new TextEncoder().encode(value).length;
      return fitVersion(bytes, spec.ecc) === null
        ? `Too long for QR version ${MAX_VERSION} at ECC ${spec.ecc} (${bytes} bytes)`
        : null;
    }
  }
}

/* --------------------------------------------------------------------------
 * Encoding
 * -------------------------------------------------------------------------- */

export interface LinearSymbol {
  kind: "linear";
  modules: readonly boolean[];
}

export interface MatrixSymbol {
  kind: "matrix";
  modules: readonly (readonly boolean[])[];
  size: number;
}

export type Symbol_ = LinearSymbol | MatrixSymbol;

export function encodeBarcode(spec: BarcodeSpec): Symbol_ {
  switch (spec.symbology) {
    case "code128":
      return { kind: "linear", modules: encodeCode128(spec.value) };
    case "ean13":
      return { kind: "linear", modules: encodeEan13(spec.value) };
    case "qr": {
      const qr = encodeQr(spec.value, spec.ecc);
      return { kind: "matrix", modules: qr.modules, size: qr.size };
    }
  }
}

/* --------------------------------------------------------------------------
 * Layout
 * -------------------------------------------------------------------------- */

/** A rectangle to fill, in device pixels relative to the element's box. */
export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BarcodeLayout {
  bars: readonly Bar[];
  /** Whole device pixels per module. Always an integer, never below 1. */
  moduleSizePx: number;
  /** Actual drawn extent, which is the element box rounded down to modules. */
  widthPx: number;
  heightPx: number;
  /** Offset that centres the drawn symbol inside the element box. */
  offsetX: number;
  offsetY: number;
}

export type LayoutResult = { ok: true; layout: BarcodeLayout } | { ok: false; error: string };

export interface LayoutBox {
  widthPx: number;
  heightPx: number;
}

/**
 * Lay a barcode out inside `box`.
 *
 * Fails rather than shrinking when a module would be under one device pixel.
 * Every other element in this app degrades gracefully when it does not fit; a
 * barcode must not, because the degraded form is indistinguishable from a good
 * one until someone tries to scan it.
 */
export function layoutBarcode(spec: BarcodeSpec, box: LayoutBox): LayoutResult {
  const invalid = validateBarcode(spec);
  if (invalid) return { ok: false, error: invalid };

  let symbol: Symbol_;
  try {
    symbol = encodeBarcode(spec);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const quiet = QUIET[spec.symbology];

  if (symbol.kind === "matrix") {
    const total = symbol.size + quiet * 2;
    // Square: a QR stretched to a non-square box no longer decodes.
    const moduleSizePx = Math.floor(Math.min(box.widthPx, box.heightPx) / total);
    if (moduleSizePx < 1) {
      return {
        ok: false,
        error: `Needs at least ${total}x${total} px for this much data; box is ${Math.floor(box.widthPx)}x${Math.floor(box.heightPx)}`,
      };
    }

    const bars: Bar[] = [];
    for (let r = 0; r < symbol.size; r++) {
      // Merge horizontal runs: far fewer rectangles, and no seams between
      // adjacent modules once the renderer antialiases.
      let c = 0;
      while (c < symbol.size) {
        if (!symbol.modules[r]![c]) {
          c++;
          continue;
        }
        let end = c;
        while (end < symbol.size && symbol.modules[r]![end]) end++;
        bars.push({
          x: (quiet + c) * moduleSizePx,
          y: (quiet + r) * moduleSizePx,
          w: (end - c) * moduleSizePx,
          h: moduleSizePx,
        });
        c = end;
      }
    }

    const side = total * moduleSizePx;
    return {
      ok: true,
      layout: {
        bars,
        moduleSizePx,
        widthPx: side,
        heightPx: side,
        offsetX: (box.widthPx - side) / 2,
        offsetY: (box.heightPx - side) / 2,
      },
    };
  }

  const total = symbol.modules.length + quiet * 2;
  const moduleSizePx = Math.floor(box.widthPx / total);
  if (moduleSizePx < 1) {
    return {
      ok: false,
      error: `Needs at least ${total} px wide for this value; box is ${Math.floor(box.widthPx)} px`,
    };
  }

  const height = Math.max(1, Math.floor(box.heightPx));
  const bars: Bar[] = [];
  let i = 0;
  while (i < symbol.modules.length) {
    if (!symbol.modules[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < symbol.modules.length && symbol.modules[end]) end++;
    bars.push({
      x: (quiet + i) * moduleSizePx,
      y: 0,
      w: (end - i) * moduleSizePx,
      h: height,
    });
    i = end;
  }

  const width = total * moduleSizePx;
  return {
    ok: true,
    layout: {
      bars,
      moduleSizePx,
      widthPx: width,
      heightPx: height,
      offsetX: (box.widthPx - width) / 2,
      offsetY: 0,
    },
  };
}
