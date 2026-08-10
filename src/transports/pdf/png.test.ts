/**
 * Own unit tests for the PDF transport, covering what the contract test does
 * not: actual pixel content of the embedded image (not just page geometry).
 *
 * We decode the produced PNG ourselves (a hand-rolled inflate-free check
 * isn't practical, so instead we re-embed via pdf-lib and cross-check via a
 * from-scratch PNG bit reader) to confirm:
 *  - black raster pixels really render as black samples in the PNG
 *  - padding bits past the raster width are never asserted as real pixels
 */
import { describe, expect, it } from "vite-plus/test";

import { createMonoRaster, getPixel, setPixel } from "../../core/raster.ts";
import { DPI } from "../../core/units.ts";

import { encodeMonoRasterAsPng } from "../../core/png.ts";

/** Minimal PNG reader: parses IHDR + concatenated IDAT, inflates via DecompressionStream. */
async function decodePng(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; getSample: (x: number, y: number) => number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; // skip signature
  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
    } else if (type === "IDAT") {
      idatParts.push(bytes.slice(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4; // skip CRC
  }

  const idat = new Uint8Array(idatParts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of idatParts) {
    idat.set(p, pos);
    pos += p.length;
  }

  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  void writer.write(idat as unknown as BufferSource);
  void writer.close();
  const reader = ds.readable.getReader();
  const inflatedParts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) inflatedParts.push(value);
  }
  const inflated = new Uint8Array(inflatedParts.reduce((sum, p) => sum + p.length, 0));
  pos = 0;
  for (const p of inflatedParts) {
    inflated.set(p, pos);
    pos += p.length;
  }

  const rowBytes = Math.ceil(width / 8);
  const stride = rowBytes + 1; // + filter byte

  return {
    width,
    height,
    getSample(x: number, y: number): number {
      const rowStart = y * stride + 1; // skip filter byte (must be 0)
      const byte = inflated[rowStart + (x >> 3)]!;
      const mask = 0x80 >> (x & 7);
      return (byte & mask) !== 0 ? 1 : 0;
    },
  };
}

describe("encodeMonoRasterAsPng", () => {
  it("renders black raster pixels as black (sample 0) PNG pixels", async () => {
    const raster = createMonoRaster(8, 4, DPI);
    setPixel(raster, 0, 0, true);
    setPixel(raster, 3, 2, true);

    const png = await encodeMonoRasterAsPng(raster);
    const decoded = await decodePng(png);

    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(4);

    // Black raster pixel -> PNG grayscale sample 0 (black).
    expect(decoded.getSample(0, 0)).toBe(0);
    expect(decoded.getSample(3, 2)).toBe(0);

    // Untouched pixels stay white -> PNG grayscale sample 1 (white).
    expect(decoded.getSample(1, 0)).toBe(1);
    expect(decoded.getSample(7, 3)).toBe(1);
  });

  it("matches getPixel() for every pixel on an unaligned-width raster", async () => {
    const raster = createMonoRaster(13, 3, DPI);
    setPixel(raster, 0, 0, true);
    setPixel(raster, 12, 0, true);
    setPixel(raster, 5, 1, true);
    setPixel(raster, 12, 2, true);

    const png = await encodeMonoRasterAsPng(raster);
    const decoded = await decodePng(png);

    expect(decoded.width).toBe(13);
    expect(decoded.height).toBe(3);

    for (let y = 0; y < raster.heightPx; y++) {
      for (let x = 0; x < raster.widthPx; x++) {
        const raterIsBlack = getPixel(raster, x, y);
        const pngSample = decoded.getSample(x, y);
        // raster black (true) -> PNG sample 0; raster white (false) -> sample 1.
        expect(pngSample).toBe(raterIsBlack ? 0 : 1);
      }
    }
  });

  it("does not render padding bits past the raster width as visible content", async () => {
    // 13px wide raster has 3 padding bits per row (13 -> 2 bytes -> 16 bits).
    // Set every bit in the padding region directly on the packed bits, then
    // confirm the PNG's declared width still excludes them and every real
    // pixel within width remains white.
    const raster = createMonoRaster(13, 1, DPI);
    // Manually flip bits 13, 14, 15 (the padding bits of the only row) to 1.
    raster.bits[1] = 0b00000111;

    const png = await encodeMonoRasterAsPng(raster);
    const decoded = await decodePng(png);

    expect(decoded.width).toBe(13);
    for (let x = 0; x < 13; x++) {
      expect(decoded.getSample(x, 0)).toBe(1); // still white; padding never observed
    }
  });
});
