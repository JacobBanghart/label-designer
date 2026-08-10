/**
 * Shared test fixtures.
 *
 * Producers (the rasterizer) and consumers (transports) both test against
 * these, so their outputs are compatible without the modules ever referencing
 * each other. Treat these as frozen: changing a fixture changes a contract.
 */

import { SCHEMA_VERSION, type LabelDocument } from "../document.ts";
import { DPI } from "../units.ts";
import { createMonoRaster, setPixel, type MonoRaster } from "../raster.ts";

/**
 * A tiny, hand-checkable raster: 16x8 at 203 DPI with a known pattern.
 *
 * Row 0 is fully black, row 1 is fully white, and thereafter pixel (x, y) is
 * black when (x + y) is even -- a checkerboard. Small enough to assert on
 * exhaustively, wide enough (16px = exactly 2 bytes) to catch row-padding bugs.
 */
export function goldenRaster(): MonoRaster {
  const raster = createMonoRaster(16, 8, DPI);
  for (let x = 0; x < 16; x++) setPixel(raster, x, 0, true);
  for (let y = 2; y < 8; y++) {
    for (let x = 0; x < 16; x++) {
      setPixel(raster, x, y, (x + y) % 2 === 0);
    }
  }
  return raster;
}

/**
 * A raster whose width is NOT a multiple of 8, to catch transports that assume
 * `widthPx / 8` instead of `bytesPerRow()`. 13x3: 2 bytes per row, 3 bits of
 * padding at the end of each row which must be ignored, not printed.
 */
export function unalignedRaster(): MonoRaster {
  const raster = createMonoRaster(13, 3, DPI);
  for (let y = 0; y < 3; y++) {
    setPixel(raster, 0, y, true);
    setPixel(raster, 12, y, true);
  }
  return raster;
}

/**
 * The reference document: the Simic Systems order label. A 4x6 portrait label
 * (812 x 1218 px) carrying text rotated 90 degrees, which is the label actually
 * printed today. The MVP is complete when this round-trips from editor to paper.
 *
 * GEOMETRY NOTE, because this is easy to get wrong: rotation is about the
 * element's CENTRE, and the stored box stays axis-aligned. So a box that is
 * 1000 wide and 180 tall, rotated 90 degrees, occupies a footprint 180 wide and
 * 1000 tall centred on the same point. To place a vertical text column you
 * therefore describe a HORIZONTAL box and rotate it -- and its stored x may sit
 * outside the label even though the rotated result is fully inside.
 *
 *   visual centre = (x + widthPx/2, y + heightPx/2)
 *
 * Both columns share a vertical centre of 609 (half of 1218) and are offset
 * horizontally from each other.
 */
export function simicOrderLabel(): LabelDocument {
  const columnWidth = 1000; // length of the text run, along the box's x axis
  const columnHeight = 190; // thickness of the column once rotated
  const verticalCentre = 1218 / 2;

  /** Convert a desired on-label visual centre into a stored top-left. */
  const place = (centreX: number) => ({
    x: Math.round(centreX - columnWidth / 2),
    y: Math.round(verticalCentre - columnHeight / 2),
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    id: "fixture-simic-order",
    name: "Simic Systems Order",
    sizeId: "4x6",
    orientation: "portrait",
    dpi: DPI,
    elements: [
      {
        id: "el-company",
        kind: "text",
        ...place(620),
        widthPx: columnWidth,
        heightPx: columnHeight,
        rotation: 90,
        text: "Simic Systems LLC",
        fontSizePx: 96,
        fontFamily: "sans-serif",
        bold: false,
        italic: false,
        align: "left",
      },
      {
        id: "el-order",
        kind: "text",
        ...place(400),
        widthPx: columnWidth,
        heightPx: columnHeight,
        rotation: 90,
        text: "Order Number: 20250903ku6pmv",
        fontSizePx: 72,
        fontFamily: "sans-serif",
        bold: false,
        italic: false,
        align: "left",
      },
    ],
  };
}
