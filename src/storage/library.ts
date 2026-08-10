/**
 * A library of saved labels.
 *
 * The app used to hold exactly one document. The real workflow is "open the
 * order label, change the order number, print", which needs named labels you
 * can come back to.
 *
 * Still localStorage: designs are small JSON. IndexedDB becomes worth it when
 * elements can carry embedded images.
 */

import type { LabelDocument } from "../core/document.ts";
import { migrate } from "./local.ts";

const LIBRARY_KEY = "label-designer:library";
const ACTIVE_KEY = "label-designer:active";
/** The pre-library single-document key. Imported once, then left alone. */
const LEGACY_KEY = "label-designer:current";
/**
 * Marks the legacy import as done.
 *
 * Without this the import would be keyed on "the library is empty", which means
 * deleting every label resurrects the old document from the dead. A separate
 * marker makes the import genuinely one-time.
 */
const LEGACY_IMPORTED_KEY = "label-designer:legacy-imported";

export interface LibraryEntry {
  doc: LabelDocument;
  /** Epoch millis of the last save. Shown, but no longer used for ordering. */
  updatedAt: number;
  /**
   * Manual position in the list.
   *
   * Sorting by updatedAt made the list reshuffle on every autosave: the label
   * you were editing jumped to the top, so flipping between two labels moved
   * the target out from under the cursor. Order is now explicit and stable.
   */
  order: number;
}

export type Library = Record<string, LibraryEntry>;

function readRaw(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Write, reporting whether it worked.
 *
 * Failures used to be swallowed entirely. That was tolerable when a design was
 * a few kilobytes of JSON, but images are data URIs and a label carrying a
 * couple of photos can exhaust the ~5MB quota. Silently not saving is the worst
 * possible behaviour there, so callers surface it.
 */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class StorageFullError extends Error {
  constructor() {
    super("Browser storage is full. Delete a label or remove an image, then try again.");
    this.name = "StorageFullError";
  }
}

/**
 * Parse the stored library, dropping any entry that fails validation.
 *
 * One corrupt document must not make the whole library unreadable; that would
 * turn a small bug into total data loss.
 */
export function parseLibrary(raw: unknown): Library {
  if (typeof raw !== "object" || raw === null) return {};

  const library: Library = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Partial<LibraryEntry>;
    const doc = migrate(entry.doc);
    if (!doc) continue;
    library[id] = {
      doc,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
      order: typeof entry.order === "number" ? entry.order : Number.MAX_SAFE_INTEGER,
    };
  }
  return library;
}

export function loadLibrary(): Library {
  const library = parseLibrary(readRaw(LIBRARY_KEY));

  // One-time import of a pre-library document, so upgrading does not look like
  // the user's work vanished. Guarded by a marker rather than by emptiness --
  // see LEGACY_IMPORTED_KEY.
  if (readRaw(LEGACY_IMPORTED_KEY) !== true) {
    write(LEGACY_IMPORTED_KEY, true);
    const legacy = migrate(readRaw(LEGACY_KEY));
    if (legacy && !library[legacy.id]) {
      library[legacy.id] = { doc: legacy, updatedAt: Date.now(), order: nextOrder(library) };
      write(LIBRARY_KEY, library);
      write(ACTIVE_KEY, legacy.id);
    }
  }

  return library;
}

/** Throws StorageFullError if the write did not land. */
export function saveToLibrary(doc: LabelDocument): void {
  const library = loadLibrary();
  // Keep an existing position; a new label goes to the end.
  const existing = library[doc.id];
  const order = existing?.order ?? nextOrder(library);
  library[doc.id] = { doc, updatedAt: Date.now(), order };

  if (!write(LIBRARY_KEY, library)) throw new StorageFullError();
  write(ACTIVE_KEY, doc.id);
}

export function removeFromLibrary(id: string): Library {
  const library = loadLibrary();
  delete library[id];
  write(LIBRARY_KEY, library);

  if (readRaw(ACTIVE_KEY) === id) {
    const next = sortedEntries(library)[0];
    if (next) write(ACTIVE_KEY, next.doc.id);
    else localStorage.removeItem(ACTIVE_KEY);
  }

  return library;
}

export function setActiveId(id: string): void {
  write(ACTIVE_KEY, id);
}

/** The document to open on load, or null for a fresh start. */
export function loadActive(): LabelDocument | null {
  const library = loadLibrary();
  const activeId = readRaw(ACTIVE_KEY);

  if (typeof activeId === "string" && library[activeId]) return library[activeId].doc;

  // Active id missing or stale: fall back to the most recently saved label
  // rather than silently starting blank on top of existing work.
  return sortedEntries(library)[0]?.doc ?? null;
}

function nextOrder(library: Library): number {
  const orders = Object.values(library)
    .map((e) => e.order)
    .filter((n) => Number.isFinite(n) && n < Number.MAX_SAFE_INTEGER);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

/**
 * Library entries in display order.
 *
 * Explicit `order` wins so drag-to-reorder sticks. Entries that have never been
 * ordered fall back to a natural-ish name comparison, which keeps "Untitled
 * label 2" before "Untitled label 10" instead of after it.
 */
export function sortedEntries(library: Library): LibraryEntry[] {
  return Object.values(library).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.doc.name.localeCompare(b.doc.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Persist a new manual ordering, given ids in the desired order. */
export function reorderLibrary(ids: readonly string[]): Library {
  const library = loadLibrary();
  ids.forEach((id, index) => {
    const entry = library[id];
    if (entry) library[id] = { ...entry, order: index };
  });
  write(LIBRARY_KEY, library);
  return library;
}

/**
 * A unique "Untitled label N" for a new document.
 *
 * Numbering rather than repeating "Untitled label" so the list is navigable and
 * the alphabetical fallback is deterministic.
 */
export function nextUntitledName(library: Library): string {
  const used = new Set(Object.values(library).map((e) => e.doc.name));
  for (let n = 1; ; n++) {
    const candidate = `Untitled label ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
