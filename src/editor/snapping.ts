/**
 * Snapping and alignment guides.
 *
 * Pure geometry, no React. Given the element being dragged and everything else
 * on the label, it returns a corrected position plus the guides to draw.
 *
 * Snapping works on AXIS-ALIGNED BOUNDING BOXES, not raw element boxes. A
 * rotated element's stored box says nothing about where it visually sits, and
 * users align what they can see. Computing the rotated AABB costs a little but
 * is the only version that behaves correctly for the rotated text this project
 * exists to lay out.
 */

import type { Element } from "../core/document.ts";
import type { LabelGeometry } from "../core/label.ts";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centreX: number;
  centreY: number;
}

/**
 * Axis-aligned bounding box of an element after its centre rotation.
 *
 * For a w x h box rotated by t, the AABB is
 *   w' = |w cos t| + |h sin t|,  h' = |w sin t| + |h cos t|
 * about the same centre.
 */
export function boundingBox(element: {
  x: number;
  y: number;
  widthPx: number;
  heightPx: number;
  rotation: number;
}): Box {
  const centreX = element.x + element.widthPx / 2;
  const centreY = element.y + element.heightPx / 2;

  const radians = (element.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = element.widthPx * cos + element.heightPx * sin;
  const height = element.widthPx * sin + element.heightPx * cos;

  return {
    left: centreX - width / 2,
    top: centreY - height / 2,
    right: centreX + width / 2,
    bottom: centreY + height / 2,
    centreX,
    centreY,
  };
}

export interface Guide {
  orientation: "vertical" | "horizontal";
  /** Position along the perpendicular axis, in label device pixels. */
  position: number;
}

export interface SnapResult {
  /** Offset to add to the element's x / y. Zero when nothing snapped. */
  dx: number;
  dy: number;
  guides: readonly Guide[];
}

/** Candidate positions on one axis, and the element edge that seeks them. */
interface Candidate {
  /** Where the moving edge currently is. */
  from: number;
  /** Where it would land. */
  to: number;
}

/** Floating-point slack when deciding whether two alignments are the same. */
const EPSILON = 0.001;

/**
 * The smallest movement that brings any edge onto any target, plus every target
 * that movement satisfies.
 *
 * Reporting all of them matters: an element the same width as its neighbour
 * aligns left, centre, and right at once, and showing only one guide would
 * misrepresent what just happened.
 */
function bestDelta(candidates: Candidate[], threshold: number): { delta: number; hits: number[] } {
  let delta = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate.to - candidate.from);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      delta = candidate.to - candidate.from;
    }
  }

  if (bestDistance === Number.POSITIVE_INFINITY) return { delta: 0, hits: [] };

  const hits = candidates
    .filter((candidate) => Math.abs(candidate.to - candidate.from - delta) < EPSILON)
    .map((candidate) => candidate.to);

  return { delta, hits: [...new Set(hits)] };
}

/**
 * Compute snapping for a element being dragged.
 *
 * `threshold` is in label device pixels; callers should scale it by the display
 * zoom so the pull feels constant on screen rather than varying with label size.
 */
export function computeSnap(
  moving: Element,
  others: readonly Element[],
  geometry: LabelGeometry,
  threshold: number,
): SnapResult {
  if (threshold <= 0) return { dx: 0, dy: 0, guides: [] };

  const box = boundingBox(moving);

  // Label edges and centre lines are always available as targets.
  const verticalTargets = [0, geometry.widthPx / 2, geometry.widthPx];
  const horizontalTargets = [0, geometry.heightPx / 2, geometry.heightPx];

  for (const other of others) {
    if (other.id === moving.id) continue;
    const otherBox = boundingBox(other);
    verticalTargets.push(otherBox.left, otherBox.centreX, otherBox.right);
    horizontalTargets.push(otherBox.top, otherBox.centreY, otherBox.bottom);
  }

  // Each of the moving box's three vertical lines can seek each target.
  const verticalCandidates: Candidate[] = [];
  for (const target of verticalTargets) {
    verticalCandidates.push(
      { from: box.left, to: target },
      { from: box.centreX, to: target },
      { from: box.right, to: target },
    );
  }

  const horizontalCandidates: Candidate[] = [];
  for (const target of horizontalTargets) {
    horizontalCandidates.push(
      { from: box.top, to: target },
      { from: box.centreY, to: target },
      { from: box.bottom, to: target },
    );
  }

  const vertical = bestDelta(verticalCandidates, threshold);
  const horizontal = bestDelta(horizontalCandidates, threshold);

  const guides: Guide[] = [
    ...vertical.hits.map((position): Guide => ({ orientation: "vertical", position })),
    ...horizontal.hits.map((position): Guide => ({ orientation: "horizontal", position })),
  ];

  return { dx: vertical.delta, dy: horizontal.delta, guides };
}
