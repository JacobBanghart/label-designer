/**
 * CSV parsing.
 *
 * CSV specifically, and not spreadsheets. Every real .xlsx carries merged
 * cells, formulas, multiple sheets, dates in half a dozen encodings and styling
 * that means something to its author -- supporting it well is a project, and
 * supporting it badly silently mangles data. Everything that can export a
 * spreadsheet can export a CSV, so the boundary is drawn here on purpose.
 *
 * Handles the parts of RFC 4180 that occur in practice: quoted fields, embedded
 * commas and newlines, doubled quotes, and CRLF. It deliberately does not try
 * to sniff the delimiter -- see `parseDelimited` for that decision.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Split into rows of raw cells. */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM, which Excel writes and which otherwise becomes part of
  // the first header name and breaks every binding to it.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Ignore the trailing newline at end of file rather than emitting a blank row.
    if (row.length > 1 || row[0] !== "") records.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) endRow();
  return records;
}

/**
 * Guess the delimiter from the header line.
 *
 * Only a guess between comma, semicolon and tab: those are what spreadsheet
 * exports actually produce, and a European locale exporting semicolons is
 * common enough that failing on it would look like a bug. Anything more clever
 * than counting is how delimiter sniffing starts corrupting data.
 */
function guessDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  const best = counts.reduce((a, b) => (b.n > a.n ? b : a));
  return best.n > 0 ? best.d : ",";
}

export interface CsvProblem {
  message: string;
}

export type CsvResult = { ok: true; parsed: ParsedCsv } | { ok: false; error: string };

/**
 * Parse `text` into headers and row objects.
 *
 * Duplicate and blank headers are resolved rather than rejected: real exports
 * contain both, and a hard failure at import is a worse outcome than a column
 * called "Column 3".
 */
export function parseCsv(text: string): CsvResult {
  if (text.trim() === "") return { ok: false, error: "The file is empty" };

  const records = splitRecords(text, guessDelimiter(text));
  if (records.length === 0) return { ok: false, error: "No rows found" };

  const rawHeaders = records[0]!;
  const headers: string[] = [];
  for (const [index, raw] of rawHeaders.entries()) {
    let name = raw.trim();
    if (name === "") name = `Column ${index + 1}`;
    // Disambiguate duplicates, so a binding always names exactly one column.
    if (headers.includes(name)) {
      let n = 2;
      while (headers.includes(`${name} ${n}`)) n++;
      name = `${name} ${n}`;
    }
    headers.push(name);
  }

  const rows = records.slice(1).map((record) => {
    const row: Record<string, string> = {};
    headers.forEach((name, index) => {
      row[name] = (record[index] ?? "").trim();
    });
    return row;
  });

  if (rows.length === 0) return { ok: false, error: "The file has headers but no rows" };
  return { ok: true, parsed: { headers, rows } };
}
