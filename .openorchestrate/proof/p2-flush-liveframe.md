# P2 — flushLiveFrame compare-and-skip + frameTipIndex on the new-bar path

Date: 2026-11-13 · Seat: oo-spec-2 (subagent) · Card: "P2: flushLiveFrame compare-and-skip + frameTipIndex=n on new-bar append (store/index.ts)"
Source: `.openorchestrate/proof/code-optimization-analysis-2026-11-13.md` — finding 3 (flushLiveFrame re-creates the tip) + L6 (frameTipIndex never set on the new-bar path)

## What changed

`src/store/index.ts` (uncommitted; built on top of the uncommitted P1 new-bar sanitize work — not reverted, not modified beyond this card's scope):

1. **Compare-and-skip in `flushLiveFrame`** — a module-level `frameTipSnapshot: Bar | null` records the tip's fields at the last flush. On flush, the current tip (`unwrap(store.bars[tip])`) is compared field-by-field (`time, open, high, low, close, volume, closed` via `sameBarFields`). If nothing changed, the `setStore('bars', tip, {...})` re-spread and `setBarPlaneTip(...)` are skipped entirely. On change (or first flush, or bars replaced with a different-timed tip), the spread happens as before and the snapshot is refreshed.
   - Note on mechanism: Solid's `mergeStoreNode` skips primitive-equal keys, so an unchanged re-spread notified nobody — its cost was the object allocation + key walk per frame. The compare-and-skip removes that per-frame waste; behavior for real changes is unchanged. (Solid tracks `closed` via `(a.closed === true) === (b.closed === true)` so `undefined` vs `false` compares equal.)
2. **`frameTipIndex = n` on the new-bar path** — all three success branches now set the pending flush index to the new last index: empty store → `0`; ceiling-slide branch → `next.length - 1` (was `frameTipIndex = null`); plain append → `n`. Previously the value pending from an earlier update tick (`n-1`, now the closed bar) survived, so the next flush re-spread the *closed* bar and merged it over `barPlane.tip` (`setBarPlaneTip` with the old bar's OHLC overwrote the plane tip set moments earlier by the append). Now the pending frame targets the new tip.
3. **Rejection paths untouched** — `'ignored'` returns (non-finite OHLC, late tick, closed-tip stale tick, closed-OHLC rewrite) return before any mutation and before `frameTipIndex` is written; the bars array is unchanged, so any pending `frameTipIndex` stays valid. Covered by a test.
4. **Test probe** — `_liveFrameProbeForTests()` / `_resetLiveFrameProbeForTests()` (test-only, same pattern as `_setLiveFrameSchedulerForTests` / `_flushRunResultPersistForTests`) count tip re-spreads and record the last flushed index, since Solid's equal-primitive merges are unobservable through the public store API.

## Tests

`tests/store-live-frame.test.ts` — new describe block `live frame tip write-through` (3 tests):

- **zero-change flush performs no store write**: after a first flush, a bare `noteTick`-scheduled flush writes nothing (`tipWrites` stays 1); a no-op forming tick (identical OHLCV) also writes nothing; a real change (`close` 1.5→1.75) re-spreads exactly once (`tipWrites` 2, `lastTipIndex` 0).
- **new-bar append retargets the flush**: after an update flush on bar 0, a new-bar append + `noteTick` flush reports `lastTipIndex === 1` (not the stale 0) and `barPlane.tip.time` equals the new bar (`1_700_000_260` / close 2.5) — i.e. the plane tip is not clobbered back to the closed bar.
- **`'ignored'` rejection does not clobber the pending index**: closed-tip stale tick rejected; the pending flush still targets index 0 and the closed bar stays closed.

## Verification (run, real output)

- `bun test --isolate tests/store-live-frame.test.ts` → **4 pass, 0 fail** (1 pre-existing + 3 new), 21 expect() calls.
- `bun test --isolate tests/store-live-frame.test.ts tests/store-append-immutable.test.ts tests/live-append.test.ts tests/store-closed-on-new-bar.test.ts tests/store-append-scale.test.ts` → **48 pass, 0 fail**.
- `bun test --isolate tests/store-live-frame.test.ts tests/store.test.ts tests/store-append-immutable.test.ts tests/store-closed-on-new-bar.test.ts tests/store-append-scale.test.ts tests/bars-cache-coverage.test.ts` → **125 pass, 0 fail**.
- `bun test --isolate tests/pane-manager.test.ts tests/engine/live-wire.test.ts tests/indicators/apply-live.test.ts tests/slot-live-append.test.ts` → **163 pass, 0 fail**.
- `bunx tsc --noEmit` → exit 0, no output.
- `bunx biome check src/store/index.ts tests/store-live-frame.test.ts` → 23 warnings, all pre-existing house-style (`noNonNullAssertion`, `useOptionalChain`); no errors introduced.

## Notes / boundaries

- Diff is on top of the uncommitted P1 working tree; P1 hunks in `src/store/index.ts` are untouched by this change (same hunks, verified in `git diff`).
- `frameTipSnapshot` is only ever a skip hint: any change in any compared field (or a different tip index) forces the write, so a stale snapshot can cause at most a redundant write, never a skipped needed write of *changed* data — and an unchanged tip has nothing to write.
- No commit, no push, no deploy. Board not moved (owned by the orchestrator). Proof file left uncommitted alongside the change.

## Checklist

[1] Artifact exists — this file; change in `src/store/index.ts`, tests in `tests/store-live-frame.test.ts`
[2] Verified — bun test runs above + `bunx tsc --noEmit` exit 0
[3] Claims sourced from the analysis doc, the code read at the cited sites, and the test runs above
[4] Nothing outside engineering touched; no external side effects; no commits/pushes/deploys
