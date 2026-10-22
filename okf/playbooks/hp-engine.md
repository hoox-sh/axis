---
type: "Playbook"
title: "HP engine"
description: "The opt-in high-performance plane: rung selection, AXB1 transport, SAB seqlock memory, copy-out and GPU paint seams — and which rungs are still library-only."
tags: [axis, playbook, okf, hp, engine, chart, render]
status: stable
okf_lock: human
generated:
  by: human:opencode
  at: 2026-10-22T00:00:00Z
sources:
  - id: plan
    resource: ".opencode/hp/implementation.md"
    title: "HP implementation plan"
  - id: hp
    resource: "src/hp"
    title: "HP engine source"
---

# What this is

The high-performance plane (HP) is AXIS's **opt-in** engine for live data:
off-thread decode, SharedArrayBuffer double-buffering, viewport-only cold
pages, and an instanced GPU painter — with Lightweight Charts as the
ever-present fallback. It is **default off** (`axis.engine.hp.enabled`
unset) and the kill switch (`axis.engine.hp.disabled`) wins over enable.
Source: [src/hp](/code/src/hp.md); the contract is
`.opencode/hp/implementation.md`. The docs page is [High-performance engine](/docs/architecture/hp-engine.md).

# Rungs and selection

`selectHpRung` ([src/hp](/code/src/hp.md)) picks one of:

| Rung | Meaning |
| --- | --- |
| HP-0 | not opted in / killed — today's JSON `/ws/live` → `Bar[]` → LWC |
| HP-1 | AXB1-or-JSON decoded in the ingest worker, transferable copy, LWC |
| HP-2 | cross-origin isolated: SAB hot ring + IDB cold, LWC copy-out |
| HP-3 | WebGL2 instanced quads (painter seam) |
| HP-4 | WebGPU instanced quads (painter seam; no painter yet) |

Order: kill switch → not enabled → HP-0; WebGPU (flag ≠ `off`) → HP-4;
else WebGL2 → HP-3; else isolated → HP-2; else HP-1. `sessionStorage`
`axis.hp.rung` **clamps downward only** (a SAB OOM writes `1` so the tab
does not retry the allocation). Flags live in
[feature-flag](/code/src/hp/index.md) (`axis.engine.hp.enabled` /
`disabled` / `gpu` / `sab`).

# Where it lives

* Transport codec: [axb1](/code/src/hp/axb1.md) — int64 ticks, 4-byte
  alignment, `TIP` vs `APPEND`; golden vectors in
  `tests/data/axb1-vectors.json` are shared with the pyne repo
  (`tests/test_axb1.py`).
* Ingest: [workers](/code/src/hp/workers.md) — `createLiveWsClient`
  returns the stock JSON client unless HP is enabled *and* a Worker can
  spawn; `binaryType = 'arraybuffer'` lives in the worker, not main.
* Memory: [memory](/code/src/hp/memory.md) — SAB layout is `O(HOT_CAP)`,
  not `O(N)`; the viewport page has its own seqlock and must never share
  the write/published hot slots.
* Calc: [calc](/code/src/hp/calc.md) — tips evaluate on scratch, only
  closed bars commit (barstate parity with PYNE).
* Paint: [paint](/code/src/hp/paint.md) — `copy-out-lwc` is what LWC
  samples (rungs 0–2); `visual-attr` stages 32-byte NDC records (rungs 3+).
* Render seam: [render](/code/src/hp/render.md) — `probeRendererKind`
  walks WebGPU → WebGL2 → LWC; `off` always lands LWC and a forced mode
  never claims a backend the probe did not find.
* Sync helpers: [sync](/code/src/hp/sync.md) — worker-only
  `Atomics.wait`; main polls generations from rAF.

# Contracts you must not break

* **Seqlock discipline** (both copy-out and visual-attr): read only even
  generations, copy, re-verify; a changed generation means retry, then
  `null` = keep the previous frame. Never publish a torn frame.
* **Record stride**: the `VisualCandle` is 8 words / 32 bytes
  (`VISUAL_RECORD_WORDS`), not the 6 float fields — both the SAB fill and
  the `bufferSubData` length must use 8, or attributes desync per record.
* **Float32 only after NDC**: int64 ticks stay in the SAB; WebGPU has no
  float64. `priceToTicks(0.00000012, 8) === 12n` and float32 of that
  price is never in the codec.
* **GLSL ES 3.00 is not desktop GL**: no `unpackUint4x8` /
  `unpackUnorm4x8` — unpack `0xAABBGGRR` with core bit ops. A shader
  compile failure returns `null` from the factory (by design) and would
  silently disable the GPU rung, so the comment there is load-bearing.
* **NDC x grows with `x_index`**: oldest candle (`x_index` 0) sits at the
  left; `RenderViewport.rightEdgeIndex` parks a slot at NDC `+1`. A `-1`
  flip mirrors the chart.
* **Flag-off is the rollback**: with HP off the client must stay
  byte-identical to today's JSON path; the JSON path is the rollback
  default, so `tests/engine/*` is the regression net.
* **Rung ≠ wiring**: the chip and `selectHpRung` report the *selection*.
  The GPU canvas stack (ChartHost layered canvas, render worker) is
  deliberately unwired — plan §14.2 forbids touching PaneManager before
  GPU parity tests exist. Do not "finish" the rung by wiring paint in a
  docs/flag PR.

# HUD

Workers Manager → **Chart plane** shows
`hpChip()` ([hud](/code/src/hp/index.md)): `hp · sab+gpu`,
`hp · copy+lwc`, or `json · lwc` — transport memory plus painter. The
default-off state is `json · lwc`, which is exactly today's path. The
feed-chip surface and MCP `stream.get`'s `hp: {rung, isolated, sabBytes}`
are planned but not wired.

# Tests

```bash
bun test tests/hp/               # codec, memory, rung, chip (new contracts)
bun test tests/engine/           # JSON regression — the rollback default
bun test tests/sw-parity.test.ts # COOP/COEP headers vs service worker
bunx tsc --noEmit && bun run typecheck:check && bun run lint
```

Manual: open `http://127.0.0.1:3000`, DevTools → `crossOriginIsolated`
(**`false` is expected** with the popup-safe COOP pair — HP then runs the
copy path; only a COOP flip to `same-origin` reads `true`) and
`typeof SharedArrayBuffer`; load BTCUSDT 1m live and confirm the
forming wick moves (the tip must never commit).

# See also

* [Engine stream](/playbooks/engine-stream.md) — the WS plane HP rides on.
* [AXIS map](/playbooks/axis-map.md) — where chart, data, and workers sit.
* `docs/architecture/hp-engine.mdx` — the operator-facing page.
