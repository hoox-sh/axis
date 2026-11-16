# Hygiene: CHANGELOG attribution + pane-manager axis-parity docblock (2026-11-13)

## Changes
- CHANGELOG.md [Unreleased] Fixed bullet on "candle setData failed: Value is null": replaced stale claim that setCandleData/setVolumeData run a final LWC-safety filter right before setData(). Now states finite-row guarantees come from filterValidCandleRows / mapBarsToVolumeData, and cross-series time parity is enforced AFTER setData by PaneManager.dropRowsOutsideCandleTimes().
- CHANGELOG.md [Unreleased] `via` bullet: appended attribution — part of the 2026-11-13 optimization batch, type narrowing only, no behavior change, no card (attributed in-line).
- tests/pane-manager.test.ts: added one-line docblock above describe('setCandleData + setVolumeData keep one axis') noting it covers the volume/candle time-parity invariant owned by dropRowsOutsideCandleTimes (2026-11-13 optimization batch). No assertions changed.

## Verification
- bunx tsc --noEmit → exit 0
- bun test --isolate tests/pane-manager.test.ts → 65 pass, 0 fail, 220 expect() calls

## Diff review
- src/chart/live-append.ts + src/streams/multiplex.ts diff reviewed: coherent no-behavior-change type narrowing (via?: 'worker' → 'worker'|'venue', default 'venue'; multiplex passes via:'venue'). Not half-finished; not reverted.

## Not attributed to a card
- The 2026-11-13 optimization batch as a whole has no card; the `via` narrowing and the pane-manager axis-parity tests are attributed in the changelog/test docblock only. No card was created (scope: CHANGELOG + test docblock only).
