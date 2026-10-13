#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
# SPDX-License-Identifier: AGPL-3.0-only
"""Run the PYNE Pro API with a deterministic fake exchange feed for AXIS e2e.

Replaces only the CCXT provider factory; the series store, session routes and
tick logic are the real PYNE code.

    PYNE_REPO_DIR=../pynescript PYNE_E2E_PORT=5055 python3 scripts/e2e/pyne-fake-feed.py
    AXIS_PYNE_E2E_URL=http://127.0.0.1:5055 bun test tests/integration/pyne-data-session.e2e.test.ts
"""

import os
import sys
import time

REPO = os.path.abspath(os.environ.get("PYNE_REPO_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "pynescript")))
PORT = int(os.environ.get("PYNE_E2E_PORT", "5055"))
sys.path.insert(0, REPO)
os.environ.setdefault("PYNE_DATA_DIR", os.path.join(os.environ.get("TMPDIR", "/tmp"), "pyne-e2e-data"))

from backend.api import datafeed  # noqa: E402

STEP_S = {"1m": 60, "5m": 300, "1h": 3600, "1d": 86400}


class FakeProvider:
    """Deterministic candles aligned to the timeframe, newest bar at or before now."""

    def __init__(self, exchange):
        self.exchange = exchange

    def fetch_ohlcv(self, symbol, timeframe, since=None, limit=1000):
        step = STEP_S[timeframe] * 1000
        now_ms = int(time.time() * 1000) // step * step
        start = since if since is not None else now_ms - (limit - 1) * step
        t = (start // step) * step
        out = []
        while t <= now_ms and len(out) < limit:
            i = t // step
            base = 100 + (i % 97) * 0.5
            out.append([t, base, base + 1, base - 1, base + 0.25, 10 + (i % 5)])
            t += step
        return out


datafeed._make_provider = lambda exchange, credentials=None: FakeProvider(exchange)

from backend.app import app  # noqa: E402

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
