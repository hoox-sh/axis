# syntax=docker/dockerfile:1.7
# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only
#
# Multi-stage AXIS image (Vite Solid PWA + static server).
#
# Targets:
#   pwa       — production static host (python axis_pwa_server)  [default]
#   pwa-nginx — same dist behind nginx (SPA + long-cache assets)
#   deps      — bun install layer (bake/cache helper)
#   build     — vite build artifacts only
#
# Examples:
#   docker buildx bake pwa
#   docker build --target pwa -t axis-pwa:latest .
#   docker compose up --build
#
# Multi-platform:
#   docker buildx bake pwa --set "*.platform=linux/amd64,linux/arm64"

ARG BUN_VERSION=1.2.19
ARG PYTHON_VERSION=3.12
ARG NGINX_VERSION=1.27-alpine

# ---------------------------------------------------------------------------
# deps — install JS toolchain
# ---------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION} AS deps

WORKDIR /app

# package metadata first for layer cache
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — Vite production bundle (public/ → dist/ includes vendor + pyodide)
# ---------------------------------------------------------------------------
FROM deps AS build

COPY index.html vite.config.ts tsconfig.json bunfig.toml ./
COPY public ./public
COPY src ./src
COPY assets ./assets
# vendor/pyodide also under public/; root copies kept for sync scripts / legacy
COPY vendor ./vendor
COPY pyodide ./pyodide
COPY brand ./brand
COPY scripts ./scripts
COPY manifest.webmanifest ./manifest.webmanifest

ENV NODE_ENV=production
RUN bun run build \
 && test -f dist/index.html \
 && test -d dist/assets

# ---------------------------------------------------------------------------
# pwa — slim Python static server (matches VPS axis-pwa.service)
# ---------------------------------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS pwa

LABEL org.opencontainers.image.title="AXIS PWA" \
      org.opencontainers.image.description="HOOX AXIS charting PWA (static dist)" \
      org.opencontainers.image.source="https://github.com/hoox-sh/axis" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8081

WORKDIR /app

RUN groupadd --gid 1000 appuser \
 && useradd --uid 1000 --gid appuser --create-home --shell /usr/sbin/nologin appuser

COPY --from=build /app/dist ./dist
COPY axis_pwa_server.py ./axis_pwa_server.py
COPY docker/entrypoint-pwa.sh /usr/local/bin/entrypoint-pwa.sh

RUN chmod +x /usr/local/bin/entrypoint-pwa.sh \
 && chown -R appuser:appuser /app

USER appuser
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/' % __import__('os').environ.get('PORT','8081'), timeout=3)"

ENTRYPOINT ["/usr/local/bin/entrypoint-pwa.sh"]
CMD ["python", "axis_pwa_server.py"]

# ---------------------------------------------------------------------------
# pwa-nginx — nginx SPA host (production CDN-like static serving)
# ---------------------------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS pwa-nginx

LABEL org.opencontainers.image.title="AXIS PWA (nginx)" \
      org.opencontainers.image.description="HOOX AXIS static dist behind nginx" \
      org.opencontainers.image.source="https://github.com/hoox-sh/axis" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
