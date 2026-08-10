import { describe, expect, it } from "vite-plus/test";

import { buildStrokePath, replayPath, type PathOp } from "./smoothing.ts";

/** Records calls so a path can be asserted without a canvas. */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    moveTo: (x: number, y: number) => void calls.push(`M ${x} ${y}`),
    lineTo: (x: number, y: number) => void calls.push(`L ${x} ${y}`),
    quadraticCurveTo: (a: number, b: number, x: number, y: number) =>
      void calls.push(`Q ${a} ${b} ${x} ${y}`),
  };
}

describe("buildStrokePath", () => {
  it("returns nothing for a degenerate path", () => {
    expect(buildStrokePath([], true)).toEqual([]);
    expect(buildStrokePath([1, 2], true)).toEqual([]);
  });

  it("draws two points as a straight line even when smoothing", () => {
    // There is no curvature to infer from two samples.
    expect(buildStrokePath([0, 0, 10, 10], true)).toEqual([
      { op: "move", x: 0, y: 0 },
      { op: "line", x: 10, y: 10 },
    ]);
  });

  it("draws unsmoothed paths as straight segments", () => {
    const ops = buildStrokePath([0, 0, 10, 0, 20, 10], false);

    expect(ops.every((o) => o.op !== "quad")).toBe(true);
    expect(ops).toHaveLength(3);
  });

  it("curves through midpoints, using each sample as a control point", () => {
    const ops = buildStrokePath([0, 0, 10, 0, 20, 0], true);

    expect(ops[0]).toEqual({ op: "move", x: 0, y: 0 });
    // Control is the middle sample; the curve ends midway to the next one.
    expect(ops[1]).toEqual({ op: "quad", cpx: 10, cpy: 0, x: 15, y: 0 });
  });

  it("ends exactly on the final sample, where the pen lifted", () => {
    const ops = buildStrokePath([0, 0, 10, 5, 20, 0, 30, 8], true);
    const last = ops[ops.length - 1]!;

    expect(last).toEqual({ op: "line", x: 30, y: 8 });
  });

  it("starts exactly on the first sample", () => {
    const ops = buildStrokePath([3, 7, 10, 5, 20, 0], true);

    expect(ops[0]).toEqual({ op: "move", x: 3, y: 7 });
  });

  it("ignores a trailing unpaired coordinate rather than reading undefined", () => {
    const ops = buildStrokePath([0, 0, 10, 10, 99], true);

    expect(ops.every((o) => Number.isFinite(o.x) && Number.isFinite(o.y))).toBe(true);
  });
});

describe("replayPath", () => {
  it("replays ops onto a sink in order", () => {
    const sink = recorder();
    const ops: PathOp[] = [
      { op: "move", x: 1, y: 2 },
      { op: "quad", cpx: 3, cpy: 4, x: 5, y: 6 },
      { op: "line", x: 7, y: 8 },
    ];

    replayPath(sink, ops);

    expect(sink.calls).toEqual(["M 1 2", "Q 3 4 5 6", "L 7 8"]);
  });
});
