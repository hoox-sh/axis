---
type: "Playbook"
title: "Chart apply and bar windows"
description: "Repair never drop at the setData boundary, and the three bar counts a live tick has to keep straight."
tags: [axis, playbook, okf, chart, data]
status: stable
okf_lock: human
generated:
  by: human:jango_blockchained
  at: 2026-10-13T00:00:00Z
sources:
  - id: sanitize
    resource: "src/chart/series-sanitize.ts"
    title: "setData payload repair"
  - id: manager-access
    resource: "src/chart/manager-access.ts"
    title: "History paint and full setData"
  - id: pane-manager
    resource: "src/chart/pane-manager.ts"
    title: "Series apply guards"
  - id: load-symbol
    resource: "src/data/load-symbol.ts"
    title: "Venue load and page walk"
  - id: dsm
    resource: "src/data/dsm-orchestrator.ts"
    title: "Dataset repaint and chart window slice"
  - id: live-append
    resource: "src/chart/live-append.ts"
    title: "Live bar append verdict"
  - id: store
    resource: "src/store/index.ts"
    title: "Chart window authority and appendBar"
---

# Three bar counts, not one

Keep these apart; most paint bugs come from mixing them up. They are owned by
[src/data](/code/src/data.md), [src/indicators](/code/src/indicators.md), and
[src/store](/code/src/store.md).

| Count | Where | Meaning |
| --- | --- | --- |
| Dataset depth | `historyBars` | What venues/DSM backfill into the dataset store. |
| Chart window | `rollingWindowBars` | The newest N bars the chart paints and the engine evaluates. |
| Engine window | `applyRollingWindow` | Caps what is sent to the engine, including explicit `opts.bars`. |

`chartWindowLimit()` ([src/store](/code/src/store.md)) is the **single
authority**: the load paths, the live append path, the background catch-up and
`applyRollingWindow` all read it, so the chart can never hold a different
number of bars than the engine evaluated. `ROLLING_WINDOW_MAX` equals
`HISTORY_BARS_MAX` — the setting cannot promise a window the chart refuses to
paint.

* Every paint path slices the dataset to the chart window (`sliceForChart`,
  `applyCachedToChart`), so the store and the chart agree. An explicit
  `maxBars` window wins over the Rolling window setting.
* The chart window **slides**: a new bar at the cap drops the head
  (`appendBar` → `'slid'`), it does not extend the series. The paint layer
  mirrors the slide with a full `setData` — `series.update` cannot remove the
  oldest bar.
* Overlay points are keyed by **time**, not by index into the store, which is why
  a windowed run can land on its own axis. Series arrays and the time axis handed
  to the mapper must still be the same length: an engine series longer than the
  chart window maps index-for-index and shifts every value by the difference.
  A slid window leaves the script series one row short (the engine has not
  re-run yet) — the prune pads them back to one row per candle with Pine `na`
  whitespace rows, or the indicator pane drifts against the price pane.
* Engine-owned live mode on the **calculator profile** (every-tick PYNE Pro,
  `data_session` caps) makes that divergence structural: the venue stream is
  only a trigger, each flush paints the engine's newest window, and the
  per-script data session appends while the local Rolling window slides. So the
  paint must advance `store.bars` (`setBarsQuiet` — memory only) and the runner
  must **tail-align** the `data-session-*` series to the chart window before
  any zip (`tailAlignSeriesToWindow`). Skip either half and indicators freeze
  on the load window ("stays as on the first print") even though candles keep
  moving. On the **stream profile** (`WS /ws/live`) there is no poll or
  tail-align: deltas carry `{base_index, count, tail_len}` plus a monotonic
  `seq`, merge through `resolveSessionPayload`, and advance the `closed_upto`
  watermark — see [engine stream](/playbooks/engine-stream.md).
* A private bar window (HPO holdout, walk-forward) must never take the live path:
  no session fast path, no tip-only apply. The runner records chart-vs-private
  window *once, up front* because `store.bars` can be replaced between capture and
  evaluation (progressive slices, live appends) — reference identity checked later
  inside the run misfires on every turbulent tick.

# The immutable candle

"Immutable" means: **everything behind the tip is final.** Three rules, all in
`store.appendBar`:

1. A tick for a bar **behind the tip** is dropped. Appending it would put the
   series out of order and break every index-based zip.
2. A **closed** tip is never reopened by a forming tick. `Bar.closed` is the
   venue's own flag; a bar the venue reported as closed is final.
3. The **dataset** follows the same rule: `mergeWithConflictPolicy` keeps a
   closed bar against an incoming forming one, so a stale REST page cannot
   reopen a candle.

