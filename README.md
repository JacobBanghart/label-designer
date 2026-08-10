# Label Designer

A browser-based, label-size-aware canvas editor for thermal printers.

![Label Designer editing a 4x6 shipping label, with the 1-bit printer preview
in the sidebar](docs/screenshot.jpg)

## Why

Most tools for laying out shipping/product labels fall into one of two
buckets: label software that isn't really a drawing tool (rigid templates,
no freeform layout), or drawing tools that don't know anything about label
stock (no fixed physical dimensions, no print-safe pixel grid). Label
Designer is closer to the second kind, an Excalidraw-style freeform canvas,
but built around a fixed physical label size from the start, so what you lay
out is exactly what a thermal printer will produce, at its native
resolution.

It's pure client-side: no backend, no accounts, no server-side storage.
Everything you design lives in your browser.

## Status: MVP

Currently supported:

- Four label sizes: 4"x6", 2"x1", and 1.08"/1.44" round stock, with artwork
  clipped to the die-cut so nothing prints onto the backing liner
- An orientation toggle that swaps width/height (e.g. 4x6 -> 6x4), changing
  the actual output dimensions, not just the editing view
- Rotatable text elements, with drag/resize/rotate handles and a property
  panel (font, size, alignment, bold/italic, layer order)
- Drawing tools: rectangle, ellipse, line, arrow, and a freehand pen, all
  drag-to-draw with a live preview. Outline or solid fill, adjustable stroke
  width, corner radius, and arrowhead size
- Snapping with alignment guides — to label edges and centre lines, and to
  other elements' edges and centres. Hold `Alt` while dragging to suspend it
- Multi-select by shift-click or rubber-band drag, with align and distribute
- Undo/redo, with drag gestures collapsed into a single history step
- A live 1-bit preview showing exactly what the printer will burn
- A built-in **Test pattern** — a tonal ramp plus an 11-step wedge, for checking
  how greys survive 1-bit conversion at your printer's darkness setting
- Image import — drop a file on the label or use the Image button. Choose
  hard-threshold rendering for logos and line art, or Floyd-Steinberg
  dithering for photographs, with an invert toggle
- Export as **PDF** (print-ready, exact physical size), **PNG** (1-bit at native
  resolution), or **JSON** (the design, for re-import). All three go through the
  same rasterizer as printing, so an exported file is what the printer receives
- A library of named labels — create, duplicate, switch, delete. Autosaved
  continuously, so there is no save button to forget. Plus JSON export/import
- **Direct USB printing** for TSPL printers (Chrome/Edge) — no print dialog, no
  CUPS, no vendor driver, with darkness, speed, rotation and registration offset
  under your control. See [docs/direct-usb.md](docs/direct-usb.md)
- Printing via the browser's native print dialog, for everything else

Not yet implemented: barcodes and QR.

> **Round label dimensions are unverified.** They map to the Rollo driver's
> `Round108` / `Round144` media options, read as 1.08" and 1.44" diameters.
> That reading is inferred from the option names, not measured. Check against
> your stock before a real run, and correct `LABEL_SIZES` in
> `src/core/label.ts` if it is wrong.

Barcode support is **deliberately** deferred rather than merely missing --
barcode management is a design question in its own right, and guessing at it
now would mean a migration later.

### Units and precision

Positions and sizes can be typed directly in the inspector, in inches,
millimetres, or device pixels — pick with the Units control in the toolbar.
Font sizes are in points, as type conventionally is.

Geometry is always _stored_ in device pixels at the label's DPI, and converted
only for display, so switching units never rewrites your document or
accumulates rounding drift.

### Keyboard

| Key                               | Action                    |
| --------------------------------- | ------------------------- |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo               |
| `Ctrl/Cmd+D`                      | Duplicate selection       |
| `Delete` / `Backspace`            | Delete selection          |
| `Escape`                          | Deselect                  |
| Arrow keys                        | Nudge by one device pixel |
| `Shift` + arrows                  | Nudge by ten              |
| `V`                               | Select/move tool          |
| `T`                               | Add text                  |
| `R` / `O`                         | Rectangle / ellipse       |
| `L` / `A`                         | Line / arrow              |
| `P`                               | Freehand pen              |
| Hold `Alt` while dragging         | Suspend snapping          |
| `Ctrl/Cmd+A`                      | Select all                |
| `Shift`+click                     | Add/remove from selection |

