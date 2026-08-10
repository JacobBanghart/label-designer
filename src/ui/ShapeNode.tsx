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

import { Ellipse, Group, Line, Rect, Shape } from "react-konva";

import { isPolylineElement, type ShapeElement } from "../core/document.ts";
import { buildStrokePath, replayPath } from "../core/smoothing.ts";

const INK = "#000000";

/**
 * Minimum grabbable thickness for an outline or line, in label pixels.
 *
 * A 2px stroke on an 812px label is essentially impossible to hit with a mouse
 * once the label is scaled to fit the screen.
 */
const MIN_HIT_STROKE = 14;

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
        hitStrokeWidth={Math.max(strokeWidthPx, MIN_HIT_STROKE)}
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
        hitStrokeWidth={Math.max(strokeWidthPx, MIN_HIT_STROKE)}
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
      <Group>
        {/*
          Drawn with an explicit sceneFunc replaying core's shared path builder
          rather than Konva's `tension` spline. Konva's spline and the
          rasterizer's midpoint quadratics trace different curves through the
          same points, so using it here would mean freehand strokes printed
          differently from how they were drawn.
        */}
        <Shape
          stroke={INK}
          strokeWidth={strokeWidthPx}
          hitStrokeWidth={Math.max(strokeWidthPx, MIN_HIT_STROKE)}
          lineCap="round"
          lineJoin="round"
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            replayPath(ctx, buildStrokePath(points, element.kind === "freehand"));
            ctx.strokeShape(shape);
          }}
          hitFunc={(ctx, shape) => {
            ctx.beginPath();
            replayPath(ctx, buildStrokePath(points, element.kind === "freehand"));
            ctx.strokeShape(shape);
          }}
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
