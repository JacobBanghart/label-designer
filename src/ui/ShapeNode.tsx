/**
 * Konva rendering for drawing elements.
 *
 * Mirrors what the rasterizer does. The two are independent implementations of
 * the same document, which is what makes WYSIWYG possible but also what makes
 * divergence possible -- see src/integration.test.ts.
 *
 * Every node uses the same centre-pivot convention as text: positioned at the
 * element's centre with the origin pushed back out via offset, so Konva's
 * rotation pivot matches the model's.
 */

import { Ellipse, Group, Line, Rect } from "react-konva";

import { isPolylineElement, type ShapeElement } from "../core/document.ts";

const INK = "#000000";

interface Props {
  element: ShapeElement;
}

export function ShapeNode({ element }: Props) {
  const { widthPx, heightPx, strokeWidthPx } = element;

  if (element.kind === "rect") {
    return (
      <Rect
        width={widthPx}
        height={heightPx}
        cornerRadius={Math.min(element.cornerRadiusPx, Math.min(widthPx, heightPx) / 2)}
        fill={element.filled ? INK : undefined}
        stroke={strokeWidthPx > 0 ? INK : undefined}
        strokeWidth={strokeWidthPx}
        listening={false}
      />
    );
  }

  if (element.kind === "ellipse") {
    return (
      <Ellipse
        x={widthPx / 2}
        y={heightPx / 2}
        radiusX={widthPx / 2}
        radiusY={heightPx / 2}
        fill={element.filled ? INK : undefined}
        stroke={strokeWidthPx > 0 ? INK : undefined}
        strokeWidth={strokeWidthPx}
        listening={false}
      />
    );
  }

  if (isPolylineElement(element)) {
    // Points are normalised 0..1 within the box; scale them into local space.
    const points: number[] = [];
    for (let i = 0; i < element.points.length - 1; i += 2) {
      points.push(element.points[i]! * widthPx, element.points[i + 1]! * heightPx);
    }
    if (points.length < 4) return null;

    return (
      <Group listening={false}>
        <Line
          points={points}
          stroke={INK}
          strokeWidth={strokeWidthPx}
          lineCap="round"
          lineJoin="round"
          // Freehand is pen input, so smooth it; a straight line must not bow.
          tension={element.kind === "freehand" ? 0.4 : 0}
        />
        {element.kind === "arrow" && element.arrowHeadPx > 0 && (
          <ArrowHead points={points} size={element.arrowHeadPx} />
        )}
      </Group>
    );
  }

  return null;
}

/** Filled triangle at the final point, oriented along the last segment. */
function ArrowHead({ points, size }: { points: number[]; size: number }) {
  const n = points.length;
  const tipX = points[n - 2]!;
  const tipY = points[n - 1]!;
  const prevX = points[n - 4]!;
  const prevY = points[n - 3]!;

  const angle = Math.atan2(tipY - prevY, tipX - prevX);
  const spread = Math.PI / 7;

  return (
    <Line
      closed
      fill={INK}
      stroke={INK}
      strokeWidth={1}
      points={[
        tipX,
        tipY,
        tipX - size * Math.cos(angle - spread),
        tipY - size * Math.sin(angle - spread),
        tipX - size * Math.cos(angle + spread),
        tipY - size * Math.sin(angle + spread),
      ]}
    />
  );
}
