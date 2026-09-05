#!/usr/bin/env bash
# Sync Pine builtin metadata from pyne LSP into AXIS for editor completion/hover.
# Usage: ./scripts/sync-pyne-builtins.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${PYNE_ROOT:-}" ]]; then
  if [[ -d "${ROOT}/../pyne" ]]; then
    PYNE="$(cd "${ROOT}/../pyne" && pwd)"
  elif [[ -d "${ROOT}/../pynescript" ]]; then
    PYNE="$(cd "${ROOT}/../pynescript" && pwd)"
  else
    PYNE=""
  fi
else
  PYNE="${PYNE_ROOT}"
fi
SRC="${PYNE}/src/pynescript/langserver/providers/builtin_metadata.json"
DEST="${ROOT}/src/editor/data/pyne-builtins.json"
if [[ ! -f "${SRC}" ]]; then
  echo "error: missing ${SRC} (set PYNE_ROOT)" >&2
  exit 1
fi
mkdir -p "$(dirname "${DEST}")"
cp -f "${SRC}" "${DEST}"
echo "synced $(wc -c < "${DEST}" | tr -d ' ') bytes → ${DEST}"
