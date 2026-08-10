import { describe, expect, it } from "vite-plus/test";

import type { LabelDocument, TextElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { alignElements, distributeElements } from "./align.ts";
import { createDocument } from "./operations.ts";
import { boundingBox } from "./snapping.ts";

const geometry = resolveGeometry("4x6", "portrait"); // 812 x 1218

function text(id: string, x: number, y: number, w = 100, h = 50): TextElement {
  return {
    id,
    kind: "text",
    x,
    y,
    widthPx: w,
    heightPx: h,
    rotation: 0,
    text: id,
    fontSizePx: 20,
    fontFamily: "sans-serif",
    bold: false,
    italic: false,
    align: "left",
    verticalAlign: "top",
  };
}

function docWith(...elements: TextElement[]): LabelDocument {
  return { ...createDocument("4x6", "portrait"), elements };
}

const ids = (doc: LabelDocument) => doc.elements.map((e) => e.id);
const boxOf = (doc: LabelDocument, id: string) =>
  boundingBox(doc.elements.find((e) => e.id === id)!);

describe("alignElements", () => {
  it("aligns several elements to their leftmost edge", () => {
    const doc = docWith(text("a", 100, 0), text("b", 250, 100), text("c", 400, 200));

    const result = alignElements(doc, ["a", "b", "c"], "left");

    expect(boxOf(result, "a").left).toBe(100);
    expect(boxOf(result, "b").left).toBe(100);
    expect(boxOf(result, "c").left).toBe(100);
  });

  it("aligns to the rightmost edge", () => {
    const doc = docWith(text("a", 100, 0), text("b", 250, 100));

    const result = alignElements(doc, ["a", "b"], "right");

    expect(boxOf(result, "a").right).toBe(350);
    expect(boxOf(result, "b").right).toBe(350);
  });

  it("does not move elements outside the selection", () => {
    const doc = docWith(text("a", 100, 0), text("b", 250, 100), text("other", 700, 900));

    const result = alignElements(doc, ["a", "b"], "left");

    expect(boxOf(result, "other").left).toBe(700);
  });

  it("centres a single element on the LABEL, since it has nothing else to align to", () => {
    const doc = docWith(text("a", 0, 0, 200, 100));

    const result = alignElements(doc, ["a"], "centreX");

    expect(boxOf(result, "a").centreX).toBeCloseTo(geometry.widthPx / 2, 0);
  });

  it("aligns a single element to the label edge", () => {
    const doc = docWith(text("a", 300, 300));

    expect(boxOf(alignElements(doc, ["a"], "left"), "a").left).toBe(0);
    expect(boxOf(alignElements(doc, ["a"], "bottom"), "a").bottom).toBe(geometry.heightPx);
  });

  it("uses the rotated footprint, not the stored box", () => {
    // 200x50 rotated 90 degrees is visually 50 wide and 200 tall.
    const rotated = { ...text("a", 300, 300, 200, 50), rotation: 90 };
    const doc = docWith(rotated);

    const result = alignElements(doc, ["a"], "left");

    expect(boxOf(result, "a").left).toBeCloseTo(0, 6);
  });

  it("is a no-op for an empty selection", () => {
    const doc = docWith(text("a", 100, 0));

    expect(alignElements(doc, [], "left")).toBe(doc);
  });

  it("preserves element order", () => {
    const doc = docWith(text("a", 100, 0), text("b", 250, 100), text("c", 400, 200));

    expect(ids(alignElements(doc, ["a", "c"], "top"))).toEqual(["a", "b", "c"]);
  });
});

describe("distributeElements", () => {
  it("spaces three elements evenly by centre, leaving the extremes alone", () => {
    const doc = docWith(text("a", 0, 0), text("b", 40, 0), text("c", 400, 0));

    const result = distributeElements(doc, ["a", "b", "c"], "horizontal");

    expect(boxOf(result, "a").centreX).toBe(50);
    expect(boxOf(result, "c").centreX).toBe(450);
    // Midpoint of 50 and 450.
    expect(boxOf(result, "b").centreX).toBe(250);
  });

  it("distributes vertically too", () => {
    const doc = docWith(text("a", 0, 0), text("b", 0, 10), text("c", 0, 400));

    const result = distributeElements(doc, ["a", "b", "c"], "vertical");

    expect(boxOf(result, "b").centreY).toBe(225);
  });

  it("needs at least three elements", () => {
    const doc = docWith(text("a", 0, 0), text("b", 100, 0));

    expect(distributeElements(doc, ["a", "b"], "horizontal")).toBe(doc);
  });

  it("works regardless of the order ids are given in", () => {
    const doc = docWith(text("a", 0, 0), text("b", 40, 0), text("c", 400, 0));

    const forward = distributeElements(doc, ["a", "b", "c"], "horizontal");
    const shuffled = distributeElements(doc, ["c", "a", "b"], "horizontal");

    expect(boxOf(shuffled, "b").centreX).toBe(boxOf(forward, "b").centreX);
  });

  it("does not mutate the input document", () => {
    const doc = docWith(text("a", 0, 0), text("b", 40, 0), text("c", 400, 0));
    const before = JSON.stringify(doc);

    distributeElements(doc, ["a", "b", "c"], "horizontal");

    expect(JSON.stringify(doc)).toBe(before);
  });
});