`appendBar` returns a verdict (`ignored` / `updated` / `appended` / `slid`).
`chart/live-append.ts` is the only place a live bar reaches the chart, and the
verdict gates the side effects: a rejected tick must not move the price card,
evaluate an alert, or overwrite a dataset bar.

The tip itself is mutated **in place** — Solid's store setter merges an object
into the existing node, so the payload is normalised first (every field
present) or a tick without a volume would keep the previous volume.

# setData: repair, do not drop

Lightweight Charts asserts **during the render pass**, not at `setData`, so a
`try { series.setData() } catch` cannot catch its `Value is null`. By then a bad
row is stored and every redraw throws.

* Duplicate or non-ascending open times: keep the **last** write for that stamp
  and re-sort. Dropping instead shortens the series against the time axis the
  overlay mapper walks.
* Missing / null / non-finite OHLC: fill from the nearest valid neighbour
  (previous first, then next); drop only when neither exists.
* `value: null` is rejected by the library and is coerced to `0`. An **omitted**
  `value` is the whitespace encoding for a Pine `na` gap and must stay omitted —
  whitespace rows and zero rows look alike in a diff and very different on the
  chart. A **non-finite** value is a Pine `na` the engine could not serialize:
  it becomes whitespace, not a numeric `0` (a zero draws a line at the axis).
* The guard runs once at the `safeSetData` boundary in
  [src/chart](/code/src/chart.md), so candles, volume, overlay lines, equity and
  indicator paths are covered together. A new series that calls the library
  directly bypasses it.

# The dataset repair must not drop venue bars

`repairBars` snaps individually off-phase bars onto the series' dominant
open-time phase. The snap is **collision-safe**: a bar only moves onto a
*free* grid point, and keeps its own timestamp when both neighbours are
taken. Snapping into an occupied slot deletes a real venue bar (the dedupe
keeps one row per open time), shifts another bar's OHLCV onto the wrong
candle, and leaves a hole the gap detector reports as fillable — the DSM
chases it on every round and the job ends with "Partial: N gaps remain".
The repair is idempotent and never snaps onto a non-positive time
(`sanitizeBar` drops those on the next pass).

# Gaps

* A gap is a window larger than one interval step (tolerance 1.5×).
* **Session venues** are closed from Friday's close to Monday's open: a
  missing Friday bar belongs to that closure and is never chased. A missing
  Monday bar *is* chased.
* Every validation site must pass the venue calendar class
  (`venueClassForSourceCaps`) — without it a complete session dataset looks
  incomplete and the job re-walks the whole range on every run.
* The gap-fill progress is measured against the **dataset store** the job
  writes to, not the bars cache (session persistence mode never writes the
  cache, so the counter stayed at 0).
* The walk-back advances its cursor by one **step**, not one second. A venue
  answers "the newest bar with open time ≤ endTime"; with a one-second
  cursor a venue whose bars sit on their own grid answers one second off it,
  and the dataset grows a one-second hole — a phantom gap the job chases.
  The one duplicated bar per page is dropped by the merge.
* Adjacent gaps are merged before the fill walk: one request covers the
  union instead of one per fragment.

# The dataset store

* The stored series is **repaired** (sorted, unique, sanitized) on every
  write. A read therefore does not need another repair pass — a page write
  merges the page in one linear pass (`mergeSortedSeries`), and the
  validation only repairs a series that is not already sorted + unique.
* A sink that cannot be read must **throw**; "absent" and "broken" are
  different answers. A write against an unreadable sink is refused — merging
  into an empty base replaces the whole dataset with the last page.
* Writes are serialized per key, and the sink replace is a single record put
  (never clear-then-write).
* The dataset key keeps the **case** of a DEX pool symbol and carries the
  provider lock (`market` / `authMode`) for a non-spot or keyed series.

# Apply on live ticks

* A genuine live tick may reuse the tip (`forceFull: false`); anything that
  recomputed the script (input override, edited source, manual reapply) must
  force a full `setData`, because nothing else in the series is trustworthy.
* When the chart is at the window cap, an append slides the head, so the
  append-only repaint path no longer matches and the paint is a full `setData`.
  That is expected, not a regression.
* Bar replay paints only the visible prefix; the store keeps the full window.

# Tests

`tests/chart-series-sanitize.test.ts` covers the repair rules,
`tests/rolling-window.test.ts` the window plumbing,
`tests/store-append-immutable.test.ts` the immutable-candle rules and the
window slide, `tests/live-append.test.ts` the append verdict,
`tests/dsm-orchestrator-repaint.test.ts` the live-tail merge and
`tests/data-source-manager.test.ts` the walk-back grid — all indexed under
[tests](/code/tests.md). A `Value is null` window error after a paint means a
row reached the library without going through the guard — check the newest
series producer first.
