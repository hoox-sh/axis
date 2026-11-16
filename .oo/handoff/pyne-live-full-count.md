# Handoff: pynescript /ws/live — full `count` vs evaluated columns

from: axis / oo-spec-2
to: pyne / HQ
date: 2026-11-09
severity: P0 (live chart lag)

## Symptom
AXIS live chart applies a ~10k-point full snapshot on every tick instead of a delta.
Measured live over 125 s: 54 paints, client requested `mode:"delta"` 53 times,
55/55 replies were `via:"stream-full"` (`context:"snapshot"`), one every ~2.1 s.
Client-side counters: `seqGap`/`resync` climb; payload→commit median 1904 ms, max 2696 ms
(~50% main-thread duty cycle).

## Mechanism (captured, read-only probe, key redacted)
SEND {"type":"subscribe","payload":{"kind":"script","meta":{"history_bars":10100,...}}}
RECV {"type":"full","seq":1,"count":10100,"bar_times_len":10022,
      "series_lens":{"RSI":10022,"Overbought":10022,"Oversold":10022},"plots_len":10022}
RECV {"type":"delta","seq":3,"count":10022,"base_index":10021,"tail_len":1,"forming":true}

The full declares `count` from the session window (10100) while plots/series/bar_times
are the evaluated prefix (10022). The following delta is numbered from the evaluated
count (10022). A client that caches the declared count can never splice: `count <
cachedCount` and `base_index > cachedCount` both reject, so it re-subscribes and gets
another full — every tick.

## Where
- `backend/api/live_ws.py:596-608` `_emit_ready` — `make_full(..., int(ensured.get("count") or len(bars)), ...)`
  while plots/series come from `live_session.result()`.
- `backend/api/live_ws.py:619-631` `_emit_snapshot` — `make_full(..., len(bars), ..., bar_times=[b["time"] for b in bars])`.
- `backend/api/live_ws.py:594-596` `_bars_of` — returns `_ohlcv_data` (session window), not the evaluated prefix.
- `backend/app.py:1340-1367` `_delta_envelope` — delta `count`/`base_index` from `result["count"]`.
- `src/pynescript/runtime/host.py:2941-3065` `result()` — `count = n_result_bars`, `session_bars = self._n_bars`.

## Decision needed
Make `count` in `full` equal `len(plots)` / `len(bar_times)` (the evaluated prefix), or
document that deltas are numbered from the session window and make the delta agree.
Either contract is fine; they must agree.

## Axis-side status
AXIS caches the evaluated column count, so the captured frame pair splices without a
resubscribe. That is not a substitute for the server contract: a full whose declared
count is correct and whose columns are short is still cached at the short length and
will reject a declared-numbered delta. Live confirmation needs a patched build.
