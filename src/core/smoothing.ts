/**
 * Freehand path smoothing, shared by the rasterizer and the editor.
 *
 * It lives in core precisely so there is only one implementation. When the
 * editor smoothed with Konva's spline `tension` and the rasterizer used
 * midpoint quadratics, the two drew visibly different curves through the same
 * points -- a WYSIWYG divergence of exactly the kind this project keeps
 * tripping over. Sharing the maths makes them agree by construction.
 *
 * The technique: curve through the MIDPOINT between each pair of consecutive
 * samples, using the sample itself as the control point. Raw pen samples become
 * tangents rather than vertices, which removes the polygonal look without
 * pulling the stroke away from where it was drawn. The final sample is joined
 * with a straight segment so the stroke ends exactly where the pen lifted.
 *
 * Emitted as data rather than drawing calls so both consumers can replay it
 * against their own context type.
 */

export type PathOp =
  | { op: "move"; x: number; y: number }
  | { op: "line"; x: number; y: number }
  | { op: "quad"; cpx: number; cpy: number; x: number; y: number };

/**
 * Build the drawing ops for a stroke through `points` (flat [x, y, x, y, ...]).
 *
 * Returns an empty array for fewer than two points, which is not a stroke.
 * Exactly two points give a straight line, since there is no curvature to
 * infer. Pass `smooth: false` for lines and arrows, which must not bow.
 */
export function buildStrokePath(points: readonly number[], smooth: boolean): PathOp[] {
  if (points.length < 4) return [];

  const at = (i: number): [number, number] => [points[i * 2]!, points[i * 2 + 1]!];
  const count = Math.floor(points.length / 2);

  const [startX, startY] = at(0);
  const ops: PathOp[] = [{ op: "move", x: startX, y: startY }];

  if (!smooth || count === 2) {
    for (let i = 1; i < count; i++) {
      const [x, y] = at(i);
      ops.push({ op: "line", x, y });
    }
    return ops;
  }

  for (let i = 1; i < count - 1; i++) {
    const [cpx, cpy] = at(i);
    const [nextX, nextY] = at(i + 1);
    ops.push({ op: "quad", cpx, cpy, x: (cpx + nextX) / 2, y: (cpy + nextY) / 2 });
  }

  const [lastX, lastY] = at(count - 1);
  ops.push({ op: "line", x: lastX, y: lastY });
  return ops;
}

/** Minimal context shape needed to replay a path. Both Ctx2D and Konva satisfy it. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

export function replayPath(sink: PathSink, ops: readonly PathOp[]): void {
  for (const item of ops) {
    if (item.op === "move") sink.moveTo(item.x, item.y);
    else if (item.op === "line") sink.lineTo(item.x, item.y);
    else sink.quadraticCurveTo(item.cpx, item.cpy, item.x, item.y);
  }
}
