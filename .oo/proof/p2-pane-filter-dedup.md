# P2 — Drop redundant safeData/safeVolData pre-filters in pane-manager

Date: 2026-11-13
Card: "P2: drop redundant safeData/safeVolData pre-filters in pane-manager (keep dropRowsOutsideCandleTimes)"
Source: `.openorchestrate/proof/code-optimization-analysis-2026-11-13.md`, findings 1 and 7.

## What was removed (src/chart/pane-manager.ts)

**setVolumeData** (was ~3753–3778):
- `candleTimes` pre-filter — `mapBarsToVolumeData(bars, volColors).filter(row => !candleTimes || candleTimes.has(row.time))`. Dead weight: `mapBarsToVolumeData` (src/chart/heavy-data.ts) already applies the exact candle skip rule (`isFinitePriceBar`, the same predicate `mapBarsToPriceData` → `toOhlcData` uses), and `filterValidCandleRows` only dedupes times (the time survives), so no row this filter could remove exists at this point.
- `safeVolData` finite filter + the `dropped-unsafe-rows` debug branch. Dead weight: `mapBarsToVolumeData` already drops non-finite-time/OHLC bars via `isFinitePriceBar` and coerces volume (`Number.isFinite(b.volume) && b.volume >= 0 ? b.volume : 0`), so `time`/`value` are always finite here.

**setCandleData** (was ~3603):
- `safeData = cleanData.filter(isFiniteOhlcBar(...))` plus the `dropped-unsafe-rows` debug branch. Strict subset of what `filterValidCandleRows` (src/chart/series-sanitize.ts) already removes: finite time + finite OHLC, plus dedup. The branch could never fire. All downstream references now use `cleanData` directly.

`isFiniteOhlcBar` (exported at pane-manager.ts:409) kept — still used at the live-append path (~3312).

## What was kept (deliberately)

- `dropRowsOutsideCandleTimes()` — called synchronously right after `setData` in both `setCandleData` and `setVolumeData`. Sole owner of the "no series holds a time the candles do not" invariant for the volume series (and co-painted script series). Kept unchanged.
- `filterValidCandleRows` / `isFinitePriceBar` / `mapBarsToVolumeData` unchanged — no behavior change, no fold needed (the finite check already lives in `mapBarsToVolumeData`).
- One invariant, one owner each: candles → `filterValidCandleRows`; volume rows → `isFinitePriceBar` inside `mapBarsToVolumeData`; cross-series time parity → `dropRowsOutsideCandleTimes`.

Note: the removed blocks were part of the pre-existing uncommitted working-tree changes (not HEAD), so `git diff HEAD` shows only the new comments + pre-existing formatting churn; net behavior vs HEAD is identical (HEAD never had the double filters).

## Verified against

- `mapBarsToPriceData` (src/chart/chart-type.ts) — non-finite bars dropped via `isFinitePriceBar`; HA path also via `toOhlcData`.
- `filterValidCandleRows` (src/chart/series-sanitize.ts:168) — same finite-time/OHLC predicate + duplicate-time dedup (last write wins; time kept).
- `mapBarsToVolumeData` (src/chart/heavy-data.ts ~190) — same skip rule + volume coercion.

## Tests run

- `bun test --isolate tests/pane-manager.test.ts` → 65 pass / 0 fail
- `bun test --isolate tests/heavy-data.test.ts tests/chart-series-sanitize.test.ts` → 33 pass / 0 fail (98 across the three files, 295 expect() calls)
- Related suites: `tests/apply-window-alignment.test.ts chart.test.ts chart-time-axis.test.ts compare-overlay.test.ts indicators-reapply.test.ts onchain-overlay.test.ts overlay-sync.test.ts pane-badge.test.ts plot-visuals.test.ts engine/v1-apply-markers.test.ts engine/v1-p6-flags.test.ts` → 164 pass / 0 fail
- `bunx tsc --noEmit` → clean

Behavior unchanged: no code path that previously dropped a row can now pass one (removed filters were provably no-ops); no commits, no push, no deploys; store/index.ts, live-wire.ts, package.json untouched by this change.

## Result

PASS — redundant pre-filters removed, single-owner invariant layout in place, all 262 related tests green, typecheck clean.
