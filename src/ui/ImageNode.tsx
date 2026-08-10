/**
 * Konva rendering for image elements.
 *
 * The editor does NOT reimplement halftoning: matching Floyd-Steinberg exactly
 * on the canvas would double the implementation for little gain, and the 1-bit
 * preview panel is the authority on what actually prints. Position, size, and
 * rotation are exact, which is what the canvas is for.
 *
 * Invert IS shown accurately, because it is a per-element choice the user needs
 * feedback on while placing artwork -- and because Konva can do it exactly.
 */

import { useEffect, useRef, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import Konva from "konva";

import type { ImageElement } from "../core/document.ts";

interface Props {
  element: ImageElement;
}

export function ImageNode({ element }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const nodeRef = useRef<Konva.Image>(null);

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

  /*
   * Konva filters only apply to a cached node, and the cache has to be rebuilt
   * whenever the source, the filter, or the size changes -- otherwise the node
   * keeps rendering a stale bitmap at the wrong resolution.
   */
  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !image) return;
    node.cache();
    node.getLayer()?.batchDraw();
  }, [image, element.invert, element.widthPx, element.heightPx]);

  if (!image) return null;

  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      width={element.widthPx}
      height={element.heightPx}
      filters={element.invert ? [Konva.Filters.Invert] : []}
      listening={false}
    />
  );
}
