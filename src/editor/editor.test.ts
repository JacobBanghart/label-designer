import { describe, expect, it } from "vite-plus/test";

import { SCHEMA_VERSION, type TextElement } from "../core/document.ts";
import { resolveGeometry } from "../core/label.ts";
import { amend, canRedo, canUndo, createHistory, push, redo, undo } from "./history.ts";
import {
  addElement,
  createDocument,
  createTextElement,
  removeElement,
  reorderElement,
  setLabelSize,
  setOrientation,
  updateElement,
} from "./operations.ts";

describe("history", () => {
  it("undoes and redoes through a linear sequence", () => {
    let h = createHistory("a");
    h = push(h, "b");
    h = push(h, "c");

    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe("b");
    expect(canRedo(h)).toBe(true);
  });

  it("clears the redo stack once a new change is made", () => {
    let h = push(push(createHistory("a"), "b"), "c");
    h = undo(h);
    expect(canRedo(h)).toBe(true);

    h = push(h, "d");
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe("d");
  });

  it("amend replaces the present without adding an undo step", () => {
    let h = push(createHistory("a"), "b");
    const depth = h.past.length;

    h = amend(h, "b-dragging");
    expect(h.present).toBe("b-dragging");
    expect(h.past.length).toBe(depth);

    // One undo returns past the whole gesture, not to a mid-drag frame.
    h = undo(h);
    expect(h.present).toBe("a");
  });

  it("ignores a push of the identical state", () => {
    const h = createHistory("a");
    expect(push(h, "a")).toBe(h);
  });
});

describe("operations", () => {
  it("never mutates the input document", () => {
    const doc = createDocument();
    const frozen = JSON.stringify(doc);
    const el = createTextElement(doc);

    addElement(doc, el);
    updateElement(doc, el.id, { x: 5 });
    removeElement(doc, el.id);
    setOrientation(doc, "landscape");

    expect(JSON.stringify(doc)).toBe(frozen);
  });

  it("stamps the current schema version on new documents", () => {
    expect(createDocument().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("places a new text element inside the label bounds", () => {
    const doc = createDocument("4x6", "portrait");
    const geometry = resolveGeometry("4x6", "portrait");
    const el = createTextElement(doc);

    expect(el.x).toBeGreaterThanOrEqual(0);
    expect(el.y).toBeGreaterThanOrEqual(0);
    expect(el.x + el.widthPx).toBeLessThanOrEqual(geometry.widthPx);
    expect(el.y + el.heightPx).toBeLessThanOrEqual(geometry.heightPx);
  });

  it("reorders elements within bounds and no-ops at the edges", () => {
    const doc = createDocument();
    const a = createTextElement(doc, "a");
    const b = createTextElement(doc, "b");
    const withBoth = addElement(addElement(doc, a), b);

    expect(reorderElement(withBoth, a.id, "forward").elements.map((e) => e.id)).toEqual([
      b.id,
      a.id,
    ]);
    // a is already at the back; moving it further back changes nothing.
    expect(reorderElement(withBoth, a.id, "backward").elements.map((e) => e.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  describe("setOrientation", () => {
    it("keeps elements inside the rotated bounds", () => {
      const doc = createDocument("4x6", "portrait");
      const el = createTextElement(doc);
      const rotated = setOrientation(addElement(doc, el), "landscape");
      const geometry = resolveGeometry("4x6", "landscape");

      const moved = rotated.elements[0]!;
      expect(moved.x).toBeGreaterThanOrEqual(0);
      expect(moved.y).toBeGreaterThanOrEqual(0);
      expect(moved.x + moved.widthPx).toBeLessThanOrEqual(geometry.widthPx);
      expect(moved.y + moved.heightPx).toBeLessThanOrEqual(geometry.heightPx);
    });

    it("swaps element dimensions and advances rotation by 90 degrees", () => {
      const doc = createDocument("4x6", "portrait");
      const el = { ...createTextElement(doc), rotation: 0 };
      const rotated = setOrientation(addElement(doc, el), "landscape");

      const moved = rotated.elements[0]!;
      expect(moved.widthPx).toBe(el.heightPx);
      expect(moved.heightPx).toBe(el.widthPx);
      expect(moved.rotation).toBe(90);
    });

    it("returns to the original layout after four rotations", () => {
      const doc = createDocument("4x6", "portrait");
      const el = createTextElement(doc);
      const start = addElement(doc, el);

      // portrait -> landscape -> portrait is two rotations; do it twice.
      let current = start;
      for (let i = 0; i < 4; i++) {
        current = setOrientation(
          current,
          current.orientation === "portrait" ? "landscape" : "portrait",
        );
      }

      expect(current.orientation).toBe("portrait");
      expect(current.elements[0]).toEqual(start.elements[0]);
    });

    it("is a no-op when the orientation already matches", () => {
      const doc = createDocument("4x6", "portrait");
      expect(setOrientation(doc, "portrait")).toBe(doc);
    });
  });

  describe("setLabelSize", () => {
    it("rescales elements so they stay within the new label", () => {
      const doc = createDocument("4x6", "portrait");
      const el = createTextElement(doc);
      const resized = setLabelSize(addElement(doc, el), "2x1");
      const geometry = resolveGeometry("2x1", "portrait");

      const moved = resized.elements[0]!;
      expect(moved.x + moved.widthPx).toBeLessThanOrEqual(geometry.widthPx);
      expect(moved.y + moved.heightPx).toBeLessThanOrEqual(geometry.heightPx);
    });

    it("scales font size uniformly and never below the legibility floor", () => {
      const doc = createDocument("4x6", "portrait");
      const el = createTextElement(doc);
      const resized = setLabelSize(addElement(doc, el), "2x1");

      const moved = resized.elements[0] as TextElement;
      expect(moved.fontSizePx).toBeGreaterThanOrEqual(8);
      expect(moved.fontSizePx).toBeLessThan(el.fontSizePx);
    });
  });
});
