/**
 * Konva rendering for barcodes.
 *
 * Unlike every other node here, this does NOT mirror the rasterizer -- it calls
 * exactly the same `layoutBarcode` and draws exactly the rectangles it returns.
 * Text and shapes can tolerate a pixel of drift between screen and print; a
 * barcode cannot, because the failure mode is a symbol that scans as the wrong
 * value or not at all.
 *
 * When a barcode cannot be laid out it renders an explanation instead of an
 * approximation, matching the rasterizer's refusal to draw anything.
 */

import { Group, Rect, Text } from "react-konva";

import { layoutBarcode } from "../core/barcode/index.ts";
import type { BarcodeElement } from "../core/document.ts";

const INK = "#000000";
const WARN = "#b42318";

interface Props {
  element: BarcodeElement;
}

export function BarcodeNode({ element }: Props) {
  const { widthPx, heightPx } = element;

  const result = layoutBarcode(
    { symbology: element.symbology, value: element.value, ecc: element.ecc },
    { widthPx, heightPx },
  );

  if (!result.ok) {
    // A dashed outline plus the reason. Deliberately unmistakable: the user
    // needs to know this box will print blank before they run a batch.
    const fontSize = Math.max(10, Math.min(widthPx / 22, heightPx / 3));
    return (
      <Group>
        <Rect
          width={widthPx}
          height={heightPx}
          stroke={WARN}
          strokeWidth={2}
          dash={[8, 6]}
          fill="rgba(180, 35, 24, 0.04)"
        />
        <Text
          width={widthPx}
          height={heightPx}
          padding={6}
          text={result.error}
          fontSize={fontSize}
          fill={WARN}
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    );
  }

  const { layout } = result;
  const captionSize = Math.min(layout.moduleSizePx * 7, heightPx * 0.22);
  const showCaption = element.showText && element.symbology !== "qr" && captionSize >= 6;
  // The caption eats into the bars rather than overflowing the box, so what the
  // element occupies on the label is exactly its declared size.
  const barHeight = showCaption ? layout.heightPx - captionSize : layout.heightPx;

  return (
    <Group>
      {/* Opaque ground: the quiet zone has to be white, not whatever is behind. */}
      <Rect
        x={layout.offsetX}
        y={layout.offsetY}
        width={layout.widthPx}
        height={layout.heightPx}
        fill="#ffffff"
      />
      {layout.bars.map((bar, i) => (
        <Rect
          key={i}
          x={layout.offsetX + bar.x}
          y={layout.offsetY + bar.y}
          width={bar.w}
          height={element.symbology === "qr" ? bar.h : Math.max(1, barHeight)}
          fill={INK}
          listening={false}
        />
      ))}
      {showCaption && (
        <Text
          x={layout.offsetX}
          y={layout.offsetY + barHeight}
          width={layout.widthPx}
          height={captionSize}
          text={element.value}
          fontSize={captionSize}
          fontFamily="monospace"
          fill={INK}
          align="center"
          verticalAlign="bottom"
          listening={false}
        />
      )}
      {/* Whole-box hit area, so thin bars are still easy to grab. */}
      <Rect width={widthPx} height={heightPx} fill="transparent" />
    </Group>
  );
}
