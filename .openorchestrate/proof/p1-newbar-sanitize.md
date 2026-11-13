# P1 — appendBar new-bar path sanitizes/rejects non-finite OHLC; null-reject instead of 0-fill

Date: 2026-11-13 · Seat: oo-spec-2 (subagent) · Card: `p1-appendbar-new-bar-path-must-s-32bbe3d8`
Source: `.openorchestrate/proof/code-optimization-analysis-2026-11-13.md` (L1/L2)

## What changed

`src/store/index.ts` (uncommitted; working tree had prior uncommitted changes — built on top, none reverted):

1. **New-bar path now sanitizes before any mutation** (before the "close the
   previous tip" block). It computes `prevTip = unwrap(store.bars[n-1])` (or
   `undefined` when the store is empty) and runs the payload through
   `normalizeBarPayload(bar, prevTip)`. Rejection returns `'ignored'` with a
   `chartDebug('appendBar', { verdict: 'ignored', reason: 'non-finite-ohlc', … })`
   and leaves the store untouched — the previous tip is NOT closed and no bar
   is written. On success the sanitized bar replaces `bar` for the rest of the
   path (`[bar]` / slide `push` / `setStore('bars', n, bar)` / `setBarPlaneAppend`).
2. **`normalizeBarPayload` zero-fill removed** (`?? 0` on price fields). Each
   price field: finite bar value wins; else the tip's same field if finite;
   else the payload is unusable → returns `null`. Same-time (update) path and
   new-bar path both treat `null` as reject (`'ignored'` + debug log). When a
   finite tip fallback exists, behavior is identical to before (tip value substituted).
3. Volume still 0-fills (unchanged — volume is not a price; fabricating 0
   volume is pre-existing accepted behavior).

## Tests

- `tests/store-append-immutable.test.ts` — added 3 tests (a/b/c from the card):
  - new-bar frame, NaN OHLC, no finite fallback (empty store **and** all-NaN tip loaded via `loadBars`) → `'ignored'`, store unchanged;
  - new-bar frame, NaN open/close, finite tip → repaired from tip, `'appended'`, all fields finite;
  - tip with all-NaN OHLC + same-bar NaN tick → `'ignored'`, tip left NaN (not 0-filled).
- `tests/live-append.test.ts` — **one pre-existing test updated** (see "Didn't fit"):
  "keeps painting after a slide whose new boundary bar has non-finite OHLC"
  previously asserted the old behavior (boundary bar stayed in store but was
  dropped from `setData`). Under the mandated repair rule the NaN close is now
  repaired from the finite tip (100), so the bar is paintable: verdict still
  `'slid'`, `setData` called once, painted times `[120, 180, 240]`, all finite.
  Docblock updated to match. No other assertions changed.

## Verification (run, real output)

- `bun test --isolate tests/store-append-immutable.test.ts tests/live-append.test.ts tests/pane-manager.test.ts`
  → **104 pass, 0 fail**, 457 expect() calls (was 101/0 before; +3 new tests).
- `bunx tsc --noEmit` → exit 0.

## Didn't fit / flagged

- `tests/live-append.test.ts` was edited although the card text named only
  `tests/store-append-immutable.test.ts` (or a new sibling). That test pins the
  exact behavior this card retires (NaN-close boundary bar kept in store,
  dropped from paint). Leaving it red would fail the required verification
  command; deleting it would lose coverage. Minimal in-place update instead —
  flagged here for the approver.
- Behavior change to be aware of: a new-bar frame with non-finite OHLC + a
  finite tip is now **repaired from the tip** (per the card's required rules),
  not stored raw and dropped at paint time. A new-bar frame with no finite
  fallback is now rejected outright — the store keeps its prior state and the
  previous forming tip is NOT marked closed.
- Not done (out of scope): L3/L6/P2 items from the analysis (frameTipIndex, flush guard, redundant filters).
- No commit, no push, no deploy. Working tree retains all prior uncommitted changes.

## Checklist

[1] Artifact exists — this file; code in `src/store/index.ts`, tests in `tests/store-append-immutable.test.ts` (+1 updated test in `tests/live-append.test.ts`)
[2] Verified with commands above — 104/0, tsc exit 0
[3] Claims sourced from code read at lines cited above and the analysis doc
[4] Nothing outside engineering touched; no external side effects
