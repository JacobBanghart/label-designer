/**
 * Thresholded preview.
 *
 * Shows the actual MonoRaster the printer will receive, not the pretty canvas.
 * A thermal printer burns black or nothing: anti-aliased text and grey fills
 * collapse to hard edges. Without this, every print is a surprise.
 */

import { useEffect, useRef, useState } from "react";

import type { LabelDocument } from "../core/document.ts";
import { getPixel } from "../core/raster.ts";
import { rasterizeDocument } from "../raster/index.ts";

interface Props {
  doc: LabelDocument;
  /** Display width in CSS pixels; height follows the label's aspect ratio. */
  displayWidth: number;
}

export function MonoPreview({ doc, displayWidth }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Debounced: rasterizing a 812x1218 label on every keystroke is wasteful.
    const timer = setTimeout(() => {
      rasterizeDocument(doc)
        .then((raster) => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;

          canvas.width = raster.widthPx;
          canvas.height = raster.heightPx;

          const image = ctx.createImageData(raster.widthPx, raster.heightPx);
          for (let y = 0; y < raster.heightPx; y++) {
            for (let x = 0; x < raster.widthPx; x++) {
              const value = getPixel(raster, x, y) ? 0 : 255;
              const i = (y * raster.widthPx + x) * 4;
              image.data[i] = value;
              image.data[i + 1] = value;
              image.data[i + 2] = value;
              image.data[i + 3] = 255;
            }
          }
          ctx.putImageData(image, 0, 0);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc]);

  if (error) return <p className="error">Preview failed: {error}</p>;

  return (
    <canvas
      ref={canvasRef}
      className="mono-preview"
      style={{ width: displayWidth, height: "auto" }}
    />
  );
}
