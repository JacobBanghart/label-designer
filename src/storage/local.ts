/**
 * Persistence.
 *
 * localStorage is deliberate for the MVP: designs are small JSON and there are
 * no images yet. IndexedDB becomes worth it when elements can carry bitmaps.
 *
 * Everything loaded goes through migrate(), so a document written by an older
 * build is upgraded rather than rejected. This exists from day one because real
 * designs will be saved before the schema settles.
 */

import { SCHEMA_VERSION, type LabelDocument } from "../core/document.ts";
import { LABEL_SIZES } from "../core/label.ts";
import { DPI } from "../core/units.ts";

const STORAGE_KEY = "label-designer:current";

export function migrate(raw: unknown): LabelDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const doc = raw as Partial<LabelDocument>;

  if (typeof doc.id !== "string" || !Array.isArray(doc.elements)) return null;

  // Reject sizes this build does not know about rather than rendering a label
  // at the wrong physical dimensions.
  const sizeId = LABEL_SIZES.some((s) => s.id === doc.sizeId) ? doc.sizeId! : "4x6";
  const orientation = doc.orientation === "landscape" ? "landscape" : "portrait";

  const version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (version > SCHEMA_VERSION) return null; // written by a newer build

  // v0 -> v1 was the introduction of schemaVersion itself; no field changes.
  return {
    schemaVersion: SCHEMA_VERSION,
    id: doc.id,
    name: typeof doc.name === "string" ? doc.name : "Untitled label",
    sizeId,
    orientation,
    dpi: typeof doc.dpi === "number" && doc.dpi > 0 ? doc.dpi : DPI,
    elements: doc.elements,
  };
}

export function save(doc: LabelDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Quota or private-mode failure. Losing autosave is not worth breaking the
    // editor over; the user can still export.
  }
}

export function load(): LabelDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function exportJson(doc: LabelDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function importJson(text: string): LabelDocument | null {
  try {
    return migrate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Trigger a browser download of the document as .json. */
export function downloadJson(doc: LabelDocument): void {
  const blob = new Blob([exportJson(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${doc.name.replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
