import { beforeEach, describe, expect, it } from "vite-plus/test";

import { SCHEMA_VERSION, type LabelDocument } from "../core/document.ts";
import { DPI } from "../core/units.ts";
import {
  loadActive,
  loadLibrary,
  parseLibrary,
  removeFromLibrary,
  saveToLibrary,
  setActiveId,
  sortedEntries,
} from "./library.ts";

/** Minimal in-memory localStorage; these tests run in the node environment. */
function installStorage() {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  };
  globalThis.localStorage = mock;
  return store;
}

function doc(id: string, name = id): LabelDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    sizeId: "4x6",
    orientation: "portrait",
    dpi: DPI,
    elements: [],
  };
}

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe("saveToLibrary", () => {
  it("stores a document and makes it active", () => {
    saveToLibrary(doc("a"));

    expect(Object.keys(loadLibrary())).toEqual(["a"]);
    expect(loadActive()?.id).toBe("a");
  });

  it("keeps several documents side by side", () => {
    saveToLibrary(doc("a"));
    saveToLibrary(doc("b"));

    expect(Object.keys(loadLibrary()).sort()).toEqual(["a", "b"]);
  });

  it("overwrites in place rather than duplicating", () => {
    saveToLibrary(doc("a", "first"));
    saveToLibrary(doc("a", "renamed"));

    const library = loadLibrary();
    expect(Object.keys(library)).toEqual(["a"]);
    expect(library.a!.doc.name).toBe("renamed");
  });
});

describe("legacy import", () => {
  it("adopts a pre-library document so upgrading does not look like data loss", () => {
    store.set("label-designer:current", JSON.stringify(doc("old", "Old label")));

    const library = loadLibrary();

    expect(Object.keys(library)).toEqual(["old"]);
    expect(loadActive()?.name).toBe("Old label");
  });

  it("keeps the legacy document alongside newly created ones", () => {
    store.set("label-designer:current", JSON.stringify(doc("old")));
    saveToLibrary(doc("a"));

    // Creating a new label must not discard the pre-upgrade one.
    expect(Object.keys(loadLibrary()).sort()).toEqual(["a", "old"]);
  });

  it("never resurrects the legacy document after it is deleted", () => {
    store.set("label-designer:current", JSON.stringify(doc("old")));
    loadLibrary(); // performs the import

    removeFromLibrary("old");

    // The legacy key is still in storage; deleting everything must not bring
    // it back from the dead on the next load.
    expect(Object.keys(loadLibrary())).toEqual([]);
    expect(loadActive()).toBeNull();
  });
});

describe("removeFromLibrary", () => {
  it("deletes the entry", () => {
    saveToLibrary(doc("a"));
    saveToLibrary(doc("b"));

    removeFromLibrary("a");

    expect(Object.keys(loadLibrary())).toEqual(["b"]);
  });

  it("moves the active document on when the active one is deleted", () => {
    saveToLibrary(doc("a"));
    saveToLibrary(doc("b"));
    setActiveId("b");

    removeFromLibrary("b");

    expect(loadActive()?.id).toBe("a");
  });

  it("leaves nothing active when the last label goes", () => {
    saveToLibrary(doc("a"));

    removeFromLibrary("a");

    expect(loadActive()).toBeNull();
  });
});

describe("loadActive", () => {
  it("falls back to the newest label when the active id is stale", () => {
    saveToLibrary(doc("a"));
    saveToLibrary(doc("b"));
    // Point at something that no longer exists.
    store.set("label-designer:active", JSON.stringify("ghost"));

    // Must not start blank on top of existing work.
    expect(loadActive()).not.toBeNull();
  });

  it("returns null for an empty library", () => {
    expect(loadActive()).toBeNull();
  });
});

describe("parseLibrary", () => {
  it("drops corrupt entries instead of failing the whole library", () => {
    const library = parseLibrary({
      good: { doc: doc("good"), updatedAt: 1, order: 0 },
      bad: { doc: { nonsense: true }, updatedAt: 2, order: 1 },
      alsoBad: "not an object",
    });

    expect(Object.keys(library)).toEqual(["good"]);
  });

  it("survives a non-object payload", () => {
    expect(parseLibrary(null)).toEqual({});
    expect(parseLibrary("garbage")).toEqual({});
  });
});

describe("sortedEntries", () => {
  it("orders by explicit position, not recency", () => {
    const library = {
      a: { doc: doc("a"), updatedAt: 100, order: 2 },
      b: { doc: doc("b"), updatedAt: 300, order: 0 },
      c: { doc: doc("c"), updatedAt: 200, order: 1 },
    };

    expect(sortedEntries(library).map((entry) => entry.doc.id)).toEqual(["b", "c", "a"]);
  });
});

describe("order backfill", () => {
  it("gives pre-ordering entries stable positions on first read", () => {
    // Entries written before ordering existed have no `order` at all.
    store.set(
      "label-designer:library",
      JSON.stringify({
        b: { doc: doc("b", "Beta"), updatedAt: 1 },
        a: { doc: doc("a", "Alpha"), updatedAt: 2 },
      }),
    );

    const library = loadLibrary();

    // Deterministic, by name, not by object key order.
    expect(library.a!.order).toBe(0);
    expect(library.b!.order).toBe(1);
  });

  it("persists the backfill so the order does not shift on the next read", () => {
    store.set(
      "label-designer:library",
      JSON.stringify({
        z: { doc: doc("z", "Zulu"), updatedAt: 1 },
        m: { doc: doc("m", "Mike"), updatedAt: 2 },
      }),
    );

    const first = sortedEntries(loadLibrary()).map((e) => e.doc.id);
    // Renaming would change a name-based sort but must not move a backfilled one.
    saveToLibrary({ ...doc("m", "Alpha") });
    const second = sortedEntries(loadLibrary()).map((e) => e.doc.id);

    expect(second).toEqual(first);
  });

  it("keeps positions that already exist", () => {
    store.set(
      "label-designer:library",
      JSON.stringify({
        first: { doc: doc("first"), updatedAt: 1, order: 0 },
        legacy: { doc: doc("legacy"), updatedAt: 1 },
      }),
    );

    const library = loadLibrary();

    expect(library.first!.order).toBe(0);
    // Appended after, not interleaved.
    expect(library.legacy!.order).toBe(1);
  });
});
