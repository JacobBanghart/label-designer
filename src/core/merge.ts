/**
 * Mail merge: variables, records, and resolving a document against one.
 *
 * Lives in core because every consumer must agree on what a bound element
 * renders as -- the on-screen preview, the 1-bit preview, the rasterizer, and
 * the batch printer. Resolving in one place means the record you previewed is
 * definitionally the label that prints.
 *
 * A dataset is deliberately just names and rows of strings. Types, formats and
 * validation belong to whatever system exported the CSV; this app prints
 * labels. The one exception is barcodes, which are validated per record because
 * an unscannable barcode is indistinguishable from a good one until someone
 * tries to use it.
 */

import { isBarcodeElement, isTextElement, type Element, type LabelDocument } from "./document.ts";
import { validateBarcode } from "./barcode/index.ts";

/** One row of merge data. Keys are variable names. */
export type MergeRecord = Readonly<Record<string, string>>;

export interface Dataset {
  /** Variable names, in the order they should be offered to the user. */
  names: readonly string[];
  records: readonly MergeRecord[];
}

export const EMPTY_DATASET: Dataset = { names: [], records: [] };

/**
 * Variable names are matched case-insensitively and ignoring surrounding
 * whitespace, because CSV headers exported from real systems are inconsistent
 * about both and a silent non-match renders an empty label.
 */
function normaliseKey(name: string): string {
  return name.trim().toLowerCase();
}

export function lookup(record: MergeRecord, name: string): string | undefined {
  const direct = record[name];
  if (direct !== undefined) return direct;
  const want = normaliseKey(name);
  for (const [key, value] of Object.entries(record)) {
    if (normaliseKey(key) === want) return value;
  }
  return undefined;
}

/** Every variable name referenced by an element binding, in document order. */
export function boundNames(doc: LabelDocument): string[] {
  const names: string[] = [];
  for (const el of doc.elements) {
    const binding = (isTextElement(el) || isBarcodeElement(el)) && el.binding;
    if (binding && !names.includes(binding)) names.push(binding);
  }
  return names;
}

function resolveElement(el: Element, record: MergeRecord): Element {
  if (isTextElement(el) && el.binding) {
    const value = lookup(record, el.binding);
    return value === undefined ? el : { ...el, text: value };
  }
  if (isBarcodeElement(el) && el.binding) {
    const value = lookup(record, el.binding);
    return value === undefined ? el : { ...el, value };
  }
  return el;
}

/**
 * A copy of `doc` with every bound element filled in from `record`.
 *
 * A variable the record does not carry leaves the element's own value in place
 * rather than blanking it. That keeps a partially-matched CSV printing
 * something recognisable, and makes the mismatch visible in the preview instead
 * of producing a page of blank labels.
 */
export function resolveDocument(doc: LabelDocument, record: MergeRecord): LabelDocument {
  if (doc.elements.every((el) => !((isTextElement(el) || isBarcodeElement(el)) && el.binding))) {
    return doc;
  }
  return { ...doc, elements: doc.elements.map((el) => resolveElement(el, record)) };
}

/* --------------------------------------------------------------------------
 * Pre-flight validation
 * -------------------------------------------------------------------------- */

export interface RecordProblem {
  /** Index into the dataset's records. */
  row: number;
  elementId: string;
  message: string;
}

/**
 * Check every record against every barcode before printing any of them.
 *
 * This is the payoff for holding the whole dataset: a value that cannot be
 * encoded, or that needs more modules than its box has pixels, is found at
 * design time rather than after fifty labels have already been printed.
 */
export function validateDataset(doc: LabelDocument, dataset: Dataset): RecordProblem[] {
  const barcodes = doc.elements.filter(isBarcodeElement);
  if (barcodes.length === 0) return [];

  const problems: RecordProblem[] = [];
  dataset.records.forEach((record, row) => {
    for (const el of barcodes) {
      const value = el.binding ? (lookup(record, el.binding) ?? el.value) : el.value;
      const error = validateBarcode({ symbology: el.symbology, value, ecc: el.ecc });
      if (error) problems.push({ row, elementId: el.id, message: error });
    }
  });
  return problems;
}

/** Missing variables, i.e. names bound in the design but absent from the data. */
export function missingNames(doc: LabelDocument, dataset: Dataset): string[] {
  const have = new Set(dataset.names.map(normaliseKey));
  return boundNames(doc).filter((name) => !have.has(normaliseKey(name)));
}
