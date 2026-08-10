/**
 * Document validation, migration, and file import/export.
 *
 * Storage itself lives in library.ts. This module owns the one thing every
 * entry point shares: turning untrusted JSON -- from localStorage or from a
 * file the user picked -- into a LabelDocument, or rejecting it.
 *
 * Everything loaded goes through migrate(), so a document written by an older
 * build is upgraded rather than rejected.
 */

import { SCHEMA_VERSION, type LabelDocument } from "../core/document.ts";
import { LABEL_SIZES } from "../core/label.ts";
import { DPI } from "../core/units.ts";

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

export function importJson(text: string): LabelDocument | null {
  try {
    return migrate(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Trigger a browser download of the document as .json. */
export function downloadJson(doc: LabelDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${doc.name.replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
