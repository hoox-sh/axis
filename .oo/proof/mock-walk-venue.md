# Mock-walk venue: replay repaint root cause + fix

Date: 2026-11-16 · Branch: `cursor/studio-ui-polish-abef` → merged to `main` as `8da93b1b` · Commits: `324448e3` (venue), `e7cdddaa` (fix), `f68cfb1a` (debug breadcrumb)

## Symptom
On the mock-walk venue (5000-bar synthetic 10s walk, bar-replay from bar 4000), stepping
+100 bars left the chart visually frozen: candles and EMA/RMA lines stopped advancing
while the replay badge, script badges and the reference panel showed the correct values.
Axis last-value labels showed EMA `98.17638300` / `RMA 99.43856055` — i.e. the painted
series ended at the value of bar 4015 (`EMA[4015] == 98.1763829987` exactly; fixture
`src/dev/mock-walk-bars.ts`), ~85 bars behind the cursor.

## Root causes (two, independent)
1. **Viewport never re-anchored on replay repaint.** Replay steps repaint via full
   `setData`; `manager-access.setDataToChart` preserves the logical range
   (`keepRange`), so newly painted bars landed off-screen right and the visible window
   stayed at bar ~4015. Fix: `snapChartToRecentBars()` re-anchors the visible range to
   the newest bar after each replay repaint (`src/ui/BarReplayControls.tsx`,
   `src/chart/manager-access.ts`).
2. **Live ingress was not fenced from the venue.** The boot-time BTCUSDT load, venue
   ticks (`appendLiveBar`), stream snapshots and feed-session deltas could land on the
   synthetic series — one foreign BTC bar turned engine EMA into ~6190 and mixed the
   two symbols into one axis. Fix: `src/dev/venue-active.ts` flag honored by
   `store.appendBar`, `loadBars` (foreign symbols dropped while venue is active),
   `data/load-symbol.ts` (feed deltas + foreign loads), `stream-live.ts`
   (`onSeriesFull`/`onSeriesDelta`) and `chart/live-append.ts`. Replay-exit now reloads
   the pre-venue symbol (`exitMockWalkVenue`) instead of leaving the chart on MOCK-WALK
   with live ticks appended.

## Also: sealed-cell re-pin breadcrumb
`chart/commit-store.ts` `resetCommitStore()` now logs `commit-store.reset` with the
caller stack (debug mode only, `commit-store.ts`). Deployed to diagnose the
live "lines drift" report: the live feed logs `close mismatch — repair requested`
permanently (`compareClosedOhlcv` is an exact field compare). Decision on epsilon
compare pending (board card: "AXIS live: close-verify…").

## Verification (headless Chromium, dev server, seeded indicator scripts)
- Venue enters and holds; Exit exits and reloads previous symbol.
- Walk +100 twice: viewport advances, lines track the tip; EMA/RMA axis labels match
  the reference panel and engine exactly (85.6351… / 87.57…), both walks.
- No foreign (BTC) bars in the mock series after the fence (was: mixed-time axis,
  garbage EMA ≈ 6190).
- `bun check` clean; `bun test --isolate --max-concurrency=1 tests/ worker/tests/` →
  5491 pass / 0 fail / 10 skip (2026-11-16, main @ 8da93b1b).

## Images
- `mock-walk-venue-4000.png` — venue entry (bar 4000/5000)
- `mock-walk-venue-4100.png` — after +100 walk; viewport advanced, lines at tip
- `mock-walk-venue-4200.png` — after +200; still tracking; RMA/EMA tags match panel

## Open
- Not pushed/deployed (owner decision pending — see board card re: deploy).
- Live "old segments drift" not yet conclusively closed; `commit-store.reset` breadcrumb
  will confirm/deny on a live session.
