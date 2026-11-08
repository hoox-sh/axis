#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
# SPDX-License-Identifier: AGPL-3.0-only
"""Interpret-mode lock: ta.sma / ta.stdev must run against the vendored wheel."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "public" / "pyodide" / "pynescript_runtime.py"


def _wheel() -> Path:
    """Resolve the vendored pynescript wheel.

    The filename carries the version (``pynescript-<ver>-py3-none-any.whl``)
    and is rewritten by scripts/sync-pyne-wheel.sh, so pinning a literal here
    meant every wheel bump broke this lock for no reason. Resolve the single
    vendored wheel instead and fail loudly if there is not exactly one.
    """
    vendor = ROOT / "vendor"
    wheels = sorted(vendor.glob("pynescript-*-py3-none-any.whl"))
    if len(wheels) != 1:
        names = ", ".join(w.name for w in wheels) or "none"
        msg = f"expected exactly one vendored pynescript wheel in {vendor}, found: {names}"
        raise SystemExit(msg)
    return wheels[0]


WHEEL = _wheel()


def load_runtime():
    spec = importlib.util.spec_from_file_location("pynescript_runtime", RUNTIME)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load {RUNTIME}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _bars(n: int = 20) -> list[dict]:
    out = []
    for i in range(n):
        close = 100.0 + i
        out.append(
            {
                "open": close - 0.5,
                "high": close + 1.0,
                "low": close - 1.0,
                "close": close,
                "volume": 1.0,
                "time": 1_000 * (i + 1),
            }
        )
    return out


def _run(rt, script: str, bars: list[dict], label: str) -> dict | None:
    raw = rt.run_script(script, bars, "interpret")
    out = json.loads(raw)
    if out.get("status") != "success":
        print(f"FAIL {label}: {out.get('error') or out}", file=sys.stderr)
        return None
    return out


def _non_null(series: object) -> int:
    if not isinstance(series, list):
        return 0
    return sum(1 for x in series if x is not None)


def main() -> int:
    if not WHEEL.is_file():
        print(f"FAIL missing vendored wheel: {WHEEL}", file=sys.stderr)
        return 1
    if str(WHEEL) not in sys.path:
        sys.path.insert(0, str(WHEEL))
    try:
        import pynescript  # noqa: F401
    except ImportError as exc:
        print(f"FAIL cannot import pynescript from {WHEEL}: {exc}", file=sys.stderr)
        return 1

    rt = load_runtime()
    bars = _bars()
    sma = '//@version=5\nindicator("t")\nplot(ta.sma(close, 14))'
    stdev = '//@version=5\nindicator("t")\nplot(ta.stdev(close, 14))'
    # Non-callable plot.style_* constants must not hit inspect.signature
    # (AXIS CustomEvaluator patch; MACD / Volume / AO use style_columns).
    # Keep this tiny — bun test default timeout is 5s.
    columns = (
        '//@version=6\nindicator("cols", overlay=false)\n'
        'plot(close, "C", style=plot.style_columns)\n'
    )
    # Bar-mode lock: input.source snapshots to scalars; without _pine_bar_mode
    # incremental ta.macd never warms and every plot stays null (empty chart).
    macd_src = (
        '//@version=6\nindicator("MACD", overlay=false)\n'
        'src = input.source(close, "Source")\n'
        "[macdLine, signalLine, hist] = ta.macd(src, 12, 26, 9)\n"
        'plot(hist, "Hist", style=plot.style_columns)\n'
        'plot(macdLine, "MACD")\n'
        'plot(signalLine, "Signal")\n'
    )
    if _run(rt, sma, bars, "ta.sma") is None:
        return 1
    if _run(rt, stdev, bars, "ta.stdev") is None:
        return 1
    if _run(rt, columns, bars, "plot.style_columns") is None:
        return 1
    macd_out = _run(rt, macd_src, _bars(80), "input.source+ta.macd")
    if macd_out is None:
        return 1
    series = macd_out.get("series") or {}
    for key in ("Hist", "MACD", "Signal"):
        nn = _non_null(series.get(key))
        if nn <= 0:
            print(
                f"FAIL input.source+ta.macd: series {key!r} all-null "
                f"(len={len(series.get(key) or [])})",
                file=sys.stderr,
            )
            return 1
    print("OK interpret ta.sma ta.stdev plot.style_columns input.source+ta.macd")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
