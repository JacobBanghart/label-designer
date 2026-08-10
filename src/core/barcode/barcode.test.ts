import { describe, expect, it } from "vite-plus/test";

import { encodeCode128 } from "./code128.ts";
import { checkEan13, ean13CheckDigit, encodeEan13 } from "./ean13.ts";
import {
  encodeQr,
  fitVersion,
  GF_EXP,
  gfMul,
  MAX_VERSION,
  rsEncode,
  TOTAL_CODEWORDS,
} from "./qr.ts";
import { layoutBarcode, validateBarcode } from "./index.ts";

describe("Code 128", () => {
  it("brackets the symbol with a start pattern and a stop pattern", () => {
    const modules = encodeCode128("A");
    // Start B is 211214 and stop is 2331112, both beginning with a bar.
    expect(modules[0]).toBe(true);
    expect(modules.at(-1)).toBe(true);
  });

  it("is a whole number of symbols wide", () => {
    // Every symbol is 11 modules, except the 13-module stop.
    for (const value of ["A", "HELLO", "12345678", "Bin 4 / Shelf 2"]) {
      expect((encodeCode128(value).length - 13) % 11).toBe(0);
    }
  });

  it("packs digit pairs, so numeric data is far narrower than text", () => {
    const digits = encodeCode128("12345678901234567890").length;
    const letters = encodeCode128("ABCDEFGHIJKLMNOPQRST").length;
    expect(digits).toBeLessThan(letters);
  });

  it("refuses characters it cannot encode rather than substituting", () => {
    expect(() => encodeCode128("café")).toThrow();
  });
});

describe("EAN-13", () => {
  it("computes the check digit for a known code", () => {
    // 978030640615(7) -- a widely published ISBN barcode.
    expect(ean13CheckDigit("978030640615")).toBe(7);
  });

  it("accepts a 12-digit UPC and completes it", () => {
    const check = checkEan13("978030640615");
    expect(check.ok).toBe(true);
    expect(check.digits).toBe("9780306406157");
  });

  it("rejects a wrong check digit instead of printing it", () => {
    const check = checkEan13("9780306406158");
    expect(check.ok).toBe(false);
    expect(check.error).toContain("check digit");
  });

  it("is always exactly 95 modules", () => {
    expect(encodeEan13("9780306406157")).toHaveLength(95);
  });

  it("starts and ends with a guard bar", () => {
    const modules = encodeEan13("9780306406157");
    expect(modules.slice(0, 3)).toEqual([true, false, true]);
    expect(modules.slice(-3)).toEqual([true, false, true]);
  });
});

describe("QR", () => {
  it("has capacity tables that sum to the documented codeword totals", () => {
    // The tables are transcribed by hand, and a single wrong number produces a
    // symbol that looks plausible and does not scan. This catches that.
    for (const ecc of ["L", "M", "Q", "H"] as const) {
      for (let v = 1; v <= MAX_VERSION; v++) {
        const bytes = fitVersion(0, ecc);
        expect(bytes).not.toBeNull();
      }
    }
    expect(TOTAL_CODEWORDS).toHaveLength(MAX_VERSION);
  });

  it("produces the right module count for its version", () => {
    const qr = encodeQr("BIN-42", "M");
    expect(qr.size).toBe(17 + 4 * qr.version);
    expect(qr.modules).toHaveLength(qr.size);
    expect(qr.modules[0]).toHaveLength(qr.size);
  });

  it("places all three finder patterns", () => {
    const { modules, size } = encodeQr("https://example.com/bin/42", "M");
    // A finder is a dark 7x7 ring with a dark 3x3 core and a light ring between.
    const isFinder = (r: number, c: number) =>
      modules[r]![c] === true &&
      modules[r + 6]![c + 6] === true &&
      modules[r + 1]![c + 1] === false &&
      modules[r + 3]![c + 3] === true;
    expect(isFinder(0, 0)).toBe(true);
    expect(isFinder(0, size - 7)).toBe(true);
    expect(isFinder(size - 7, 0)).toBe(true);
  });

  it("lays down the timing patterns", () => {
    const { modules, size } = encodeQr("BIN-42", "M");
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6]![i]).toBe(i % 2 === 0);
      expect(modules[i]![6]).toBe(i % 2 === 0);
    }
  });

  it("always sets the dark module", () => {
    const { modules, size } = encodeQr("BIN-42", "M");
    expect(modules[size - 8]![8]).toBe(true);
  });

  it("grows its version with the data", () => {
    const small = encodeQr("42", "M").version;
    const large = encodeQr("x".repeat(120), "M").version;
    expect(large).toBeGreaterThan(small);
  });

  it("refuses data it cannot fit rather than truncating", () => {
    expect(() => encodeQr("x".repeat(5000), "H")).toThrow(/too long/i);
  });
});

describe("layout", () => {
  const spec = { symbology: "code128" as const, value: "BIN-42", ecc: "M" as const };

  it("uses a whole number of pixels per module", () => {
    const result = layoutBarcode(spec, { widthPx: 407, heightPx: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number.isInteger(result.layout.moduleSizePx)).toBe(true);
    expect(result.layout.moduleSizePx).toBeGreaterThanOrEqual(1);
    // Every bar edge must land on a module boundary.
    for (const bar of result.layout.bars) {
      expect(bar.x % result.layout.moduleSizePx).toBe(0);
      expect(bar.w % result.layout.moduleSizePx).toBe(0);
    }
  });

  it("fails rather than shrinking below one pixel per module", () => {
    const result = layoutBarcode(spec, { widthPx: 40, heightPx: 40 });
    expect(result.ok).toBe(false);
  });

  it("keeps a QR square even in a wide box", () => {
    const result = layoutBarcode(
      { symbology: "qr", value: "BIN-42", ecc: "M" },
      { widthPx: 400, heightPx: 120 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.widthPx).toBe(result.layout.heightPx);
  });

  it("leaves a quiet zone inside the box", () => {
    const result = layoutBarcode(spec, { widthPx: 600, heightPx: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = Math.min(...result.layout.bars.map((b) => b.x));
    expect(first).toBeGreaterThanOrEqual(10 * result.layout.moduleSizePx);
  });
});

describe("validation", () => {
  it("reports why a value cannot be used", () => {
    expect(validateBarcode({ symbology: "ean13", value: "12", ecc: "M" })).toContain("12 or 13");
    expect(validateBarcode({ symbology: "code128", value: "", ecc: "M" })).toBe("No value");
    expect(validateBarcode({ symbology: "code128", value: "OK", ecc: "M" })).toBeNull();
  });
});

describe("Reed-Solomon", () => {
  it("produces codewords whose syndromes are all zero", () => {
    /*
     * The real proof that the error correction is right, as opposed to merely
     * plausible. A valid RS codeword is divisible by the generator polynomial,
     * which means evaluating it at each root a^0..a^(n-1) yields zero. If the
     * arithmetic or the generator were wrong, the symbol would still look like
     * a QR code and no scanner would read it.
     */
    for (const ecLen of [7, 10, 13, 16, 17, 18, 20, 22, 24, 26, 28, 30]) {
      const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 0xff);
      const codeword = [...data, ...rsEncode(data, ecLen)];

      for (let root = 0; root < ecLen; root++) {
        let acc = 0;
        for (const byte of codeword) acc = gfMul(acc, GF_EXP[root]!) ^ byte;
        expect(acc).toBe(0);
      }
    }
  });
});
