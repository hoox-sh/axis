---
type: "Playbook"
title: "Live evaluation sessions"
description: "When the O(delta) session path may run, what continuity requires, which responses are not results, and how failures are memoised."
tags: [axis, playbook, okf, engines, live]
status: stable
okf_lock: human
generated:
  by: human:jango_blockchained
  at: 2026-10-13T00:00:00Z
sources:
  - id: live-sessions
    resource: "src/engines/live-sessions.ts"
    title: "Live-session client"
  - id: catalog
    resource: "src/engines/catalog.ts"
    title: "Engine catalog and session fast path"
  - id: runner
    resource: "src/indicators/runner.ts"
    title: "Indicator runner liveTick plumbing"
  - id: tests
    resource: "tests/engines-live-sessions.test.ts"
    title: "Session continuity regression tests"
---

# What this is

The `server` engine may evaluate a genuine live tick through a PYNE live session
(`POST /session`, `/session/{id}/tick`, `/session/{id}/append`, `DELETE
/session/{id}`) instead of re-running the whole window. The client is
`live-sessions.ts` and the fast path lives in the engine's `run`. The flag is
raised by [src/streams](/code/src/streams.md) and forwarded by
[src/indicators](/code/src/indicators.md); both files are under
[src/engines](/code/src/engines.md).

The rules below are the ones that bite. Read them before changing the session
client, the fast path, or the runner plumbing.

# Protocol invariants

* **Tick-then-append.** `append` confirms the session's *stored* forming bar, so
  appending final close values without ticking first leaves a duplicate bar
  (stale confirmed + new appended). The client ticks the finalized base before it
  appends the strictly newer tail, and only when the base's OHLCV actually moved.
* `tick` overwrites the forming cell and does **not** advance the bar count;
  `append` advances it by the number of bars sent.
* **A session freezes its inputs and libraries at create.** `/tick` and
  `/append` carry bars only. Anything that must change per tick cannot live in a
  session.
* The envelope is `/run`-shaped and reports `count` (bars the session holds).
  A no-change tick reuses the last envelope instead of calling the server.
* Sessions are **interpret-only**: compile has no resumable evaluator state, and
  the create body asks for `mode: "interpret"` explicitly.

# Eligibility (who may tick)

* A tick may only follow a full run the backend itself resolved to `interpret`.
  The client remembers the mode *reported* for each `(endpoint, script, mode
  sent, profiler)` run key and allows the fast path when that was `interpret`, or
  when the configured mode is `interpret`. Never assume `auto` means interpret —
  `auto` can compile, and a compiled series must not silently switch to
  interpreted values mid-stream.
* A script whose resolved inputs hold **any non-scalar value** skips the session
  path. `resolveInputSourceValues` inlines cross-indicator `input.source` refs as
  live series arrays; sessions would freeze them (stale) and content-keying them
  would recreate the session every tick. Such scripts stay on the full run.
* Endpoints without session routes (`404` / `405` / `501`) are remembered once,
  so the fallback costs one probe per endpoint rather than one per tick.
* `503` / `SESSIONS_FULL` sets a create cooldown per endpoint.

# Continuity

Continuity is judged per session key (endpoint + script + inputs + libraries +
symbol + interval) against Pine-millisecond bar times.

* Session state is `count`, `lastTime`, a snapshot of the last evaluated bar, the
  last envelope, and a **fingerprint of the closed bars** `bars[0..count-2]`. The
  forming tip is excluded on purpose — it changes every tick.
* Same count + same tip time + matching closed fingerprint: tick when the tip
  moved, otherwise serve the cached envelope.
* Series advanced or shrank: find the session's tip by time, verify the
  fingerprint of everything before it, then tick the finalized base and append
  the strictly newer tail.
* **Rebase (release + recreate)** when the tip is not found (reload, rewind,
  gap), when the prefix fingerprint differs (in-place history rewrite, gap fill,
  venue revision, prepended history), or when the session outgrew the chart
  window by `SESSION_GROWTH_SLACK`.
* The stored fingerprint is only meaningful while the session holds exactly `n`
  bars. A response whose `count` disagrees with the expected shape drops the
  session and falls back — do not keep ticking a session that disagrees about its
  own series, and do not store a fingerprint computed over a different window.

# A response is not a result until it is usable

* `/run`-shaped failures arrive as `{ status: 'error', … }`, sometimes with a
  **2xx** status. Any 2xx JSON body is not proof of success.
* The client classifies each op as `ok` / `gone` (`NO_SESSION` → recreate) /
  `invalid` (answered but unusable → drop + cooldown) / `miss` (transport error
  or timeout → drop, no cooldown).
* `invalid` must never be mapped as a run result: the engine's payload mapper
  reports `success` unconditionally, so an error body becomes an empty
  `plots`/`series` that then clears the indicator off the chart while the status
  bar reports a fast, successful run.

# Cost model and failure memos

* create is a full-window evaluation; `tick` is O(1); `append` is O(delta). The
  client re-reads the closed-window fingerprint on every tick, so continuity is
  O(window) client-side by construction — the O(delta) claim covers the server
  evaluation and the envelope.
* Unusable answers cool the session key down for `SESSION_RETRY_COOLDOWN_MS`.
  Without that memo a backend that answers but cannot serve sessions costs a
  full-window create **plus** a full re-run on every tick — worse than never
  engaging the fast path at all.
* Sessions are owned per script instance (applied indicator id / editor run key),
  not per symbol/interval: siblings on one chart must not evict each other, while
  a new revision of the same instance still releases its predecessor. Callers
  with no owner id scope to the script source.
* **Releasing authenticates.** The `DELETE` must carry the same API key as
  create/tick/append, or an authenticated backend rejects it and the session
  lingers until the idle TTL.

# Before changing this path

* Run `tests/engines-live-sessions.test.ts` (wire sequence, tick-then-append
  order, rebase cases, negative caches and cooldowns) and
  `tests/runner-livetick-session.test.ts` (runner plumbing, mode eligibility,
  private windows, live inputs). Both are indexed under
  [tests](/code/tests.md).
* A run result carries `meta.sessionVia`
  (`session-create | session-tick | session-append | session-cached`) and
  `meta.session_id`, which is the fastest way to see which path a tick took.
* `store.profilerEnabled` (and scripts that call `alert()` /
  `alertcondition()`) forces `interpret`, so a leaked `true` in a test changes
  the resolved mode a suite asserts on. Reset it when a test asserts on modes.
