import { describe, expect, it } from "vite-plus/test";

import type { Element, TextElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { boundingBox, computeSnap } from "./snapping.ts";

const geometry = resolveGeometry("4x6", "portrait"); // 812 x 1218

function text(overrides: Partial<TextElement> & { id: string }): TextElement {
  return {
    kind: "text",
    x: 0,
    y: 0,
    widthPx: 100,
    heightPx: 50,
    rotation: 0,
    text: "x",
    fontSizePx: 20,
    fontFamily: "sans-serif",
    bold: false,
    italic: false,
    align: "left",
    verticalAlign: "top",
    ...overrides,
  };
}

describe("boundingBox", () => {
  it("matches the element box when unrotated", () => {
    const box = boundingBox({ x: 10, y: 20, widthPx: 100, heightPx: 50, rotation: 0 });

    expect(box).toMatchObject({ left: 10, top: 20, right: 110, bottom: 70 });
    expect(box.centreX).toBe(60);
    expect(box.centreY).toBe(45);
  });

  it("transposes the box at 90 degrees, keeping the centre", () => {
    const box = boundingBox({ x: 0, y: 0, widthPx: 100, heightPx: 50, rotation: 90 });

    // 100x50 rotated a quarter turn occupies 50x100 about the same centre.
    expect(box.right - box.left).toBeCloseTo(50, 6);
    expect(box.bottom - box.top).toBeCloseTo(100, 6);
    expect(box.centreX).toBe(50);
    expect(box.centreY).toBe(25);
  });

  it("grows the box at 45 degrees", () => {
    const box = boundingBox({ x: 0, y: 0, widthPx: 100, heightPx: 100, rotation: 45 });

    // A square rotated 45 degrees has an AABB of side w*sqrt(2).
    expect(box.right - box.left).toBeCloseTo(100 * Math.SQRT2, 4);
  });
});

describe("computeSnap", () => {
  it("snaps a near-centred element to the label centre line", () => {
    // Label centre is x=406; put the element's centre 5px off.
    const moving = text({ id: "a", x: 406 - 50 + 5, y: 600 });

    const result = computeSnap(moving, [], geometry, 10);

    expect(result.dx).toBe(-5);
    expect(result.guides).toContainEqual({ orientation: "vertical", position: 406 });
  });

  it("snaps to the label edge", () => {
    const moving = text({ id: "a", x: 3, y: 600 });

    const result = computeSnap(moving, [], geometry, 10);

    expect(result.dx).toBe(-3);
  });

  it("does nothing when everything is further away than the threshold", () => {
    const moving = text({ id: "a", x: 200, y: 600 });

    const result = computeSnap(moving, [], geometry, 4);

    expect(result).toMatchObject({ dx: 0, dy: 0 });
    expect(result.guides).toHaveLength(0);
  });

  it("aligns to another element's left edge", () => {
    const other = text({ id: "b", x: 300, y: 100 });
    const moving = text({ id: "a", x: 296, y: 600 });

    const result = computeSnap(moving, [other], geometry, 8);

    expect(result.dx).toBe(4);
    expect(result.guides).toContainEqual({ orientation: "vertical", position: 300 });
    expect(result.guides.some((g) => g.orientation === "vertical")).toBe(true);
  });

  it("never snaps an element to itself", () => {
    const moving = text({ id: "a", x: 200, y: 601 });
    // Passing the element in its own "others" list must not produce a
    // zero-distance self-match that pins it in place.
    const result = computeSnap(moving, [moving], geometry, 8);

    expect(result.dx).toBe(0);
  });

  it("uses the rotated footprint, not the stored box", () => {
    // A 100x50 box rotated 90 degrees is visually 50 wide. Its left edge sits
    // at centreX - 25, so alignment must be judged from that, not from x.
    const moving = text({ id: "a", x: 0, y: 600, rotation: 90 });
    const box = boundingBox(moving);
    expect(box.left).toBeCloseTo(25, 6);

    // Nudge so the ROTATED left edge is 3px from the label's left edge.
    const shifted = text({ id: "a", x: -22, y: 600, rotation: 90 });
    const result = computeSnap(shifted, [], geometry, 8);

    expect(result.dx).toBeCloseTo(-3, 6);
  });

  it("snaps both axes independently", () => {
    const moving = text({ id: "a", x: 406 - 50 + 2, y: 609 - 25 - 3 });

    const result = computeSnap(moving, [], geometry, 10);

    expect(result.dx).toBe(-2);
    expect(result.dy).toBe(3);
    expect(result.guides).toHaveLength(2);
  });

  it("is disabled by a zero threshold", () => {
    const moving = text({ id: "a", x: 406 - 50 + 1, y: 600 });

    expect(computeSnap(moving, [], geometry, 0)).toMatchObject({ dx: 0, dy: 0 });
  });

  it("prefers the nearest target when several are in range", () => {
    // Deliberately far from the label's centre line (406) and edges, so the
    // only candidates in range belong to the two neighbours.
    const near = text({ id: "b", x: 202, y: 100 });
    const far = text({ id: "c", x: 210, y: 100 });
    const moving = text({ id: "a", x: 204, y: 600 });

    const result = computeSnap(moving, [near, far] as Element[], geometry, 20);

    // 202 is 2 away, 210 is 6 away -- the closer edge wins.
    expect(result.dx).toBe(-2);
  });

  it("reports every alignment a single movement satisfies", () => {
    // Same width and same offset, so left, centre, and right all land at once.
    const other = text({ id: "b", x: 300, y: 100 });
    const moving = text({ id: "a", x: 296, y: 600 });

    const result = computeSnap(moving, [other], geometry, 8);

    const positions = result.guides
      .filter((g) => g.orientation === "vertical")
      .map((g) => g.position)
      .sort((a, b) => a - b);
    expect(positions).toEqual([300, 350, 400]);
  });
});
