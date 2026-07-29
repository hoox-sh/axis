#!/usr/bin/env bash
# Rebuild the pynescript wheel from the sister pyne repo and vendor it into AXIS.
#
# Usage:
#   ./scripts/sync-pyne-wheel.sh
#   PYNE_ROOT=/path/to/pyne ./scripts/sync-pyne-wheel.sh
#
# Copies:
#   public/vendor/pynescript-<ver>-py3-none-any.whl  (Vite → dist/)
#   vendor/pynescript-<ver>-py3-none-any.whl         (legacy layout)
#
# Hardcoded install paths in src/engines/catalog.ts and index.js must match
# the wheel filename (currently pynescript-0.2.0-py3-none-any.whl).
#
# Copyright (C) 2024-2026 jango_blockchained
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYNE_ROOT="${PYNE_ROOT:-$(cd "${ROOT}/../pynescript" 2>/dev/null && pwd || true)}"
if [[ -z "${PYNE_ROOT}" || ! -d "${PYNE_ROOT}/src/pynescript" ]]; then
  echo "error: PYNE_ROOT not found (expected sister repo with src/pynescript)" >&2
  echo "  set PYNE_ROOT=/path/to/pyne (or pynescript)" >&2
  exit 1
fi

PYTHON="${PYTHON:-}"
if [[ -z "${PYTHON}" ]]; then
  if [[ -x "${PYNE_ROOT}/.venv/bin/python" ]]; then
    PYTHON="${PYNE_ROOT}/.venv/bin/python"
  else
    PYTHON="python3"
  fi
fi

echo "==> building wheel from ${PYNE_ROOT} (${PYTHON})"
cd "${PYNE_ROOT}"
"${PYTHON}" -m pip install -q build hatchling
rm -f dist/pynescript-*.whl
"${PYTHON}" -m build --wheel

WHEEL="$(ls -1 dist/pynescript-*-py3-none-any.whl | head -1)"
if [[ -z "${WHEEL}" || ! -f "${WHEEL}" ]]; then
  echo "error: no wheel produced under ${PYNE_ROOT}/dist" >&2
  exit 1
fi
BASE="$(basename "${WHEEL}")"
echo "==> built ${BASE} ($(wc -c < "${WHEEL}" | tr -d ' ') bytes)"

mkdir -p "${ROOT}/public/vendor" "${ROOT}/vendor"
cp -f "${WHEEL}" "${ROOT}/public/vendor/${BASE}"
cp -f "${WHEEL}" "${ROOT}/vendor/${BASE}"

# Drop stale alternate versions so dist/ does not serve two wheels
find "${ROOT}/public/vendor" "${ROOT}/vendor" -maxdepth 1 -name 'pynescript-*-py3-none-any.whl' ! -name "${BASE}" -print -delete 2>/dev/null || true

# Spot-check compiler payload is present (not a stale thin wheel)
if ! unzip -l "${ROOT}/public/vendor/${BASE}" | grep -q 'pynescript/compiler/numba_builtins.py'; then
  echo "error: wheel missing compiler package" >&2
  exit 1
fi
NB_SIZE="$(unzip -l "${ROOT}/public/vendor/${BASE}" | awk '/numba_builtins\.py/{print $1; exit}')"
echo "==> numba_builtins.py in wheel: ${NB_SIZE} bytes"
if [[ "${NB_SIZE}" -lt 10000 ]]; then
  echo "warning: numba_builtins.py looks truncated (<10k)" >&2
fi

# Remind if catalog still points at a different filename
if ! grep -q "${BASE}" "${ROOT}/src/engines/catalog.ts" 2>/dev/null; then
  echo "!! update hard-coded wheel path in src/engines/catalog.ts to ${BASE}" >&2
fi
if ! grep -q "${BASE}" "${ROOT}/src/engines/index.js" 2>/dev/null; then
  echo "!! update hard-coded wheel path in src/engines/index.js to ${BASE}" >&2
fi

echo "==> vendored:"
ls -la "${ROOT}/public/vendor/${BASE}" "${ROOT}/vendor/${BASE}"
echo "done — run: bun run build  # then redeploy dist/"
