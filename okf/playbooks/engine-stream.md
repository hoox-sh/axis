---
type: "Playbook"
title: "Engine stream"
description: "The WS subscription plane (subscribe → status → full → delta → close): profiles, frames, watermark, close verification, and reconnect."
tags: [axis, playbook, okf, engines, live, stream]
status: stable
okf_lock: human
generated:
  by: human:jango_blockchained
  at: 2026-10-16T00:00:00Z
sources:
  - id: plan
    resource: ".opencode/plans/final/plan.mdx"
    title: "Engine redesign — final plan"
---

# What this is

The engine-owned data plane for engines that advertise
`features.live_stream`. One WebSocket per engine endpoint carries N
multiplexed subscriptions; the engine ensures history, evaluates once, and
pushes deltas. The client applies snapshots/deltas and verifies closed bars.
Client code lives in [src/engine](/code/src/engine.md) (protocol) and
[src/streams](/code/src/streams.md) (`stream-live.ts` glue); the server side is
the sibling `pyne` repo (`backend/api/live_ws.py`, `live_ensure.py`,
`feed_manager.py`, `live_push.py`).

# Profiles

* **Stream** (`liveStream === true`, strictly opt-in from `features.live_stream`):
  the default. Client sends script + identity only, never bars.
* **Calculator** (everything else): the legacy bars-in path
  (`src/engines/`, `POST /run`, `/session`, `/data/*`). See
  [live evaluation sessions](/playbooks/live-evaluation-sessions.md).
* Routing is `routeEngineRun()` (`src/engine/router.ts`): opt-out via
  `axis.engine.stream.disabled` forces legacy; anything failing open takes
  legacy too. A 60s cooldown after a stream failure keeps a flapping backend
  from stalling live.

# Frames

Client → engine: `auth`, `subscribe {id, kind, meta, script?}`, `resume`,
`repair {from_time}`, `unsubscribe`, `ping`. Engine → client: `auth.ok`,
`status`, `full`, `delta`, `close`, `verify.result`, `error`, `pong`.

* Every `full`/`delta`/`close` carries a per-subscription monotonic `seq`.
  A gap (`seq > last + 1`) means dropped frames → `resume`, never a silent
  partial apply (`classifySeqGap` in `src/engine/frames.ts`).
* Deltas merge positionally (`cached[:base_index] + tail`, exact `tail_len`)
  through `resolveSessionPayload`; unmergeable deltas report `needs-full`.
* `DATA_MISS` is not an error — it becomes `status(datafeed-loading)` plus an
  autonomous server-side fetch.
* Back-to-back frames on one id share an inbox (`StreamLiveWire`): status
  frames route to handlers while the snapshot wait drains — a snapshot arriving
  in the same TCP segment as its statuses is never lost.

# Watermark and close verification

* `closed_upto` on every `full`/`delta` marks final bars; later values are
  provisional. The engine finalizes the bar with venue values before advancing
  it and pushes `close {index, time, ohlcv}`.
* The client re-verifies closed OHLCV exactly (`compareClosedOhlcv` — any field
  difference is a mismatch) and sends `repair {from_time}`; the exchange's
  version wins. The client never edits closed bars locally.

# Reconnect

WS drop → reconnect + `resume(count, last_time, seq)` per subscription; the
server answers `delta` when continuous, else `full`. Session ids are owned by
the caller (`session-multiplexer`) and survive reconnects; reconnect handlers
re-issue subscribes. Engine restarts rebuild from the session journal (one
re-evaluation). Unsubscribe releases the script session and detaches the feed.

# Before changing this path

* `tests/engine/live-wire.test.ts` (inbox, fallback, cooldown) and
  `tests/integration/engine-stream.e2e.test.ts` (fake engine speaking the real
  validators: subscribe → status → full → delta → close).
* PYNE side: `tests/test_live_ws.py`, `tests/test_live_ensure.py`,
  `tests/test_feed_manager.py`, `tests/test_live_push.py`.
* `store.live.feeds` / `scriptStatus` are ephemeral (never persisted, always
  hydrate empty); HUD reads them via `feedStatusTone` / `feedStatusLabel`.