## Self-hosting

### Docker

```sh
docker build -t label-designer .
docker run -p 8080:8080 label-designer
```

Then open `http://localhost:8080`.

### docker-compose

The simplest path — no volumes, no environment variables needed, because the
app has no server-side state at all:

```sh
docker compose -f deploy/docker-compose.yml up -d
```

### Kubernetes

`deploy/kubernetes/label-designer.yaml` has a Namespace, Deployment,
Service, Traefik `IngressRoute`, and cert-manager `Certificate`, modeled on
a working homelab deployment. Point `image:` at wherever you publish the
image built from the repo-root `Dockerfile`, and adjust the hostname/issuer
to your own ingress setup.

## Local development

This project uses [Vite+](https://viteplus.dev) (the `vp` CLI), not plain
Vite, with Bun as the package manager.

```sh
vp install   # install dependencies
vp dev       # start the dev server
vp check     # format, lint, and type-check (add --fix to auto-fix)
vp test      # run tests
```

There is no separate ESLint, Prettier, Vitest config, or `tsc` step -- `vp
check` and `vp test` cover all of it. Please don't add them.

Note that Bun installs dependencies but does not run the build: `vp` is a
Node script, so the Docker build stage installs with Bun and then invokes it
under Node.

### Architecture

The pipeline is deliberately linear, and the middle step is the contract
everything else is built around:

```
LabelDocument  ->  MonoRaster (packed 1bpp)  ->  transport
                          |
                          +-- PdfTransport  (browser print dialog)
                          +-- WebUsbTransport  (future)
```

`MonoRaster` is the canonical render artifact rather than a PNG or PDF,
because printer command languages ultimately want a bitmap. Terminating the
pipeline in an image format would mean retrofitting rasterization when a
direct-to-printer transport is added.

The rasterizer renders the document straight to a 2D context rather than
going through Konva, so it is a pure function of the document and testable
headlessly. Konva is only the editor's interaction layer. The cost of that
split is that the editor and the rasterizer must agree on geometry
independently -- `src/integration.test.ts` exists to catch it when they
don't.

### Storage

Designs live in `localStorage`, which browsers cap at roughly 5MB. Imported
images are downscaled to at most 1218px on their long edge — the printable
resolution of a 4×6 label at 203 DPI, so nothing visible is lost — but a
library with many image-heavy labels can still fill the quota. If a save
fails you get an explicit warning rather than silence; export the label to
JSON and delete something.

## Examples

`examples/simic-order-label.json` is a complete 4×6 order label — import it
with the Import button to see a realistic design. Exported labels are plain
JSON and can be committed, diffed, and shared.

## Printing

Two routes, and the direct one is better where it works.

**Direct USB** speaks TSPL straight to the printer over WebUSB. Nothing sits
between the app and the hardware, so the settings a driver would normally hide —
rotation, darkness, media gap, registration offset — are yours. Chrome/Edge
only, and on Linux the printer must be detached from the `usblp` kernel module
first. See [docs/direct-usb.md](docs/direct-usb.md).

**Print dialog** works everywhere and needs no setup, but every layer it passes
through is a layer that can alter your output.

Output is rendered as a 1-bit raster at 203 DPI (the resolution of common
desktop thermal printers, e.g. the Rollo). This is real, fixed-resolution
pixel data, not a vector page that gets rasterized at whatever resolution
the printer driver feels like.

**When the print dialog opens, you must set scale to "Actual size" / 100%.**
"Fit to page" looks harmless but silently rescales the image to fit
whatever page size the dialog thinks you're printing to — on a thermal
label this resampling ruins crisp text and turns fine detail into mush.
Always print at actual size / 100% scale, never "fit to page."

## License

MIT — see [LICENSE](LICENSE).
