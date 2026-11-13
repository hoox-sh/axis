# P0: live app lag — post-deploy live proof (behaviour fixed, cause unproven)

Date: 2026-11-11
Seat: oo-spec-2 (engineering)
Card: `p0-live-app-laggy-engine-wire-se-943577b8`
Verdict: behaviour fixed in production — deltas splice, the full-snapshot loop
is gone. Cause attribution is **unproven** (see below).

## Measurement

- Session: `701a5ff1` (1 tab)
- Window: 2026-11-11T17:34:28 → 17:35:12 (44.6 s, 310 debug lines)
- Method: live MCP read of the deployed app (`chart.lag`, `logs.debug.get`,
  `stream.get`, engine telemetry), taken by the Chief and handed to engineering.

## Before / after

| Signal | Before (triage, session `701a5ff1`) | After (this window) |
|---|---|---|
| Full snapshots | 41/41 `apply.payload via:"stream-full"` in ~2.5 min; re-measure 55/55 in 125 s — one per ~2.1 s | **0** `apply.payload` lines in 44.6 s |
| Paint modes | `wire.script.paint` delta 32 / subscribe 9 | 66 paints, **all `mode:"delta"`**, 0 `subscribe` |
| `chart.lag` v1 | seqGap 27 / resync 40; engineLagBars 0 | seqGap 0, resync 0, droppedTip 0, jsonFallback 0, unknownOpcode 0, longTask 0; verdict `live`, engineLagBars 0 |
| Engine telemetry latency | 3738 ms (lastEventAt ~5 min stale, state open) | 646 ms, state open |
| Apply commits | 39/39 `seq=null lastSeq=0` | 22 `apply.commit`, seqs 16, 17, 19, 20, 22, 23, 25, 27, 28 …; **7 of 22 `seq:null`** (paint transaction) |
| Window / engine bars | engineBars frozen at 10100; windowBars 10000→10002 | engineBars 5100 vs windowBars 5001–5002 (~99-bar offset) — deltas splice anyway |

The ~99-bar offset still exists and is expected; it was never the defect. The
defect was the full envelope declaring `count` from the session window while
`plots`/`series`/`bar_times` came from the evaluated prefix, which made the
client reject every delta (`delta.count < cachedCount` /
`base_index > cachedCount`, `session-delta.ts:125-160`) and resubscribe into
another full snapshot.

## Cause — unproven

Causation is **unproven**. What the evidence supports: the behaviour change
coincides with the Pages deploy `2.28.1` @ `60ac6ec5` (build
`2026-11-11T17:23:22Z`, `dirty:false`, re-read from
`https://axis.hoox.sh/version.json` on 2026-11-11). That build contains the AXIS
client fixes: `ingest-core` JSON→AXB1 cursor sync
(`src/hp/workers/ingest-core.ts`), no invented `seq:-1`, and
resume→fresh-subscribe escalation (`src/engine/live-wire.ts:199-217`), plus
`scriptFullForApplier` (`a7a85aab`).

pynescript 0.6.34 may also be required, but the running engine exposes no sha
and its cited build predates the before-state, so it cannot be credited from
this evidence.

Evidence for that limit: `https://pynescript.online/health` reports
`version:"1.0.0"` with no sha (re-read 2026-11-11); the Checker reports
`/version`, `/git`, and `/openapi.json` all 404. The image
`pynescript-api:latest` cited on the card was built `2026-11-09 20:42:21Z`,
which predates the before-state (41/41 fulls, 2026-11-10) — an artifact built
before the regression cannot be what fixed it. pynescript `6ea1d35d` /
release `654d148f` = `0.6.34` remains recorded on the card and in the pyne
handoff, but the running service does not corroborate it.

### How to prove the server half later

Rebuild the engine with an exposed git sha (e.g. `PYNE_GIT_SHA` in `/health`),
or bisect by pinning the engine back to `0.6.29` and re-measuring the same
`chart.lag` counters and `wire.script.paint` modes.

## Checker FAIL — separate, non-blocking

Separate, non-blocking: the Checker FAIL on the defensive `bar_times` slice
stands — the `slice(-count)` branch is defensive-only and unreachable for the
captured shape (`bar_times_len == columns`), so it is unproven but cannot
affect this fix.

Details: `scriptFullForApplier` (`src/engine/live-wire.ts:344`, slice fallback
at `:364`) landed in `a7a85aab`. With `bar_times_len == columns` (10022) the
`slice(-count)` branch never runs, so the 10100/10022 regression test passes
without it. Still open there: the head-vs-tail slice question and the missing
guard for declared-correct/short-columns. Track separately; not a gate on this
card's lag fix.

## AXIS-side state

- `scriptFullForApplier` at `src/engine/live-wire.ts:344` in `a7a85aab`;
  regression test at `tests/engine/live-wire.test.ts:1235`.
- Source tree clean; `origin/main...HEAD` = `0 0` at the time of the card update.
- No deploy and no push were performed by this seat for this proof.

## Checklist

```text
[1] the artifact exists at the stated path — pass
[2] the change was verified with before/after numbers — pass (table above, live MCP)
[3] every claim has a source — pass (Pages `/version.json` and pynescript `/health` re-fetched live; server-half causation explicitly marked unproven)
[4] nothing outside engineering was touched — pass
```
