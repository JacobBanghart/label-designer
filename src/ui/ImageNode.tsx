/**
 * Konva rendering for image elements.
 *
 * The editor draws the image in greyscale-ish form rather than reimplementing
 * halftoning: matching Floyd-Steinberg exactly on the canvas would double the
 * implementation for little gain, and the 1-bit preview panel already shows the
 * true output. Position, size, and rotation ARE exact, which is what the canvas
 * is for.
 */

import { useEffect, useState } from "react";
import { Image as KonvaImage } from "react-konva";

import type { ImageElement } from "../core/document.ts";

interface Props {
  element: ImageElement;
}

export function ImageNode({ element }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const next = new Image();
    next.onload = () => {
      if (!cancelled) setImage(next);
    };
    // A broken source leaves the node empty rather than crashing the canvas.
    next.onerror = () => {
      if (!cancelled) setImage(null);
    };
    next.src = element.src;

    return () => {
      cancelled = true;
    };
  }, [element.src]);

  if (!image) return null;

  return (
    <KonvaImage
      image={image}
      width={element.widthPx}
      height={element.heightPx}
      // Rough visual cue that the output is 1-bit; the preview panel is the
      // authority on what actually prints.
      filters={undefined}
      opacity={element.invert ? 0.85 : 1}
      listening={false}
    />
  );
}
