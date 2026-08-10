import { describe, expect, it } from "vite-plus/test";

import { fitWithin } from "./importImage.ts";

describe("fitWithin", () => {
  it("scales a large image down to the limit, preserving aspect", () => {
    const { width, height } = fitWithin(4000, 3000, 1218);

    expect(Math.max(width, height)).toBe(1218);
    expect(width / height).toBeCloseTo(4000 / 3000, 2);
  });

  it("never scales a small image up", () => {
    // Upscaling would invent detail the printer cannot resolve anyway, and
    // would bloat the stored data URI for nothing.
    expect(fitWithin(100, 50, 1218)).toEqual({ width: 100, height: 50 });
  });

  it("handles tall and wide images symmetrically", () => {
    expect(fitWithin(3000, 4000, 1218).height).toBe(1218);
    expect(fitWithin(4000, 3000, 1218).width).toBe(1218);
  });

  it("never rounds a dimension down to zero", () => {
    // A 1000x1 banner scaled to fit 10 would round the height to 0 and produce
    // a canvas that cannot be created.
    const { width, height } = fitWithin(1000, 1, 10);

    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
