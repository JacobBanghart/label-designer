/**
 * Variables and mail merge.
 *
 * Two jobs in one panel, because they are two halves of one idea:
 *
 *   1. define the variables -- by hand, or from a CSV's column headings
 *   2. step through the records, seeing the actual label each one produces
 *
 * Manual variables exist so this is useful with no file at all: naming a couple
 * of fields and typing values per label is the common case for a handful of
 * storage bins or a few game boxes. A CSV is the same feature with the typing
 * done elsewhere.
 *
 * Problems are surfaced per record and counted across the whole dataset,
 * because the point of holding every row is to find the bad one BEFORE the roll
 * has been printed.
 */

import { useRef, useState } from "react";

import type { LabelDocument } from "../core/document.ts";
import {
  boundNames,
  missingNames,
  validateDataset,
  type Dataset,
  type MergeRecord,
} from "../core/merge.ts";
import { parseCsv } from "../editor/csv.ts";

interface Props {
  doc: LabelDocument;
  dataset: Dataset;
  onDatasetChange: (dataset: Dataset) => void;
  /** Index of the record being previewed. */
  recordIndex: number;
  onRecordIndexChange: (index: number) => void;
}

export function MergePanel({
  doc,
  dataset,
  onDatasetChange,
  recordIndex,
  onRecordIndexChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bound = boundNames(doc);
  const missing = missingNames(doc, dataset);
  const problems = validateDataset(doc, dataset);
  const problemRows = new Set(problems.map((p) => p.row));
  const current = dataset.records[recordIndex];

  function importCsv(file: File) {
    setError(null);
    file
      .text()
      .then((text) => {
        const result = parseCsv(text);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDatasetChange({ names: result.parsed.headers, records: result.parsed.rows });
        onRecordIndexChange(0);
      })
      .catch(() => setError("Could not read that file"));
  }

  function addVariable() {
    const name = newName.trim();
    if (name === "" || dataset.names.includes(name)) return;
    // A manual variable needs a row to hold its value, so seed one if the
    // dataset is empty. Without this, typing a name produces a variable that
    // can be bound but never given a value.
    const records = dataset.records.length > 0 ? dataset.records : [{}];
    onDatasetChange({
      names: [...dataset.names, name],
      records: records.map((record) => ({ ...record, [name]: record[name] ?? "" })),
    });
    setNewName("");
  }

  function removeVariable(name: string) {
    onDatasetChange({
      names: dataset.names.filter((n) => n !== name),
      records: dataset.records.map((record) => {
        const next = { ...record };
        delete next[name];
        return next;
      }),
    });
  }

  function setValue(name: string, value: string) {
    onDatasetChange({
      ...dataset,
      records: dataset.records.map((record, i) =>
        i === recordIndex ? { ...record, [name]: value } : record,
      ),
    });
  }

  function addRecord() {
    const blank: MergeRecord = Object.fromEntries(dataset.names.map((n) => [n, ""]));
    onDatasetChange({ ...dataset, records: [...dataset.records, blank] });
    onRecordIndexChange(dataset.records.length);
  }

  return (
    <div className="merge-panel">
      <h2>Variables</h2>

      <div className="field-row">
        <button type="button" onClick={() => fileRef.current?.click()}>
          Import CSV
        </button>
        {dataset.names.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onDatasetChange({ names: [], records: [] });
              onRecordIndexChange(0);
            }}
          >
            Clear
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importCsv(file);
            event.target.value = "";
          }}
        />
      </div>

      {error && <p className="warning">{error}</p>}

      <div className="field-row">
        <input
          type="text"
          placeholder="New variable name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addVariable();
            }
          }}
        />
        <button type="button" onClick={addVariable} disabled={newName.trim() === ""}>
          Add
        </button>
      </div>

      {dataset.names.length === 0 ? (
        <p className="hint">
          Add a variable, or import a CSV to use its column headings. Then set any text or barcode
          to read from it.
        </p>
      ) : (
        <ul className="variable-list">
          {dataset.names.map((name) => (
            <li key={name}>
              <code>{name}</code>
              {bound.includes(name) ? (
                <span className="badge">in use</span>
              ) : (
                <span className="badge muted">unused</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${name}`}
                onClick={() => removeVariable(name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="warning">
          Bound but not in the data: {missing.join(", ")}. Those elements keep their own value.
        </p>
      )}

      {dataset.records.length > 0 && (
        <>
          <h2>Mail merge</h2>

          <div className="record-stepper">
            <button
              type="button"
              onClick={() => onRecordIndexChange(Math.max(0, recordIndex - 1))}
              disabled={recordIndex === 0}
              aria-label="Previous record"
            >
              ‹
            </button>
            <span>
              {recordIndex + 1} of {dataset.records.length}
            </span>
            <button
              type="button"
              onClick={() =>
                onRecordIndexChange(Math.min(dataset.records.length - 1, recordIndex + 1))
              }
              disabled={recordIndex >= dataset.records.length - 1}
              aria-label="Next record"
            >
              ›
            </button>
            <button type="button" onClick={addRecord}>
              Add row
            </button>
          </div>

          {current && (
            <div className="record-fields">
              {dataset.names.map((name) => (
                <label className="field" key={name}>
                  <span>{name}</span>
                  <input
                    type="text"
                    value={current[name] ?? ""}
                    onChange={(event) => setValue(name, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}

          {problems.length > 0 && (
            <div className="warning">
              <strong>
                {problemRows.size} of {dataset.records.length} records will not print.
              </strong>
              <ul>
                {problems.slice(0, 5).map((problem, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => onRecordIndexChange(problem.row)}>
                      Row {problem.row + 1}
                    </button>
                    : {problem.message}
                  </li>
                ))}
              </ul>
              {problems.length > 5 && <p>…and {problems.length - 5} more.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
