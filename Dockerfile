# syntax=docker/dockerfile:1

# --- Build stage -----------------------------------------------------------
# Package manager: Bun. Bun is used only to resolve/install dependencies and
# produce a lockfile -- NOT to execute the build. Vite+ (`vp`) is a Node
# script (`node_modules/vite-plus/bin/vp`, shebang `#!/usr/bin/env node`);
# it does not run on the Bun runtime. So this stage installs with `bun
# install` and then invokes the installed script directly with `node`.
#
# The pnpm catalog that previously blocked this has been inlined: `vite` and
# `vite-plus` now carry concrete specifiers in package.json, `overrides` moved
# there too, and pnpm-workspace.yaml is gone. `bun install` resolves cleanly
# and bun.lock is committed.
FROM oven/bun:1-alpine AS build

# vp is a Node script; Bun's runtime is not a substitute for it.
RUN apk add --no-cache nodejs

WORKDIR /app

# --ignore-scripts: package.json's "prepare" script runs `vp config`, which
# sets a local git hooksPath. That's meaningless in a build container (no
# .git is copied in -- see .dockerignore -- and there's nothing to configure
# hooks for), and without it the install fails outright since there's no
# git binary on this image either. Verified this is the fix, not just a
# workaround, by reproducing the failure and the fix on the equivalent pnpm
# install path (same lifecycle script, package-manager-agnostic).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN node node_modules/vite-plus/bin/vp build

# --- Runtime stage -----------------------------------------------------------
# nginx-unprivileged runs the master process as a non-root user (uid 101)
# and listens on 8080 instead of 80, so no capabilities/setuid tricks are
# needed to serve on an unprivileged port.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
