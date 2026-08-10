import { describe, expect, it } from "vite-plus/test";

import { parseCsv } from "./csv.ts";

function ok(text: string) {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(result.error);
  return result.parsed;
}

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    const parsed = ok("bin,contents\n1,Cables\n2,Adapters\n");
    expect(parsed.headers).toEqual(["bin", "contents"]);
    expect(parsed.rows).toEqual([
      { bin: "1", contents: "Cables" },
      { bin: "2", contents: "Adapters" },
    ]);
  });

  it("handles quoted fields containing the delimiter", () => {
    const parsed = ok('bin,contents\n1,"Cables, adapters, and hubs"\n');
    expect(parsed.rows[0]!.contents).toBe("Cables, adapters, and hubs");
  });

  it("handles embedded newlines and doubled quotes", () => {
    const parsed = ok('a,b\n"line one\nline two","say ""hi"""\n');
    expect(parsed.rows[0]!.a).toBe("line one\nline two");
    expect(parsed.rows[0]!.b).toBe('say "hi"');
  });

  it("strips the BOM Excel writes, which would corrupt the first header", () => {
    const parsed = ok("﻿bin,contents\n1,Cables\n");
    expect(parsed.headers[0]).toBe("bin");
  });

  it("accepts semicolons, as European exports produce", () => {
    const parsed = ok("bin;contents\n1;Cables\n");
    expect(parsed.headers).toEqual(["bin", "contents"]);
    expect(parsed.rows[0]!.contents).toBe("Cables");
  });

  it("accepts tabs", () => {
    const parsed = ok("bin\tcontents\n1\tCables\n");
    expect(parsed.headers).toEqual(["bin", "contents"]);
  });

  it("copes with CRLF", () => {
    const parsed = ok("bin,contents\r\n1,Cables\r\n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.contents).toBe("Cables");
  });

  it("names blank headers rather than failing", () => {
    const parsed = ok("bin,,contents\n1,x,Cables\n");
    expect(parsed.headers).toEqual(["bin", "Column 2", "contents"]);
  });

  it("disambiguates duplicate headers, so a binding names one column", () => {
    const parsed = ok("name,name\na,b\n");
    expect(parsed.headers).toEqual(["name", "name 2"]);
    expect(parsed.rows[0]).toEqual({ name: "a", "name 2": "b" });
  });

  it("pads rows that are short of columns", () => {
    const parsed = ok("a,b,c\n1,2\n");
    expect(parsed.rows[0]).toEqual({ a: "1", b: "2", c: "" });
  });

  it("reports empty input and headers without rows", () => {
    expect(parseCsv("")).toEqual({ ok: false, error: "The file is empty" });
    const headersOnly = parseCsv("a,b\n");
    expect(headersOnly.ok).toBe(false);
  });
});
