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

* Every paint path slices the dataset to the chart window (`sliceForChart`,
  `applyCachedToChart`), so the store and the chart agree. An explicit `maxBars`
  window wins over the Rolling window setting.
* Overlay points are keyed by **time**, not by index into the store, which is why
  a windowed run can land on its own axis. Series arrays and the time axis handed
  to the mapper must still be the same length: an engine series longer than the
  chart window maps index-for-index and shifts every value by the difference.
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
  chart.
* The guard runs once at the `safeSetData` boundary in
  [src/chart](/code/src/chart.md), so candles, volume, overlay lines, equity and
  indicator paths are covered together. A new series that calls the library
  directly bypasses it.

# Apply on live ticks

* A genuine live tick may reuse the tip (`forceFull: false`); anything that
  recomputed the script (input override, edited source, manual reapply) must
  force a full `setData`, because nothing else in the series is trustworthy.
* When the chart is at the window cap, an append slides the head, so the
  append-only repaint path no longer matches and the paint is a full `setData`.
  That is expected, not a regression.
* Bar replay paints only the visible prefix; the store keeps the full window.

# Tests

`tests/chart-series-sanitize.test.ts` covers the repair rules and
`tests/rolling-window.test.ts` the window plumbing, both indexed under
[tests](/code/tests.md). A `Value is null` window error after a paint means a row
reached the library without going through the guard — check the newest series
producer first.
