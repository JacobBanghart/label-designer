/**
 * Canvas abstraction for the rasterizer.
 *
 * DESIGN NOTE -- read before changing the rasterizer.
 *
 * The rasterizer does NOT go through Konva. Konva is the *editor's* interaction
 * layer (scene graph, transform handles, hit detection); printing renders the
 * LabelDocument directly to a 2D context. Two reasons:
 *
 *   1. It makes rasterizeDocument a pure function of the document, so it is
 *      testable headlessly and cannot drift with Konva's rendering quirks.
 *   2. It keeps print output independent of whatever the editor happens to be
 *      doing on screen (zoom, selection outlines, guides).
 *
 * The consequence is that the editor and the rasterizer must agree on element
 * geometry. That agreement lives in the document model, not in a shared canvas.
 *
 * The factory is injectable so tests can supply @napi-rs/canvas in Node while
 * the browser uses a real <canvas>.
 */

/** The subset of CanvasRenderingContext2D the rasterizer relies on. */
export interface Ctx2D {
  fillStyle: string;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Ctx2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

/** Browser default. Throws in Node, where a factory must be injected instead. */
export const domCanvasFactory: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as CanvasLike;
};
