import { describe, expect, it } from "vite-plus/test";

import { DPI, ptToPx, pxToPt, pxToUnit, unitToPx } from "./units.ts";

describe("display units", () => {
  it("round-trips inches through device pixels", () => {
    // 4 inches at 203 DPI is 812 px, the width of the reference label.
    expect(unitToPx(4, "in")).toBe(812);
    expect(pxToUnit(812, "in")).toBeCloseTo(4, 6);
  });

  it("converts millimetres correctly", () => {
    // 25.4mm is one inch.
    expect(unitToPx(25.4, "mm")).toBe(DPI);
    expect(pxToUnit(DPI, "mm")).toBeCloseTo(25.4, 4);
  });

  it("treats px as identity", () => {
    expect(unitToPx(123, "px")).toBe(123);
    expect(pxToUnit(123, "px")).toBe(123);
  });

  it("always returns whole device pixels", () => {
    // The document stores integers; a fractional pixel is not printable.
    expect(Number.isInteger(unitToPx(1.2345, "in"))).toBe(true);
    expect(Number.isInteger(unitToPx(7.77, "mm"))).toBe(true);
  });

  it("converts font sizes through points", () => {
    // 72pt is one inch by definition.
    expect(ptToPx(72)).toBe(DPI);
    expect(pxToPt(DPI)).toBeCloseTo(72, 6);
  });

  it("survives a unit round trip without drifting", () => {
    // Switching units repeatedly must not walk a value away from itself.
    let px = 500;
    for (let i = 0; i < 20; i++) {
      px = unitToPx(pxToUnit(px, "mm"), "mm");
      px = unitToPx(pxToUnit(px, "in"), "in");
    }
    expect(px).toBeCloseTo(500, 0);
  });
});
