#!/usr/bin/env python3
# Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
# SPDX-License-Identifier: AGPL-3.0-only
"""Run the PYNE Pro API with a deterministic fake exchange feed for AXIS e2e.

Replaces only the CCXT provider factory; the series store, session routes and
tick logic are the real PYNE code. Mints an API key on startup (the /data
routes require one) and writes it next to the data dir as ``api_key.txt``.

    PYNE_REPO_DIR=../pynescript PYNE_E2E_PORT=5055 python3 scripts/e2e/pyne-fake-feed.py
    AXIS_PYNE_E2E_URL=http://127.0.0.1:5055 \
    AXIS_PYNE_E2E_API_KEY=$(cat /tmp/pyne-e2e-data/api_key.txt) \
      bun test tests/integration/pyne-data-session.e2e.test.ts
"""

import os
import sys
import time

REPO = os.path.abspath(os.environ.get("PYNE_REPO_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "..", "pynescript")))
PORT = int(os.environ.get("PYNE_E2E_PORT", "5055"))
sys.path.insert(0, REPO)

DATA_DIR = os.path.abspath(os.environ.get("PYNE_DATA_DIR", os.path.join(os.environ.get("TMPDIR", "/tmp"), "pyne-e2e-data")))
os.environ["PYNE_DATA_DIR"] = DATA_DIR
os.environ.setdefault("ADMIN_TOKEN", "test-admin-token-for-data-series")
os.environ.setdefault("STORE_BACKEND", "json")
os.environ.setdefault("API_KEY_STORE", os.path.join(DATA_DIR, "api_keys.json"))
os.makedirs(DATA_DIR, exist_ok=True)

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
from backend.middleware.auth import reset_key_store  # noqa: E402


def mint_api_key() -> str:
    """Mint a hobby key through the admin route, same process as the server."""
    reset_key_store()
    with app.test_client() as c:
        resp = c.post(
            "/auth/create_key",
            json={"tier": "hobby"},
            headers={"X-Admin-Token": os.environ["ADMIN_TOKEN"]},
        )
        if resp.status_code != 200:
            raise SystemExit(f"minting API key failed: {resp.status_code} {resp.json}")
        return resp.json["api_key"]


if __name__ == "__main__":
    key = mint_api_key()
    key_path = os.path.join(DATA_DIR, "api_key.txt")
    with open(key_path, "w") as fh:
        fh.write(key)
    print(f"PYNE fake feed on http://127.0.0.1:{PORT} (api key: {key_path})", flush=True)
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
