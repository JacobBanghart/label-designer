# Label Designer

A browser-based, label-size-aware canvas editor for thermal printers.

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

- Two label sizes: 4"x6" and 2"x1"
- An orientation toggle that swaps width/height (e.g. 4x6 -> 6x4), changing
  the actual output dimensions, not just the editing view
- Rotatable text elements
- Undo/redo
- Printing via the browser's native print dialog

Not yet implemented: barcode support is deliberately deferred, not planned
for the current MVP.

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
Vite.

```sh
vp install   # install dependencies
vp dev       # start the dev server
vp check     # format, lint, and type-check
vp test      # run tests
```

## Printing

Output is rendered as a 1-bit raster at 203 DPI (the resolution of common
desktop thermal printers, e.g. the Rollo). This is real, fixed-resolution
pixel data, not a vector page that gets rasterized at whatever resolution
the printer driver feels like.

**When the print dialog opens, you must set scale to "Actual size" / 100%.**
"Fit to page" looks harmless but silently rescales the image to fit
whatever page size the dialog thinks you're printing to — on a thermal
label this resampling ruins crisp text and turns fine detail into mush.
Always print at actual size / 100% scale, never "fit to page."
