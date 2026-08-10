#!/bin/sh
# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only
#
# Entry point for the AXIS PWA container. Ensures dist/ exists, then execs CMD.

set -eu

if [ ! -f /app/dist/index.html ]; then
  echo "error: /app/dist/index.html missing — image build incomplete" >&2
  exit 1
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8081}"

GIT_SHA="${AXIS_GIT_SHA:-}"
if [ -z "$GIT_SHA" ] && [ -f /app/dist/.git-sha ]; then
  GIT_SHA="$(cat /app/dist/.git-sha 2>/dev/null || true)"
fi
VERSION="${AXIS_VERSION:-}"
if [ -z "$VERSION" ] && [ -f /app/dist/.version ]; then
  VERSION="$(cat /app/dist/.version 2>/dev/null || true)"
fi

echo "[axis-pwa] starting on ${HOST}:${PORT} → /app/dist" >&2
if [ -n "${VERSION:-}" ] || [ -n "${GIT_SHA:-}" ]; then
  echo "[axis-pwa] version=${VERSION:-unknown} sha=${GIT_SHA:-unknown}" >&2
fi

# Optional readiness: refuse to start if critical assets missing
if [ ! -d /app/dist/assets ]; then
  echo "error: /app/dist/assets missing" >&2
  exit 1
fi

exec "$@"
