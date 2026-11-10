#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
# SPDX-License-Identifier: AGPL-3.0-only
"""Interpret-mode lock: strategy fills and plot display reach the AXIS bridge."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "public" / "pyodide" / "pynescript_runtime.py"


def _wheel() -> Path:
    vendor = ROOT / "vendor"
    wheels = sorted(vendor.glob("pynescript-*-py3-none-any.whl"))
    if len(wheels) != 1:
        names = ", ".join(w.name for w in wheels) or "none"
        raise SystemExit(f"expected exactly one vendored pynescript wheel, found: {names}")
    return wheels[0]


def load_runtime():
    spec = importlib.util.spec_from_file_location("pynescript_runtime", RUNTIME)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {RUNTIME}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _bars(n: int = 30) -> list[dict]:
    out = []
    for i in range(n):
        close = 100.0 + (i % 5) - 2
        out.append(
            {
                "open": close - (1 if i % 2 == 0 else -1),
                "high": close + 1.0,
                "low": close - 1.0,
                "close": close,
                "volume": 1.0,
                "time": 1_700_000_000 + i * 900,
            }
        )
    return out


def main() -> int:
    wheel = _wheel()
    if str(wheel) not in sys.path:
        sys.path.insert(0, str(wheel))
    try:
        import pynescript  # noqa: F401
    except ImportError as exc:
        print(f"FAIL cannot import pynescript: {exc}", file=sys.stderr)
        return 1

    rt = load_runtime()
    script = """//@version=6
strategy("t", overlay=true)
if ta.crossover(close, open)
    strategy.entry("Long", strategy.long)
if ta.crossunder(close, open)
    strategy.close("Long")
plot(close - open, "Hist", display=display.data_window)
"""
    raw = rt.run_script(script, _bars(), "interpret")
    out = json.loads(raw)
    if out.get("status") != "success":
        print(f"FAIL strategy: {out.get('error') or out}", file=sys.stderr)
        return 1
    events = out.get("events") or []
    if not events:
        print("FAIL strategy returned 0 events", file=sys.stderr)
        return 1
    meta = (out.get("meta") or {}).get("plot_meta") or {}
    display = (meta.get("Hist") or {}).get("display")
    if display != 2:
        print(f"FAIL Hist display expected 2 (data_window), got {display!r}", file=sys.stderr)
        return 1
    print(f"OK strategy events={len(events)} display={display}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
