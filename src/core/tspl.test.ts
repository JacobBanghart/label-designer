import { describe, expect, it } from "vite-plus/test";

import { createMonoRaster, setPixel, bytesPerRow } from "./raster.ts";
import { DEFAULT_TSPL_SETTINGS, encodeTspl } from "./tspl.ts";
import { DPI } from "./units.ts";

const decoder = new TextDecoder("latin1");
const asText = (bytes: Uint8Array) => decoder.decode(bytes);

/** A 2x1 label at 203 DPI, matching the reference capture. */
function label2x1() {
  return createMonoRaster(406, 203, DPI);
}

describe("encodeTspl", () => {
  it("emits the command sequence the vendor filter emits", () => {
    const text = asText(encodeTspl(label2x1(), DEFAULT_TSPL_SETTINGS));

    // Captured verbatim from rastertorollo, including the space before the comma.
    expect(text).toContain("SIZE 51 mm ,26 mm\n");
    expect(text).toContain("REFERENCE 0,0\n");
    expect(text).toContain("DIRECTION 0,0\n");
    expect(text).toContain("GAP 3 mm,0 mm\n");
    expect(text).toContain("DENSITY 8\n");
    expect(text).toContain("SPEED 6\n");
    expect(text).toContain("CLS\n");
    expect(text).toContain("BITMAP 0,0,51,203,1,");
    expect(text.endsWith("PRINT 1,1\n")).toBe(true);
  });

  it("sizes the bitmap payload exactly bytesPerRow * height", () => {
    const raster = label2x1();
    const bytes = encodeTspl(raster, DEFAULT_TSPL_SETTINGS);
    const marker = "BITMAP 0,0,51,203,1,";
    const start = asText(bytes).indexOf(marker) + marker.length;
    const payloadLength = bytes.length - start - "\nPRINT 1,1\n".length;

    expect(payloadLength).toBe(bytesPerRow(406) * 203);
    expect(payloadLength).toBe(10353); // the vendor capture, exactly
  });

  it("inverts polarity: our set bit means burn, TSPL's means white", () => {
    const raster = createMonoRaster(8, 1, DPI);
    setPixel(raster, 0, 0, true); // one black dot at the left

    const bytes = encodeTspl(raster, DEFAULT_TSPL_SETTINGS);
    const marker = "BITMAP 0,0,1,1,1,";
    const start = asText(bytes).indexOf(marker) + marker.length;

    // 0b10000000 burned -> 0b01111111 in TSPL.
    expect(bytes[start]).toBe(0x7f);
  });

  it("renders a blank label as all-white, not all-black", () => {
    const bytes = encodeTspl(createMonoRaster(16, 2, DPI), DEFAULT_TSPL_SETTINGS);
    const marker = "BITMAP 0,0,2,2,1,";
    const start = asText(bytes).indexOf(marker) + marker.length;

    // Getting this backwards would burn an entire solid label.
    for (let i = 0; i < 4; i++) expect(bytes[start + i]).toBe(0xff);
  });

  it("carries DIRECTION, which is what fixes rotated media", () => {
    const text = asText(encodeTspl(label2x1(), { ...DEFAULT_TSPL_SETTINGS, direction: 1 }));
    expect(text).toContain("DIRECTION 1,0\n");
  });

  it("carries the registration offset", () => {
    const text = asText(
      encodeTspl(label2x1(), { ...DEFAULT_TSPL_SETTINGS, offsetXDots: -13, offsetYDots: 4 }),
    );
    expect(text).toContain("REFERENCE -13,4\n");
  });

  it("clamps density and speed to the ranges the printer accepts", () => {
    const text = asText(
      encodeTspl(label2x1(), { ...DEFAULT_TSPL_SETTINGS, density: 99, speed: 0 }),
    );
    expect(text).toContain("DENSITY 15\n");
    expect(text).toContain("SPEED 1\n");
  });

  it("asks the printer for multiple copies rather than resending the bitmap", () => {
    const one = encodeTspl(label2x1(), DEFAULT_TSPL_SETTINGS);
    const five = encodeTspl(label2x1(), { ...DEFAULT_TSPL_SETTINGS, copies: 5 });

    expect(asText(five)).toContain("PRINT 1,5\n");
    // Same payload: the printer repeats it, so five labels cost one transfer.
    expect(five.length).toBe(one.length);
  });

  it("rounds label dimensions up to whole millimetres", () => {
    // 4x6in at 203dpi = 812x1218 dots = 101.6 x 152.4 mm.
    const raster = createMonoRaster(812, 1218, DPI);
    expect(asText(encodeTspl(raster, DEFAULT_TSPL_SETTINGS))).toContain("SIZE 102 mm ,153 mm\n");
  });
});
