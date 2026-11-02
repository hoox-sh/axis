#!/usr/bin/env bash
# Copyright (c) 2026 HOOX · AXIS · hoox-sh
# SPDX-License-Identifier: AGPL-3.0-only
#
# Copy the PYNE Agent AXIS plugin from the sister pyne-agent-worker repo into
# AXIS same-origin /plugins/axis-pine-agent.js (Manager → Install URL).
#
# Usage:
#   bun run sync:pyne-agent-plugin
#   ./scripts/sync-pyne-agent-plugin.sh [/path/to/pyne-agent-worker]
#
# Search order for the sister repo:
#   1) first CLI arg
#   2) $PYNE_AGENT_WORKER_ROOT
#   3) ../pyne-agent-worker next to this AXIS checkout (realpath)
#   4) $HOME/Git/pyne-agent-worker
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/public/plugins/axis-pine-agent.js"

candidates=()
[[ $# -ge 1 && -n "${1:-}" ]] && candidates+=("$1")
[[ -n "${PYNE_AGENT_WORKER_ROOT:-}" ]] && candidates+=("$PYNE_AGENT_WORKER_ROOT")
candidates+=("$ROOT/../pyne-agent-worker")
candidates+=("${HOME}/Git/pyne-agent-worker")

SISTER=""
SRC=""
for cand in "${candidates[@]}"; do
  if command -v realpath >/dev/null 2>&1; then
    resolved="$(realpath -m "$cand" 2>/dev/null || true)"
  else
    resolved="$cand"
  fi
  try="$resolved/plugin/axis-pine-agent.js"
  if [[ -f "$try" ]]; then
    SISTER="$resolved"
    SRC="$try"
    break
  fi
  try2="$cand/plugin/axis-pine-agent.js"
  if [[ -f "$try2" ]]; then
    SISTER="$cand"
    SRC="$try2"
    break
  fi
done

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "error: could not find sister plugin axis-pine-agent.js" >&2
  echo "tried:" >&2
  for cand in "${candidates[@]}"; do
    echo "  - $cand/plugin/axis-pine-agent.js" >&2
  done
  echo "hint: clone https://github.com/hoox-sh/pyne-agent-worker, or pass the path," >&2
  echo "      or set PYNE_AGENT_WORKER_ROOT." >&2
  exit 1
fi

ver="$(grep -E 'const PLUGIN_UI_VERSION = "' "$SRC" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
if [[ -z "$ver" ]]; then
  echo "error: could not read PLUGIN_UI_VERSION from $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"

if ! cmp -s "$SRC" "$DEST"; then
  echo "error: copy drifted after cp ($SRC → $DEST)" >&2
  exit 1
fi

if ! grep -q 'orchestrate: true' "$DEST"; then
  echo "error: expected 0.1.8+ orchestrate:true in $DEST" >&2
  exit 1
fi
if ! grep -q 'pyneBackend' "$DEST"; then
  echo "error: expected pyneBackend configSchema in $DEST" >&2
  exit 1
fi

echo "ok: synced PYNE Agent plugin $ver"
echo "    from $SISTER"
echo "    $SRC"
echo " →  $DEST"
echo "install URL (same-origin): /plugins/axis-pine-agent.js"
echo "remote URL: https://pyne-agent-worker.cryptolinx.workers.dev/plugin/axis-pine-agent.js"
