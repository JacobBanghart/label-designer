/**
 * Merge datasets, persisted per label.
 *
 * Kept alongside the label rather than inside it, keyed by document id. Two
 * reasons:
 *
 *   1. A dataset can be thousands of rows. Undo/redo snapshots the whole
 *      document on every edit, so folding the data in would make every
 *      keystroke copy the entire CSV.
 *   2. The design and the data have different lifetimes. Exporting a label to
 *      share it should not ship whatever inventory list happened to be loaded.
 *
 * It does persist, though, so reopening a label a week later still knows how to
 * reprint the batch.
 */

import { EMPTY_DATASET, type Dataset } from "../core/merge.ts";

const KEY_PREFIX = "label-designer:dataset:";

function key(docId: string): string {
  return `${KEY_PREFIX}${docId}`;
}

function isDataset(value: unknown): value is Dataset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Dataset>;
  return (
    Array.isArray(candidate.names) &&
    candidate.names.every((n) => typeof n === "string") &&
    Array.isArray(candidate.records)
  );
}

export function loadDataset(docId: string): Dataset {
  try {
    const raw = localStorage.getItem(key(docId));
    if (!raw) return EMPTY_DATASET;
    const parsed: unknown = JSON.parse(raw);
    return isDataset(parsed) ? parsed : EMPTY_DATASET;
  } catch {
    // A corrupt or unreadable entry must not stop the editor loading. The data
    // is re-importable; the design is not.
    return EMPTY_DATASET;
  }
}

export function saveDataset(docId: string, dataset: Dataset): void {
  try {
    if (dataset.names.length === 0 && dataset.records.length === 0) {
      localStorage.removeItem(key(docId));
      return;
    }
    localStorage.setItem(key(docId), JSON.stringify(dataset));
  } catch {
    // Quota exceeded on a large CSV. The dataset stays usable in memory for
    // this session; only persistence is lost.
  }
}

export function removeDataset(docId: string): void {
  try {
    localStorage.removeItem(key(docId));
  } catch {
    /* nothing meaningful to do */
  }
}
