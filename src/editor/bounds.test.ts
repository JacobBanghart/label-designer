import { describe, expect, it } from "vite-plus/test";

import type { LabelDocument, TextElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { clampIntoBounds, isOutOfBounds, outOfBoundsIds } from "./bounds.ts";
import { createDocument } from "./operations.ts";

const rect = resolveGeometry("4x6", "portrait"); // 812 x 1218
const round = resolveGeometry("round144", "portrait"); // 292 x 292

function text(id: string, x: number, y: number, w = 100, h = 50, rotation = 0): TextElement {
  return {
    id,
    kind: "text",
    x,
    y,
    widthPx: w,
    heightPx: h,
    rotation,
    text: id,
    fontSizePx: 20,
    fontFamily: "sans-serif",
    bold: false,
    italic: false,
    align: "left",
  };
}

describe("isOutOfBounds", () => {
  it("accepts an element well inside the label", () => {
    expect(isOutOfBounds(text("a", 100, 100), rect)).toBe(false);
  });

  it("accepts an element flush against the edges", () => {
    expect(isOutOfBounds(text("a", 0, 0, rect.widthPx, rect.heightPx), rect)).toBe(false);
  });

  it("catches the real bug: a rule running past the bottom edge", () => {
    // The calibration target placed a 4.000in rule starting at 2.202in on a
    // 6.000in label. It printed clipped, silently.
    const overflowing = text("v", 91, 447, 6, 812);
    expect(447 + 812).toBeGreaterThan(rect.heightPx);
    expect(isOutOfBounds(overflowing, rect)).toBe(true);
  });

  it("catches negative positions", () => {
    expect(isOutOfBounds(text("a", -20, 100), rect)).toBe(true);
    expect(isOutOfBounds(text("a", 100, -20), rect)).toBe(true);
  });

  it("tolerates sub-pixel rounding rather than crying wolf", () => {
    expect(isOutOfBounds(text("a", -0.4, -0.4), rect)).toBe(false);
  });

  it("uses the rotated footprint", () => {
    // 400x50 fits horizontally at x=200, but rotated 90 degrees it becomes
    // 50 wide and 400 tall about the same centre -- which escapes vertically
    // when placed near the top.
    const flat = text("a", 200, 10, 400, 50);
    const turned = text("a", 200, 10, 400, 50, 90);

    expect(isOutOfBounds(flat, rect)).toBe(false);
    expect(isOutOfBounds(turned, rect)).toBe(true);
  });

  describe("round stock", () => {
    it("accepts an element near the centre", () => {
      expect(isOutOfBounds(text("a", 120, 130, 50, 30), round)).toBe(false);
    });

    it("rejects an element in the corner of the bounding box", () => {
      // Inside the rectangle, outside the die-cut circle.
      const corner = text("a", 2, 2, 40, 40);
      expect(isOutOfBounds(corner, rect)).toBe(false);
      expect(isOutOfBounds(corner, round)).toBe(true);
    });
  });
});

describe("outOfBoundsIds", () => {
  it("lists only the offending elements", () => {
    const doc: LabelDocument = {
      ...createDocument("4x6", "portrait"),
      elements: [text("ok", 100, 100), text("bad", 100, 1200), text("alsoOk", 50, 50)],
    };

    expect(outOfBoundsIds(doc)).toEqual(["bad"]);
  });

  it("returns nothing for a clean document", () => {
    const doc: LabelDocument = {
      ...createDocument("4x6", "portrait"),
      elements: [text("a", 10, 10)],
    };

    expect(outOfBoundsIds(doc)).toEqual([]);
  });
});

describe("clampIntoBounds", () => {
  const doc = (...els: TextElement[]): LabelDocument => ({
    ...createDocument("4x6", "portrait"),
    elements: els,
  });

  it("pulls an element back inside and clears the warning", () => {
    // The rule that actually printed clipped.
    const before = doc(text("v", 91, 447, 6, 812));
    expect(outOfBoundsIds(before)).toEqual(["v"]);

    const after = clampIntoBounds(before, ["v"]);

    expect(outOfBoundsIds(after)).toEqual([]);
  });

  it("moves without resizing", () => {
    const after = clampIntoBounds(doc(text("a", 100, 1200, 100, 50)), ["a"]);
    const moved = after.elements[0]!;

    expect(moved.widthPx).toBe(100);
    expect(moved.heightPx).toBe(50);
  });

  it("handles negative positions", () => {
    const after = clampIntoBounds(doc(text("a", -50, -80)), ["a"]);
    const moved = after.elements[0]!;

    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
  });

  it("leaves untargeted elements alone", () => {
    const before = doc(text("a", -50, -50), text("b", -60, -60));
    const after = clampIntoBounds(before, ["a"]);

    expect(after.elements[1]!.x).toBe(-60);
  });

  it("does not mutate the input", () => {
    const before = doc(text("a", -50, -50));
    const snapshot = JSON.stringify(before);

    clampIntoBounds(before, ["a"]);

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("pins an oversized element to the top-left rather than shoving it off the far edge", () => {
    const oversized = text("big", -100, -100, rect.widthPx + 400, rect.heightPx + 400);
    const after = clampIntoBounds(doc(oversized), ["big"]);
    const moved = after.elements[0]!;

    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
    // Still too big for the label, so it stays flagged rather than pretending.
    expect(outOfBoundsIds(after)).toEqual(["big"]);
  });

  it("keeps round-stock elements out of the unprintable corners", () => {
    const roundDoc: LabelDocument = {
      ...createDocument("round144", "portrait"),
      elements: [text("a", -20, -20, 40, 40)],
    };

    const after = clampIntoBounds(roundDoc, ["a"]);

    expect(outOfBoundsIds(after)).toEqual([]);
  });
});
