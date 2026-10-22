#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
# SPDX-License-Identifier: AGPL-3.0-only
"""Record the HP calc parity fixtures from PYNE (HP PR 6, §10.4).

The AXIS calc worker's *committed* series must match what PYNE produces for
the same OHLCV with every bar closed — that is what
`tests/hp/barstate-tip.test.ts` asserts against
`tests/hp/fixtures/barstate-parity.json`. The forming-tip / scratch side is
an AXIS-side contract (§10.1/§10.2): the test proves tip ticks never touch
the committed series.

Re-record after a PYNE release that changes bar-state semantics:

    cd /home/jango/Git/pynescript && python3 <axis>/scripts/record-hp-fixtures.py

Uses the local `pynescript` checkout (`src/` layout, importable in place).
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, "/home/jango/Git/pynescript/src")

from pynescript.__about__ import __version__  # noqa: E402
from pynescript.runtime import Runtime  # noqa: E402

# Deterministic walk with distinct closes so a leaked tip tick is obvious.
CLOSES = [100.0, 103.0, 101.0, 107.0, 105.0, 110.0, 108.0, 115.0, 112.0, 120.0, 118.0, 125.0]

BARS = []
for i, close in enumerate(CLOSES):
    open_ = CLOSES[i - 1] if i else 100.0
    BARS.append(
        {
            "time": 60 * i,
            "open": open_,
            "high": max(open_, close) + 2.0,
            "low": min(open_, close) - 2.0,
            "close": close,
            "volume": 100.0 + i,
        }
    )

CASES = [
    (
        "ta-cum",
        "cum",
        '//@version=6\nindicator("HP fixture — ta.cum")\nplot(ta.cum(close), "cum")\n',
    ),
    (
        "valuewhen-confirmed",
        "valuewhen_confirmed_close",
        '//@version=6\n'
        'indicator("HP fixture — ta.valuewhen")\n'
        "plot(ta.valuewhen(barstate.isconfirmed, close, 0), "
        '"valuewhen_confirmed_close")\n',
    ),
    (
        "var-assignment",
        "var_x",
        '//@version=6\n'
        'indicator("HP fixture — var assignment")\n'
        "var float x = na\n"
        "if barstate.isconfirmed\n"
        "    x := close\n"
        'plot(x, "var_x")\n',
    ),
]

FLAGS_CODE = (
    '//@version=6\n'
    'indicator("HP fixture — barstate flags")\n'
    "plot(barstate.isnew ? 1.0 : 0.0, \"isnew\")\n"
    "plot(barstate.isconfirmed ? 1.0 : 0.0, \"isconfirmed\")\n"
    "plot(barstate.isrealtime ? 1.0 : 0.0, \"isrealtime\")\n"
    "plot(barstate.isfirst ? 1.0 : 0.0, \"isfirst\")\n"
    "plot(barstate.islast ? 1.0 : 0.0, \"islast\")\n"
)


def run(code: str) -> dict:
    res = Runtime(symbol="HPFIX").run(code, BARS, mode="interpret")
    if res.get("error"):
        raise SystemExit(f"PYNE run failed: {res['error']}")
    return res


def main() -> None:
    cases = []
    for case_id, plot_name, code in CASES:
        series = run(code)["series"]
        cases.append(
            {
                "id": case_id,
                "code": code,
                "plot": plot_name,
                "confirmed": series[plot_name],
            }
        )

    flags = run(FLAGS_CODE)["series"]
    cases.append({"id": "barstate-flags", "code": FLAGS_CODE, "plots": flags})

    fixture = {
        "comment": (
            "Recorded from PYNE — regenerate with scripts/record-hp-fixtures.py, "
            "never hand-edit. `confirmed` is the per-bar plot of the closed run: "
            "the exact series the AXIS calc worker's committed state must match."
        ),
        "pynescript": __version__,
        "mode": "interpret",
        "bars": BARS,
        "cases": cases,
    }

    out = pathlib.Path(__file__).resolve().parent.parent / "tests" / "hp" / "fixtures"
    out.mkdir(parents=True, exist_ok=True)
    path = out / "barstate-parity.json"
    path.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path} (pynescript {__version__}, {len(BARS)} bars, {len(cases)} cases)")


if __name__ == "__main__":
    main()
