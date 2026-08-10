/**
 * Minimal 1-bit PNG encoder.
 *
 * Lives in core because two callers need it: the PDF transport embeds the PNG,
 * and PNG export hands it to the user directly. A second implementation would
 * be a second place for the bit-packing to go subtly wrong.
 */
import { bytesPerRow, type MonoRaster } from "./raster.ts";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Standard PNG/zlib CRC-32 table.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, false);
  return buf;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(type.length);
  for (let i = 0; i < type.length; i++) typeBytes[i] = type.charCodeAt(i);
  const typeAndData = concatBytes([typeBytes, data]);
  return concatBytes([u32(data.length), typeAndData, u32(crc32(typeAndData))]);
}

/** zlib-compress (RFC 1950) via the platform's CompressionStream. */
async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  void writer.write(new Uint8Array(arrayBuffer));
  void writer.close();

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parts.push(value);
  }
  return concatBytes(parts);
}

/**
 * Encode a MonoRaster as a grayscale, bit-depth-1 PNG. 1:1 pixel mapping, no
 * scaling, no resampling.
 */
export async function encodeMonoRasterAsPng(raster: MonoRaster): Promise<Uint8Array> {
  const rowBytes = bytesPerRow(raster.widthPx);

  // Raw (pre-deflate) image data: each scanline prefixed with filter type 0
  // (None), then the row bytes with polarity flipped (raster 1=black,
  // PNG grayscale 1=white).
  const raw = new Uint8Array((rowBytes + 1) * raster.heightPx);
  for (let y = 0; y < raster.heightPx; y++) {
    const srcOffset = y * rowBytes;
    const dstOffset = y * (rowBytes + 1);
    raw[dstOffset] = 0; // filter type: None
    for (let i = 0; i < rowBytes; i++) {
      raw[dstOffset + 1 + i] = ~raster.bits[srcOffset + i]! & 0xff;
    }
  }

  const idatData = await zlibDeflate(raw);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, raster.widthPx, false);
  ihdrView.setUint32(4, raster.heightPx, false);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  return concatBytes([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
