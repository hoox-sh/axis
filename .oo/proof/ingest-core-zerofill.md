# ingest-core zero-fill fix — proof

Card: hp/workers/ingest-core.ts barFromTip fabricates 0-price CursorBar (ZERO-FILL leak).

## Change
`src/hp/workers/ingest-core.ts`:
- `barFromTip` now returns `CursorBar | null`. Returns `null` when there is no prior
  tip AND the tip carries no usable price bits (OPEN/HIGH/LOW/CLOSE all absent, or
  present-but-undefined). When there is no prior tip but some price bits exist,
  missing OHLC fields are seeded from the bits actually present (never from 0).
- `TIP_UPDATE`: on `null`, emits `{ ok: true, kind: 'frames', frames: [] }` — no bar, no
  cursor mutation.
- `APPEND_BAR` / `APPEND_BARS`: tip emission is gated on a non-null tip bar
  (`hasTip = mask&TIME && tipBar != null`); the closed-bar path is unchanged.

## Design decision (return contract)
The function contract is now `CursorBar | null` rather than a sentinel bar: CursorBar has
no honest "unknown price" sentinel (0 is a valid-looking finite number that defeats the
store sanitizer), so absence is signalled by `null` and callers skip the emit. For
APPEND_BAR(S) the closed bar is always real, so the frame is still emitted with the
no-tip shape (forming: false) instead of being dropped.

## Verification
- `bunx tsc --noEmit` — clean.
- `bun test tests/hp/` — 121 pass, 0 fail (8 files), incl. 3 new tests in
  tests/hp/ingest-core.test.ts:
  (a) no prior tip + no price bits → frames: [] and cursor.lastBar stays null;
  (b) no prior tip + partial price bits → missing OHLC seeded from present bits;
  (c) prior tip present → unchanged fallback behavior.
- Note: (a) expects `frames: []`; the ingest worker already guards `frames.length`
  before pushing to the coalescer, so nothing is posted.

No commits, no push, no deploy. Only src/hp/workers/ingest-core.ts and
tests/hp/ingest-core.test.ts touched.

## Zero-fill sweep (follow-up to checker FAIL)

Remaining `?? 0n` / `?? 0` fabrication paths removed from `src/hp/workers/ingest-core.ts`:

- `snapshotBars()` (SNAPSHOT_OHLCV): bars are built via a shared `barFromArrays()` helper. A bar is
  emitted only when time is present and normalizable AND all four OHLC ticks are present; otherwise
  the bar is skipped. Emitted count (cursor `count` and payload `count`) reflects bars actually
  emitted. Empty snapshot → `bars: []`, `count: 0`, `lastBar: null` — no placeholder bars.
- `APPEND_BARS` closed-bar loop: same helper; `nextCount` now adds `closedBars.length` (emitted),
  not the claimed `n`. Missing/short arrays → only real bars emitted.
- `serverBarSec(ax.timeS[i] ?? 0, 0)` epoch-0 fallback removed from both paths: a missing/unnormalizable
  time now disqualifies the bar entirely (skipped), never epoch 0.
- Volume: when absent, a real `0` is used. This is intentional and standard — a fresh bar with a
  known price may legitimately carry volume 0; volume is not a price and is never fabricated from thin
  air. Price/time fabrication remains forbidden.
- `mapAxb1` is now exported so tests can feed synthetic in-memory frames (the AXB1 wire decoder reads
  exactly `count` elements or throws, so truncated arrays cannot arrive over the socket; the guard is
  defense-in-depth and is tested at the mapAxb1 level).

Behavior note (TIME-only tip with a prior closed bar): with a prior tip present, a TIME-only
TIP_UPDATE yields `hasTip=false`, `forming:false` — the delta carries the closed bar only and no
forming tip bar. This is stricter than the pre-fix behavior and is intentional: we never synthesize
OHLC for a tip we cannot build from real data. Confirmed as intended semantics.

Tests added (tests/hp/ingest-core.test.ts, `zero-fill sweep` describe):
(a) SNAPSHOT_OHLCV truncated arrays → no 0n bars; only complete bars emitted; count = emitted.
(b) APPEND_BARS with fewer array elements than count → only real bars emitted; count = prior + emitted.
(c) missing time → bar skipped, never epoch 0 (asserts no bar with time 0).

Verification: `bun test tests/hp/` — 125 pass, 0 fail (8 files). `bunx tsc --noEmit` — clean.
No commits, no push, no deploy. Only src/hp/workers/ingest-core.ts, tests/hp/ingest-core.test.ts,
and this proof file touched.

## Epoch-0 sweep (pass 3)

Rule applied uniformly: skip / emit nothing when time is unknown — never fabricate epoch 0.

- L580 CLOSE_VERIFY (`serverBarSec(ax.timeS, cur.lastBar?.time ?? 0)`): now `normalizeBarTime(ax.timeS) ?? cur.lastBar?.time ?? null`; if null, the handler returns `frames: []` and the cursor is not updated. No verified bar, no closeFrame, no delta — nothing emitted.
- L629 APPEND_BAR (`serverBarSec(ax.closedTime, cur.lastBar?.time ?? 0)`): same pattern; if null, returns `frames: []` before building the closed bar, closeFrame, or delta. No closed bar emitted.
- L657 APPEND_BAR closeFrame payload (`serverBarSec(ax.closedTime, 0)`): now uses the already-resolved `closedTime` (guaranteed non-null at that point); the `?? 0` path is gone.
- `barFromTip` seeded `base.time: 0`: time is resolved before seeding — tip TIME bit normalized, else prior tip's real time, else `null` → `barFromTip` returns null (no forming bar). If a prior tip exists, its real time is used (never 0). Seeded base carries the resolved `time`, not 0.
- The now-unused `serverBarSec` helper was removed; all call sites use `normalizeBarTime` directly.

Tests added (tests/hp/ingest-core.test.ts, `epoch-0 sweep` describe):
(a) CLOSE_VERIFY, no prior tip, missing/unnormalizable timeS → `frames: []`, cursor lastBar stays null.
(b) APPEND_BAR, no prior tip, missing/unnormalizable closedTime → `frames: []`, no closeFrame, cursor lastBar stays null.
(c) TIME-only TIP_UPDATE with unnormalizable timeS and no prior tip → no bar emitted (barFromTip returns null via the decode path), cursor lastBar stays null.

Verification: `bun test tests/hp/` — 128 pass, 0 fail (8 files; 125 pre-existing + 3 new). `bunx tsc --noEmit` — clean (no output).
No commits, no push, no deploy. Only src/hp/workers/ingest-core.ts, tests/hp/ingest-core.test.ts, and this proof file touched.
