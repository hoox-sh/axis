#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh
# SPDX-License-Identifier: AGPL-3.0-only
"""Compile-path alert() / alertcondition() recording (pynescript_runtime patch)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "public" / "pyodide" / "pynescript_runtime.py"


def load_runtime():
    spec = importlib.util.spec_from_file_location("pynescript_runtime", RUNTIME)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {RUNTIME}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    rt = load_runtime()
    bars = [
        {"open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "volume": 1.0, "time": 1_000},
        {"open": 1.5, "high": 2.5, "low": 1.0, "close": 0.8, "volume": 1.0, "time": 2_000},
        {"open": 0.8, "high": 1.2, "low": 0.7, "close": 1.1, "volume": 1.0, "time": 3_000},
    ]
    script = "\n".join(
        [
            "//@version=5",
            'strategy("t")',
            "if close > open",
            '    alert("up", alert.freq_once_per_bar)',
            'alertcondition(close < open, "Down", "price down")',
            "plot(close)",
        ]
    )
    out = rt._run_compiled(script, bars)
    alerts = out.get("alerts") or []
    sources = {a.get("source") for a in alerts}
    messages = [a.get("message") for a in alerts]
    if "alert" not in sources:
        print("FAIL missing alert() firing", alerts, file=sys.stderr)
        return 1
    if "alertcondition" not in sources:
        print("FAIL missing alertcondition() firing", alerts, file=sys.stderr)
        return 1
    if "up" not in messages:
        print("FAIL missing alert message", messages, file=sys.stderr)
        return 1
    if "price down" not in messages:
        print("FAIL missing alertcondition message", messages, file=sys.stderr)
        return 1
    # Bar 0: close 1.5 > open 1.0 → alert up
    # Bar 1: close 0.8 < open 1.5 → alertcondition Down
    # Bar 2: close 1.1 > open 0.8 → alert up
    up_bars = [a.get("bar_index") for a in alerts if a.get("message") == "up"]
    down_bars = [a.get("bar_index") for a in alerts if a.get("message") == "price down"]
    if 0 not in up_bars or 2 not in up_bars:
        print("FAIL up bars", up_bars, file=sys.stderr)
        return 1
    if 1 not in down_bars:
        print("FAIL down bars", down_bars, file=sys.stderr)
        return 1
    print("OK", len(alerts), "alerts", messages)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
