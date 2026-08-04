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

echo "[axis-pwa] starting on ${HOST}:${PORT} → /app/dist" >&2
exec "$@"
