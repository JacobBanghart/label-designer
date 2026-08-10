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
  /** Epoch millis of the last save, for ordering the list. */
  updatedAt: number;
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

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-mode failure. Losing a save is not worth breaking the
    // editor over -- the user can still export to a file.
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
      library[legacy.id] = { doc: legacy, updatedAt: Date.now() };
      write(LIBRARY_KEY, library);
      write(ACTIVE_KEY, legacy.id);
    }
  }

  return library;
}

export function saveToLibrary(doc: LabelDocument): void {
  const library = loadLibrary();
  library[doc.id] = { doc, updatedAt: Date.now() };
  write(LIBRARY_KEY, library);
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

/** Library entries, most recently updated first. */
export function sortedEntries(library: Library): LibraryEntry[] {
  return Object.values(library).sort((a, b) => b.updatedAt - a.updatedAt);
}
