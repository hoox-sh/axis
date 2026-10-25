# Changelog

All notable changes to **AXIS** (`hoox-sh/axis`) are documented in this file.

This changelog is **recursive**: it lists the full git history of the
repository, grouped by month and conventional-commit type. Agents and
humans **must keep it updated** on every release (see `AGENTS.md` § Changelog & releases).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/) with
commit SHAs for traceability.

_Generated/updated: 2026-10-20 · 639 commits · describe-tag: `v2.25.1`_

---

## [Unreleased]

- `hp/memory/control-block.ts` (A05/A06): dedicated `PAGE_GENERATION` word (19); shrank i64 overlay to 1 word (bytes 64–71) avoiding alias with notify/page; added `samplePage`; added `beginTipWrite`/`commitTipWrite`; `init()` seeds page gen, tip slot/index.
- `hp/memory/hot-buffer.ts` (P01/P02/A07/A08): `publishTail` + `publish` with tip clear; `writeTip`/`clearTip`/`sampleTip`; `paintGeneration`; cached `headerView`; `allocateHotBuffer` guards `ReferenceError`/bad-size → rung 1.
- `hp/paint/copy-out-lwc.ts` (A05/A10): `copyClipped` supports independent page seqlock (`samplePage` / `pageGeneration`) and tip overlay (`tip` option); `copyOutBars` uses `tip: true`; `copyOutPage` uses page sampler.
- `hp/sync/raf-poll.ts`: `subscribeGeneration` accepts `generation?: () => number` (combined hot+tip).
- `hp/workers/hot-ring-writer.ts` (A03/P01/A04): `absorb`/`applyDelta` use forming-tip-only path (`publishTipIfForming`); `publishTail` for append; `priceScale` propagation; `routeThroughRing` takes `priceScaleFor`; `contiguousTailRun` accepts multi-candle generations.
- `chart/live-append.ts` (A04): `contiguousTailRun` walks contiguously from newest, validates oldest is `tail` or `tail+step`; `startHotRingPaint` uses `buffer.paintGeneration`.
- `hp/workers/calc-engine.ts` (A01): `coldToCalcBars` uses `coverage().baseAbs` + `length > 0` guard.
- `hp/memory/cold-store.ts` (A18/A23): `setTicks` `baseAbs = deduped.length - capped.length`; `complete = capped.length === deduped.length`; avoids `unshift` spread.
- `tests/hp/` updated for page-only seqlock and forming-tip behavior (265 pass / 0 fail).

### Fixed

- **A live bar time comes from the server, not the local clock.** AXB1 snapshot, tip, close, and append times go through the same unix-second normalizer as venue bars. A tip that omits the bar open stays on the previous server bar. The frame's `tsMs` is not used as the candle time.

- **A live `setData` puts the visible range back.** Window slides and left-edge prefetches replace the series with `fit` off. `setData` can still jump the logical range, so the range from before the replace is written back. A full load still fits. A tick still uses `update` and does not call `fitContent`.

- **A snapshot that never arrives retries twice, then that subscription asks in JSON.** The waits stay bounded (the same snapshot deadline, then 50 ms and 200 ms). An AXB1 socket resubscribes once without `encoding`. A JSON socket just fails. The series socket stays open.

- **An unknown AXB1 opcode does not close the socket.** The decode counts `unknownOpcode`, names the subscription, and that subscription resumes without `encoding: 'axb1'`. Other subscriptions stay on AXB1. A second unknown opcode for the same subscription does not resume again.

- **A hidden tab does not replay every missed tick.** The live socket stays open. Forming ticks fold into one slot per subscription. When the tab is shown, a `closed_upto` that moved resumes once from the last painted close. Otherwise the latest tip is applied once. A seq that never arrived still resumes.

- **A dead ingest worker is replaced.** `onerror` terminates that worker, starts another, and connects again. The next open resubscribes through the same reconnect handlers as a socket drop. After five crashes in one `connect()` the host stays down. It does not switch the socket back to main-thread `JSON.parse`.

- **A dropped keepalive no longer looks like a missed frame.** The tip coalescer still drops `UNCHANGED` frames and still folds several forming tips into one. Those seqs are now acknowledged on the next frame that is actually released (`seqAckFrom`). The applier and the apply transaction advance through that run. A seq nobody saw is still a gap and still resubscribes. JSON decode strips a forged ack, so a socket payload cannot hide a real hole.

- **Tail-align pads at the head again, so a clamped series no longer paints early.** `tailAlignSeriesToWindow` was flipped to pad at the *end* by the P03 perf commit (`33cc4269`) without a test or changelog change, contradicting its own doc block ("a shorter one head-padded with `null`") and the `tailAlign*` contract. Consequence: a `meta.windowBars: 3` free-tier clamp (`[11,12,13]` on a 5-bar chart) painted 11/12/13 on the three **oldest** bars instead of the newest three — every value shifted two bars early. Restored head-padding (the newest engine value belongs on the newest chart bar); the engine-evaluated-fewer-history-bars case stays the job of the bar-time join (`alignSeriesToTimes`). Added a unit regression guard so a future "pad at the end" edit fails loudly, and corrected the stale comment in `apply-context.ts` that described the flipped behaviour. `tests/runner-engine-owned-apply.test.ts` goes 22/7 → 30/0.

- **`fillVisualAttrFromViewport` no longer spins forever (GPU overlay / test-suite hang).** The P03 single-pass rewrite left `const len = 0` with no increment in the merged hot+page fill loop, and `len` was returned as the fill length. Any viewport that touched the page slot — a zoomed-out chart on HP-3, or `tests/hp/visual-attr.test.ts` — wedged the thread in an infinite loop; because that file never returned, `bun run test` stalled after its last completed test and only exited on timeout. Rewritten as the same two-pass shape `fillVisualAttrFromHot` uses: pass 1 walks the contiguous covered prefix and tracks the visible volume maximum (a gap ends the run), pass 2 writes the records. Also removed the duplicated `open`/`high` NDC writes the merge left behind.

- **`ColdStore` cap test reads the absolute index it documents.** After `setBars(bars(20))` with `max: 10`, `baseAbs` is 10, so `read(0, 1)` is *before* the retained head and correctly returns empty (the A18/A23 contract). The test asserted the oldest surviving bar through relative index 0; it now reads `coverage().baseAbs`.

- **Session overlays no longer tail-pin a window they never evaluated.** A session/stream run whose engine shipped no bar axis was tail-pinned onto the chart even when its series length missed the window by thousands of bars (a 9577-bar engine window on a 5000-bar chart shifts every value and marker by 4577 slots — the SOLUSDT desync). The `staleNoAxis` skip now also covers full runs whose length misses the window by more than a few mid-run appends (`PIN_TOLERANCE_BARS = 8`); the deliberate free-tier clamp (`windowBars`) keeps pinning, and equal-length runs keep the index zip. The WS `/ws/run` path now also carries `meta.engineTimes` like REST, so WS session runs can time-join instead of pinning. And a series repair now invalidates memoized data sessions + live tick/append sessions for that key, so the next run creates a fresh session over the repaired window instead of evaluating (and pinning) the stale one. Pinned by four new `alignApplySeries` guard tests (gross mismatch skips, plots-array mismatch skips, clamp still pins, small race still pins) plus data-session / live-session invalidation tests.

- **The WebGL2 overlay engages on HP-3 selection (hp2 D1).** The overlay was a forced-`gpu=webgl2` instrument; `auto` stayed dormant even where the rung selector already landed on HP-3. `startGpuOverlay` now gates on the same selection the HUD chip reports — `probeRendererKind` webgl2 plus `selectHpRung() === 3` — so `auto` on a WebGL2-only machine paints the parity overlay. `off`, GPU-less `auto`, the painterless HP-4 rung, session-cap clamps below 3, and HP disabled all stay dormant. The hide-LWC switch remains gated (D2): this is still additive parity, not the production painter.

### Added

- **A thrown paint resumes once instead of leaving a stale badge.** The apply transaction still skips the rest of the batch. The status says why, and that subscription asks for one snapshot. A later failure does not resume again until a full arrives.

- **The worker transport and the single chart are the defaults.** A tab with no `axis.engine.transport` uses the ingest worker. A tab with no `axis.chart.layout` uses one Lightweight Charts chart per slot. `json` and `multi` remain the rollback. A missing Worker still counts one JSON fallback and stays on the main-thread socket.

- **Panning to the left edge prefetches one older history page.** The dataset read does not run on the drag frame. The page is painted with `fit` off, and the logical range shifts by the number of bars inserted on the left so the viewport stays put. The rolling window grows with that page, up to the 100k cap, so the next live bar does not slice the page away. Conflation itself is unchanged: on at 2,500 bars, precomputed from 10,000.

- **A live bar keeps its plot and its fill.** When the engine axis ends before the chart tip, the last value is extended onto the newer bars instead of head-padding the series, which slid the fill onto later candles. A live tick whose axis is behind also drops the memoized session so the next run evaluates the bar the candle is already showing.

- **A script axis with a hole the candles do not have asks for a series repair.** `noteChartSeriesHole` runs at apply time, so Donchian does not wait for the next series snapshot.

- **A PYNE tick that reports `stale` drops the script session.** That flag means the engine clamped its history walk, not that the feed was idle. The next run loads the store after the gap page is written.

- **A fresh engine tip no longer hides a hole in the series.** Repair used to stop when `newest` was current, so a tick walk that skipped the middle (about 22 hours on DOGEUSDT 1m) stayed in the store and the Donchian axis. A bounds deficit of 30 or more bars now uploads the local window. An upload that adds nothing is remembered, so a weekend on a session venue does not re-upload every cooldown. A snapshot whose stamps jump, while the chart's do not, asks for that repair.

- **`axis.chart.layout=single` uses one Lightweight Charts chart per slot.** The default stays `multi` (one chart per pane, manual time-scale sync). `single` adds indicator and volume panes with `addPane` on the price chart, sends each series to that pane index, and removing a sub-pane does not remove the candles. Time-scale mirroring is skipped because there is one scale.

- **The ingest tip coalescer folds a window instead of keeping one frame.** Last OHLC tip wins, plot columns union by key, and a plot tip no longer drops the pending candle. A non-tip frame flushes that subscription's tip first. `UNCHANGED` keepalives with no bars and no columns are dropped.

- **A script delta paints inside one apply transaction.** `runApplyTransaction` refuses a seq gap, a rewind, a generation mismatch, or a pane/plot shape check before `commit`. A thrown step skips the rest of the batch and does not paint. The live wire commits the merged script delta through it, so a gap never reaches `applyScriptPush`.

- **A new candle uses `series.update` unless it is the first bar or the window slides.** `appendLiveBar` used to `setData` the whole window on every append, on the belief that `update` cannot add a time. Lightweight Charts 5.2 appends when the time is newer than the tip. The first bar and a rolling-window slide still `setData`. Forming ticks stay on `update`.

- **The live proxy forwards a Blob frame as the original bytes.** `relayFrame` accepts `Blob` (Workers compat dates ≥ 2026-03-17 deliver binary frames that way) and both sockets prefer `binaryType = 'arraybuffer'` when the property exists. Text and `ArrayBuffer` frames are unchanged. The compat date stays `2024-11-01`.

- **Subscribe and resume send `encoding: 'axb1'` only when the ingest worker owns the socket.** That is `axis.engine.transport=worker` or HP on. The main-thread JSON client omits the field, so a server that ignores it keeps the old JSON frames, and a server that honors it does not switch a parse-only client onto binary.

- **`axis.engine.transport=worker` decodes `/ws/live` off the main thread without turning HP on.** `worker` is now the default (see above); `json` is the main-thread rollback. `worker` reuses the ingest worker for the same JSON frames and does not allocate the hot ring, negotiate AXB1, or start the overlay. A tab that asks for the worker where `Worker` is missing stays on the JSON client and counts one `jsonFallback`. Pinned by `tests/engine/v1-transport.test.ts`.

- **v1 engine metrics record tick→apply, tick→paint, long tasks, and pan frames.** `src/engine/v1/metrics.ts` stamps `tick:recv` before main-thread `JSON.parse` on `full`/`delta`/`close`, `batch:post` when the ingest worker delivers a decoded batch, and `apply:start`/`apply:end` around `applyStreamPayload`, then one frame for tick→paint. The first stamp in a burst wins. Seq gaps and gap-driven resumes increment counters; conflation and the visible bar count are gauges on `setData`; pan and wheel frame deltas sample while the price pane is ranging. `chart.lag` returns the rolling p50/p95/p99 snapshot as `v1`. Pinned by `tests/engine/v1-metrics.test.ts`.

- **Tick → frame latency is split into pipeline stages (hp2 A1).** The §14.2 number was one delta — applied tick to next frame — so a bad p95 could hide anywhere between the worker and the glass. The ingest worker now stamps `publishedAt` on every `frames` message (dedicated-worker `performance.now` shares the main clock origin), and `paint-latency` records per-burst stage marks: worker publish → main apply (`publishToApply`, covers postMessage + dispatch), apply → hot-ring copy-out, copy-out → overlay draw. Stages that never stamp (JSON path, LWC-only paint) report `null` instead of fictional zeros, and the existing total is untouched. `hp.get` exposes the split as `paint.stages` p50s next to `paint.latency`, so the p95-tail hunt in `.opencode/hp2/implementation.md` can point at a stage instead of the whole pipeline. Pinned by three new `paint-latency` stage tests (first-stamp-wins, null-path, burst reset). Controlled live runs (2 × 10 s, HP-0 JSON path, MCP idle): 587/593 frames @ ~59 fps, rolling paint p50 ~13 ms / p95 ~16 ms / max ~129 ms (n = 240) — the §14.2 tail (p95 ≈ 160 ms, max ≈ 520 ms) does not reproduce under quiet conditions and attributes to observer load during that measurement (heavy MCP diagnosis traffic + screenshots), not the pipeline. HP-on rung runs still pending for the A2 gate.

- **The ingest worker reads its own cold history (hp2 B1).** The page slot used to paint only what the main thread's chart window happened to hold: a range older than the REST window arrived as a short (or empty) slice and the overlay fell back. The worker now owns a `ColdStore` per series bind — hydrated from `bars-cache` IDB on connect via the new `coldKey` (`sourceId`/`symbol`/`interval`, posted on `connect`), extended by every snapshot (`upsertByTime`), every verified bar close (`appendTick` — forming re-ticks share the tail time and are ignored), and every page slice the main thread sends (the REST slice accumulates, so gaps close over time). The `page` message carries the wanted `count`, and the worker publishes the merged range — main bars win on overlap, cold fills the rest, truncation at the first uncovered slot instead of an invented bar. `ColdStore` tracks its absolute base (`baseAbs`) so an evicted head or a prepended deeper history cannot silently misalign slots; losing absoluteness flips `complete` and the merge stops trusting positions. A symbol switch re-seeds; a hydrate racing the socket merges instead of wiping. Pinned by new write-back/upsert/eviction/merge tests in `tests/hp/page-buffer.test.ts`.

- **AXB1 codec fuzz + relay reconnect proof (hp2 E1).** The audit found no dead surface: `HPC1_MAGIC` is the live control-block magic and `AXB1_HDR_COMPRESSED` is live as a v1 reject-rule (decode throws, encode refuses) — both are now marked as audited in `constants.ts`. New `tests/hp/axb1-fuzz.test.ts` throws 500 seeded-PRNG frames across all 11 opcodes at `encode → decode` (exact `toEqual`, 4-byte alignment asserted) plus 50 single-bit-flip corruptions that must fail loudly with `RangeError`/`TypeError`, never silently. `worker/tests/live-proxy.test.ts` gains the reconnect leg: upstream drop closes the server side, the client redials with a fresh ticket, the JSON resubscribe stays text, and the first binary frame on the new socket is still byte-identical.

- **Calc session runs in a worker (hp2 C1).** `CalcSession` was main-thread library code; the HP topology needs it off the Window thread with cold history as its replay source. New `src/hp/workers/calc-engine.ts` (pure, testable) owns one session per series plus a `ColdStore` each: snapshots seed cold and replay **from cold** once it holds history (full-history replay, not the 500-bar main window — a rebind with no reposted bars replays identically), tips stay scratch, only appends commit. `FrameValuesEvaluator` files the Pro-API server values by bar time; its `snapshotCommitted`/`restoreCommitted` are an O(1) cursor — the pickle-restore analog for a host with nothing to pickle — and `evaluateCalls` pins the no-rewalk bound (12 bars + 3 tips = 15 calls, not 12 + 3×12). Hydrate merges IDB behind live bars instead of wiping them; per-series isolation and error-instead-of-throw replies are covered. Pinned by six `calc-worker` tests against the PYNE-recorded `barstate-parity` fixture (ta-cum confirmed series identical). The thin `calc.worker.ts` entry ships with the protocol; the live frame producer that posts to it is the explicit next step, not this commit.

- **The GPU overlay paints zoomed-out viewports via pixel-column downsampling.** The hot window plus one cold page cover at most `2 · HOT_CAP` bars, so a fully zoomed-out chart fell back to LWC for most of the pane — and paging the whole series in would break the `O(HOT_CAP)` memory contract. When the exact hot+page fill cannot cover the viewport's real bars, the overlay now downsamples the chart window LWC paints (`downsampleToPixelColumns` in `src/hp/paint/`): one bin per pixel column, first-open / column-extremes / last-close / summed volume, bin centers in fractional viewport slots that the renderer positions natively. It reads the exact array LWC paints, so parity is by construction and it needs no SAB traffic; the exact fill stays the path wherever the viewport is coverable, and the forming tip keeps its flag through the bin. Pinned by binning-semantics, fractional-center, hole-skipping, and viewport-clip tests (`tests/hp/downsample.test.ts`).
- **Cold paging is wired: the GPU overlay paints past the hot ring.** The overlay used to clear whenever the viewport started left of the hot window, because the page slot existed only as library code nothing populated. Now the overlay reports its absolute viewport every frame (`noteHpViewport` in `src/streams/stream-live.ts`, throttled to 200 ms), the main thread slices the cold range out of the chart window it already owns, and the ingest worker — still the SAB's single writer, so a page replace can never tear a concurrent hot publish — replaces the page slot via the new `page` message (`publishBarPage`, converted with the buffer's own price scale). A re-seed or reconnect retires the page (its absolute base is snapshot-relative), and the overlay fills the merged hot+page range in one seqlock sample (`fillVisualAttrFromViewport`), stopping at the first uncovered bar so LWC keeps painting underneath. Chart index ↔ absolute mapping lives in one place (`chartRangeToAbsolute`) so the pager, the page slot, and the fill cannot disagree. `hp.get` reports the page (`page.active/from/count`). Pinned by `chartRangeToAbsolute`, `publishBarPage`, `fillVisualAttrFromViewport`, and host `page`-message tests. The worker-side `ColdStore`/IDB adapter stays library-only (future calc-reader territory). The `@gpu` e2e re-asserts the shrunken-ring step: the cold viewport must repaint *without* zooming (downsample, then the paged exact fill) — the old clear assertion encoded the pre-paging contract.
- **The HP engine is configured in Settings, not the console.** Every `axis.engine.hp.*` flag used to require `localStorage` in DevTools, which made an opt-in plane look like a developer hidden switch. Settings → General gains a **High-performance engine** section: the master toggle (off keeps the JSON `/ws/live` → Lightweight Charts path byte-identical), the GPU painter (`auto` / `webgl2` / `webgpu` / `off`) and the SAB transport (`auto` / `off`), each writing the same tab-local keys so automation still works. The section renders the resulting `hpChip()` verdict inline (`json · lwc`, `hp · sab+gpu`, `Kill switch`, …) and, once something changed, the **Reload to apply** button the flags need — the plane is read at boot, so a silent write would look like a no-op. The architecture page and the README now point at the section instead of DevTools, and an e2e smoke asserts the toggle, the select write-through and the reload affordance (`e2e/smoke.spec.ts`).
- **Tick → frame latency is measured (the plan §14.2 gate).** `src/chart/paint-latency.ts` stamps the first applied live tick of each frame and records the delta to that frame's timestamp — one rAF callback per burst, no steady loop, no timers, and the recording is a no-op for rejected ticks. `appendLiveBar` calls it, and both `hp.get` (`paint.latency`) and `hp.sample` (`paint`) expose p50 / p95 / max over the last 240 samples, so the default-flip decision can be argued with production numbers instead of a stopwatch. `hp.sample`'s ring progress is now `closedUptoTimeDelta` — the engine's `closed_upto` is a time stamp, not an index, and the old name invited that misreading.
- **Chart screenshots include the HP GPU overlay.** `chart.screenshot` (MCP) and the Screenshot menu composed LWC's pane canvases, drawings and the watermark — but never the HP-3 WebGL candle canvas, which is a sibling element, so a captured image silently differed from what the trader sees. `capturePaneCanvas` now composites the overlay under the drawings (annotations stay on top) via `overlayPlacement`, which maps the overlay's CSS rect into the screenshot's pixel space (`shot.width / pane.width`, so 1× and 2× captures both line up). A WebGL drawing buffer is discarded at composite time, so the copy runs in the next animation frame — the overlay's own rAF tick was registered earlier, which is what keeps the buffer intact without `preserveDrawingBuffer`. Verified by sampling 1 948 candle pixels: the live composite reads (174,92,94), the app screenshot (184,96,98), LWC alone (229,119,122) — the screenshot follows the composite.
- **High-performance chart engine implementation spec** on branch `engine/high-performance` (`.opencode/hp/implementation.md`). It pins generation-based double-buffering, ingest/calc/render workers, the AXB1 4-byte-aligned binary delta, viewport-only SAB paging, int64 price ticks (float32 only after NDC), worker-only `Atomics.wait`, tip-vs-append Pine `barstate` context, and a HP-0…HP-4 fallback matrix on top of the existing JSON `/ws/live` plane.

- **AXB1 codec + JSON execution context (HP PR 1).** Canonical prices are int64 ticks (`decimalToTicks` / `priceToTicks`); the encoder/decoder round-trips the 32-byte little-endian envelope and the TIP/APPEND/SNAPSHOT opcodes. Live JSON deltas with `forming: true` stamp `executionContext: 'tip'` on the merged payload so a later calc worker will not commit `barstate.isconfirmed` accumulators until `APPEND_BAR`.

- **Cross-origin isolation headers (HP PR 2).** Every static host (Pages `_headers`, nginx, Vite dev/preview, Bun and Python PWA servers) and the SW offline shell send one locked-step `COOP` / `COEP: credentialless` / `CORP: same-origin` trio — COOP landed popup-safe and later flipped to `same-origin` (see Changed), so SharedArrayBuffer is now reachable without a second header pass. `isolationProbe` / `selectHpRung` stay HP-0 until `axis.engine.hp.enabled` and report SAB only when `crossOriginIsolated` is true. The kill switch is `axis.engine.hp.disabled`.

- **Ingest worker: `/ws/live` decode off the Window thread (HP PR 3).** `createLiveWsClient` returns an `IngestHostClient` only when `axis.engine.hp.enabled === '1'` **and** a Worker exists; otherwise it returns the original `Redesign2WsClient`, so the flag-off path is byte-for-byte today's client. The worker owns the socket (`binaryType: 'arraybuffer'`), decodes JSON **and** AXB1 through the shared `decodeInbound`, holds forming tips for a 16 ms vsync coalesce while `close` / `APPEND_BAR` flush immediately, and posts typed frames over a `HostToIngest` / `IngestToHost` port — the auth token rides once on `connect` and is never echoed back. The host keeps the `WireClient` contract (`onFrame`, `awaitFrame`, reconnect handlers) so `StreamLiveWire` is unchanged, and the Workers Manager gains an `hp-ingest` card that probes as `none` (there is nothing to HTTP-probe in a tab). Tests: `tests/hp/ingest-core.test.ts` (JSON + AXB1 fixtures through the pure decoder) and `tests/hp/ingest-host.test.ts` (loopback port: connect, frame delivery, exact subscribe serialization, reconnect, error mapping).

- **Hot double-buffer + main-rAF copy-out (HP PR 4).** One SharedArrayBuffer is sectioned into a 256-byte control block (the seqlock words), a series header (price scale + epoch), two reserved tip records, and the hot window itself: `HOT_CAP` = 5_120 bars × 2 slots of int64-tick columns (~450 KiB — O(hot window), not O(N), so a mobile WebView never has to allocate 200k×2). The single writer (ingest) fills the *unpublished* slot and flips the generation from odd to even; readers sample only even generations, and a copy is re-verified by a second generation load — a torn sample is discarded and retried, and after the retry budget `copyOutBars` returns `null` so the paint path keeps the previous frame instead of showing a mixed candle. `Atomics.wait` is worker-only: `waitInWorker` throws the moment `globalThis.Window` / `self` says Window thread, which the main thread replaces with `subscribeGeneration`'s `requestAnimationFrame` poll. A `RangeError` from the allocator drops the tab to rung 1 for the session (`axis.hp.rung = '1'`) instead of retrying the OOM on reload. `copyOutBars` clips the visible range to the hot window (cold pages are HP PR 5) and produces the float64 `Bar[]` Lightweight Charts paints; the tests feed those bars through `appendLiveBar` and assert all four store verdicts (`ignored` / `updated` / `appended` / `slid`) plus the torn-write, main-thread-guard and 5_120×2 allocation cases (`tests/hp/{hot-buffer,atomics-main-guard,copy-out-lwc}.test.ts`).

- **Viewport paging + columnar cold store (HP PR 5).** The SAB gains one *single-buffered* page section (`PageSlot[HOT_CAP]`) after the hot double-buffer, so panning into cold history copies **one page** of bars — a far-left jump replaces that page instead of allocating a third history buffer, and "fit content" over a range that still overlaps hot is acked without pulling 100k bars into shared memory (§9.2). The allocation is a fixed 691,968 bytes (~676 KiB): O(HOT_CAP) and provably independent of series length, because a 200k-bar history allocates the same bytes as a 1k one. A page replace runs its own seqlock transaction (`beginPageWrite` / `commitPageWrite`) that **never moves the hot published slot**, so the hot window and the forming tip keep updating while the page is on screen. Readers get `copyOutPage` and the `copyOutViewport` dispatcher beside `copyOutBars`, all three sharing one seqlock-verified clipped copy. `ColdStore` keeps the worker's full series as columnar int64 ticks — a page copy is a straight column read, never a re-encode — hydrates from the existing `bars-cache` memory-first, and on rung 1 (`copyOutPageFromCold`, no SAB at all) the viewport is still served straight from the cold store (`tests/hp/page-buffer.test.ts`).

- **Calc scratch-vs-commit state machine (HP PR 6).** The calc worker's core rule, made testable without a Worker or a Pine runtime: a forming **tip** is a *scratch* evaluation and a **bar close** is a *commit*. `barstate.ts` pins the §10.1 contexts — history replay is new + confirmed + never realtime (`isfirst` only at index 0, `islast` only on the rightmost bar), the snapshot's forming tip and every incremental tip are **never** confirmed so `ta.cum` / `ta.valuewhen` / `var` accumulators stay scratch, `isnew` is true only on the first tip after an append, and `APPEND_BAR` closes the bar with a confirmed + realtime eval that folds the accumulators before the next slot opens. `CalcSession` (`calc-core.ts`) drives any `CalcEvaluator` — PYNE in a worker, Pyodide, or a test double — through `onSnapshot` / `onTipUpdate` / `onAppendBar`: each tip restores the committed snapshot *before* evaluating, so ticks cannot accumulate into committed state, and only the append path grows the committed plot series. This split is not invented: PYNE's own multi-tick realtime window sets `isconfirmed = tick_i == n_ticks - 1` (forming ticks unconfirmed, closing tick commits), which is exactly this table. Parity is pinned by fixtures **recorded from PYNE** (`scripts/record-hp-fixtures.py` → `tests/hp/fixtures/barstate-parity.json`, pynescript 0.6.18, re-recordable after a PYNE release): the tests drive the session through wild forming ticks and assert the committed series still matches the recorded closed-run `ta.cum` / `ta.valuewhen` / `var` outputs bar for bar, that three 200→150→125 ticks leave committed untouched, and that the recorded `barstate` flag columns match the replay contexts (`tests/hp/barstate-tip.test.ts`).

- **AXB1 golden vectors now pin every payload shape (HP PR 7 prep).** `tests/hp/axb1-vectors.json` grows from a lone heartbeat to 12 vectors — heartbeat, unchanged, status, tip (close+volume+time and full OHLCV), append-bar, close-verify, plot-tip (int64 ticks + float64), a 2-bar OHLCV snapshot, a plots snapshot, error, and a JSON blob. Each vector carries the **language-neutral frame spec** (int64/uint64 as decimal strings, masks and value kinds as names) *and* the exact little-endian hex the encoder must emit, plus `hash_checks` pinning `fnv1a32` on shared inputs. This is the cross-repo contract: PYNE's `tests/test_axb1.py` builds the same frames from the same spec with its own encoder and must produce identical bytes, so a wire-format drift now fails both repos' test suites instead of silently corrupting live frames. `bun scripts/generate-axb1-vectors.ts` regenerates the hex from the specs through the real AXIS encoder, and the codec test loops every vector through spec → encode → golden hex → decode → re-encode (`tests/hp/axb1-codec.test.ts`).

- **The live relay no longer corrupts binary frames (HP PR 7b).** `worker/src/live-proxy.ts` decoded every non-text WebSocket frame with `TextDecoder` before relaying it — fine for JSON, fatal for AXB1: any byte that is not valid UTF-8 would be mangled before reaching the client. The relay now hands payloads through untouched (`relayFrame`: text stays text, `ArrayBuffer` and views stay bytes, in both directions), which is exactly what a transparent proxy means once the engine can speak binary. The test drives the real `handleLiveProxy` upgrade path with a faked `WebSocketPair` and upstream, and asserts an encoded AXB1 `TIP_UPDATE` crosses the relay byte-for-byte in both directions while JSON control frames stay text (`worker/tests/live-proxy.test.ts`).

- **GPU paint plane: NDC staging + instanced WebGL2 renderer (HP PR 8).** `hp/paint/visual-attr.ts` turns visible candles into the plan's 32-byte `VisualCandle` record (§6.5): `x / open / high / low / close / volume` as float32 and **nothing else** — prices are mapped to NDC in float64 against the caller's visible y-range and narrowed once at the store, so neither float64 nor int64 ever crosses the GPU boundary (WebGPU has no float64) and canonical ticks stay in the SAB. `fillVisualAttrFromHot` mirrors the copy-out's seqlock discipline (sample only even generations, re-verify after the copy, `null` = keep the previous frame) over a `visible + 64` capacity, with `volume_norm` normalized against the *visible* maximum. `hp/render/` adds the painter seam: `probeRendererKind` pins the plan's probe order **WebGPU → WebGL2 → LWC** as a literal 4×4 truth table where `off` wins over capability and a forced mode never claims a backend the probe did not find, and `createWebgl2Renderer` draws the whole viewport as **one instanced call** — one VAO, an 8-word-per-record divisor-1 attribute layout read straight out of the staging bytes, and a fragment shader that carves the body box plus a centered 1/8-slot wick out of a single quad per candle (packed `0xAABBGGRR` unpacked with core ES 3.00 bit ops, since GLSL ES 3.00 has no `unpackUint4x8`; alpha 194/255 blending over the transparent-clear, stacked LWC chrome). The factory is null-never-throws, so any context/shader failure falls through to LWC instead of failing the page. Tests pin the struct stride and byte order, the NDC math, the hot-fill contracts, the full probe table and the factory's failure surface (`tests/hp/{visual-attr,select-renderer,webgl2-renderer}.test.ts`). **Live wiring is deliberately deferred**: no producer writes `visual_generation` yet and plan §14.2 forbids gutting PaneManager before GPU parity tests exist, so — like PR 4–7 — this lands as library + tests, and the e2e "candles visible" smoke waits for a producer.

- **HP visibility: architecture page, agent playbook, and rung chip (HP PR 9).** `docs/architecture/hp-engine.mdx` documents the opt-in plane end to end — the HP-0…HP-4 rung matrix and selection algorithm, the flag table with the kill-switch rule, the COOP/COEP reality — the isolating pair (`same-origin` + `credentialless`; COOP flipped from the popup-safe value, see Changed) — while HP-3/4 still run on the copy transport until a producer wires the SAB hot ring, the AXB1 transport and its cross-repo golden vectors, the SAB `O(HOT_CAP)` memory contract, the GPU paint seam, and a landed-vs-library-only status table — registered in the Architecture nav and track map. `okf/playbooks/hp-engine.md` (curated, `okf_lock: human`) gives agents the same map as a playbook: which hp submodule owns what, the contracts that must not break (seqlock discipline, 8-word/32-byte record stride, float32 only after NDC, GLSL ES 3.00 bit unpack, the right-edge NDC anchor, flag-off byte-identical rollback), and the reminder that rung selection ≠ wiring. The Workers Manager gains a **Chart plane** card carrying the plan's HUD chip: `hpChip()` (`src/hp/hud.ts`) reports the *selected* rung in plan format — `hp · sab+gpu` / `hp · copy+lwc` / `json · lwc` (transport memory + painter) — where default-off honestly reads `json · lwc` because that is exactly today's path; the kill switch shows as `Kill switch` and engaged tabs show the rung word (`HP-3`). Pinned across the full flag × capability matrix including the session OOM clamp (`tests/hp/hud.test.ts`). The feed-chip surface and MCP `stream.get`'s `hp` field stay unwired.

- **A working OpenCode project configuration.** The project `opencode.json` declared a Prettier formatter whose command never passed a file, so every write ran a no-op formatter and then fell through to Biome — which is lint-only here (`biome.json` sets `formatter.enabled: false`) and exited non-zero, so **no file was ever formatted**. The command now ends with `$FILE`, which OpenCode replaces with the absolute path, and the formatter is scoped to the code extensions the repo declares as Prettier-managed (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.json`, `.jsonc`, `.css`); Markdown/MDX and YAML are excluded because Prettier rewrites the `#`-block license headers into headings and flips the compose files to single quotes. Biome, `rustfmt`, `ruff` and `uv` are disabled as formatters: Biome is the linter, `src-tauri/src/*.rs` is not rustfmt-clean (the repo uses a 2-space Rust style), and the Python helpers have no formatter config. The same file keeps `lsp: true`, adds the OKF bundle as project instructions, ignores the heavy build directories in the file watcher, guards `git push` / `git tag` / deploy / `rm -rf` behind an approval prompt, enables the `todo` tool, and adds the `/commit`, `/verify` and `/release` slash commands plus a read-only `axis-reviewer` subagent. Two `references` point OpenCode at the sister checkouts — `pyne` at `/home/jango/Git/pynescript` (the checkout is still named `pynescript`, not `pyne`) and `hoox` at `/home/jango/Git/hoox` — so Pine Script™ parity questions can be checked against the real PYNE builtin signatures without scanning the tree. Automatic compaction is enabled (`auto`, 15 000 retained tokens, 20 000 buffer) so long `/verify` and `/release` runs stop walking into the context ceiling. Four more shell rules join `git push` / `git tag` behind the approval prompt: `git reset --hard*`, `git clean -f*`, `git checkout --*` and `wrangler secret*` — the destructive git forms that could discard work, and the command that mutates live Worker secrets.

- **One git backend instead of two near-identical files.** GitHub and GitLab were separate modules with twelve functions of the same body, and the dispatch picked between them with nine ternaries. The provider-specific parts — URL shape, auth header, content encoding, update token, conflict status — now live behind a `GitForge`, and the shared operations live in one place. The per-provider differences stay explicit: GitHub identifies a blob by its sha and answers `409` on a conflict, GitLab only needs to know whether the file exists and may answer `400`/`409`/`422`.

- **Engines declare what they are instead of being guessed from their id.** Seventy-one places branched on the engine id string — `id === 'server'`, `id.includes('pyne-worker')` — to decide how the engine behaves: which credential slot it uses, whether the remote LSP is reachable, which transport the HUD reports, whether the run can be re-applied. An engine now declares a **family** (`server` / `pyodide` / `worker` / `dynamic`), and the behaviour branches on that. The id stays the user-facing name and the selection key, and the credential vault still resolves a family *exactly*, so an unknown engine id is never routed to the shared server or worker slot by accident.

- **One event-listener primitive instead of the same four lines everywhere.** Dozens of components repeated `onMount(() => target.addEventListener(...))` / `onCleanup(() => target.removeEventListener(...))` — the same shape, easy to get subtly wrong (a `capture` flag on one side only, a listener that outlives its component). `attachEventListener` attaches and returns the disposer, so the two halves cannot drift apart, and `useEventListener` wires it to the component lifetime.

- **One modal shell instead of six copies of the dialog chrome.** The About, Symbol, Script settings, Dataset manager, Keyboard shortcuts and Storage change dialogs each carried their own backdrop, accent, header (title, hint, close), body and footer, plus their own focus trap, Escape handling and backdrop dismiss. They now render through one shared `Modal`, which owns the chrome, the focus trap and the Escape listener — the listener exists only while the dialog is open. The **Keyboard shortcuts** dialog declared `aria-modal="true"` and had **no focus trap**; it now has one, like the other five.
- **The shortcuts dialog's close button now uses the shared icon.** It was the only dialog drawing a literal `✕` instead of the Lucide `X` the other five use.

- **One run-result envelope instead of three.** The engine result arrived over the REST path, the WebSocket path and the batch path, and each built the same envelope with its own copy of the body — plus a byte-identical copy of the bar-time-axis extractor. One mapper builds it now. The differences between the paths are stated per call site instead of hidden inside three copies: the WS path resolves the run mode server-side, the REST path infers `script_type` from the payload kind, and the batch path only accepts a real boolean `overlay`.

- **One Worker route table instead of four copies of the route list.** The route knowledge lived in the entry dispatcher's `switch`, its ad-hoc `if` / `startsWith` guards, the MCP proxy's own dispatcher, and the MCP allowlist's method+path pairs — and the four drifted. One table declares the routes now; the entry dispatcher and the MCP proxy both read it. The allowlist stays the authority on *whether* a path may be reached over MCP (it is a security boundary with its own script-id and version-path rules), and a test asserts the table and the allowlist agree.

- **One popover shell instead of four copies of the menu skeleton.** The chart-layout, screenshot, extra-widgets and run-split menus each carried an open flag, an anchor element, a measure-and-clamp placement, a resize/scroll reposition, an outside-click dismiss and an Escape handler. One `Popover` owns that skeleton now. Two of them had drifted: the run-split menu dismissed on `mousedown` where the others used `pointerdown`, and it hand-rolled the outside check the shared helper already provided — it now dismisses on the same event as the others.

- **A network failure carries its status code.** The same three steps — read the body, decide what a non-2xx means, give the failure a status — were written into every network call, and the status was usually flattened into the error *text*, so a caller could not tell a 404 from a 429 without parsing a string. `src/api/client.ts` owns those three steps now, and the cloud storage client and the venue fetchers carry the status on the error. The engine plane, the probe plane, the git adapters and the editor LSP client keep their own contracts on purpose — a failed engine request is a *verdict*, not an exception — and the module documents which is which.

- **HP-2 producer wiring: ingest writes the hot SAB ring, the chart samples it on rAF.** The SAB plane stops being library-only. When the tab is opted in **and** cross-origin isolated, `IngestHostClient` allocates the hot ring once and rides it on `connect` (`hotSab`); the ingest worker wraps the same buffer, confirms with a `hot` reply, and becomes the ring's single writer (`hp/workers/hot-ring-writer.ts`). The **first series snapshot** binds the ring (a snapshot for another id rebinds with an epoch bump, so a symbol switch never reuses ticks); a bound series `delta` is written into the ring and **stripped** from the posted frame — `seq`, `closed_upto` and the positional block still cross `postMessage`, so `applySeriesPush`'s no-bar branch keeps resume/repair sequencing intact — while snapshots keep their payload (initial paint) and script deltas, foreign series and stale-only deltas pass through untouched: the frame path is always a correct fallback. Every flip republishes the whole window through `publish` (an unpublished slot must be fully rewritten or readers see stale zeros outside the touched indices); a forming tip overwrites the newest entry in place, and a full window slides one step with a whole-window rewrite per closed candle. Main-thread paint is `startHotRingPaint` (`src/chart/live-append.ts`): a `subscribeGeneration` rAF pump samples the published generation via `copyOutTail` and feeds the **contiguous tail run** that continues the store tail through `appendLiveBar` — the same store verdicts and paint invariants as the frame path (a forming tick never reopens a closed tip; a jumped ring — suspended tab, resume replay — is left to the snapshot/repair path). `stream-live.ts` starts and stops the sampler with the wire lifecycle. Flag-off, kill switch, non-isolated tabs and a refused SAB allocation (the existing rung-1 OOM clamp) all keep today's JSON/transferable frame path byte-identical. New tests: `tests/hp/hot-ring-writer.test.ts` (bind/strip/slide/rebind/passthrough routing), `tests/hp/hot-ring-paint.test.ts` (sampler verdicts incl. the non-contiguous guard and disposer), `tests/hp/ingest-host-sab.test.ts` (the isolation × flag transport gate).

- **HP-3 producer wiring: the WebGL2 candle overlay paints over the price pane (parity mode).** The GPU paint plane gets its producer. `src/hp/render/gpu-overlay.ts` stacks a transparent WebGL2 canvas over LWC's price-pane content area and draws the *same* candles LWC is painting — aligned by construction against LWC's own geometry (visible logical range + right-scale coordinates) — with LWC staying the painter and the full fallback; hiding LWC's candle series remains the plan-gated next switch (§14.2). Data is the HP-2 ingest hot SAB ring: `stream-live.ts` exposes the ring the wire allocated (`getLiveHotBuffer`), and ChartHost starts the overlay per active slot after the initial paint, stopping it in the main cleanup. The frame path reuses the PR-8 renderer (`fillVisualAttrFromHot` → one instanced draw) with a new pure `overlayViewport` helper (fractional logical anchor, right-edge index, the `MAX_OVERLAY_BARS` sanity cap) and a `priceScaleLinear` probe that refuses non-linear (log/percentage/indexed) right scales; every bail — no ring, ring/chart length mismatch, cold left edge, non-linear scale, torn seqlock sample — **clears** the transparent canvas, so a skipped frame shows LWC underneath and never a stale GL layer. The overlay engages **only** when `axis.engine.hp.gpu` is forced to `webgl2`: LWC paints candle bodies translucent (0.76) and stacking identical GL bodies composites them darker, so `auto` / `off` / `webgpu` stay dormant until the hide-LWC-candles switch is measured. Tests: `tests/hp/gpu-parity.test.ts` pins feed parity against `copyOutBars` (bit-exact NDC + reconstruction), hot-fill bit parity, capacity-drop parity, `overlayViewport` anchor identity vs LWC, the explicit-gate matrix (auto dormant even when probeable; forced+probeable engages once, disposes safely) and `parseCssColorToRgb` on LWC's premultiplied palette. The e2e smoke (`e2e/gpu.spec.ts`, `@gpu`) drives the full product chain — empty chart, offline mock-poll stream, scripted `/ws/live` full snapshot + per-slot rollover re-seeds against a local WS server (Playwright's WS routing does not intercept the ingest worker's socket) — and asserts the overlay canvas turns visible and its framebuffer carries alpha-nonzero GL pixels.

- **MCP observability for the HP plane: `hp.get` + `hp.sample`.** The HP flags live in tab-local `localStorage` and isolation is a runtime property — neither crossed the sanitized app snapshot, so an agent asking *"is HP actually working in this tab?"* got nothing. `src/mcp/hp.ts` adds two read-only capabilities: **`hp.get`** reports the flags (enable / kill switch / `gpu` / `sab`), the cross-origin isolation probe, the HUD chip verbatim, the session rung cap after a SAB OOM (`axis.hp.rung`), the **actual** hot-ring runtime (window bounds, `seq` / `closedUpto`, SAB bytes, `tailTime` vs `chartTailTime`, and the tail-identity alignment the GPU overlay guard enforces), the wire state, the overlay canvas's DOM state, and a verdict — `kill` / `off` / `awaiting` / `copy` / `fallback` / `degraded` / `misaligned` / `live`; **`hp.sample`** measures a bounded window (100 ms–10 s, default 1 s) of *movement*: ring `seq` delta (ingest publishes landing), `closedUpto` progress, rAF frame cadence, and the chart's append/tail deltas. Pure reads — no flag writes, no wire start, no SAB allocation, no secrets. Tests: `tests/mcp-dispatch.test.ts` pins registration as read-only, the default-off / kill-switch verdicts, the engaged-rung-without-wire wording, and the sample envelope incl. the window clamp.

### Changed

- **The last hand-rolled LRU trims use `BoundedMap`.** The session run-mode memo, the session retry cooldown map and the dataset memory mirror each reimplemented delete + re-insert + evict-oldest; they now use `BoundedMap.set`, which owns that sequence (and, unlike the dataset store's old loop, needs no special-case to protect the just-written key — a fresh write is always newest, so the trim can never evict it). `BoundedMap` also gains `[Symbol.iterator]` so the dataset mirror's existing `for..of` loops keep working. Pinned by the dataset, live-sessions and data-sessions suites.
- **The cloud client uses the shared JSON fetch instead of its own.** `storage/cloud`'s private `api()` reimplemented `fetchJson` line for line (fetch + `readJsonBody` + `HttpError`, same `{status, json}` shape, same 30 s timeout). It now delegates, which gives `fetchJson` its first production caller — the helper is no longer a tested-but-unused abstraction. No behavior change: same return shape, same timeout, same error contract.
- **One flag pair instead of two state machines.** `engine/feature-flag` and `hp/feature-flag` were the same module with different keys: an enabled key, a disabled key, in-memory fallbacks, and a kill-switch-wins rule written out twice. They now share `createFlagPair` from `src/utils/flags.ts`; the plane modules keep their key constants and public function names, the GPU/SAB/rung handling stays HP-specific, and the kill-switch-wins rule exists once. Side effect, now matching both modules' doc comments: the stream-engine `isEnabled` also respects an explicit opt-out (previously only HP's did). Pinned by the `hp/feature-flag` + `engine/feature-flag` suites.
- **One storage accessor instead of eight helpers and thirty guards.** Four modules each owned an `lsGet` / `lsSet` / `lsRemove` triple and ~30 call sites hand-rolled `typeof localStorage` guards, differing only in whether a failed write returned `false` or `void`. They now share `src/utils/storage.ts` (`getItem` / `setItem` / `removeItem` / `getJson` / `setJson` / `getFlag` / `setFlag`), which never throws — the boolean write return is kept because the alerts persist path reports quota failures. The memory fallbacks in both feature-flag modules and the quota-reporting `trySetItem` in the store stay exactly as they were. Pinned by the existing storage, alert, credential, vault, catalog, watchlist, plugin, optimize and editor suites (234 cases).
- **Nine listener sets share one emitter instead of hand-rolled loops.** `bar-replay`, both alert modules, the MCP bridge, the dataset store, the secret vault, the credentials store, the editor bridge and the open-script source each kept a `Set` of listeners with its own subscribe/unsubscribe pair and notify loop — and two of them (`editor-bridge` dispatch, `open-script-source` emit) had no error isolation, so one throwing subscriber broke delivery for the rest. They now share `createEmitter` from `src/utils/emitter.ts` (snapshot iteration, per-listener fault isolation); the emitter gains a `clear()` for the dataset store's test reset. All public subscribe functions keep their names and signatures. Pinned by the existing `bar-replay`, `editor-bridge`, `dataset-store`, `credentials`, alert and MCP-bridge suites (236 cases).
- **One public-REST definition per venue instead of two.** `symbol-catalog` (instruments) and `watchlist-tickers` (24h tickers) each implemented OKX / Bybit / Coinbase / Kraken — same hosts, same `HttpError` contract, same `XBT → BTC` normalization — and had already drifted: the catalog sent `cache: 'no-store'` where the tickers did not. Each venue now owns its public fetchers (`fetchOkxInstruments` / `fetchOkxTickers`, …) in `src/data/venues/`, sharing one `venueFetch` (always `no-store`, throws `HttpError`) and one symbol spelling (`toUsdt`, `okxInst`, `coinbaseProduct`, Kraken legacy-key handling) in `venues/spot.ts`. The catalog and the Watchlist are thin mappers over those; `toUsdt` / `okxInst` / `coinbaseProduct` stay re-exported from `watchlist-tickers` so the WS layer's imports are unchanged. Side-effect fix, not a behavior change: the Coinbase ticker path stripped `USDT`/`USD` but not `USDC`, so a `…USDC` symbol built a broken product id — it now shares the exported helper. Pinned by the existing `symbol-catalog` and `watchlist-tickers` suites (42 cases).
- **One wire-bookkeeping core for both live socket clients.** `Redesign2WsClient` (direct WebSocket) and `IngestHostClient` (HP ingest worker) each carried a verbatim copy of the request/response waiter map, the reconnect-handler set with its swallow-per-listener notify loop, `awaitFrame`, `dropPending`, and the `stats()` snapshot — a fix to waiter cleanup or teardown in one never reached the other. They now share `PendingRequests<TFrame>` (id-keyed waiters, timeout reject, `dropAll`) and `ReconnectHandlers` (snapshot iteration, fault isolation) in `src/engine/wire-bookkeeping.ts`, plus a `wireStats()` snapshot helper. Public behavior is unchanged (`addReconnectHandler`, `awaitFrame`, `stats()` shapes identical; the one white-box test that read the private handler set now reads the shared core). Pinned by the `ws-client`, `ws-send`, `ingest-host` and `ingest-host-sab` suites plus the `mcp-live` / `engines-live-sessions` / `data-sessions` suites (124 cases).
- **The Worker answers every route with the same error envelope.** The entry `fetch` opened its `try`/`catch` *after* the MCP, MCP-bridge and stream paths, so an exception in any of them escaped the Worker as an unhandled rejection instead of a `500`. The dispatch now runs inside one `try`, and a shared `handleError` helper logs the failure server-side and returns the canonical `{ status: 'error', code: 'INTERNAL' }` envelope. The error text is still never reflected to the caller.
- **One rate limiter instead of two.** The MCP plane kept a verbatim fork of the fixed-window limiter, with its own bucket map. Both now share `worker/src/rate-limit.ts`. The shared `allowRate` takes an optional call weight so a JSON-RPC batch is still charged per method — and a batch that does not fit the remaining budget is rejected *without* being counted, so it cannot eat into the next caller's allowance.
- **One abort/timeout combiner instead of eight.** Six modules each had their own `requestSignal` / `withBudget` / hand-rolled budget block, and four of them **silently dropped the caller's abort signal** on runtimes without `AbortSignal.any`. They now share `src/utils/fetch-timeout.ts`, whose fallback keeps the parent signal honoured. The one place that deliberately lets the caller's signal win — the venue page walk, which owns its own budget — uses a separate, explicitly named helper so the difference is intentional rather than accidental.
- **One error helper instead of four.** Three modules carried their own `errMessage` copy and four carried their own abort-detection heuristic. They now share `src/utils/errors.ts`, which separates the two questions the old copies conflated: `isAbortError` decides whether to rethrow (name-based only, so a network error that merely mentions a timeout is still a network error), while `isAbortLike` / `isTimeoutLike` decide how to word the message.
- **One JSON builder per CORS policy, and one error envelope across the Worker.** Eleven near-identical JSON wrappers were spread across the Worker (`apiJson`, three `json` copies, `corsJson`, `proxyJson`, two `jsonError`s), and forty-five hand-written `{ status: 'error', code, message }` objects bypassed the canonical envelope. `http.ts` now exports `scopedJson(cors)` and `plainJson`: a route binds its CORS policy once and cannot answer with another route's headers by accident, and the inline envelopes go through `errorBody()` so the error shape has exactly one definition. Two name collisions are gone — `mcp/protocol.ts` `jsonError` (an MCP tool result, not an HTTP response) is now `toolError`, and `onchain.ts`'s local `proxyJson` no longer shadows `proxy-router.ts`'s export — and `proxy-router.ts` no longer uses a reversed argument order. The session Durable Object answered 404/426 with a plain-text body; it now answers with the JSON error envelope like every other route. Header values and status codes on every existing route are unchanged.

- **One time normalizer instead of five.** The venue parser, the plot-time helper, the engine-time helper and the two on-chain helpers each implemented the same ms-to-seconds rule, and each rejected a slightly different set of values: a plot time of `0` was accepted by one helper and dropped by another, and a time past year 2100 was accepted by some and rejected by others. They now share one function, so a time the venue accepts cannot be rejected by the engine and vice versa. The venue parser keeps its ISO date-string support, which is the one shape the other planes never see.
- **The cached-datasets modal has one state, not three.** The Topbar, the StatusBar and the Data Source Manager panel each owned a `datasetsOpen` signal for the same modal, so the copies could drift: opening it from one surface left the other two showing their own closed state. They now share one module-scope signal, like the mobile-sheet state.
- **One labelled-field component instead of two.** The Data Source Manager and the Script Library each had their own `sc-field` wrapper, byte for byte identical. They now share `ScField`.

- **The cloud script list is newest-first, like the other backends.** The Worker returned the scripts in whatever order the row scan produced, so the Script Library listed them differently depending on the backend.
- **A backend without version history no longer throws a special error.** The service probed each backend for optional methods and then threw `VERSIONING_UNAVAILABLE` at the call site. The backends now declare what they can do, the service reads that declaration, and an unavailable history is an empty list (and `null` for a single revision) instead of a runtime error.

- **COOP flipped to `same-origin` — cross-origin isolation is on.** Chromium sets `crossOriginIsolated` (and unlocks SharedArrayBuffer) only for COOP `same-origin`; the previously shipped `same-origin-allow-popups` pair could never isolate, so every HP rung above the transferable copy was unreachable in a real browser. No AXIS surface depends on a popup opener — the GitHub/GitLab device-flow popup is opened `noopener,noreferrer` and the token arrives by Worker polling (`waitForDeviceToken`), never via `window.opener`; the detachable editor and panel companion windows are same-origin (BroadcastChannel / direct DOM wiring) and stay in the same browsing-context group under `same-origin`. The flip moves `COOP_VALUE` plus every static host in lockstep (`public/_headers`, the SW offline shell, `axis_pwa_server.py`, both nginx configs; Vite/Bun servers import the map) and re-pins the three header tests. The capability probe stays the runtime source of truth: a tab that fails isolation keeps the copy path (`hp · copy+gpu` / HP-1), and the GitHub login is worth one manual pass on a deployed host.

### Fixed

- **WebGPU is reported as what it is: selected, but with no painter.** `auto` on a WebGPU-capable machine selected rung HP-4 and the chip read `hp · sab+gpu` — while no WebGPU renderer exists anywhere in the tree, so LWC painted and nothing said so. The chip now reads `hp · …+lwc` with a `no painter yet — HP-4 reserved` note whenever the probe outcome is `webgpu` (the rung and the selected renderer are still reported, only the painter word follows what actually paints), `hp.get`'s dormant-overlay verdict says the same, and the Settings GPU select labels the option `(no painter yet — rung only)`. No behavior changed — this only stops the UI from claiming a backend that does not exist.
- **The GPU overlay draws LWC's candle widths, not a look-alike fraction.** Even with the anchor fixed, the overlay's body was `0.75 · barSpacing` and its wick `0.125 · barSpacing`, while Lightweight Charts computes the body with `optimalCandlestickWidth(barSpacing, pixelRatio)` (a spacing-dependent coefficient, a flat 3-device-pixel special case, and device rounding) and draws a flat one-CSS-pixel wick — leaving a visible fringe on every candle edge. `src/hp/render/lwc-candle-width.ts` mirrors LWC's formula verbatim; the overlay derives the pixel ratio from LWC's own pane canvas (not `devicePixelRatio`: LWC's canvas can be 1× on a 2× display) and passes CSS widths through the viewport, which the shader consumes as NDC half-width uniforms. Measured on the rendered chart: body **5 CSS px on both painters**, wick **1 px on both** (direct device-row runs, not column bucketing). The vertical mapping now also uses `coordinateToPrice(h)` so the GL viewport's bottom edge is LWC's price at `h`, not `h − 1`.
- **The GPU overlay's anchor now reproduces LWC's own `indexToCoordinate` — no more doubled wicks.** The overlay derived `barSpacing` as `width / (to − from)` and anchored records at `width − (to − i)·spacing`, but LWC's visible range spans `width / barSpacing − 1` (half a slot inset on each side), its bar x is `width − (to − i + 0.5)·barSpacing − 1`, and the pane content box is the pane canvas (554 px here, not the 555 a `paneRect − timeScale` estimate produced). The result was a ~5 px shear across the pane — near-zero mid-chart, a couple of pixels at the edges — which read as "slightly wrong" overlaid candles. `overlayViewport` now recovers the real spacing from the range, folds the half-slot phase and 1 px inset into the right-edge anchor, and `paneContentSize` takes the geometry from the pane's own canvas. `tests/hp/gpu-parity.test.ts` pins the identity against LWC's formula to 1e-9 and the on-screen check (column-profile correlation + crops) went from 0.55 to 0.84 with the wick/body doubling gone.
- **The HP-2 hot ring now allocates when the wire client is constructed, so the sampler and the GPU overlay actually engage.** `IngestHostClient` allocated the hot SAB inside `connect()`, but `buildWire` reads `rawClient.hotBuffer` synchronously right after `createLiveWsClient` — before any `connect()` — so the read was always `null`: `startHotRingPaint` never started, `getLiveHotBuffer` never exposed the ring, and both the HP-2 rAF copy-out and the HP-3 GPU overlay stayed dormant in the real app while the unit tests (which check after `await connect()`) stayed green. `ensureHot()` moved into the constructor (still gated on flag + isolation + SAB mode, still OOM-clamped to rung 1), and the regression is pinned by asserting `hotBuffer` is non-null **before** the first `connect()`.
- **The GPU overlay places the hot ring as the chart's *tail window*, not as the whole series.** The first production measurement (`hp.get` on a live 9 500-bar chart) showed `ring.aligned: false` with `hotCount: 501`, `hotFrom: 0`: the guard compared `getBarsLength()` against the engine snapshot's own index space (`hotFrom + hotCount`), which only ever matched when the snapshot happened to equal the chart window — the overlay therefore never painted on a real REST-loaded chart (the e2e staged equal counts and missed it). The ring is now placed by **identity**: the ring's newest bar must equal the chart's newest bar (tail time), ring slot `j` is chart index `chartBars − hotCount + j` (`ringWindowPlacement`), and a viewport that starts left of the window clears instead of shifting candles — cold paging remains unwired, so zoomed-out views over more bars than the ring holds still draw nothing (LWC keeps painting). `hp.get` now reports `ring.tailTime` / `ring.chartTailTime` and a tail-identity `aligned`, and the `@gpu` e2e covers the production shape: a shortened snapshot clears the canvas (alpha 0) and a wheel zoom into the tail repaints it.
- **A background backfill can no longer fail an unrelated test's fetch assertion.** `tests/onchain-load-symbol.test.ts` starts a `loadSymbolData` that queues a Data Source Manager walk; the job outlived the test and kept paging after later files had restored the *real* GeckoTerminal source, so whichever file installed a fetch mock next counted a stray `api.geckoterminal.com` call. That is why `setScriptChartVisible > show does not run library() sources` failed in roughly every other full run with nothing to do with indicators — and the same leak failed its sibling `show while live…` case instead. The case now resets the DSM in `afterEach`, the visibility describe resets multiplex rerun/live-bar timers in `beforeEach`, and the assertion prints the offending URL and stack instead of a bare counter.
- **A long session no longer leaks a client, a timer or a memo per key.** Six module-level maps grew with the number of distinct keys a session touched and nothing ever evicted them: the engine WebSocket clients (one socket plus its pending map per endpoint), the data-session series memos (one per endpoint + series), the dismissed job ids (one per job, forever), the pending live-bar writes (one per source + symbol + interval), and the bar-close verifiers (one per engine + series). They now share `src/utils/bounded-map.ts` and are capped. Two of them needed more than a cap: an evicted WebSocket client is **closed** so the socket does not outlive it, and an evicted pending live bar is **flushed** rather than dropped — it is still a bar the dataset should receive.
- **A Worker route can no longer be reached with an uncapped body.** Four routes read the request body outside the shared cap — `/api/keys` created a key from an unbounded body, `/api/git/oauth/*` parsed the device-flow body unbounded, the MCP bridge forwarded an unbounded invoke payload, and the MCP plane carried its own hand-rolled copy of the byte check. All four now go through the shared capped reader and answer `413 PAYLOAD_TOO_LARGE` for an over-cap body. A truncated device-flow body used to look like a request that carried no client id; it is now an explicit `413`.
- **Live indicators no longer drift away from the candles on the stream path.** The stream plane *replicates* the engine's series (the wire has no client-side tick), but the stream branch returned before the engine-owned branch that ticks the chart's engine data session — so on the stream path nothing drove the engine and its series froze a few bars behind the venue. The script sessions that evaluate over that series froze with it, while the chart kept advancing from the venue, and the apply path tail-aligned the stale values onto the chart's tail: the indicators were **displaced by the freeze gap** (measured live: 38 bars after 38 minutes, growing with every new bar) and the newest bars carried no indicator value at all. The stream path now drives the engine's series on every venue flush (the `series-drive` module existed for exactly this but was never wired in), and the re-run awaits that drive so the scripts evaluate against the freshly driven series.
- **Re-apply is no longer skipped once the rolling window slides.** The dedupe compared only the bar **length**, but the rolling window slides with a constant length — so every reapply after the first looked "unchanged" and was silently skipped: the UI re-run button and the MCP `indicators.run` capability became no-ops, and the indicators kept the window they were last computed on while the candles moved on. The guard now compares the window *identity* (head bar time + length): a repeated call on the same window is still a no-op, a slid window re-runs. `indicators.run` also reports how many scripts actually re-ran (`reapplied`).
- **Strategy events stay on the chart on every tick instead of flickering on/off.** Silent live re-runs replaced all trade markers for a strategy with only the events from the current evaluation, so entry/exit labels disappeared between bar closes and only reappeared on the next close. Silent re-runs now merge new markers with existing ones (same-time markers are replaced, others are kept), so strategy actions are always visible; interactive runs still replace wholesale. Also `live.rerunOn` is always honored — `every-tick` (the default) is no longer silently downgraded to `bar-close` based on engine capability probing.
- **A new candle now advances the chart instead of freezing it.** `appendLiveBar` painted every genuinely new bar (`appended`) with `series.update`, which can only overwrite the last bar in place and never adds a time slot, so the chart stuck at the last loaded time and each new candle rewrote that same slot (the right edge stayed at `11:30` while the price there changed). New bars now go through the same full-window `setData` path as a window slide, so the candle lands at the right edge within `rightOffset` without auto-scroll; forming-tick updates (`updated`, same time) still use the O(1) in-place path.
- **The engine flush names every local dataset before it clears anything.** The purge list was built after the memory mirror had been wiped, so IndexedDB-only series (the mirror keeps 48) were never deleted on the engine, and the result still said they had been. Settings and `engine.flush` now capture memory and IndexedDB keys first, delete those engine series, then wipe the local stores. A list that cannot be read is reported as a failure instead of a clean delete.
- **A page that starts during a flush cannot put the series back.** The generation check ran only when a write was queued, and a bars-cache put that had already copied its batch could commit after the clear. The flush bumps that generation and clears the mirror after the removes, after the remote deletes, and after the cache wipe. A write that loses the race deletes its key, and a batch copied out before the clear is dropped.
- **Spot and another market no longer share one dataset.** Reads and writes never passed the provider lock, so linear and inverse bars merged into the public spot series while the engine key used a different market. Non-spot and keyed series now append `|market|authMode`. The engine wire still maps `linear` to `swap` and `inverse` to `future` at that boundary only.
- **A Data Manager job follows the dataset that was loaded.** Backfill and apply-when-complete used the chart's current market, so a linear row grew the spot series and could paint onto a chart that had since switched market. The job keeps the selection's lock, and a completed job does not paint when that lock is no longer the chart's.
- **An IndexedDB read failure no longer looks like an empty dataset.** `getCachedBars` returned `[]` on a failed read, and the next page merge replaced the series. A failed read now throws and the write is refused. A genuine miss, and a browser with no IndexedDB, still look empty.
- **Replacing a dataset keeps a DEX pool address's case.** The replace path uppercased the stored symbol while the write path did not, so list and delete rebuilt a different key for an address that contains `:` or `/`.
- **A dataset repaint no longer drops chart bars the dataset is missing.** The merge kept only bars strictly newer than the dataset tip, so a same-time forming candle jumped backward and an interior hole-fill was punched back out. Equal times keep a closed dataset bar over a forming chart bar, and otherwise keep the chart bar.
- **A script subscription grows with the chart window.** `history_bars` was sent only on the first subscribe, which usually ran against the short first paint, so the indicator stayed blank on the rest of the window. The depth is part of the subscription identity and is the chart window even when the store is still shorter. A script resubscribe does not cool the series socket.
- **A new candle no longer shifts the indicators.** Every forming tick pushed the open bar's time onto the candle axis again, so the script series was one row per tick instead of one row per candle. The next candle repainted that series onto a longer index than the price pane, and the plots jumped. A forming tick now keeps the time it already recorded, and a new candle extends the axis by one bar.
- **Zooming while the chart loads no longer blanks the candles.** A history replace paints the new candles while volume or an indicator still holds the previous times. That frame throws inside the chart library, and the price series stays empty until the next bar updates both. Those extra times are dropped before the candle replace, and a zoom already in progress is not fitted away.
- **Donchian keeps moving after a new candle.** The live snapshot stored the shorter history the subscribe asked for, while the session and every later update were numbered from the longer series. Each new candle was rejected, so the channel stayed where the load left it and drew as a single point out to the last bar. The snapshot now counts the plots it actually contains, and a bad time axis no longer drops the value update.
- **Bollinger %B no longer repaints when a candle closes.** The live script snapshot carries bar times, and the deltas that follow carry only the new values. The apply path dropped that axis and zipped %B onto the candles by index, so each new candle moved every closed value onto the next bar. The price series was never moved. Closed %B now stays on the bar it was computed for, and only the new candle takes the new value.
- **Pine plot colors are no longer overwritten by the palette on re-run.** The legacy `plots[]` overlay path dropped the engine's `plot_meta.color`, so any script evaluated without named `series` fell back to the palette instead of the script's color. It now uses the same precedence as the named-series path: explicit panel pick (`custom`) → Pine `plot_meta.color` → palette. Auto-persisted (non-custom) colors no longer shadow a fresh script color, matching the earlier named-series fix.
- **Re-apply runs only once at a time.** Multiple call sites (load-symbol ×4, DSM, store, MCP) could fire during a single load, each re-running every script and flashing the chart through intermediate states. A guard now skips concurrent reapply passes; `stillCurrent` still supersedes stale ones.
- **Script colors survive a reapply when `plot_meta.color` is missing.** The re-run store path previously fell to `PLOT_PALETTE[colorIdx]` when the engine didn't ship a resolvable `plot_meta.color`, wiping Pine colors (e.g. `#6366f1`) to palette colors on every reapply. It now keeps the stored color when the fresh run doesn't ship one.
- **Chart overlays preserve stored script colors when `plot_meta.color` is absent.** `buildOverlayPayloads` fell to the palette on the chart (even though the script panel stored the correct color) whenever the engine response lacked `plot_meta.color` — e.g. batched reapply. It now falls back to the stored (non-custom) color before the palette, across named-series, legacy `plots[]`, and OHLC overlay paths. Precedence: explicit panel pick (`custom`) → Pine `plot_meta.color` → stored color → palette.
- **Fill bands render from `plot_meta` when no fill series array exists.** `resolvePlotFillBands` only scanned `series` entries, so `fill(plot1, plot2, color=...)` bands had no band to draw — fills are derived from edge plots, not a separate series. It now also scans `plot_meta` for fill entries and resolves their Upper/Lower edge series.
- **Re-apply runs only once per bar window.** Multiple call sites (load-symbol ×4, DSM, store, MCP) fired sequentially during one load with the same bars, each flashing the chart through intermediate states. `reapplyChartScripts` now skips when `store.bars.length` hasn't changed since the last pass.
- **Stale session/stream pushes no longer pin or freeze the chart.** A live push whose engine shipped no bar-time axis over a moved window (gap fill, backfill, slide while the tab was idle) was index tail-pinned onto the chart tail, and Lightweight Charts spans the resulting `na` gap as a long diagonal from the last pre-break value to the tip. Those pushes are now skipped instead (`staleNoAxis` in `src/indicators/apply-context.ts`, live pushes only — fresh full runs keep the tail-pin), so the last good plots stay on screen until a full run with an axis arrives. The same gap left the pane frozen instead when the values-only delta salvage dropped the axis permanently: the wire now resubscribes once per snapshot for a real full (`axisResubPending` in `src/engine/live-wire.ts`) instead of painting unpaintable state on every tick, and a seq gap resubscribes instead of force-merging. Pinned by `staleNoAxis` alignment tests, skip/paint live-push run tests, and wire resub-vs-paint tests (`tests/runner-engine-owned-apply.test.ts`, `tests/engine/live-wire.test.ts`).

## [2.25.3] — 2026-10-20

### Fixed

- **A remote dataset document that is already gone is no longer reported as a failure.** The dataset flush deletes the remote dataset documents; removing one that was never pushed (or was pushed before the sink existed) answered "not found", and the flush reported it as a write failure. Removing a document that is already gone is the state the caller wanted, so it is silent now.
- **The reconnect test no longer counts another suite's sockets.** The reconnect suite counted every socket the shared WebSocket mock had seen, so a reconnect timer another test file left behind could land in it and make the suite count one socket too many (a CI-only flake). The suite now counts only the sockets its own client opened, and waits for the reconnect instead of guessing the delay.

## [2.25.2] — 2026-10-20

### Added

- **The dataset flush reaches the engine.** AXIS caches the venue's OHLCV twice: in the local dataset store and in the **engine's** series store (the shared venue cache behind `GET /data/series`). Flushing only the local side left the engine serving the old — stale, holed — window, and the live path mirrors the engine's copy. Settings → Data → "Flush dataset manager" now also drops the engine's series for every key AXIS knows about (per key — the engine's store is shared), and the MCP exposes it as `engine.flush`.

### Fixed

- **A dataset write that was queued before a reset no longer repopulates the store.** The suite resets the shared singletons between files, and a write that was still queued when the reset ran landed in the next file's mirror — a dataset the next file never created, which then failed its "the mirror is empty" assertion (order-dependent, CI-only). A queued write now carries the store's generation and is dropped when the store was reset underneath it.
- **A live apply keeps the script's input descriptors.** The socket payload carries the values, not the run's metadata, so a live apply replaced the run's input list with an empty one (the Results panel and the Script Settings modal read it from there). The descriptors of the script's last full run are carried over.
- **A live script subscription now covers the chart's whole window.** The socket subscribed the script with the *series* depth — the short live snapshot (500 bars), which is right for the chart's own OHLCV (the chart is painted from REST) but wrong for a script: the engine's script state was 500 bars deep, so every live apply repainted the indicator over the last 500 bars only, blanked the rest of the window and collapsed the script's band fill with it. The script subscription now asks for the chart's own depth (capped by the Rolling window).
- **A script's input values now reach the engine.** The live socket subscribed the script **without its inputs**, so the engine evaluated it with the Pine defaults: changing an input (a Keltner channel length, an EMA period) repainted the chart with the new values and the next live tick overwrote them with the old ones — the change looked like it did nothing. The values now travel with the subscribe frame, and a changed value re-subscribes (the engine keys its session on the inputs).

## [2.25.1] — 2026-10-20

### Added

- **An uncaught error now carries its stack.** "Uncaught error: Value is null" named no series and no frame; the first three stack frames are appended to the log line, so the next occurrence is attributable.
- **The chart audits its own time axis.** After every apply, the co-painted series and the volume are checked against the candle axis; a series that holds a bar the candles do not have is named in the log (`time axis drift: price/overlay_x: 1 row(s) outside the candle axis …`).

### Fixed

- **The engine's live snapshot no longer replaces the chart's window.** The engine's live series is a short tail (the socket subscribes with ~500 bars), and the chart painted that tail as a **replace**: a freshly loaded 20 000-bar dataset was thrown away and the chart showed the engine's stale 500-bar window — with the engine's holes in it. The snapshot is now **merged** into the chart's window: it fills the holes the chart has, extends the tail when the engine is ahead, and never shortens the chart's own history.
- **The volume series carries exactly the bars the candles carry.** The volume skipped a bar only when its open/close were not finite, while the candle series rejects a bar whose high/low are not finite too — so the volume could hold a bar time the candles did not have. The library's shared time scale is the union of every series' rows, and each renderer asks its own series for the bar at the rendered index: a volume row at a bar the candles dropped makes the candlestick renderer fail with `Value is null` and no other clue. Both series now use the same rule.
- **A live tick lands on the same bar in the candle and the volume series.** The candle took its time from the mapped bar while the volume took the tick's own time, so a rejected tick could leave the two series one bar apart.
- **The co-painted series land on the candle axis.** The script series were clamped to the candles' *range*, so a row at a bar time the candles do not hold (a venue hole, a stale window) survived and extended the shared time scale past the candles — the render then failed with `Value is null` on every paint. The clamp now drops the rows the candles do not have, and the overlay lines are projected onto the candle axis (one row per candle, a Pine `na` whitespace row where the script had no value).
- **The new chart-window tests no longer leak state into the suite.** The test files that exercise the Rolling window left a small window in the shared store, so a later test file that loaded bars got them sliced — order-dependent failures on CI (and a coverage-gate drop). The store is now restored after each file.
- **A dataset repaint no longer paints over a chart that moved on.** The progressive repaint of a completed backfill ran on a timer: if the chart had switched to another symbol in the meantime, the repaint put the old series on the chart (and the store's bars with it). The repaint is now dropped when the chart no longer shows that series.
- **Three test files no longer leak state into the suite.** The dataset store, the provider session and the worker's proxy rate-limit buckets are module singletons: a dataset cached by one test file made the next file's backfill find the range already complete (and skip the walk), a venue left behind made the next file label its chart with the wrong exchange, and the worker's per-IP rate-limit bucket made a later worker test answer 429 instead of 404. The state is now reset per file.

## [2.25.0] — 2026-10-20

### Added

- **AXIS Settings → Data can flush the dataset manager.** A new “Dataset manager” section (next to the exchange keys) wipes every cached OHLCV dataset — bars *and* metadata — from the memory mirror, the local IndexedDB cache, and the remote dataset stores (git / cloud), behind a confirm step and with a result line (`Dataset manager flushed · N datasets removed`). Chart bars stay until the symbol is reloaded.

### Changed

- **The Rolling window is now the chart window, and it slides instead of growing.** Settings → Rolling window used to bound only what the engine was asked to evaluate: the chart itself kept every bar a live tick appended (up to the 100k safety rail) and only the next dataset repaint re-capped it. The window is now one number (`chartWindowLimit`) shared by the load paths, the live append path, the background catch-up and the engine input, and a new bar at the cap drops the head instead of extending the series. The status-bar inline edit and the Settings page both re-slice the chart through the same helper, so the setting and the painted window can no longer disagree. `ROLLING_WINDOW_MAX` is now `HISTORY_BARS_MAX` (100k) — the setting cannot promise a window the chart would refuse to paint.
- **A live tick is applied through one audited path.** `store.appendBar` returns a verdict (`ignored` / `updated` / `appended` / `slid`) and `chart/live-append.ts` is the only place a live bar reaches the chart. A rejected tick no longer moves the price card, no longer evaluates alerts, and no longer overwrites a dataset bar.
- **The chart data session follows the chart window.** The engine session was provisioned with a fixed 5 000 bars while the chart window is 10 000, so the engine's store could only serve half the configured window. The depth is part of the session identity now, and changing the Rolling window re-provisions the session.
- **A dataset write no longer re-repairs the whole series.** The stored series is already repaired, so a page write merges the page in one linear pass instead of rebuilding a map, re-sorting and re-sanitizing every bar.

### Fixed

- **The dataset repair no longer deletes venue bars (the phantom-gap loop).** The phase-aware snap moved an off-phase bar onto the nearest grid point even when that slot already held a bar; the dedupe then dropped one of the two — losing a real venue bar, shifting another bar's OHLCV onto the wrong candle, and leaving a hole the gap detector reported as fillable. The DSM chased that hole on every round and the job always ended with “Partial: N gaps remain”. The snap is now collision-safe (a bar only moves onto a free slot, and keeps its own timestamp when both neighbours are taken), never snaps onto a non-positive time, and the repair is idempotent.
- **The backfill walk stays on one grid.** The walk advanced its cursor by one second, so a venue that answers “the newest bar with open time ≤ endTime” returned a bar one second off its own grid — a one-second hole in the dataset, which is a phantom gap the job then chased. The cursor now advances by one step (one duplicated bar per page, dropped by the merge).
- **A widened backfill window is fetched by the running walk.** A second `startBackfill` for the same series widens the job's window while the walk runs; the walk now re-reads the bound on every page instead of keeping the one it was launched with.
- **A zero Rolling window falls back to the default.** `0` used to mean "no cap" for the chart as well, which could grow the series without limit; the engine keeps its "no cap" escape hatch, the chart stays bounded.
- **Monthly intervals count calendar months.** The expected-bar count used a fixed 30-day step, so the density floor was unreachable for most windows and a `1M` job could never report "complete".
- **A session venue's Friday closure is no longer chased as a gap.** The weekend classifier excused only gaps whose every missing slot was a Saturday or Sunday, so a venue closed from Friday's close to Monday's open produced a *fillable* gap: every job burned all six gap rounds on a bar the venue does not have. A missing Friday bar now belongs to that closure; a missing Monday bar is still chased.
- **The dataset job no longer re-walks a complete dataset.** The pre-walk completeness check validated the series without the venue calendar class, so a session venue's weekend closure counted as a hole and every job re-walked the whole range.
- **A failed dataset read can no longer truncate the dataset.** A sink that could not be read looked exactly like an empty dataset, so the merge base was empty and the last backfill page replaced the whole series. The sinks now distinguish “absent” from “broken”, and a write against an unreadable sink is refused instead of applied.
- **A dataset write is atomic and serialized.** The sink replace was a clear-then-write (a window where the dataset did not exist at all, and a concurrent write could be clobbered); it is now a single record put. Writes are serialized per key, so two concurrent writers (a backfill page and the debounced live-bar write) can no longer drop each other's bars. The memory mirror evicts **LRU** instead of FIFO, so the hottest series is no longer the first to be dropped.
- **A closed candle is immutable in the dataset.** A stale REST page carrying the partial (forming) values of a candle the venue had already closed could overwrite the final bar; a closed bar now wins against a forming one.
- **The live tail survives a dataset repaint.** The dataset store only learns about a live bar when the Data Manager source is active, so a background backfill slice landing in between repainted the chart from a series that was one bar behind and the forming candle vanished. The repaint now merges the chart's live tail back in and re-caps the result to the window.
- **A late tick cannot rewrite history.** A tick for a bar behind the tip was appended behind it, which put the series out of order and broke every index-based zip. Such a tick is now dropped, and a closed tip is never reopened by a forming tick.
- **The forming tip is replaced, not merged.** Solid's store setter merges an object into the existing node, so a tick without a volume kept the previous volume and the chart drew a stale histogram. The tip payload is normalised before the path-set.
- **A slid window no longer drifts the indicator pane.** When the window slides, the candles move forward by one bar while the script series do not (the engine has not re-run yet); the prune left them one row short, which shifts the pane's logical range against the price pane. The pruned series are padded back to one row per candle with Pine `na` whitespace rows.
- **A Pine `na` is a gap, not a zero.** A non-finite plot value was coerced to `0`, which draws a line at the axis; it now becomes a whitespace row (an omitted value). `null` is still coerced to `0` because the library rejects it.
- **Strategy fills follow the bar, not a stale index.** The engine stamps `bar_index` relative to the window it evaluated, and the chart window slides (it drops its head on every new candle) — so an index pointed at a different bar in the current series: every entry/exit marker landed one bar early and the PnL was computed from the wrong bars. The absolute `bar_time` is now the authority (the index is the fallback), and the report is built from the run's bars rather than the live store.
- **`plotshape()` markers survive the apply that paints them.** The owner-scoped series cleanup also cleared the script's shape and trade markers — and the apply path calls it on the price pane right after painting them, so `plotshape()` on every non-overlay script (RSI/MACD sub-panes) never rendered, and "Add Indicator" lost its markers before they could be re-homed. The series cleanup is now series-only; the detach path still clears the markers.
- **Two scripts that plot the same series name no longer collide.** The marker id was plot-scoped (`<plot>_<index>`), so the price-pane merge kept only one owner's markers and the rest vanished. The id is owner-scoped now.
- **The legacy `plots[]` fallback is length-checked.** A `plots[]` array of a different length than the chart window was index-zipped, mis-plotting every value with no error and no visual cue. It now goes through the same alignment as the named series.
- **A re-owned indicator's `bgcolor` band stays on its own pane.** The re-own path left the band on the price pane, where the removal loop (which only inspects the target pane) never removed it — a permanent duplicate band and a leaked series.
- **A destroyed pane releases its drawing layer.** The script `DrawingLayer` (SVG overlay, DOM listeners, a reference to the removed series) outlived the pane; a recreated pane with the same id got the stale layer back and projected drawings against a disposed scale.
- **A bar replay cannot leak the future.** The `bgcolor` bands were built from the full series and had no clamp, so they extended the shared time scale past the replayed candles — the user could scroll into the colours of bars the replay had not reached. The bands are clamped to the painted range now.
- **A bar-colour repaint updates the painted range.** The overlay clamp used a stale range after the candles were re-tinted, so it either dropped the newest overlay points or kept rows that no longer had candles.
- **A hidden script no longer fires its alerts.** The Pine alert notification ran before the "hide / detach after the engine returned" check.
- **A live alert sees the bar it fired on.** The alert context was built from the store, which is appended *after* the alert hook — so a condition on `bar.open` / `bar.high` / `bar.low` saw the previous candle. The tick's own bar is part of the context now.
- **`plotshape()` follows Pine's defaults.** The marker position is no longer inferred from the arrow direction (Pine's default is `location.abovebar` whatever the style), and the plot title is only used as the marker text for the label styles (`shape.labelup` and friends) — in Pine the title is the plot's name.
- **A fill band is only drawn where both edges exist.** Two edges of different lengths were zipped positionally, which drew half a band (one edge present, the other missing) instead of a clean gap.
- **A hidden plot keeps its palette slot.** The colour index only advanced for the plots that were painted, so hiding one plot changed the colour of every later plot of the same script.
- **A cross-indicator `input.source` series is re-joined by time.** The cached series was zipped against the consumer's window by index, but the chart window slides — so every value of a `plot:<script>:<plot>` source was off by the slide. The cache now carries the bar times it was written for and the consumer re-joins by time.
- **A session run without an engine bar axis says so.** The series is tail-pinned onto the chart (the only anchor left), which is only correct when the session's window is the chart's window. The apply now logs a warning instead of mis-plotting silently.
- **A bar replay cannot leak the future through the compare overlay.** The overlay was built from the full series, so the compared symbol's future extended the shared time scale past the replayed candles.
- **The compare overlay notices a mid-history correction.** The memo compared the refs, lengths and endpoints, so a gap fill (same endpoints, changed middle) left the compare line stale.
- **A line-break primitive is keyed by pane.** The same owner and plot name on two panes shared one entry, so one pane detached the other's primitive.
- **The Pine drawings fallback calls the layer once.** Without a sub-pane layer everything went to the price pane in a second call, which replaced the first call's list and overwrote the kept count.
- **Scrolling to a time before the history falls back to the ±14-day window** instead of snapping to the oldest bar.
- **The paint dedup is per chart slot and samples the whole window.** The signature was a module global (the second slot's paint could be skipped, leaving it blank) and sampled one middle row, so a correction anywhere else in the window left the stale candle on screen. It now samples up to nine evenly spaced rows per slot.
- **The dataset job cannot be resurrected after a cancel or a dismiss.** The final validation flipped a cancelled job back to `complete` and painted a chart the user had just cancelled, the cache-only job had no abort check at all, and a late status sync re-inserted a dismissed job into the list.
- **A paused job can be resumed.** The pause request only reached the runner at the next page boundary, so a resume in that window was dropped and the job stayed paused until the user pressed resume again.
- **The gap counter counts the right store.** The gap-fill progress was measured against the bars cache while the job writes to the dataset store, so “gaps filled” stayed at 0 in session persistence mode.
- **Adjacent gaps are filled in one walk.** The gap-fill phase now merges adjacent holes before walking back, so a fragmented hole costs one request instead of one per fragment.
- **The background catch-up runs once.** The in-flight gate was armed after the first `await`, so `focus` and `visibilitychange` — which fire together when the user tabs back — both started a repair (double network traffic, two DSM jobs).
- **The internal gap fill no longer skips single-bar holes**, and the closed tail / filled holes it fetches are persisted instead of being thrown away on the next load.
- **The interval parser is case-insensitive for the fixed units** (`1H` is an hour, not a day) and warns on an unknown interval instead of silently assuming a 24× wrong step. Monthly intervals count calendar months, so their density floor is reachable.
- **A DEX pool symbol keeps its case in the dataset key.** Uppercasing a base58 / `0x…` address made two distinct pools share one cache key — the store served the wrong series and merged one pool's bars into the other's. The provider lock (`market` / `authMode`) is part of the key for a non-spot or keyed series.
- **A persistence-mode switch migrates every dataset.** Only the memory mirror was copied, so a dataset that lived solely in the old sink (evicted from the mirror, or written before it was warmed) was invisible in the new mode.
- **The chart window slide copies the window once, not twice.** The head drop and the tail append were two full copies of the series; the tail is now pushed into the sliced array. The 500k-tick firehose bench (50k window) halved from 15.7s to 8.0s.
- **The backfill is an order of magnitude cheaper per page.** A page write rebuilt a Map, re-sorted the whole series and re-sanitized every bar; the stored series is already repaired, so the page is now merged in one linear pass. The completeness pre-check and the validation round no longer re-repair a dataset that is already sorted and unique.- **The chart window slide no longer rebuilds the overlay axis per bar.** The bar-time cache recognizes a slid window (the head moved, the length did not) and shifts the axis instead of reading every bar through the store proxy.
- **An engine series that covers a different window is aligned by time.** A same-length series from a session that slid independently of the chart was index-zipped onto the chart axis, which mis-plotted every value; the engine's own axis now decides when the windows disagree.
- **Deleting a dataset in the Dataset manager removes the full set, metadata included.** The delete only cleared the local bars cache, so the dataset-store memory mirror kept the series and its metadata row survived — the dataset came back in the list on the next refresh. The delete now sweeps the mirror *and* every sink (session / local / git / worker), including the `|market|authMode` cache-key variants, and waits for in-flight persistence-mode copies so a background copy can no longer resurrect a dataset that was just deleted.

## [2.24.8] — 2026-10-19

### Fixed

- **The desktop release pipeline works again.** The changelog extraction read the file with the Windows default codepage (cp1252) and died on the typographic quotes in the release notes, and the matrix jobs raced on creating the GitHub Release (`HTTP 422 — Release.tag_name already exists`) — the tag shipped without its installers.
- **The feed chip says what the data path is, not a stale state word.** A live engine feed read `degraded` whenever only the engine’s own copy confirmed the close, so the chip disagreed with the engine plane (`ws` / `open`) while the data was flowing. It now reads `live` and flags the weak tier as `live·unverified`; a feed that never came up keeps its state word plus the time it has been stuck (`connecting · 45s`). The opened panel lists the facts behind it — state, freshness, verification tier, progress, the engine hop and the series identity.
- **The session delta merge keeps the engine’s bar-time axis.** A merged engine-owned payload described only the tail, so the apply path fell back to an index join — which displaces the plot whenever the engine’s stored series has gaps (a missed minute). The axis is spliced with the tail like the plot columns.

## [2.24.7] — 2026-10-19

### Added

- **GitHub Release notes use the CHANGELOG version section** (`scripts/generate-changelog.py --extract`) instead of the generic “Desktop build of AXIS (Tauri 2)” stub.
- **MCP connect / session chip sits on the command bar trailing edge** (very top row, above Studio). Overlay indicator plots stack above price candles (`setSeriesOrder`); Layers lists Scripts above Panes.
- **Topbar Market after Venue.** Binance (and OKX / Bybit / MEXC) can switch Spot, USDT-M, and COIN-M. BTCUSDT on Binance was always spot (`api.binance.com` / `stream.binance.com`); USDT-M uses `fapi` / `fstream`, COIN-M uses `dapi` / `dstream`. Engine series keys send PYNE/CCXT names (`swap` / `future`).

### Fixed

- **CI is green again.** The coverage gate ran the test files in parallel, so files sharing module state raced (`clampPointsToPaintedRange`) and every run since 2026-10-15 failed on a flaky assertion. The gate now runs serialized (`--max-concurrency=1`), and the engine-owned live plane (wire, series subscription, snapshot paint, close verification) got real unit coverage — the coverage floor (89%) was below it and is met again.
- **Pyodide compile mode no longer crashes on `alert()` / `alertcondition()`.** The wheel hands the compiled `__alerts` back as an *empty float array*, and the runtime’s `or []` on it raised `ValueError: The truth value of an empty array is ambiguous` — the whole compile run failed in the browser (Pyodide has no Numba, so this path is the norm there). The runtime now normalizes the packed event containers without truthiness checks.
- **A broken engine WebSocket no longer re-opens on every run.** An abnormal close (1002 protocol error, 1006, 1011) after the socket opened now marks the shared `/ws/run` client dead for the cool-down, so the next runs go straight to REST instead of re-connecting to an endpoint that accepts the handshake and then drops every frame. Normal closes (1000 / 1001) keep the client reusable.
- **Interval switch no longer paints a stale cache tail plus the live candle.** Switching 5m → 1m used to show yesterday’s last cached bar, a hole, then the current price because live started before venue pages closed cache→now. The load path now fills that tail before `startLive`.
- **Internal holes in the painted window are filled from the venue.** A 1m cache that already reached “now” still left a ~2h blank (133 bars); load now fetches those ranges before live starts.
- **`/ws/live` subscribes a 500-bar tail instead of the full 5k window.** A 5000-bar 1m `full` timed out; the chart stays on the REST/DSM window and the socket can go live.
- **Transient `/ws/live` errors no longer `disconnect()` the client.** Snapshot timeout, empty snapshot, and subscribe/connect errors still fall back to venue+REST and debounce subscribe, but `stopped` stays false so the socket can stay up or reconnect. Only `reset()` / `stopLive` stop the client.
- **`/ws/live` snapshot wait is 120s, and a script miss no longer cools the series wire.** History ensure of a painted 5m window often exceeds 30s; a Keltner (script) snapshot-timeout used to `fail()` the whole socket so the HUD stayed `degraded · venue+REST`.
- **Plot fills tail-align when the engine series is shorter than the chart.** Adding Keltner (or any `fill()`) on a 5000-bar cache plus DSM/forming bars no longer leaves the band 2–3 candles left of the last bars.
- **Worker and engine API keys survive a new tab, PWA update, and browser restart.** The secret vault was memory + `sessionStorage` only, and persist stripped `apiKey` from the app-state JSON — so the first hard reload after that migration (or the 2.24.6 update) looked like the app deleted the keys. They now also live in a dedicated `localStorage` bag (`axis.secret-vault.v1`), still out of workspace snapshots and the main persist payload. Exchange CEX keys stay session-only.
- **`/ws/live` no longer dies on `Redesign2 auth timeout`.** Browser sockets cannot send `Authorization`, so the client now puts `api_key` on the upgrade URL (the engine already accepts that handshake) and does not block `connect()` on `auth.ok`. The auth frame is still sent. A close rejects any leftover auth waiter.

## [2.24.6] — 2026-10-18

### Added

- **MCP can now read and drive the live plane itself** — the diagnostic and recovery surface that until now needed DevTools or SSH into the engine host, as eight new `app_invoke` capabilities (catalog `src/mcp/catalog.ts`, implementations in the new `src/mcp/live.ts`, dispatched from `src/mcp/dispatch.ts`):
  - **`chart.lag`** — the lag ledger for *"why is the chart a bar behind?"*: chart tail vs the wall-clock bar slot vs the venue's last tick (a fresh tick wins, so session venues holding their last close are not accused), plus the engine's own series bounds. Returns a verdict code (`live` / `one-bar-behind` / `behind` / `empty`) with every raw number it used. The engine read is one in-tab `GET /data/series` (6s budget, fail-soft; `engine: false` for the local-only view) — the API key never leaves the tab and is reported as `hasApiKey` only.
  - **`chart.bars`** — bounded OHLCV windows (`tail` default 50, optional `head`, cap 500) plus a missing-slot map (`gaps.total` + up to 50 `{after, to, missing}` runs) and a forming-bar flag, so "is the forming bar on the chart / where are the holes" is one call instead of a screenshot.
  - **`engine.get`** — sanitized engine plane: active id, endpoint, `hasApiKey`, mode, config *field names* (never values), cached capabilities, router decision, cached `/health`, the chart data session the drive ticks (`getChartSessionInfo()`), live prefs, telemetry.
  - **`engine.series`** — the engine's *own* store for a series (chart default, or `{exchange, market, symbol, interval}`): `count`/`oldest`/`newest`/`updatedAt`, `lagBars`, `behindChartBars`, `stale` (same verdict as the paint guard) and `updatedAgeSec` — the ground truth behind "the engine feed is frozen" (a stale `updated_at` means nothing is writing it at all). Never puts the key on the URL; `NO_ENDPOINT` / `ENGINE_UNREACHABLE` instead of a silent `{error}`.
  - **`engine.tick`** — force one drive tick past the 10s throttle (`minGapMs: 0`, riding the drive's `tick` seam so the throttle bookkeeping still runs) and report the raw engine envelope (`appended`/`forming`/`unchanged`/`stale`) plus before/after series bounds and `advancedBars` — an agent pokes once and sees whether *its* tick moved the series.
  - **`engine.repair`** — force the stale-series broker (`force: true`, 60s cooldown skipped) and report `via` (`local` upload vs engine-side `fetch`) with the same before/after bounds.
  - **`stream.get`** — the live plane in one read: route decision, wire state (open/cooldown/failures/socket counters/subscriptions by id + last applied seq — never frame payloads), every feed chip, per-script statuses, stream/engine telemetry, last tick. A `null` wire is itself the answer to "why is there no subscription?" (it builds lazily).
  - **`stream.reset`** — drop the engine socket and every subscription, then probe one re-subscribe (default; `{resubscribe: false}` to skip, gated on live + the stream route). The wire singleton is *discarded*, not just closed — `Redesign2WsClient` is terminal after `disconnect()`, so the next tick rebuilds from the *current* engine config. This recovers in one step the states "no live ticks forever" reduces to: a changed API key/endpoint, a socket superseded by a second tab, a wedged reconnect loop, or a failure cooldown.
  - Supporting introspection (library-level, reused by the capabilities): `StreamLiveWire.snapshotState()`/`reset()` (`src/engine/live-wire.ts`), `Redesign2WsClient.stats()` counters (`src/engine/ws-client.ts`, opt-in on `WireClient`), `streamWireState()`/`resetStreamWire()` (`src/streams/stream-live.ts`), `getChartSessionInfo()` (`src/engines/chart-data-session.ts`).
  - Mutating capabilities (`engine.tick`, `engine.repair`, `stream.reset`) are `mutates: true`, so the in-page read-only host still denies them (`MUTATION_DENIED`); every engine call reuses the active engine's endpoint + key in-tab. Covered by `tests/mcp-live.test.ts` (24 cases incl. the no-key-on-URL assertions and mocked engine chains) and four new wire cases in `tests/engine/live-wire.test.ts`; documented in `docs/enduser/guides/mcp.mdx` and the capability table in `docs/worker/mcp.mdx`.

### Changed

- **The in-browser Pyodide engine now vendors the PYNE 0.6.12 wheel.** Rebuilt with `scripts/sync-pyne-wheel.sh` from the sister pyne repo (1.40 MB, verified byte-identical in `public/vendor/` and `vendor/`), so the browser engine runs the same release as the Pro API. The wheel-side payload since 0.6.9:
  - **`chart.point.copy(pt)` keeps its argument.** `_call_prefers_array_method` returned True for any attribute receiver, so `chart.point.copy` was lowered to the collection-method path and emitted `array_copy_value(None)` before the `chart.point` branch could run — the point became `None`, `pt.price` read through `udt_get_field(None, …)` as NaN, and the strategy/plot silently plotted nothing. The `chart.point` namespace is now excluded from that path (`_is_chart_point_namespace`).
  - **A numeric multi-return UDF is no longer forced into object mode.** `f(float a, float b) => [a + 1.0, b + 2.0]` is marked `func_returns_sequence` so a single-target `a = f()` keeps the tuple handle, but the same marker demoted the multi-unpack `[u, w] = f()` to object mode. Such functions are now recognised as numeric-tuple UDFs and the unpack indexes `__tup[i]` directly — the `isinstance(__tup, (tuple, list))` guard cannot be narrowed by Numba and alone failed the njit warm-up.
  - **Interpret and compile agree on every titled `fill()`.** Interpret wrote the per-bar band colour into the `series` column while compile packs series into float64 arrays and therefore cannot emit a colour string, so the same script rendered differently per mode. The interpret fill column is now null too; the band is still described completely by `plot_meta` (`kind="fill"`, `plot1`/`plot2`, `color`).
  - `pynescript.debug` / `pynescript.stats` (the 0.6.10 `PYNE_DEBUG` logging and the `GET /stats` counters) and the 0.6.11 `util/datafeed.py` CCXT Pro fan-in ship in the wheel but are inert in the browser, which receives bars as inputs rather than through the engine datafeed.

  The hard-coded wheel URLs in `src/engines/catalog.ts` (prefetch warm list) and `src/workers/pyodide-runtime.ts` (`micropip.install`), the worker-test expectation, and the wheel references in `docs/architecture/evaluation.mdx`, `docs/plugins/engines.mdx`, and `docs/llm.txt` moved with the filename. `scripts/sync-pyne-wheel.sh` now warns against those three call sites instead of the long-deleted `src/engines/index.js`.

### Fixed

- **Live feed no longer sticks on `degraded · venue+REST` after a keyless first tick.** The `/ws/live` wire is rebuilt when the engine API key/endpoint appear, `connect()` waits for `auth.ok` before subscribe, a `datafeed-loading` status extends the snapshot wait, and subscribe `history_bars` matches the painted window so PYNE can emit `full` immediately.
- **REST data-session create no longer binds a compact symbol.** `createDataSession` was overwriting the canonical pair-form key (`BNB/USDT`) with the AXIS load-form ticker (`BNBUSDT`), so PYNE persisted `binance|spot|BNBUSDT|1m` while MCP/stream read `binance|spot|BNB/USDT|1m`. Create and tick now both send `canonicalSeriesKey` / `pairFormSymbol`. Compact `BNBUSDT` still binds and looks up `BNB/USDT`.
- **Live-wire cooldown now pauses `/ws/live` reconnects.** P0 stopped `fail()` from self-extending cooldown, but `Redesign2WsClient.scheduleReconnect` kept retrying after the first open. `fail()` now disconnects for the cooldown window; `connect()` after `coolUntil` can open the same client again (or stream-live can rebuild a fresh wire). A reconnect timer already elapsed when `disconnect()` ran re-checks `stopped` before `connect()`, so it cannot un-stop and reopen `/ws/live` during cooldown or after MCP reset.
- **Live stream P3 — stop driving the engine from venue ticks.** `streamSeriesTick` no longer REST-ticks the engine series; the feed push owns advance. Engine `setData` runs on snapshot/repair only — tick deltas path-set the forming tip. `SESSION_KEY_MISMATCH` drops the chart session so pair-form ticks recreate it.
- **Live stream P1 (client) — series and study push.** Series `full`/`delta` frames now paint through `onSeriesFull`/`onSeriesDelta` (no applier required) and advance `appliedSeq`. Script deltas call the apply bridge immediately instead of waiting for `scheduleRerun`. A reconnect resumes every live sub; a close mismatch sends `repair`.
- **Live stream P0 — stop the bleeding (client only).** Venue ticks no longer wait on the engine, the wire no longer re-subscribes or self-extends cooldown, series keys agree with PYNE, and REST fallback no longer looks like a dead EMA:
  - **Paint venue first.** `flushPendingBar` appends the venue bars (including same-slot forming updates) before kicking `streamSeriesTick`. Engine work is fire-and-forget; a later snapshot re-applies the forming tip instead of gating LWC.
  - **`ensureSeries` subscribe-once.** A live series returns the cached snapshot; concurrent ticks join the in-flight wait; `inboxWaiters` fan out instead of stealing. First snapshot still paints; later ticks leave the venue tip alone.
  - **Cooldown does not self-extend.** `fail()` while already cooled down throws `cooldown` without `failures++` or resetting `coolUntil`. The previous latch was thousands of failures/s with the socket still open.
  - **`awaitFull` accepts only `full` or terminal `error`.** Leftover `delta`/`close` frames stay in the inbox instead of failing as `no-snapshot`.
  - **Pair-form series keys.** `canonicalSeriesKey`, stream `chartSeriesKeyObject`/`seriesMeta`, and MCP `engine.series` now map `BNBUSDT` → `BNB/USDT`, matching the PYNE store (`binance|spot|BNB/USDT|1m`).
  - **HUD.** Stream REST fallback is `degraded · venue+REST` on the feed chip and the script badge, not a sticky `cooldown` on a live EMA.
- **Engine-owned live no longer drops the venue's forming tip on every engine tick** (*"the chart is cut off by a bar"*). The engine's store holds **closed bars only**, while engine-owned live mode paints the venue's forming tip locally between engine ticks — so the chart routinely carries one trailing bar the next engine read does not have. `diffEngineOwnedBars()` treated any shorter engine window as a reshape (`full`), so every ~10s engine round trip repainted the chart *without* the tip: the candle oscillated (tip → repaint → gone → venue re-append) and indicators re-ran on the truncated window. The diff now recognises a **prefix-aligned shortfall** — the engine window is exactly the chart minus its local trailing tail — as `noop`: the prefix came from this engine and the trailing local bars are newer than anything it holds, so the chart keeps them. Misaligned shorter windows (history rewrite, window slide, depth change) still repaint in full. Regression-covered in `tests/multiplex-engine-owned-paint.test.ts` (diff-level alignments + a live cycle where the engine window retracts to closed bars while the venue tip survives).
- **A frozen engine series can no longer back-date the chart.** `DATA_MISS` is a *count* check (`have < need`), so a series that is deep enough but frozen — Pro's upstream feed stopped advancing, or a stale local window was uploaded before the Data Manager repaired it — never misses; AXIS paints the chart from that series in engine-owned live mode, so the chart sat on a days-old tail while the venue WebSocket and feeds looked connected (`newest` four days back on $DOGEUSDT 1m). Staleness is now an explicit contract:
  - New pure predicates `src/engines/series-freshness.ts` — stale means the newest bar lags the comparison bound (chart tail, venue trigger clock, or now) by more than 2 whole interval steps; unknown bounds are never treated as behind by the *skip* predicates.
  - `repairStaleEngineSeries()` in `src/engines/data-sessions.ts` — local-first repair (upload the local window when it reaches now; upsert-by-time keeps Pro's deeper history), else `fetch` from Pro's exchange feed; cooldown-guarded (60s per endpoint+series), never throws. Exposed as `POST /data/series` `newest` truth: `tick`'s `unchanged: true` is not proof of freshness.
  - Both engine-owned paint paths refuse to back-date the chart — `src/streams/multiplex.ts` (`paintEngineOwned`, including the `unchanged` early return against a moved venue clock) and `src/streams/stream-live.ts` (snapshots, deltas, per-tick `ensureSeries`). A stream delta that does not continue the chart tail is dropped instead of punching a hole. They report once via `src/engines/series-repair.ts` (`noteStaleEngineSeries`: throttled log + `engine` telemetry `degraded` + feed `degraded`) and repair in the background; the next snapshot/tick paints the healed window.
  - Provisioning tops up: `sharedProvisionSeries` asks Pro to `fetch` after an upload whose tail is already stale, so a stale local window can never become the engine's frozen tail.
  - Background catch-up (`src/data/background-catchup.ts`) skips the local repaint in engine-owned mode (it would fight the store the overlay time axis is built from) and pushes AXIS' freshest window onto Pro's series instead. Documented in `docs/devops/engine-owned-data-plane.mdx` § Series staleness; covered by `tests/series-freshness.test.ts`, the `repairStaleEngineSeries`/`seriesIsStale` cases in `tests/data-sessions.test.ts`, and the two frozen-series paint cases in `tests/multiplex-engine-owned-paint.test.ts`.
- **A repair-driven window jump no longer trips LWC's `Value is null`, and a stale engine window no longer pins the candles.** Two follow-ups to the staleness contract above, both observed on the deployed build:
  - **Skip vs report.** A *behind-the-venue-clock* verdict no longer refuses the paint in either engine-owned path (`src/streams/stream-live.ts`, `src/streams/multiplex.ts`): it reports + repairs, and the snapshot is painted whenever it does not back-date the chart. Only a genuine back-date (`engineWindowBehindChart`) keeps the fresher chart window — refusing a snapshot that would advance the chart pinned the candles while every other series kept moving. The `unchanged` early return in `paintEngineOwned` now reports as a no-op instead of a skip (there is nothing newer to paint either way). Covered by the new lagging-engine-window case in `tests/multiplex-engine-owned-paint.test.ts` (it fails if the guard is narrowed back to "any stale verdict skips").
  - **Moved-window prune.** `PaneManager.notePaintedCandleRange` now prunes co-painted script series (`overlay_*`, `bgcolor_*`, equity) to the new candle range **immediately**, in the same task as the candle `setData` and before LWC's next render. A long forward jump (a four-day-frozen series repaired 279 bars at load) left those series holding rows the candles no longer had; LWC's shared time scale is the union of every series' rows, so the candlestick painter threw `Value is null` on every render for ~2 minutes until an overlay apply happened to re-clamp them. Compare / on-chain overlay series are untouched (their windows are legitimately independent). Covered by `tests/pane-manager.test.ts` (`pruneCoPaintedSeriesToPaintedRange`).
- **A superseded engine socket can no longer tear down the live connection.** Observed on the deployed build: a symbol switch logged `Uncaught error: WebSocket not open` and left the engine stream plane in per-tick failure cooldown (venue fallback painting instead). Browsers dispatch `open`/`close`/`error` as separate tasks, so an abandoned connect attempt could open or close *after* a later attempt had already taken over `this.ws`; `ws.onclose` / `ws.onerror` nulled the socket unconditionally, which killed the replacement connection — the auth frame sent from the live socket's `onopen` then threw out of the socket handler, while the client believed it was down and kept reconnecting. Both engine WS transports now check ownership (`owns()`): a stale socket's late events and frames are ignored, a socket that opens after abandonment is closed instead of adopted, `send` from the heartbeat can no longer throw out of a timer (the same uncaught-error class), and `EngineWsClient` no longer rejects the live connection's in-flight runs or marks the whole client dead on a stale close. Covered by four tests in `tests/engine/ws-client.test.ts` and `tests/engine-ws.test.ts` (all fail without the guard); documented in `docs/devops/engine-owned-data-plane.mdx` § Stream plane (socket ownership).
- **The stream plane now drives the engine's series, so the chart stops sitting at its frozen tail.** `live_stream` subscriptions carry no client tick frame (`subscribe` / `resume` / `repair` / `ping` only), so the plane could only *replicate* the engine's series while the calculator plane advanced its own with a REST chart-session tick per venue flush. On the observed Pro deployment the engine's per-tick advance stalled (`GET /data/series` `newest` frozen three bars behind the venue), which left the chart moving only when the staleness verdict + repair landed — a sawtooth of 0 → 3 bars behind, one bar painted every ~3 minutes on a 1m series, i.e. a chart that never looks live even though the venue stream is healthy. New `src/engines/series-drive.ts` ticks the same chart session the calculator plane uses (`tickChartDataSession`), throttled to `SERIES_DRIVE_MIN_MS` (10s) with a new venue bar always driving immediately; `streams/stream-live.ts` calls it per venue flush without awaiting it (the paint stays bound to the flush, and the back-date guard still refuses a late snapshot). A `stale` tick envelope falls through to `noteStaleEngineSeries` so the existing report + repair broker remains the backstop for engines without `data_session`. Covered by `tests/series-drive.test.ts` (throttle, bar-advance bypass, `stale`/failure outcomes, per-series scoping); documented in `docs/devops/engine-owned-data-plane.mdx` § Series staleness + § Stream plane (series drive).

### Docs

- **Docs landing refreshed to the current release** (`docs/index.mdx`): the stale v2.21.0 line moved to **v2.24.5**, and a new **What's new** section surfaces this changelog's headline surface — the eight MCP live-plane capabilities, the engine-owned live fix batch (forming tip, staleness repair, socket ownership, stream-plane series drive), and the PYNE 0.6.12 wheel — linked to the MCP guide, the engine-owned data plane doc, and the online changelog. `docs/llm.txt` regenerated from the PYNE exports pipeline (the pack had been missing the six docs commits since the last regen).
- **Landing What's-new plate synced** (`hoox-landing-page` → `app/axis/axis-data.ts`): `AXIS_WHATS_NEW` now leads with the MCP live-plane capabilities, the live-correctness batch, and the 0.6.12 wheel — all tagged `2.24.5` (the build production serves).

## [2.24.5] — 2026-10-17

### Added

- **Engine-owned data plane (stream profile, `WS /ws/live`).** Each engine that
  can hold a feed owns its datafeed with the exchange as source of truth: the
  client subscribes with script + meta, receives status
  (`datafeed-loading → calculating → live`), one full snapshot, then deltas
  with per-subscription `seq` and the `closed_upto` watermark, and re-verifies
  closed bars against the venue. New `src/engine/` client (frames, WS client,
  delta applier, bar-close verifier, router, apply bridge, live-wire),
  `src/streams/stream-live.ts` glue, HUD feed chip + indicator stream badges,
  and the `features.live_stream` capability gate (strict opt-in, fail-open to
  the calculator profile). Legacy `serverEngine` path frozen for engines
  without `live_stream` (pyodide, pyne-worker, offline, HPO).
- **`runAndApplyInner` decomposed into apply stages (F-25).** The ~1180-line
  function is now a ~250-line orchestrator over `src/indicators/apply-context`
  (run context + series alignment), `apply-pane` (pane setup), `apply-overlays`
  (line/OHLC payload building), `apply-mutations` (chart mutations),
  `apply-strategy` (trade markers + report), `apply-drawings` (Pine drawings),
  and `apply-store` (indicator store update). No behavior change — full suite
  green.
- **Maintenance mode (`VITE_MAINTENANCE_MODE`) — a full maintenance page instead of the app.** Setting the flag in `.env` (or the build environment) makes `index.tsx` mount only the new `ui/MaintenancePage`: dark void background, a dimmed overlay, the landing `texture-cross` hairline grid (0.8px accent lines on a 10px pitch at 25% opacity), and a `ui/SideRays` light fan painted above the content (`mix-blend-screen`) so the beam grazes the mark and copy — the spotlight is the only light. The HOOX mark is anchored dead-center of the viewport and flickers once on load plus again on hover (the landing `logo-flicker` stagger, via a new opt-in `HooxLogo` `introFlicker` prop reusing the existing one-shot hover stagger — no continuous loader animation; phosphor glow ring included), and no dust motes are drawn; a "Planned maintenance — will be back soon" status line, an upcoming-major-release (AXIS v3) teaser label, and the hoox.sh/axis slogans typed character-by-character by the new `ui/SloganTypewriter` (see below) sit below that center anchor, and the site link is pinned to the bottom edge. The chart workspace and editor popout never import, so no engine or panel can half-work while a deployment is down; the check lives in the new `src/maintenance.ts` (unit-tested in `tests/maintenance-mode.test.ts`) and the page stays a lazy chunk. Reduced motion is honored by the existing app-wide `prefers-reduced-motion` block (SideRays renders a static frame). Vite inlines the value at build time, so flipping the flag always needs a rebuild; e2e forces it off via `playwright.config.ts` (`webServer.env` — process env outranks `.env` files), documented in `.env.example` and `docs/devops/build-and-serve.mdx`.
- **`ui/SideRays` — SolidJS port of the React Bits `SideRays` light-fan background.** The WebGL2 shader + RAF loop are unchanged; the React wrapper was adapted to Solid (`useRef`/`useState` → bindings + `createSignal`, `useEffect` → `createEffect`/`on`/`onCleanup`, `className` → `class`) and the upstream `.side-rays*` CSS is inlined as Tailwind equivalents. Renders a configurable fan of light rays (two color layers, origin/anchor, density, dust, mouse-leaning); honors `prefers-reduced-motion`, pauses off-screen and on hidden tabs, and degrades to an empty container when WebGL2 is unavailable. Used by the maintenance page (indigo fan, `origin="top-right"`).
- **`ui/SloganTypewriter` — SolidJS port of the hoox landing `TypewriterTagline`.** Cycles phrases with the landing rhythm (type 65ms/char → hold 2s → delete 35ms/char), sizes the box from an invisible longest-phrase probe so the typing origin never slides in a centred layout, keeps the whole line `aria-hidden` (the maintenance page root is an `aria-live` region — per-character mutations would otherwise be announced by screen readers), and renders the first phrase statically under `prefers-reduced-motion` (`motion-safe` cursor). Used by the maintenance page for the AXIS slogans: the hoox.sh/axis hero headline ("Own the axes. Swap the engine.") plus the three footer phrases.

### Fixed

- **Session ticks resolve delta envelopes against the cached full result.** Tick/append calls now send `delta: true` (new `engines/session-delta` merge: positional splice with count/key validation, minimal-unchanged reuse, null on any mismatch so the session recreates instead of applying partial data). Old backends that reject the flag are retried plain once per endpoint and remembered. Applies to engine-owned data sessions and bars-in live sessions; the chart session stays flag-free (its envelope is already tiny).
- **Engine-owned bars are normalized before chart paint.** `getDataSeriesBars` now runs the venue pipeline (`normalizeHistoricalBars`: ms→s, sanitize, dedupe last-wins, sort) so engine paints cannot hit the LWC `Value is null` path on ms times or unsorted data.
- **Candle-range clamp is per-chart instead of global.** The painted range lives on the `PaneManager` instance, extends on live appends, and is a no-op without a recorded paint — slots no longer clamp each other and newest tips are not dropped.
- **The candle-range clamp is no longer a no-op before the first recorded paint.** The per-chart painted range is only recorded *after* a successful candle `setData`, so an engine/indicator overlay that applied first (the engine-owned plane can paint ahead of the debounced history paint) was clamped against `null` — i.e. not at all — and could extend the shared time scale past the candles, which is exactly the `Value is null` boot loop (candles keep failing, so the range is never recorded and the clamp stays off forever). Co-painted payloads now fall back to the extent the candle series already holds (`rangeFromSeriesData`, fed from `PaneManager.clampRange()`); `null` is still the answer for an empty chart, so a chart with no candles behaves exactly as before. A *moved* painted window also invalidates the overlay tip cache, so the next overlay apply repaints in full and is re-clamped instead of appending a stale tip. Covered by the `rangeFromSeriesData` cases in `tests/chart-series-sanitize.test.ts`.
- **The engine-owned live plane authenticates over the socket.** `stream-live` built its `Redesign2WsClient` with `endpoint` only, so the documented `auth` frame was never sent: the engine answered `UNAUTHORIZED` on the first frame and AXIS fell back to REST (with reconnect churn) even on hosts that served the plane correctly. The client now gets `authToken` from `getActiveEngineConfig().apiKey` — resolved vault-first, like every key-gated REST call — matching `{type:"auth",payload:{token}}`. Companion engine-side fix: the Pro API must not run the `GeventWebSocketWorker`, which corrupts flask-sock framing after a successful upgrade (PYNE 0.6.12 defaults to `gthread`).
- **Engine error frames are no longer mistaken for malformed ones.** The engine answers an unauthorised or bad frame with the body flat (`{type:"error", code, message, retryable}` — its shared `_err` helper), while the AXIS contract reads every frame body from `payload`. The strict validator therefore discarded real `UNAUTHORIZED` replies as `skipping malformed frame error`, hiding the reason and making an auth failure indistinguishable from framing garbage. `isErrorFrame` now accepts either envelope and the wire client normalises the flat shape into `payload` on receipt, so `live-wire` reports the engine's actual message when a subscribe fails. Covered by the `error frame` cases in `tests/engine/frames-contract.test.ts`.
- **Session series join the chart by bar time, not index.** `alignSeriesToTimes` covers `data-session-*` and `session-*` hits via `meta.engineTimes` / live-session `barTimes`; index tail-align stays as fallback for time-less payloads.
- **New indicators no longer re-upload the full window.** Series provisioning is memoized per endpoint+series (max coverage wins) with in-flight dedup; reapply and live reruns run bounded-concurrent on a shared epoch honoring plot-dependency levels.
- **Engine-owned live paints are tip-aware and ordered.** `paintEngineOwned` diffs bars (noop/tip/append/full), paints tip-only when possible, and reruns wait for the paint chain to settle; `runBatch` handles free-tier 413 with `windowBars` meta like single runs.
- **Engine-owned live throttle actually throttles.** `lastEngineTickAt` was set inside the async paint step, so every quick venue tick saw the initial value and chained a new `/tick` + `/data/series/bars` round-trip (~3s each) back to back — starving indicator re-runs (they await the paint chain) and leaving the chart lagging 20–30s. The tick time is now recorded synchronously before the step is chained, so ticks within `ENGINE_OWNED_TICK_MIN_MS` (10s) skip the engine and paint the venue tip locally instead.
- **Every-tick indicator re-runs honored on heavy histories.** Delta ticks (O(delta) server-side) plus tip-only chart apply make per-tick updates cheap regardless of bar count, so `effectiveLiveRerunMode` no longer downgrades `every-tick` to `bar-close` at `HEAVY_LIVE_RERUN_BARS` (10,000 bars). The local venue-tip paint path (within the engine throttle gap) also schedules an indicator re-run when `every-tick` is on, so indicators update per venue tick instead of only after engine ticks.

---

## [2.24.4] — 2026-10-15

### Fixed

- **Co-painted series can no longer extend the shared time scale past the candles.** When the candle window and an overlay/equity window diverged (a stale engine-owned window vs live venue ticks is the classic case — e.g. an 18-minute-lagged host series against real-time bars), the overhanging points extended the shared time scale past the candle PlotList and LWC's renderer threw `Value is null` on every paint. Overlay lines, plotbar/plotcandle overlays and the equity curve are now clamped to the last successfully painted candle range (tracked in `chart/series-sanitize`, a no-op until the first candle paint and for already-aligned payloads). The candle `setData` failure envelope now reports chartType, series type, fill/merge/non-integer counts, payload length and time range so any recurrence is instantly attributable. Covered by the `clampPointsToPaintedRange` cases in `tests/chart-series-sanitize.test.ts`.

## [2.24.3] — 2026-10-15

### Fixed

- **The Pro API engine key now survives a reload.** `sanitizePluginsConfigForPersist` strips every `apiKey` from the durable `localStorage` payload, but the session vault never captured the `server` / `pyne-worker` engine keys — so after every reload the key field was empty and every key-gated call (`/data/*`, authenticated `/run`, `/auth/usage`) answered 401 until the key was re-entered. The engine keys now live in the vault like the cloud key (`engine.server.apiKey` / `engine.pyne-worker.apiKey` slots, captured from `engine:server` / `engine:pyne-worker` bags on every persist, migrated from pre-vault blobs on boot): `getActiveEngineConfig()`, `readEnginePluginConfig()` and the Runtime form hydrate resolve vault-first, and saving mirrors the key back into the vault. Covered by the `engine key vault` cases in `tests/wsd-vault.test.ts` (capture → strip → resolve round-trip) plus a vault-isolation reset in `tests/engine-pro.test.ts`.
- **A short local dataset no longer falls through to an exchange fetch the host may not support.** When the engine reported `DATA_MISS` after a local `/data/series/provide` upload, the broker unconditionally called `/data/series/fetch` — which fails with `ccxt_missing` on hosts without ccxt. The broker now retries the session create clamped to the uploaded bar count (the apply path tail-aligns the shorter series) and never fetches for data the host cannot download. Covered by the clamp cases in `tests/data-sessions.test.ts`.

## [2.24.2] — 2026-10-15

### Fixed

- **Engine-owned live mode now finds the local Data Manager dataset.** The data-session broker looked up local bars under the canonical venue (`binance|BTCUSDT|1m`), but the Data Manager keys datasets by the **source plugin id** (`binance-rest|BTCUSDT|1m`), so the lookup never matched: the broker skipped the local upload and went straight to `POST /data/series/fetch`, which on a host without ccxt fails (`ccxt_missing`) — every tick paid create → fetch → create and the run stayed in error (observed 190+ failed `/data/series/fetch` calls in one session). `defaultLocalBars` now resolves candidate keys (active Data Manager selection → provider session source → active source → `${venue}-rest` → bare venue, each matched by `exchangeForSource`) and uploads the newest window via `/data/series/provide`, which needs no exchange feed on the host. Regression: `tests/data-sessions.test.ts` stores a dataset under `binance-rest` and asserts the broker provides it instead of fetching.
- **A failing data-plane provisioning no longer retries on every live tick.** The three-round-trip broker chain (create → provide/fetch → create) was re-paid on each tick while the run was already failing. Live ticks (`tick: true`) now back off per session slot for `DATA_SESSION_RETRY_COOLDOWN_MS` (60 s) after a provisioning failure; interactive runs still retry immediately, and a success clears the memo.
- **Free-tier bar caps are handled instead of failing every run.** A PYNE host with `FREE_TIER_LIMITS` refuses windows over `FREE_MAX_BARS` (default 5000) with `413 TOO_MANY_BARS`; with the default Rolling window of 10,000 every bars-in run (reapply, bar-close live ticks) failed. The REST client now reads `max_bars` from the 413 body and retries once with the newest `max_bars` bars, tagging the result `meta.windowBars`; the apply path tail-aligns such series to the chart window (older bars become `na` whitespace) instead of shifting every value early, and an interactive run logs `Engine bar cap: evaluated newest N bars (free tier)`.

## [2.24.1] — 2026-10-15

### Fixed

- **Engine capabilities no longer silently reset the saved live re-run mode.** The Indicators panel clamped `store.live.rerunOn` to `bar-close` whenever the selected engine's resolved capabilities did not include `every-tick` — which includes a `/health` that simply does not advertise `features.live_modes` (the hosted PYNE Pro does not) and any probe that failed. The stored preference was overwritten in memory and later persisted by the next unrelated save, so "Every tick" reverted on its own and read as "settings do not save". Capability resolution now never rewrites the preference: the live loop and the panel chip derive the effective cadence through `liveRerunModeForEngine()` — bar close only when the engine positively advertised its modes without every-tick, unknown capabilities keep the stored choice — and the chip marks the engine-limited case (`Bar close · engine`). The Settings modal keeps showing and saving the user's own choice. Covered by the `liveRerunModeForEngine` cases in `tests/engine-ownership.test.ts`.
- **Indicators and strategies advance on new bars in engine-owned live mode again.** In every-tick PYNE Pro mode the venue stream is only a trigger: each flush ticks the chart's engine data session and paints `GET /data/series/bars`, but the painted bars were never written back to `store.bars`. The runner builds every overlay point by zipping the engine's series against the time axis from `store.bars` (`getOhlcvTimesForApply` → `lineSeriesToOverlayData`), so that axis stayed frozen at the load window while the engine's session kept appending: indicator/strategy lines never gained the new bars and their tip stopped changing once the old window's last bar closed — "stays as on the first print". The engine-owned paint now advances `store.bars` with the engine's newest window (`setBarsQuiet`, memory-only — no dataset write, no persist, no viewport re-fit), and the runner tail-aligns engine-owned series (`meta.sessionVia` = `data-session-*`) to the chart window, because the session's own series slides independently of the local Rolling window (trimmed when longer, `na`-padded when shorter) instead of mapping index-for-index and shifting every value by the difference. Covered by `tests/multiplex-engine-owned-paint.test.ts` (store advances from the engine series even when the venue tick carries no new closed bar) and `tests/runner-engine-owned-apply.test.ts` (series tail lands on the newest bars, 1:1 mapping untouched for bars-in runs).
- **Cross-test store leakage that made CI order-dependent.** `setStore('pluginsConfig', {})` **merges** in a Solid store rather than replacing, so test files that set `engine:server.preferWs: false` left that key behind for every later file — `classifyTransport('engine', 'server')` then reported `rest` where the telemetry test expects `ws`, depending on run order. The leaking files (`tests/runner-engine-owned.test.ts`, the batch runner-seam test) now restore with `reconcile({})`, and `tests/telemetry.test.ts` asserts the default explicitly instead of inheriting it. The batch seam test also dropped an assertion on `store.lastRun`, which `setLastRun` only publishes when `resultsFocusId` is null — order-dependent for the same reason.

## [2.24.0] — 2026-10-14

### Added

- **The rest of the `/health` payload is now consumed, and the parity surfaces have e2e coverage.** `compile.default_mode` / `features.default_run_mode` seed the Runtime form's execution mode when the user has not saved one (a host configured for interpret no longer opens on `auto`); the prewarm action is disabled up front when a probed backend answered without advertising `POST /compile/prewarm`, instead of firing a guaranteed 404; the Workers `pyne-pro` detail shows the compile detail (`disk cache (N IR)`) and flags `features.free_tier_limits` when unauthenticated runs are guarded. `e2e/pyne-parity.spec.ts` asserts both studio surfaces against a stubbed Pro `/health`. Fixing that test surfaced a real bug: `baseResult` in `src/workers/probe.ts` rebuilt the probe result field-by-field and silently dropped the new `readiness` / `compile` fields, so the Compile row would never have rendered.
- **Runner jobs can be deployed from the chart, and PYNE keys validated from the CLI.** The Workers **Hosted runner** section gains **Deploy active script**, which registers the newest applied chart script as a hosted job via `POST /scripts` (upsert by indicator id, carrying symbol/timeframe), alongside the existing list / enable / run-now controls. `axis keys validate --pyne` checks a key against `POST /auth/validate` (tier, active, rate-limited) without consuming a call, mirroring `axis keys create --pyne` and `axis usage`. The parity ledger (`docs/devops/pyne-endpoints.mdx`) now records `POST /auth/validate` and `POST /scripts` as used, with `GET /scripts` and `DELETE /scripts/{id}` left out deliberately — job state already flows through `GET /cron/jobs`, and destructive deletion stays out of the charting UI.
- **The optional PYNE hosted runner is manageable from AXIS, and PYNE keys/usage from the CLI.** `src/engines/runner.ts` wraps `GET /cron/jobs`, `PUT /cron/jobs` and `POST /cron/run` behind `runnerAvailable()`, which reads `features.script_runner` from the cached `/health` — so the UI hides the surface entirely on a host without `PYNE_RUNNER=1` instead of probing a 404. A disabled runner (`RUNNER_DISABLED`) comes back as `unavailable` and denied access as its own message. The Workers page's **pyne-pro** detail gains a **Hosted runner** section (load jobs, per-job enable toggle, **Run now**); the host's `ADMIN_TOKEN` is deliberately never stored in the browser, so a 403 is surfaced as guidance. On the CLI side, `axis keys create --pyne` mints through `POST /auth/create_key` (admin token from `--admin-token`/`AXIS_ADMIN_TOKEN`, 403 mapped to a host-side `ADMIN_TOKEN` hint) and the new `axis usage` prints `GET /auth/usage` for a key.
- **Pro surfaces are wired: usage, chart thumbnail, indicator preview, quick backtest.** `src/engines/pro.ts` wraps `GET /auth/usage`, `POST /preview/chart`, `POST /preview/indicator` and `POST /backtest/quick` behind the same endpoint/key/consent resolution the runner uses, sends only the close series the endpoints accept (capped at 500 bars), and returns `unavailable` — never a thrown error — when the host does not offer a Pro route (403/404/501) or the key is not recognised (401). The Runtime page gains an **EngineProPanel**: an **API usage** section (tier, calls used/limit/remaining, key id — only when a key is configured), a **Quick backtest** section that maps equity curve, trades and summary and shows the backend's equity PNG, and a **Chart thumbnail** section that renders the newest applied script over the current bars with a Save-PNG link.
- **Chart reapply can evaluate several indicators in one round-trip (`POST /run/batch`).** `src/engines/batch.ts` maps the backend's per-script envelope into the same `RunResult` shape a single REST run produces (including `plot_meta`, alerts and `meta.batch`), enforces the backend's 8-script cap, isolates per-script failures, and returns `null` when the route is missing so nothing changes on older backends. `reapplyChartScripts` now sends one batch when at least two visible scripts are eligible — no resolved `input.*` overrides (the batch body has no per-script inputs), one shared resolved mode (`resolveServerRunMode` is applied per script and a mixed bag falls back), the `server` engine, and not engine-owned live mode. Batched results are applied through the existing path via the new `RunOptions.precomputedResult` seam, so panes, overlays, drawings and alerts behave exactly as before; per-script failures and oversized sets fall back to individual runs.
- **Live sessions are reconciled against the engine instead of trusted blindly.** `GET /session/{id}` is now used for what it is good at: `getSessionStatus()` returns the engine's own view (bars, idle seconds, TTL) as a typed `ok` / `gone` / `unknown`, and an idle session (untouched for 20 s, checked at most every 5 s) is reconciled before a tick is paid for. A session the engine has reclaimed — or one whose bar count drifted from the recorded count — is dropped locally so the next tick rebases over the chart window; a transport failure leaves local state alone, because a tick still detects `gone` on its own. `refreshLiveSessionTelemetry()` reuses a status fetched within the throttle window, so the live stream telemetry line can show `session N bars · idle Ss · ttl Ss` without adding a request per paint.
- **Numba prewarm is available from the app and the CLI (`POST /compile/prewarm`).** The backend compiles in `mode: auto` by default, so a cold host makes the *first* interactive run absorb the JIT cost; `src/engines/prewarm.ts` now pays it up front. The Runtime form has a **Warm compiler** button that uses the draft endpoint + key (so it works before Save) and re-reads `/health` afterwards so the readiness badge reflects the warm state; the Workers Manager **pyne-pro** detail has the same action and re-probes. An opt-in **Warm compiler after save** toggle warms the applied visible scripts (libraries and hidden scripts excluded, capped at the backend's 16) through a memoised client that retries only real failures — so a Save cannot spam the endpoint. `axis prewarm` exposes the same call with `--endpoint/--key/--force/--script/--json` (default `http://127.0.0.1:5002` or `AXIS_PYNE_URL`), and `axis doctor` points at it when the PYNE sibling repo is present. The client never throws: no endpoint, Pyodide, a 404/405 older backend, an error envelope, a declined key-consent prompt, and timeouts all return a typed `PrewarmResult` the UI renders.
- **The full PYNE `/health` payload is now parsed and surfaced, not just the live-mode subset.** `src/engines/health.ts` types the backend's discovery surface — `features.*` (`warm_compile`, `optimize`, `alerts`, `alert_webhooks`, `default_run_mode`, `free_tier_limits`, `script_runner`, `script_runner_scheduler`) and `compile.*` (`has_numba`, `builtins_warmed`, `prewarm_enabled`, `host_prewarmed`, disk cache, IR/source entries, default mode) plus the advertised `endpoints` map. Parsing is conservative: booleans require `=== true`, unknown/malformed keys degrade to `null`, and nothing is inferred from the service name. The same `GET /health` probe that feeds `capabilitiesFromHealth()` now also populates a cached `EngineHealth` (`getCachedEngineHealth()`), which clears when the endpoint stops answering or a non-server engine is selected, so a readiness badge can never describe the wrong backend. `compileReadiness()` summarises it as `warm` / `cold` / `unavailable` / `unknown`; the Workers Manager Pro-API detail shows a **Compile** row and the Runtime form shows readiness for the endpoint it just probed (via the side-effect-free `probeEngineHealth()`, which does not touch the selected engine's cache).
- **Live ticks evaluate O(delta) via PYNE live sessions (Pro API 0.6.9+).** The `server` engine keeps a resumable session per script (`POST /session`, `/tick`, `/append` in `src/engines/live-sessions.ts`): forming-bar re-ticks are O(1), new closed bars append O(delta) — measured 1,087 ms → 0.13 ms on 20k bars upstream. Sessions are interpret-only, keyed by endpoint + script + inputs + libraries + symbol + interval, with tick-then-append ordering (append alone would confirm stale forming values and duplicate the bar), no-change-tip envelope reuse, rebase once the session outgrows the chart window by 2,000 bars, and silent fallback to the full WS/REST run on any miss (old backends, edge, proxies, `NO_SESSION`, `SESSIONS_FULL` are remembered per endpoint). Wired through `EngineOpts.liveTick` (`src/plugins/types.ts`) from `runScript` (`src/indicators/runner.ts`); the live multiplex already marks genuine ticks. Session path is tagged `meta.sessionVia` (`session-create|tick|append|cached`).
- **Engine-owned data sessions for PYNE Pro every-tick (AXIS side).** New `src/engines/data-sessions.ts`: identity-only session client (`POST /data/session`, `POST /data/session/{id}/tick` with `{exchange, symbol}`, `POST /data/series/provide|fetch`, `GET /data/series/bars`) and a cache-miss broker. On `DATA_MISS` the broker auto-uploads the matching local Data Manager dataset (last `history_bars`, chunked to 5,000), and only if that is still short asks the engine to fetch from its exchange; it never loops. `serverEngine.run` accepts an `EngineOpts.dataSession` identity and evaluates over the engine's series without sending bars; broker failures surface as run errors instead of silently falling back to shipping bars. Session reuse is per script owner, so live ticks re-tick one session and sibling indicators keep their own. Contract and remaining steps: `docs/devops/engine-owned-data-plane.mdx`. Verified cross-repo against the PYNE Pro API `/data/*` store (`tests/integration/pyne-data-session.e2e.test.ts`, run via `scripts/e2e/pyne-fake-feed.py`; skipped unless `AXIS_PYNE_E2E_URL` is set). The runner, chart paint, and no-persist routing are not wired yet.

### Fixed

- **In-browser Pyodide runs no longer freeze the UI, and Cancel really stops them.** `pyodideEngine` evaluated Pine synchronously on the main thread, so a multi-second run blocked chart, panels and input, and a cancel only took effect before evaluation started. Evaluation now runs in a dedicated module Web Worker (`src/workers/pyodide.worker.ts`, main-thread client `src/workers/pyodide-client.ts`, typed request/response protocol in `pyodide-protocol.ts`). Cancel terminates the worker, rejects the run with `Aborted`, and the next run respawns and reloads the runtime (cold-load cost accepted). Runs queue one-at-a-time on the worker; a worker crash surfaces as a run error and respawns on the next run; a failed load keeps the existing 30 s cooldown. The wheel/runtime load sequence is shared (`installPynescriptRuntime`) so the worker and the in-thread fallback cannot drift. Without a Worker (bun unit tests), the original in-thread path runs unchanged. Public engine API and `RunResult` shape are unchanged; the worker chunk is emitted as an ES module (`worker.format: 'es'` in `vite.config.ts`).
- **`Value is null` chart crash — Lightweight Charts asserts at render time, not at `setData`.** The library's candlestick style getter calls `ensureNotNull(valueAt(barIndex))` inside the render pass, so a stored row with missing OHLC, a null `close`, or two rows sharing an open time throws **asynchronously** — escaping every `try { series.setData() } catch` in the app and surfacing as a raw uncaught window error on each redraw (captured in a browser harness with a stack pointing at `barStyleFnMap.Candlestick`). The old guard only *dropped* bad rows, which also left the series shorter than the time axis the overlay mapper walks. `chart/series-sanitize` now **repairs** the payload instead: duplicate/non-ascending open times collapse to the last write (matching DatasetStore conflict resolution) and re-sort, missing/null OHLC fills from the nearest valid neighbour, and null/NaN `value` becomes `0` (an omitted `value` is left alone — that is how a Pine `na` whitespace gap is encoded). Dropping is the fallback for rows with no donor. The repair runs at the `safeSetData` boundary in `chart/pane-manager`, so every setData path (candles, volume, overlay lines, equity, indicators) is covered in one place, and the history paint logs `dropped/merged/filled` counts so repeat offenders stay visible.
- **Live ticks survive turbulent chart updates on the session path.** Follow-up to the `liveTick` forwarding fix: `runScript` compared the forwarded bars against the *live* `store.bars` reference, but DSM progressive slices (`setBarsQuiet`) and live appends can replace that array between capture and evaluation — exactly what happens on every tick while a backfill lands — so the flag misfired back to full re-runs. `runAndApply` now records chart-vs-private-window once, up front, and `runScript` trusts the flag (isolate studies still always take the full path).
- **Live ticks actually reach the session endpoint now.** `runAndApplyInner` always forwards the bars it evaluated, so the `!opts.bars` guard in `runScript` never fired and every live tick silently fell back to a full WS/REST re-run (production ticks measured 1–2s each with the session client idle). The guard compares by reference against `store.bars`: chart-series ticks go O(delta), private HPO/holdout slices stay on `/run`. Regression test `tests/runner-livetick-session.test.ts` asserts the wire sequence (`POST /session` → `tick` → `append`, never `/run`) and the HPO opt-out.
- **Sibling indicators no longer evict each other's live sessions.** Session ownership was keyed `endpoint|symbol|interval`, so on a chart with several applied indicators each run released the previous script's session and recreated its own — every tick fell back to a full-window eval (O(window), never O(delta)) even with the session client engaged. Ownership now includes the script instance (`liveSessionOwner`, threaded `runAndApply → runScript → engine.run → /session` as `ownerId`): one session per indicator, and a new revision of the same instance still releases its predecessor. Covered by the sibling-independence and same-instance-revision cases in `tests/engines-live-sessions.test.ts`.
- **Live sessions rebase when closed history is rewritten under a stable count.** Continuity was judged by bar count + tip time alone, so a gap fill or venue revision of an earlier closed candle — or older bars prepended — left the resumable session serving stale values. `tryLiveSessionTick` now fingerprints the closed bars (`bars[0..count-2]`, the forming tip excluded because it legitimately changes every tick) and rebases over the current window on mismatch, for both the same-tip and the advanced-tail paths. Covered by the stable-count-rewrite and prepend cases in `tests/engines-live-sessions.test.ts`.
- **Reload no longer strands the chart at one venue page (1000 bars).** `loadSymbolData` passed Settings → Historical bars as a single `fetchHistorical` limit, but venues cap one response (Binance/Bybit/MEXC 1000, Kraken 720, OKX 300), so Reload painted the first page and stopped. The venue path now walks back page-by-page (`endTime` cursor, stall/empty/abort guards, 12-page sync budget) up to Historical bars, seeds the full window into the dataset store, and subscribes the progressive repaint *before* the DSM background job runs — the chart keeps growing as backfill slices land instead of freezing at the first page.
- **Dataset vs chart split is now Historical bars vs Rolling window.** The DSM target stays Settings → Historical bars (default 5000); every paint path (`paintDataset`, venue load, `applyCachedToChart`, offline fallback) now shows only the newest Settings → Rolling window slice (default 10,000) while the dataset keeps the full depth. `applyCachedToChart` also drops the inverted `max(history, 100k)` clamp — an explicit `maxBars` window wins, otherwise Rolling window, hard-capped at 100k.
- **A live-session response that is not a result is no longer rendered as a successful run.** `/tick` and `/append` accepted *any* 2xx JSON body, and `payloadCount` fell back to the local bar count when the body carried no `count` — so an error envelope (`{ status: 'error' }`, which the `/run` path already guards against and which some backends return with a 200) passed every shape check, `mapRestPayload` coerced it to `status: 'success'` with empty `plots`/`series`, and the empty overlay list then cleared the indicator off the chart while the status bar reported success. The session client now requires a usable envelope (no `status: 'error'`, a matching `session_id` when echoed) and classifies each op as ok / gone / invalid / miss. Covered by the error-body case in `tests/engines-live-sessions.test.ts`.
- **A backend that cannot serve sessions no longer costs two full evaluations per tick.** An answered-but-unusable response (error envelope, mismatched bar count, missing `session_id`) dropped the session and returned `null`, so the caller ran a full `/run` on top of the full-window `POST /session` it had just paid for — on every tick, with no negative cache. Unusable answers now cool the session key down for `SESSION_RETRY_COOLDOWN_MS` (30 s), bounding that cost to one wasted create per cooldown. The `!tail.length` (same-tip) path also pins its closed-history fingerprint to a session that really holds `n` bars, instead of storing a hash that may not describe the session's own history.
- **Live sessions now engage under the default `mode: auto`.** The fast path was gated on `mode === 'interpret'`, but the engine's `configSchema.mode.default` is `auto` and `pluginsConfig` starts empty, so on a stock install — and on any deployment that never switched to interpret — every live tick still took the full WS/REST run and the session client was never called. Sessions always evaluate in interpret (compile has no resumable evaluator state), so the client now records the mode the *backend reported* for each `(endpoint, script, mode sent, profiler)` run key and allows a tick only when that was `interpret`: `auto` deployments get O(delta) ticks wherever the backend really interpreted, and a compiled series is never silently switched to interpreted values. Regression: `tests/runner-livetick-session.test.ts` (auto tick → `/run`, then `/session`) plus the mode-memo case.
- **Scripts with `input.source` stay on `/run` instead of churning sessions.** A resumable session freezes its inputs at create (`/tick` and `/append` carry bars only), while `resolveInputSourceValues` inlines cross-indicator plot refs as live series arrays that change every tick. Those arrays were part of the session key, so each tick released the session and created another — a full-window create plus a `DELETE` per tick, i.e. no O(delta) at all. Scripts whose resolved inputs are not all scalar now skip the session path (fresh inputs, one full run per tick — the pre-session behaviour); the guard is documented in `src/engines/catalog.ts` and asserted in `tests/runner-livetick-session.test.ts`.
- **Session release authenticates.** `DELETE /session/{id}` was issued without headers, so an authenticated backend rejected it and every dropped session lingered until the 15-minute idle TTL — including the ones released on every rebase. Releases now send the same `X-API-Key`/`Authorization` as create/tick/append.
- **The session budget survives a caller abort signal.** `withBudget` returned `signal || timer` when `AbortSignal.any` was unavailable, silently dropping the 30 s/90 s budget whenever a caller passed a signal; it now combines both by hand.

### Changed

- **Every-tick Pro mode is wired end to end.** When the selected engine owns the feed (`data_session` caps + every-tick policy): the chart paints from the engine's series (`GET /data/series/bars`, memory only), the runner evaluates over the engine's series with identity only (no bars sent), and live ticks advance the engine's store so candles and indicators stay aligned. Isolate studies and engines without `data_session` keep the bars-in path.
- **No local OHLCV persistence in engine-owned live mode.** When the selected engine owns the feed (`data_session` caps + every-tick policy), live bars stay in memory: the streaming multiplex no longer grows the dataset cache and cache→now expand serves cache only. The gate (`isEngineOwnedLive()` in `src/engines/ownership.ts`) is fail-open — while capabilities resolve, or on engines without data sessions, persistence works exactly as before.
- **Live re-run policy is hydrated from the selected engine.** Engines expose `getCapabilities()` (`EngineCapabilities`: `liveModes`, `ownsData`, `dataSession`, optional `dataExchanges`). PYNE Pro reports `features.live_modes` / `features.data_session` on `/health`; anything absent (pyne-worker, Pyodide, a generic endpoint without those keys) is bar-close only. The indicator panel cycles only through supported modes and falls back to bar close once an engine answers without every-tick. The preference is not changed while capabilities are still loading. Parsing is `capabilitiesFromHealth()` in `src/engines/catalog.ts`, which never infers support from the service name.
- **Status bar bars are interactive.** Left chart count is an editable input (Enter/blur commits to Rolling window and re-slices from the dataset; Escape cancels). Right `· dataset Nk` segment is a button that opens the Dataset manager modal instead of the DSM panel. Settings copy updated to match (Historical = dataset depth, Rolling = chart + engine window).
- **`src/engines/live-sessions.ts` documents its costs and exports its key types.** The module header now states that the closed-history fingerprint re-reads the closed window on every tick (O(window) client-side by construction — the O(delta) claim covers the server-side evaluation and envelope) and that unusable responses are memoised per session key. Session identity is split into exported `LiveSessionKeyFields` (key) and `LiveSessionModeFields` (run-mode eligibility).
- **The evaluation map and the OKF bundle now describe the live-session path.** `docs/architecture/evaluation.mdx` gains a `POST /session` → `/tick` / `/append` node with its interpret-only and miss-falls-back-to-`/run` edges, an `src/engines/live-sessions.ts` row in Internals, and an invariant that a live tick never changes evaluation semantics. Two curated OKF playbooks carry the durable rules: `okf/playbooks/live-evaluation-sessions.md` (protocol invariants, eligibility, continuity, not-a-result responses, failure memos and their cost) and `okf/playbooks/chart-apply-and-bar-windows.md` (repair-never-drop at the `setData` boundary, the three bar counts). `okf/code/src/engines.md`, `okf/playbooks/index.md`, and `okf/log.md` are regenerated by `bun run okf:enrich`.

## [2.23.1] — 2026-10-13

### Changed

- **The in-browser Pyodide engine now vendors the PYNE 0.6.9 wheel.** Rebuilt with `scripts/sync-pyne-wheel.sh` from the sister pyne repo (1.39 MB, verified byte-identical in `public/vendor/` and `vendor/`), which brings the browser engine up to parity with the Pro API:
  - the `array.copy(na)` codegen no longer emits a dead `list(None)` into generated Python;
  - `Runtime.create_session` / `append_bars` / `update_last_bar` are present in the wheel, so a Pyodide-backed session is possible without a second runtime.

  The hard-coded wheel URLs in `src/engines/catalog.ts` (preload warm list and the `micropip.install` call) and the wheel references in `docs/plugins/engines.mdx` / `docs/architecture/evaluation.mdx` moved with the filename. `sync-pyne-wheel.sh` prints a warning when that path drifts; this time it was caught and followed rather than ignored.

### Fixed

- **The vendored-wheel lock test no longer breaks on every wheel bump.** `tests/pynescript-interpret-ta.py` pinned the literal filename `pynescript-0.6.8-py3-none-any.whl`, so it failed as soon as the wheel was rebuilt — a test that fails on a routine dependency bump is a test that gets deleted. It now resolves the single wheel in `vendor/` and fails with the actual set of filenames when there is not exactly one, which keeps the lock (the wheel must still import and evaluate `ta.sma` / `ta.stdev` in interpret mode) while removing the version coupling.

## [2.23.0] — 2026-10-13

### Added

- **Rolling window (Settings → Historical bars, second field)**: caps how many bars reach the engine on every run, default **10,000** (`ROLLING_WINDOW_DEFAULT`, clamped 200–200,000). The chart keeps the entire dataset — this bounds only what is evaluated and shipped back. Added because the Data Source Manager can grow a dataset to `DSM_MAX_BARS_PER_JOB` (50k), and every extra bar costs evaluate time, encode time, and full-size response-envelope bytes on *every* run including each live tick. Explicit `opts.bars` (HPO holdout / walk-forward) is windowed too, so a trial cannot quietly exceed the user's budget.
- **Dataset size in the status strip**: the existing `N bars` readout covers chart bars, which understates the dataset once a deep backfill has run. A `· dataset 20.0k` segment now appears whenever the DSM memory mirror holds more bars than the chart, sourced from `peekDataset` and kept reactive via `subscribeDatasets`. `formatBarCount` keeps the readout inside the monospace strip: exact below 10k, grouped above.
- **`/health?deep=1` reports live upstream reachability**: shallow `/health` stays cheap and binding-only, but `?deep=1` pays one `HEAD` per egress peer (Binance, MEXC, DefiLlama, GeckoTerminal) and returns `status: "degraded"` plus a per-host `upstream` block, downgrading only the plane that failed. Probes use `HEAD` — DefiLlama's cheapest GET is ~9 MB / 2 s and would abort a shared timeout while proving nothing. Still returns HTTP 200: a third-party outage must not flap uptime probes.
- **Git-native script storage on Cloudflare Artifacts (no GitHub creds)**: optional `SCRIPT_ARTIFACTS` binding mirrors every script save/delete as a git commit to a per-API-key repo (`scripts/<id>.pine` + meta sidecar via `isomorphic-git`), history endpoints serve from git log with D1/memory fallback, and `GET /api/scripts/_git` + `POST /api/scripts/_git/token` hand out clone remotes plus short-lived repo tokens for any standard git client. Unbound workers behave exactly as before. Identical re-saves dedupe against HEAD (no clone+push, no history spam); `POST /api/scripts/:id/restore` resurrects any version as the new tip, recreating deleted scripts. Setup: `axis setup artifacts [--namespace axis-scripts]` (writes `[[artifacts]]`, verifies namespace access); docs in `docs/worker/data-plane.mdx`.
### Fixed

- **Market + on-chain proxies work again in production (100% failure rate fixed)**: both `fetchUpstream()` helpers passed `redirect: 'error'`, which **workerd rejects** (`Invalid redirect value, must be one of "follow" or "manual"`). Every `/api/market/*` and `/api/onchain/*` call returned 502 `UPSTREAM_NETWORK`, so DefiLlama TVL and GeckoTerminal DEX overlays were dead in the deployed Worker. Bun/undici *does* support `"error"`, which is why all 3,419 unit tests stayed green. Now a shared `fetchUpstreamJson()` in `worker/src/http.ts` uses `redirect: 'manual'` plus an explicit 3xx / `opaqueredirect` rejection — the original A10 intent preserved on every runtime. Regression guard added: `worker/tests/upstream-fetch.test.ts` pins the redirect mode and both proxy paths.
- **Upstream error text no longer leaks to clients**: the 502 body used to echo the raw runtime message (workerd internals, undici phrasing) verbatim. Failures now reduce to a short reason — `upstream unreachable` / `upstream timed out` / `upstream redirect refused` — via `UpstreamError`, and the signed Binance path never logs or echoes its HMAC-signed URL.
- **CI now installs worker dependencies before the root test run.** `bun run test` executes `bun test tests/ worker/tests/` from the repo root, but the worker is a separate package with its own lockfile; CI only ran a root install. Any worker test importing a worker-only dependency therefore died with `Cannot find package` — nine tests failed on `isomorphic-git`, and the coverage gate never ran. It passed locally only because `worker/node_modules` was left behind from a manual `cd worker && bun install`.
- **The coverage gate is enforced at its measured floor, not an unreachable target.** The 95% rung of the 70→80→87→90→95 ratchet was set but never met, so CI had been red on main since before 2026-10-13. `check-coverage.mjs` now separates an enforced `BASELINE` (89%, the real number) from an aspirational `TARGET` (95%), and reports the exact shortfall — currently 1,165 lines, concentrated in `src/store/index.ts`, `src/chart/manager-access.ts`, `src/storage/local.ts`, and `src/data/data-source-manager.ts`. The floor's job is to stop coverage going *down*; nothing here makes the gap smaller.
- **Unit suite is green again (`bun run test` exits 0)**: two independent causes. (1) `tests/helpers/mock-solid.ts` is preloaded so Bun's automatic JSX runtime resolves `solid-js/jsx-dev-runtime` to a runtime that actually implements `jsxDEV` — the package's own export map points that specifier at `dist/solid.js`, which has no `jsxDEV`, so every test whose import graph reached a `.tsx` died with `SyntaxError`. Root-level `conditions` in `bunfig.toml` does not affect Bun 1.4.3's runtime resolver, hence the preload. (2) `tests/pane-badge.test.ts` had a stale expected-button list from before the Pine tables button landed in v2.22.
- **E2E no longer asserts against a UI that moved**: `loadMockBars` and the smoke spec seed `{ autoload: false }` so the manual Load button is actually rendered (it is hidden by default), and the seed merges on reload instead of resetting app state. `selectDrawingTool` targets `[data-drawing-group]` + the caret flyout instead of a group *label*, which the caret button shadowed. The Script Library spec switches to the **Personal** tab, where the storage picker and save form actually live. Drawings persistence reloads bars before asserting shapes.
- **Chart `setData` boundary guard**: history apply now sanitizes candle/volume payloads (drops non-finite times/values and non-ascending times with a counted log line) and reports candle vs volume failures under distinct contexts, instead of surfacing a bare library assertion (`Value is null`) on every redraw after one poisoned row.
### Changed

- **Bun is pinned to 1.4.3** across all workflows, plus a `packageManager` field in
  `package.json`. Coverage measurement was Bun-version-sensitive: the identical suite
  reported **81.31%** under 1.3.14 and **89.82%** under 1.4.3, with
  `src/store/index.ts` alone reading 35.7% vs 88.4%. The gate was measuring different
  code depending on the runner.

### Docs

- Removed dead references: `hoox-sh/pine-worker` and `hoox-sh/hoox-landing-page` (both 404) and the unpublished `hoox-sh.pyne` VS Code Marketplace link.
- The PYNE Agent plugin install URL is now labelled as a reference deployment rather than project infrastructure, with a pointer to `hoox-sh/pyne-agent-worker` for self-deploy.

## [2.22.1] — 2026-10-11

### Fixed

- **Fib circles / arcs respect X/Y ratio**: `fibCircles` and `fibArc` no longer force pixel-perfect circles from the hypotenuse. Radii are now independent `rx=|dx|·lvl`, `ry=|dy|·lvl` ellipses — round only at 45°, with circular fallback for horizontal/vertical trends so levels stay visible. Hit-testing uses normalized ellipse distance plus trend-guide hit; drafts preview ellipses; `create()` stamps dual-shape `points[]` so moves stay in sync.
- **Fib circles background fills relocate with strokes**: nested ellipse fills (largest→smallest, `fillOpacity`, per-level colors) added to `fibCircles` and half-annulus fills to `fibArc`, matching the style dialog Background toggle. Fills derive from the same `rx/ry` as strokes so body-move/resize relocates them together.
- **N-point drag + fill relocation**: `hitTestHandle` now exposes every vertex for fixed 3–5pt tools (channel, pitchfork, fibext, fibchannel, fibWedge, triangle, xabcd, headShoulders) instead of only the first three; freehand (brush/highlighter, long polylines) stays body-move-only to avoid DOM thrash. `resizeDrawing` handles generic `pN`, `shiftDrawing` keeps `p2=last` for n-pt tools so `p1/p2` mirrors no longer desync from `points[]` after a move.
- **Drag perf**: pointermove drags coalesce to one user-layer rebuild per frame (`dragRaf`, flushed on pointerup) instead of a full SVG rebuild per event; pan/zoom path unchanged (script/fills never rebuild on drag).
- **Long/short fills honor style**: profit/loss rects use `ctx.fillOpacity` instead of hardcoded `0.18`.
- **Indicator `fill()` / `linefill` relocation**: `ensureScriptPaneLayer` refreshes its Y series + bar clock on every call (stale removed-series scale misplaced sub-pane fills); `runAndApply` clears this owner's fills on the non-target layer when overlay toggles so fills don't duplicate/linger; `clearScriptChartOverlays` clears only the hidden script's drawings/fills on shared sub-panes (previously destroyed the whole layer, wiping siblings); `plotFillsSignature` samples up to 16 interior points so historical rewrites with identical tips still invalidate the cache.
## [2.22.0] — 2026-10-10

### Fixed

- **Full-app review fix batch (2026-10-10, 152 items, plan `.opencode/plans/review-fixes-2026-10-10.md`)**: seven parallel review passes (Worker, engines, data/streams/chart, store/SW, UI, alerts/on-chain/MCP, CLI/desktop/CI) with every finding re-traced before fixing. Suite 3418 pass / 1 pre-existing fail (`tests/pane-badge.test.ts` stale expectation from `fa15352b`, untouched); typecheck clean; build passes; `bun run lint` exits 0; CLI 79/79.
- **Worker `/api/run` accepts `mode:'auto'`**: the PWA default was rejected with 400 when the Worker was selected as engine; `auto` now normalizes to interpret/compile, with a contract test on the PWA request body.
- **Worker hardening**: billing idempotency keys carry a per-isolate random prefix (no more cross-isolate dedupe); usage metering keyed by key hash; public on-chain/market proxies get per-IP rate limits, in-flight coalescing, and bounded cache keys; request bodies capped (32 MiB run / 8 MiB scripts) with Content-Length pre-checks; generic 500 bodies instead of raw `err.message`; upstream abort covers the body read with `redirect:'error'`; console verify has a 2 s timeout behind an IP pre-limit; script PUT is CAS (`UPDATE … WHERE revision=?` → 404/409); timing-safe admin-token compare with attempt gate; `clientIp` from `CF-Connecting-IP` only; `Vary: Origin` on CORS; `/api/stream` per-IP gated.
- **Secrets out of localStorage**: Worker API key, git PAT, and agent key now live in a session vault (memory + sessionStorage) with boot migration of legacy values; persisted payloads strip secret keys; cloud endpoints require https (loopback excepted); MCP `alerts.*` no longer echoes webhook URLs.
- **Service worker correctness**: `/api/*` responses are no longer cached (auth-ignoring cache could serve the previous account offline); `skipWaiting()` on install removed so updates wait for the banner instead of reloading mid-edit; unhashed pyodide/plugin files are network-first while hashed `/assets/*` stay cache-first; pyodide gets its own cache; `public/sw.js` and `src/sw/strategy.ts` parity is enforced by test.
- **Persistence robustness**: persisted payload gains a schema version (`PERSIST_SCHEMA_VERSION=1`) with a migration hook; `topbar`/`onchain`/`drawingUi` are now persisted (they reset on every reload before); per-section hydration so one bad field no longer voids the blob; unknown keys dropped; numeric bounds validated; nested defaults cloned instead of aliased; corrupt-blob backup is capped and only clears after a successful write; cloud drafts serialize; update dismissals stick per session; stale editor popout resets to docked.
- **Engine transport parity**: WS frames now carry `libraries`; one shared JSON sanitizer preserves `NaN` inside string literals on both transports; Pyodide receives script `inputs` (HPO and Script Settings overrides work) and reports unsupported fields instead of silently dropping them; WS/REST both honor abort signals; Pyodide load failures get a 30 s cooldown; cross-transport conformance fixture locks WS ≡ REST ≡ Pyodide.
- **Live data and chart races**: progressive repaint stops on CSV upload; "apply when complete" re-checks the current symbol; DEX pool keys keep case; Kraken live bars align to interval start like history; DSM-first failures fall through to venue fetch; stale-run flag clears are epoch-guarded; dead ccxt sockets take Live offline; destroyed panes purge overlay meta and listeners; bar-color repaint respects Heikin-Ashi and replay; overlay color edits resolve owner-scoped keys; catch-up repaints respect replay; backfill validation is every 4th page; progressive repaint appends instead of full `setData`; single shared `exchangeForSource`; tick coalescing per bar slot; dead `src/streams/binance.ts` duplicate removed.
- **Alerts correctness**: live bars carry the stream's symbol/interval and mismatches are dropped (no more BTC ticks firing ETH alerts); persisted per-symbol prices with a default cooldown stop reload re-fires; `pct_change` base latches at create; on-chain watermarks keyed per protocol; `data:`/`blob:` plugin URLs rejected in prod; `app.event` allowlisted; engine endpoint must be an https origin; per-tick alert path caches instead of parsing localStorage twice.
- **MCP host**: `mutates` enforced in dispatch (same-origin page scripts are read-only; ticket-authenticated bridge traffic may mutate); `includeBars` returns bounded rows instead of `"[array N]"`; bridge replies on the originating socket; event allowlist of 22 real listeners.
- **UI and design system**: shortcuts modal mounted; `--color-muted` defined (66 uses); extra price/alert cards use theme tokens; focus trap installed in settings/symbol/command modals with `focusin` containment; `ExtraMenu` is a dialog, not a menu; dead `SettingsDialog`/`AppDrawer`/`PluginManager`/`WorkersManager` deleted (live panels extracted to `settings/panels.tsx`); hardcoded hex replaced by tokens; off-palette fallbacks fixed; shared `.sc-popover` and `dismissOnOutside`; `FloatableShell` no longer builds `doc.write` HTML; shared 1 Hz clock; timers tracked and cleared; keyboard-recording pulse honors reduced-motion; non-null assertions narrowed.
- **CLI, desktop, and CI**: `setup --prod` fails closed (exit 1) on D1/KV failure and writes `ALLOW_OPEN_KEYS=""`; deploy refuses open-keys configs with D1-but-no-KV; template ships the flag empty; doctor requires KV when D1 is bound; Tauri CSP added; Windows binary resolution and `.cmd` spawn fixed with tests; npm token scoped to publish steps; compose binds `127.0.0.1` with production Flask default; https enforced for admin/key traffic; secrets leave argv; `secret put` no longer redeploys by default; wrangler pinned with ENOENT-only fallback; Tauri read errors surfaced; nginx runs as non-root on 8080; pyodide downloads SHA-256-verified; workflow permissions scoped; `ref_name` via `env:`; e2e waits on state, not sleeps; unit coverage for CLI helpers and pure functions.
### Added

- **Chart settings panel**: floating panel (chamfered SVG frame) opened from a new gear button in the price-scale cluster (`axis-chart-scale-settings`), anchored top-right of the active chart. Controls chart type, interval (reloads data), log / auto scale, and the last-value / plot-name / price-scale label toggles. Stays in sync with the scale cluster and chart context menu; closes on Escape. Open state is UI-only (`src/ui/chart-settings-state.ts`), not persisted.
- **Chart settings entry points**: the chart context menu's “Chart settings” row now toggles this panel (id `chart.settings`, previously `app.settings`, which opened app Settings; app Settings stays reachable from the topbar and palette). New command-palette entry “Chart Settings”.
- **Pine tables in the bottom panel (September 2026 parity)**: any script's `table.*` drawings can now move off the chart into a bottom Tables tab via “Move tables to bottom” (chart context menu, pane-badge table button), and back via “Move tables to chart” (same menus + Tables tab header). Bottom tables stack vertically in creation order regardless of `position` / `force_overlay`, stretch to the pane width with proportional `table.cell(width=…)` columns, never truncate text (scrollbars when needed), keep tooltips on hover, honor `merged_cells`, and allow text selection + per-table TSV copy — matching TradingView's bottom-panel rules. Placement persists per script (`pineTablesLocation`); chart HUD hides moved tables; new `Tables` bottom-docked panel, Topbar toggle, command-palette entry, and `panel.tables` chrome.
- **Pine table model forward-fill**: `PineTableCell` now carries `width` / `height` / `tooltip` / border hints and `PineTable` carries `force_overlay` / `merged_cells`, parsed from either engine shape (interpret + compile) so proportional bottom sizing, tooltips, and merges work as soon as the engine emits them.
### Changed

- **Studio UI elevation and motion**: layered shadow tokens (`--ax-shadow-ambient` / `-card` / `-raised`, `--ax-drop-shadow`) with light-theme variants; 150 ms transitions and focus rings on buttons, cards, chips, tabs, and rail items; press feedback on buttons and cards; all motion disabled under `prefers-reduced-motion`.
- **Pyodide 0.26.2 → 0.29.5 (Python 3.13.2)**: self-hosted runtime replaced in place — same file layout (`pyodide.js` + `pyodide.asm.js`, no `.mjs` migration needed), so loader, prefetch, probe, and worker CDN paths only change version strings. Bundled micropip 0.6.0 → 0.11.1 and packaging 23.2 → 26.2 from the new lock file. Verified end-to-end in Node: 0.29.5 boots, wheel 0.6.8 unpacks, `run_script` interprets a real Pine script successfully.
- **pynescript wheel 0.5.0 → 0.6.8**: rebuilt from the sister pyne repo via `scripts/sync-pyne-wheel.sh` (85 commits, incl. September 2026 Pine release-notes parity); stale wheels dropped, hard-coded paths in `src/engines/catalog.ts` updated. Editor builtin metadata already in sync; interpret lock (`ta.sma` / `ta.stdev`) passes.
- **Docs review vs last 20 commits**: fixed stale post-2.21.0 references (pre-Solid `state.js`/`main.js`/`server.ts`/root `sw.js` now past-tense across `ui/store`, `architecture/{overview,state-namespaces,adrs}`, `devops/build-and-serve`), bumped `docs/index.mdx` to v2.21.0, and documented previously uncovered changes — Pine tables bottom panel (enduser drawings guide + parity invariant), extras ticker controls / float-only time+price panels / big-price watchlist rows / panel motion (`ui-shell`), shared Worker plumbing `http.ts`/`proxy-router.ts`/`rate-limit.ts` + client `throttle.ts` (`worker/runtime`, `worker/index`, feature atlas), and Storybook lab (`local-dev`, `ci-and-testing`, atlas).
- **Docs repo identity + voice**: `docs/llms.txt` Repository/Docs-tree links pointed at `hoox-sh/pyne` — now `hoox-sh/axis`; enduser builtin-scripts heading de-maintainer-voiced (`What AXIS does not ship`). No `jango_blockchained`-as-source clone instructions exist in docs body (only required AGPL author headers); all clone instructions already target `hoox-sh`.
## [2.21.0] — 2026-10-07

### Removed

- **Pre-Solid static shell (~3,900 lines)**: deleted the legacy pre-Solid tree — `src/main.js`, `src/registry.js` + `registry.d.ts`, `src/registry-bootstrap.js`, `src/plugin-types.d.ts`, `src/chart.js`, `src/state.js` + `state-hash.js`, the `src/{sources,streams,engines}/index.js` builtin barrels, the eight `src/ui/*.js` legacy DOM modules, root `pyne-editor.js` / `style.css` / `storage.js` / `sw.js` / `server.ts`, and `tests/{registry,state,server}.test.ts`. Before deleting, the real import graph was traced from `src/index.tsx`: **no** legacy file was reachable and none shipped in `dist/` after a build — the only consumers were those three tests. This leaves exactly one plugin registry (`src/plugins/registry.ts`), one service worker (`public/sw.js`), and one state store (`src/store`). `LEGACY.md` and `docs/reference/legacy-shell.mdx` rewritten to record what was removed and why it was safe.
### Changed

- **Legacy plugin registry disambiguated**: `src/registry.js` exported its singleton as `registry`, the same name as the shipping `src/plugins/registry.ts` — two unrelated classes under one identifier, so a wrong import registered into a dead store with no error. The legacy singleton is now `legacyRegistry` (updated in `main.js`, `registry-bootstrap.js`, `ui/manager.js`, `ui/legacy-topbar.js`, `registry.d.ts`, and `tests/registry.test.ts`). Traced the import graph from `src/index.tsx` and confirmed **no** legacy file is reachable and none ships in `dist/`; `LEGACY.md` now records the full legacy file list, that finding, and why deleting the tree is a product decision rather than a refactor.
- **Allowlisted proxy routers**: new `worker/src/proxy-router.ts` (`createProxyRouter`) turns the `/api/onchain/*` and `/api/market/*` planes into ordered route tables instead of hand-rolled if-ladders. The accepted paths are now data (`onchainAllowlist()` / `marketAllowlist()`, pinned by `worker/tests/proxy-router.test.ts`) rather than implicit in evaluation order, which matters because for these planes the route table *is* the security boundary — they are not open reverse proxies. `onchain.ts` and `market.ts` shrink by ~100 lines net with identical responses; the preflight, 405, health, validation-error, and `NOT_FOUND` paths are unchanged. One deliberate difference: a path that only shares a string prefix with the plane (`/api/onchainfoo`) is now declined by the plane (`null`, 404 from the top-level dispatcher) instead of being absorbed as a plane 404 — same status and code, different message.
- **Worker HTTP helpers consolidated**: new `worker/src/http.ts` owns CORS header sets (`corsHeaders` + `READ_CORS` / `MARKET_CORS` / `WRITE_CORS` / `SCRIPTS_CORS` / `MCP_CORS` / `ORIGIN_ONLY`), `jsonResponse`, the `{ status:'error', code, message }` envelope (`errorBody` / `errorResponse`), `methodNotAllowed`, `preflight`, and `clientIp`. Replaced seven near-identical `corsHeaders`/`json`/`jsonResponse`/`jsonError` copies across `index.ts`, `onchain.ts`, `market.ts`, `git-oauth.ts`, `scripts.ts`, `keys.ts`, `runtime.ts`, `mcp/{handler,proxy,bridge}.ts`, and `durable-objects/session.ts`. Header values are preserved verbatim per call site (pinned by `worker/tests/http.test.ts`), so this is a no-behavior-change refactor.
- **`clientIp` deduplicated**: the verbatim `cf-connecting-ip` → `x-forwarded-for[0]` → `unknown` chain existed in both `runtime.ts` and `git-oauth.ts`; one implementation now.
- **Rate limiter deduplicated**: new `worker/src/rate-limit.ts` replaces the byte-identical fixed-window limiters in `runtime.ts` (`/api/run`) and `git-oauth.ts` (device flow). Behaviour and prune threshold are unchanged; it stays per-isolate and best-effort.
- **Bearer parsing deduplicated**: `keys.ts` had its own `Authorization.replace(/^Bearer\s+/i,'')` fallback; it now calls `auth.extractBearer`, the same reader `requireApiKey` uses.
- **Throttle guard consolidated**: new `src/utils/throttle.ts` (`createThrottle`, leading-edge drop guard keyed per call) replaces three hand-rolled `lastTrigger`/`Date.now()` copies in `update/update-manager.ts`, `ui/boot-errors.ts`, and `ui/error-share.ts`.
- **Bun-native scripts**: `scripts/*.mjs`, `scripts/okf/*`, and `scripts/capture-*.ts` moved from `node:fs/crypto/child_process` to `Bun.file`/`Bun.write`/`Bun.CryptoHasher`/`Bun.spawnSync`/`Bun.$` (kept `mkdirSync`/`unlinkSync` and ImageMagick/ffmpeg where Bun has no equivalent); capture `webp()` step uses `Bun.Image` (byte-identical output at q92, ~1.2x faster).
- **Panel open/close motion**: dock columns snap instantly on open/close (no width/height/margin transitions, so the chart reflows exactly once); the shell plays a smooth clean slide + fade (`ease-out`, compositor-only transform/opacity, no flicker/brackets/blink). Hover-slide stays linear on layout props; `will-change` is compositor-side only.
- **Datafeed WS hardening**: `/watch` sockets now clean up their ccxt watcher on disconnect (previously leaked one watcher per dropped client), with typed `Bun.serve` data, `perMessageDeflate: false`, and socket timeouts.
- **Test runner**: `bun test --isolate --parallel` benchmarked at ~12.5s vs ~37.8s serial with an identical failure set (see `test:fast` proposal).
### Fixed

- **Ticker drag handle**: listeners were only removed on `pointerup`, so unmounting mid-drag (emptying the symbol list) leaked `document`-level `pointermove`/`pointerup` against a detached node; added `pointercancel`, `onCleanup` teardown, and `user-select` suppression during the gesture. The drag offset is now persisted instead of being written straight to `style.transform` and lost on reload, and negative offsets are clamped so the band can't paint over the command/module bars.
- **Extra menu dividers**: `.axis-extra-menu-section` re-declared the border and padding that `.axis-extra-menu-row` already carries, producing two divider lines per section and roughly doubled vertical padding; the section is now `display: contents` and the trailing divider is handled with `:last-child` (the unreferenced `--last` modifier classes are gone).
- **Typecheck green**: added the missing `src/vite-env.d.ts` (`vite/client` types) — `bunx tsc --noEmit` went from 8 pre-existing `ImportMeta.env` / CSS-module errors to zero.
- **Flaky UI tests**: `workspace-snapshot` sample now opens the editor chrome it asserts on; `editor-menu` matches the `<For each={DOCK_MENU…}>` prefix (source gained a floatOnly filter); `store` rapid-switch waits on condition instead of a fixed 50ms sleep. Full suite: 3272 pass, 0 fail.
- **Datafeed version drift**: `/health` version now comes from `packages/datafeed/package.json` via static import (bundler-embedded, compile-safe — same pattern as CLI `own-package.ts`) instead of a hardcoded string.
- **CI-only test pollution**: `mcp-bridge-tabs` resets cloud config in `beforeEach` (was `afterEach`-only — an earlier suite's stored key leaked into the no-key assertion); the offline `expand-cache` test uses a unique symbol instead of the shared `csv-upload/BTCUSDT/1h` key.
### Added

- **Panel open effect**: `panel.open` Motion tune (Settings → Theme → Motion) — duration (40–200ms, default 180) and slide distance (0–100% of the panel, default full) for a smooth slide + fade; disabled or reduced-motion zeroes both to an instant snap.
- **Datafeed standalone binaries**: new `packages/datafeed/scripts/build-binaries.ts` cross-compiles the sidecar (`bun build --compile`, same 7 targets as the CLI) with a boot + `GET /health` smoke test; added `protobufjs` (ccxt's optional peer dep, required by the bundler) and a `build:bin` script.
- **`test:fast` script**: `bun test --isolate --parallel` (~12s vs ~38s serial). Known caveat: `tests/background-catchup.test.ts` intermittently segfaults a Bun 1.4.2 test worker under parallel load (upstream runtime crash, not a test failure) — CI keeps the serial `test`.
- **Storybook dev scaffolding**: `storybook-solidjs-vite` + `@storybook/addon-docs` with `storybook` / `build-storybook` scripts, `.storybook/` config (lucide-solid aliased to the prebuilt ESM bundle), and 19 `src/stories/` entries for brand/icons/panels/studio chrome.
- **Ticker band polish**: fixed the loop seam — spacing moved from a flex `gap` on the track to `padding` on two identical `.axis-extra-ticker-set` halves, so `translateX(-50%)` is exactly one period instead of a gap-width short (the band no longer skips ~1rem every cycle). The clone half is `aria-hidden` so screen readers no longer hear every symbol twice; prices use `tabular-nums` so live ticks stop re-flowing the band mid-scroll; items split into dim symbol / strong price / colored ▲▼ change (the symbol no longer turns green with the change); band gets a fixed 22px height, a panel tint, edge fade masks, and pauses on `:focus-within` alongside hover. New pure `buildTickerRows` builds the display rows (unit-tested).
- **Ticker customization + controls**: persisted sliders for item spacing (0–3rem), band height (18–40px), font size (10–16px), and opacity (20–100%) in the Extra menu; a pause/play toggle, click-to-pin items (pinned symbols keep full contrast + underline, exposed via `aria-pressed`), and a drag handle for vertical repositioning (`extras.ticker.offsetY`, clamped 0–160px, persisted with a "Reset band position" action). Hover still pauses, but the explicit toggle now wins — focus-based pausing was scoped to tick items so the pause button stays operable. Extra menu gained vertical clamping (flip above the button when there's no room below) plus `max-height`/`overflow-y` so the taller ticker stack scrolls on short viewports.

---

## [2.20.1] — 2026-10-04

### Fixed

- **Price-card trend on live ticks**: the Extra price-card arrow now heads the trailing-N trend with the stream-scoped live tick (falls back to the last bar close when no tick), so it reacts to every tick instead of only bar closes.
- **Price-card countdown prefix**: the bar-close badge reads `-M:SS` (e.g. `-4:32`).
- **Ticker marquee placement**: the marquee is a full-width band under the module bar (app top) — no longer a squeezed item on the right side of the topbar row.
## [2.20.0] — 2026-10-04

### Changed

- **License headers**: unified all own-file headers to `Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)` / `part of axis` (was `pynescript`). Comment-only, no behavior change.
### Added

- **Watchlist big-price rows**: `!` button after the alert bell toggles an expanded row — full-cell-width big price (auto-shrinks for long prices / extra decimals) with symbol, change, and prev close in a sub-row.
- **Ticker marquee options**: travel direction (left/right) and a 24h-change toggle join speed + symbol picks in the Extra menu; persisted with the ticker state.
- **Float-only time + price panels**: compact Extras (normal width, ~2 rows, float only — no layout docks, title-drag moveable). Time shows the candle-close countdown + local/UTC clocks; Price shows the big last price + 24h change for the chart symbol. Both default side-by-side just under the topbar.
- **Price-card time badge**: left name badge on the current-price overlay — bar-close countdown while bars load, live clock otherwise (tooltip: local + UTC).
- **Quote dock panel**: full quote sheet (price + trend, 24h change/range, day open, last O/H/L/C, 24h volume, tick time, venue) as a right-dock panel with multirow stacking, toggled from the Extra menu.
### Fixed

- **Extra chrome widgets (review hardening)**: ticker starts once per mount and REST-seeds underneath live quotes instead of wiping them; color pickers no longer sit inside the checkbox label so picking a color can't toggle the overlay; alert direction treats `0` levels as real levels; disabling the overlay clears any visible/stale alert; price card ignores ticks from a previous symbol; persisted ticker symbols are trimmed + deduped and overlay colors must be `#rrggbb`; alert-broadcast test now covers the firing path.
- **Ticker auto-seed**: enabling the price ticker copies the watchlist symbols when nothing is selected, so the band appears immediately; single quote-mux lifecycle per mount.
- **Price card alignment**: overlay sits top-right, clear of the 72px price-scale gutter.
- **Extra menu polish**: dropdown rebuilt with Studio inputs — toggle switches with hints, `ax-range` sliders in labeled fields (controls appear only when their widget is on), `StudioColorInput` swatches for alert colors, `ax-chip` pills for ticker symbols.
- **Quote sheet correctness**: day window anchored to an injectable clock (was date-sensitive in tests); 24h high/low loop instead of `Math.max(...spread)` which overflows the stack on large histories; live tick ignored when it belongs to a previous symbol.
## [2.19.0] — 2026-10-03

### Added

- **Extra chrome widgets**: module-bar `Extra` button (after Results) with dropdown toggles for a current-price trend card (tick-length slider), a watchlist ticker marquee (symbol pick + speed), and a fullscreen direction-colored price-alert overlay.
## [2.18.2] — 2026-10-03

### Fixed

- **Background-tab data gaps**: live ticks no longer depend on `requestAnimationFrame` alone — the multiplex queues every tick in order with a timer fallback, so hidden/throttled tabs keep every closed slot instead of only the newest. `mock-poll` emits each missed intermediate slot on wake. New `data/background-catchup` auto-detects trailing staleness / fillable holes on `visibilitychange` / `focus` / `online` (and after long WS outages), REST-expands the dataset toward now, repaints without viewport reset, and queues a DSM backfill — the chart always delivers correct data.
## [2.18.1] — 2026-10-03

### Fixed

- **Chart engine (Heikin-Ashi)**: per-chart incremental HA cache instead of a shared singleton, so multi-chart slots no longer thrash each other; live ticks stay O(1) and the price-line tint reuses the computed HA point instead of a second full-history transform. Non-finite bars return null instead of pushing NaN to Lightweight Charts.
- **Chart overlays**: smart-apply fingerprints are pane-qualified (`pane:key`), so the same plot name on price + indicator panes never shares tip state; hline fallback series are owner-scoped like price lines.
- **Chart paint**: `plot.style_*br` primitives sample head/mid/tail plus a sparse hash (and honor recompute `forceFull`), so mid-history rewrites repaint; merged candle + indicator markers are capped at `MAX_CHART_MARKERS`; full-history paint dedup samples first/mid/last OHLCV so gap-fill corrections repaint; `scrollToTime` centers on the nearest bar index instead of a fixed ±14d window.
- **Chart lifecycle**: inactive-slot paints restore the global active slot in `finally`; price-series swaps create before removing so a failed create never leaves the pane empty; price-series theme subscriptions are tracked per slot; compare alignment skips re-sort when sorted and memoizes on refs + endpoints; rAF coalescer drain is re-entrancy safe; empty volume profiles return no bins so the overlay hides.
- **Pre-eval typo checker**: comma-separated multi-declarations (`const string A = 'x', const string B = 'y'`, `var series bool L = na, var series bool S = na`) now index every name instead of only the first per line, and single-line function bodies after `=>` contribute their bindings too. Large scripts no longer drown in false `Unknown COL2 / __GRID / __MTG / ATS … did you mean …?` marks. `dayofweek.sunday` … `dayofweek.saturday` are known builtins, so `dayofweek == dayofweek.monday` is no longer flagged.
- **Drawing tool menu**: the group flyout (Fib, Gann, and the rest) opens beside the rail with the full tool name. It is no longer clipped to the rail edge.
- **Script delete**: removing a chart script owner-clears its Pine drawings, plot fills, and barcolor. Lines no longer stay on the chart when another script is still applied.
## [2.18.0] — 2026-09-28

### Added

- **Drawing example**: AXIS Drawings places a line, linefill, box, label, polyline, and table. Open it from the editor Examples menu or apply it from Scripts.
- **UI effect manager**: Settings → Theme → Motion tunes short chrome flashes. The watchlist price flash is the first effect (duration, up tint, down tint). Later effects register the same way. Reduced motion turns flashes off without forgetting the tune.
### Changed

- **Future drawings**: Pine lines, boxes, polylines, linefills, and labels can sit up to 500 bars past the last candle. The right margin grows to fit that point.
- **Drawing gallery**: AXIS Drawings places its line, linefill, box, label, and polyline on the candle clock. Pine drawing times are milliseconds; the chart bars are unix seconds, and the mismatch was pinning every anchor to the last candle. The corner table stays up in chart-only mode, and a failed live tick no longer clears the last good gallery.
- **OKF query**: `okf:query` also matches file names listed on a concept, so `drawings.ts` finds `src/indicators/builtins`. Path segments stay whole words (`ui` does not match `builtins`). The shared agent instructions are `okf/playbooks/read-this-first.md`. `AGENTS.md` stays gitignored and is not compiled into the bundle.
- **Watchlist tick flash**: the watchlist toolbar bolt turns the quote flash on or off. The same switch is Settings → Theme → Motion.
- **Watchlist add field**: the symbol browse control is a lens inside the input, matching the topbar symbol field.
- **Data panel estimate**: the backfill form shows the span, dense bar count, and page count for the past date and timeframe. A job past 50,000 bars says how much of that timeframe one run keeps. Job cards show fetched versus expected bars and the window length. Dataset load preview includes the span of the bars that will load.
## [2.17.1] — 2026-09-27

### Added

- **Editor function tree**: optional right-rail outline of Pine functions, methods, types, and enums (`editorRightRail: outline`). Click a name to jump. Mutually exclusive with the minimap; toggle from the editor overflow menu or command palette.
### Changed

- **Quiet trader shell**: a new session opens on the chart. The status row is Live, last price, and a Compose chip. Diagnostics expands the raw engine, source, stream, and storage chips. Layouts can switch between Trader and Operator. The Data tab keeps the Data Source Manager name in its tooltip.
- **Problems stay while typing**: the Problems list and underlines keep the last lint / run marks until idle re-lint (or a new run) replaces them. Optional Settings → Editor → **Clear marks while typing** still wipes mid-keystroke.
### Fixed

- **Calm live state**: reconnect stays an amber dot and a tooltip. Routine loads and reconnects stay in the log. A toast fires when retries are exhausted or the stream recovers from a long outage.
- **Chart failures**: an empty chart shows a title, one sentence, and one action. HTML from a venue is not printed as a token dump.
- **Pre-eval UDT fields with spaced generics**: `array <label> labels` / `array <line> lines` (and tab-indented draft arrays) are indexed as declared names again, so Progressbar-style libraries no longer get false `Unknown labels` / `Unknown lines` typos.
## [2.17.0] — 2026-09-26

### Added

- **Right-click menus**: the chart plot, price scale, time scale, volume and indicator panes, script names, and drawings each open a menu for the actions that already exist there (reset view, scale, chart type, screenshot, script settings, drawing edit). Right-click a panel title to open its dock menu at the pointer.
- **HOOX favicon and live tab title**: the browser icon is the HOOX mark. The tab title leads with the last price and its change versus the previous bar, and follows live updates.
## [2.16.0] — 2026-09-26

### Added

- **Named chart themes**: Settings → Theme can save the current chart under a name. Each theme keeps a bar coloring. That coloring can also be saved on its own, applied into the selected theme, and updated across every theme that uses it. Editing one color on a built-in preset keeps the rest of that preset.
### Changed

- **Pattern dedupe**: new `src/utils/emitter.ts` (`createEmitter` + `createSingleton`) shared by `ThemeManager` and `PluginRegistry`; registry's 5 ordered kinds collapsed to generic helpers; venue `assertHttpOk`/`assertBars` helpers in `sources/catalog.ts`. No public API or message changes.
- **Drawing toolbar press states**: tool-rail buttons, carets, width chips, and style-bar chips show an accent pressed state. The style bar has a thin divider.
### Fixed

- **DEX backfill symbol case**: `startBackfill` and `expandCachedSeriesToNow` reuse `normalizeLoadSymbol` so background jobs no longer uppercase case-sensitive pool addresses (e.g. Solana base58 via `geckoterminal-ohlcv`). Fixes the order-dependent `onchain-load-symbol` full-suite failure.
- **Script plot colors**: `resolvePineColor()` resolves Pine forms (`color.red`, `color.new(…)`, `color.rgb(…)`) to CSS at every apply point (runner overlays, `buildPlotVisuals`, shapes/fills/bgcolor/barcolor, Pine drawings) so script colors no longer fall back to axis defaults; per-bar `color.*` tokens now survive series coercion.
- **Persisted plot colors gain provenance**: panel picks store `custom: true`, so re-runs refresh auto-persisted script/palette colors from the fresh run (script color edits take effect) while explicit user picks survive. One-time self-heal: pre-existing persisted colors refresh on next run.
- **Chart resize sync**: drawing layers no longer rebuild all SVG groups on every resize frame — the viewport tracks each frame while full repaints wait for resize settle (150ms), so overlays, indicator and drawing layers converge with the main chart instead of lagging it. Pane-manager resize paths batch rect reads before `applyOptions` writes, and the ChartHost reflow safety net dropped from double- to single-rAF.
- **Toolbar drag tracking**: the tool rail and style bar track pointer deltas onto the live position, so a drag follows the pointer 1:1. Drop, dock, tap, and slop are unchanged.
- **Editor pre-eval typos**: `format.inherit` is recognized, `to` / `by` are not flagged as bare calls, and `for`-loop variables, UDT declarations, and multi-line signature parameters count as bindings.
## [2.15.0] — 2026-09-24

### Changed

- **Drawing toolbar polish**: extracted `drawings/toolbar/` primitives (`ToolRailButton`, `ToolCaret`, `ToolFlyout`, `DockMenu`, style controls, shared drag factory) so `DrawingToolbar` is a composition root. Unified 32px grid / 16px glyphs, 16px caret hit area, focus rings, pill count chip, and keyboard-nav flyouts. Settings popover uses matching field/check/level styles. No placement-math or glyph-path changes.
## [2.14.0] — 2026-09-24

### Added

- **OKF bundle**: `okf/` is an Open Knowledge Format v0.2 cache of the repo (one concept per source directory and doc, imports already linked). The pre-commit hook drafts, links, and lints it from the git index and stages it into the commit. `bun run okf:query` and `bun run okf:context` read that cache. `bun run okf:check` fails CI when the bundle is stale. Curated notes in `okf/playbooks/` stay put (`okf_lock: human`).
- **Connect MCP**: the chart loading splash and the status bar offer Connect MCP while the bridge is down. A saved Worker key attaches this tab. Without one, the button opens Settings → General.
### Changed

- **PYNE Agent plugin 0.1.7**: same-origin `/plugins/axis-pine-agent.js` matches pyne-agent-worker. Chat reads the live Workers Manager endpoint, API key, and persona on each send. A non-http(s) endpoint is refused. Closing the panel aborts the request. Validation status is plain text. Add to editor confirms, and says so when the editor panel is closed. The launcher sits under dialogs.
- **Studio Settings**: General splits chart chrome (appearance, labels, strategy marks, results) from live data, script storage, the Worker key, and MCP. UI scale presets preview until Save; Cancel, Escape, and the studio rail restore the saved scale. Topbar, keyboard, and theme use the same studio controls. Arrow keys move the settings tabs.
- **Chart loading splash**: the HOOX mark, caption, and status line sit in the center of the chart on desktop and phone. The shared list empty-state style no longer pins them to the top-left.
- **Drawing toolbar**: the select tool is a filled pointer. The menu arrow sits inside the tool button — the icon selects the tool, the arrow opens the menu. The magnet mark stays inside its button.
### Fixed

- **ZigZag** plots confirmed pivots and the live extreme. It was holding the last confirmed pivot as a flat line, so a rally never left that price.
- **plotshape markers** (fractals, MA crosses) stay on the chart. The engine sends `true` for a hit; that value was coerced to empty and the series was all blank.
- **Pine `time` sent to the engine is milliseconds.** Chart bars are unix seconds. `hour()` / `minute()` / session highlights were reading a ~15 minute slice of the whole history, so AXIS Sessions never lit.
- **Chart arrows behind Studio**: Left/Right no longer pan the chart while a modal is open, so the settings tab strip receives them.
- **Script storage label**: the storage select is labeled Storage. It lists storage backends.
## [2.13.0] — 2026-09-23

### Added

- **Movable drawing toolbar**: a grip docks the tool rail to the left or the top of the chart, or leaves it floating. Docked rails can slide in to the grip. The style bar has its own grip; double-click puts it back beside the rail.
### Changed

- **Classic colors on Fibonacci and Gann drawings**: retracement, extension, time zones, channel, arcs, wedge, circles, Gann fan, box, square, and pitchfork paint each level in a fixed palette (0.618 teal, Gann 1×1 blue). Drawing settings can turn that off or recolor one level.
- **Drawing tool icons** are separate silhouettes, so the Gann fan, box, square, and Fibonacci tools no longer share one glyph.
### Fixed

- **AXIS Ultimate plots a value**: the built-in no longer calls `ta.uo` (the compiler emitted that as empty). It now plots the Williams Ultimate Oscillator from buying pressure and true range. The engine `ta.uo` compiles to the same formula.
## [2.12.0] — 2026-09-22

### Changed

- **Script Library and Layers panels**: list chrome is split into `ui/library` and `ui/layers`. The library search covers built-ins and personal scripts (with a jump to matches on the other tab); Find across scripts and Recent scripts from the command palette now focus that search or show newest personal scripts. Personal scripts filter by kind. Layers sections show counts, drawing rows use labelled eye toggles instead of a nested button, and the drawing list can be filtered.
## [2.11.0] — 2026-09-21

### Added

- **PYNE Agent persona** control on Workers Manager (auto / pine / axis / trader), same `writePluginField` path as the agent endpoint.
### Changed

- **Large OHLCV histories stay interactive**: 10k–100k candle loads lower LWC `minBarSpacing` so fit-content can actually show the full series, precompute conflation on every pane (user-visible priority at 25k+), skip duplicate full `setData` (DSM paint + ChartHost), and throttle progressive backfill paints. Pan/zoom no longer walks the whole series for plot fills, line-break primitives, or volume profile (visible window only); time-scale sync is rAF-coalesced from the price pane; plotshape markers cap at 2,500 newest; Data Window / crosshair updates stop tracking the 45k-bar array identity.
- **Data Source Manager panel + Dataset manager modal**: job card / coverage map / formatters split out; the panel inherits the chart symbol and interval, uses filter chips with counts (Issues instead of Error), and puts Dataset manager in the header. The modal gets a focus trap, two-step delete (no native confirm), sort-by-header, success banner, and arrow keys that no longer steal from date/search inputs.
### Docs

- MCP setup/troubleshooting now points at **Settings → General → Worker (cloud + MCP)** (Data tab is exchange credentials only). PYNE Agent guide documents the Workers Manager persona/endpoint controls.
- **Pyodide-in-Worker use case + test conventions**: `worker/RUNTIME.md` rewritten to match the actual scaffold (boot wired, wheel/`run_script` stubbed — enabling the flag currently breaks evaluation; completion checklist included); `docs/architecture/evaluation.mdx` gains the scaffold status and the `NO_BACKEND` consumer contract (don't retry); `TESTING.md` records mock-hygiene, staleness-guard, and generation-advance conventions.
### Fixed

- **Dataset manager never throws and always delivers**: `startBackfill` clamps bad dates, remaps the cache-reader source, and always returns a job id. Venue failures retry with backoff then complete as **Partial** with whatever bars are already cached (jobs no longer die as `error`). Empty-cache loads subscribe for progressive paint and kick a background walk after the first page.
- **System / script log chrome**: expanded system-log rows size the timestamp to `13ch` so `HH:mm:ss.sss` no longer runs into the level; `.axis-empty-state` uses padding-inline (12px) so the editor Script Logs empty copy is inset when a run produced no `log.*` lines.
- **Drawings no longer paint over the scales**: the SVG drawing layer is sized to LWC `paneSize()` (plot pane only), so fibs / rays / hlines clip at the price and time axes. Scale-control cluster (`A L $ N T`) and volume profile use the live `priceScale('right').width()` so last-value titles that widen the gutter no longer sit on the ticks.
- **Compile `fill()` plot_meta**: auto/compile runs stamp `kind: fill` plus distinct `plot1`/`plot2` series keys (untitled `plot()` → `plot_N`) so AXIS paints bands instead of dropping them.
- **Pine `fill` / `linefill` geometry**: untitled `plot()` fill edges no longer both bind to the first series (`plot` vs `plot_2`); per-bar fill color splits the SVG band so Ichimoku-style clouds flip; `line.fill` / `linefill.new` quads order each line by time so opposite `line.new` directions do not bowtie. Live re-runs pick up mid-band color/shape changes.
- **MCP streamable HTTP handshake**: `GET /mcp` with `Accept: text/event-stream` returns 405 (stateless JSON-RPC, no SSE). Grok and other Streamable HTTP clients no longer parse discovery JSON as an event stream.
- **MCP invoke no longer fans out to every tab**: `McpBridgeDO` sends each `/invoke` to the newest attached socket only and ignores late replies from other tabs, so two open AXIS windows cannot both mutate the chart for one agent call.
- **Worker key rotation reconnects the MCP bridge**: changing, clearing, or generating the `pn_…` key compares the hashed session, disconnects the old socket, and reconnects (300ms debounce while typing; only well-formed keys attempt a socket). Settings dialog Save uses the same path.
- **PYNE Agent uses live plugin config**: chat submit and the floating launcher re-read `getConfig()` so Workers Manager endpoint/API key/persona edits apply without a reload.
- **MCP bridge WebSocket no longer puts the long-lived key in the query string**: the PWA mints a 30s single-use ticket over HTTP (`GET /api/mcp/bridge?issue=ticket`) and connects with `?ticket=`. Discovery stops advertising query bearer. JSON-RPC batches are capped at 10 items, charged per method against the 60/min limit, and bodies above 1 MiB fail closed before parse.
- **MCP reconnect toasts**: socket blips log at `info` without a toast; warn/error toasts only after the backoff ceiling. Ticket-mint failures use the same ceiling.
- **MCP bridge tickets survive Durable Object hibernation**: one-time nonces are stored in DO storage (30s TTL, single-use), so mint→upgrade is not lost if the isolate sleeps between the two requests. If the targeted tab disconnects mid-invoke, the Worker fails `SESSION_OFFLINE` instead of waiting out the 20s timeout.
- **Flaky suite: shared-Response fetch mock + stale DSM status** — `tests/git-oauth.test.ts` device-flow tests intermittently timed out because the queued fetch mock re-served one single-use `Response` (a leaked background task from another suite consumed its body → `res.json()` fell back to `{}` → endless `authorization_pending` polling). The mock now builds a fresh `Response` per call. Separately, `ensureDatasetComplete`'s detached closure announced `setStatus('ready')` unconditionally, clobbering newer loads/errors; it now takes `stillCurrent`, `load-symbol.ts` passes its generation guard, and the `_reset*Generation` test helpers advance (never zero) so stale guards can't re-arm.
- **MCP `structuredContent` always an object**: app-plane array results (`indicators.list`, `logs.get`, `alerts.list`, `library.list`, `drawings.list`) and primitive `app.get`/`settings.get` slices failed strict MCP clients (`expected record, received array/string`). Worker `jsonText` now envelopes non-objects as `{ result }`.
- **MCP `chart.zoom` accepts `action` alias**: `{"action":"reset"}` previously fell back to `in`; now `op`/`action` are equivalent.
- **MCP `drawings.tool` validates**: unknown tools now fail `BAD_TOOL`, missing tool fails `NO_TOOL` (previously set empty string).
- **Market Binance failover**: `403/451/429` from `data-api.binance.vision` now tries `api.binance.com` before surfacing; geo-block HTML no longer sticks on first upstream.
- **PYNE Agent endpoint dead-end**: installing the agent plugin from the same-origin `/plugins/axis-pine-agent.js` left `endpoint` empty with no UI to set it, so every chat failed with `Set plugin config: endpoint = your pyne-agent-worker HTTPS URL`. Remote installs now seed the endpoint from the install origin and same-origin installs fall back to the production worker origin (backfilled on boot for existing installs); Workers Manager → PYNE Agent gains an editable **Agent endpoint** section (worker URL + API key, `component:pyne-agent`). Self-hosters (local `wrangler dev` in the sister `pyne-agent-worker` repo) override the URL there.
## [2.10.0] — 2026-09-18

### Added

- **MCP agent-activity dot**: the status-bar capsule gains a second dot that lights while an agent invoke is in flight (bridge tracks `lastInvokeAt`/`lastCapability`; tooltip names the last call). The first dot keeps showing socket state + tab count.
- **Faster app-update prompts**: version poll tightened to every 2 minutes and now also fires (throttled) whenever the MCP bridge connects, so open tabs notice a deploy without a manual full reload.
- **Toast notifications + Settings → Notifications**: transient bottom-right toasts for runs, data loads, DSM completion, stream connect, Pyodide ready, library save/delete/restore, layouts, workspace import/export, settings saves, screenshots, and git connect. Every toast is written to System Logs; warn/error log entries raise a toast automatically. New Notifications tab (modal dialog, studio Settings page, command palette) holds the master switch, severity floor, per-category toggles (run / data / stream / engine / scripts / workspace / system), and flood control (auto-dismiss duration, max visible, repeat-dedupe window collapsing repeats to ×N). Prefs persist; toasts stay in-memory only.
### Fixed

- **MCP `indicators.remove` left ghost panes**: it deleted only the store row, so chart overlays and empty indicator sub-panes stayed painted (and the orphan panes persisted across reloads). It now uses the same detach path as the Layers panel (overlay cleanup, sub-pane destroy, orphan sweep). `indicators.update` routes `visible` through the chart-synced visibility path and rejects unknown ids.
- **MCP activity in System Logs + filters**: bridge connects, disconnects, tab-count changes, and every agent invoke now log under source `mcp` (with outcome + duration). The System Logs strip gains source and level filters (count shows `shown/total`, copy follows the filter); `logs.get` accepts `{ source?, level? }`.
## [2.9.0] — 2026-09-17

### Added

- **MCP drawings control**: new `app_invoke` capabilities `drawings.add` (place a drawing by kind + time/price points, validated through the same normalizer as the chart layer), `drawings.update` (patch points/style/meta/visible by id; kind is immutable), and `drawings.remove` (delete by id). `drawings.list` accepts an optional `symbol` filter.
- **MCP settings control**: new `settings.get` (sanitized app settings — endpoint, engine, interval, history bars, live prefs, UI scale, label/strategy/telemetry prefs; secrets never exposed) and `settings.set` (allowlisted patch with the same clamps as the Settings dialog; interval/history changes reload the chart, unknown engines and secret keys rejected).
- **MCP/session status-bar indicator**: new `McpHud` capsule (socket state + attached-tab count for the key's session, click opens Settings → MCP). Backed by `GET /api/mcp/bridge` without `Upgrade`, which now returns the `McpBridgeDO` `{ connected }` count instead of `426`; the app polls it every 20 s while the bridge is open.
## [2.8.0] — 2026-09-17

### Added

- **Script Library tabs**: **Builtin** (110 first-party AXIS Pine scripts, searchable and grouped by category — Apply runs one onto the chart, Edit opens its source in the editor to fork under Personal) and **Personal** (the existing storage-backed user library: backend, save/import/export, published, version history).
- **Unified Worker API key setting**: Settings → General → **Worker (cloud + MCP)** is now always visible (no longer hidden behind storage engine `cloud`). One `pn_…` Bearer unlocks both cloud script storage (`/api/scripts`) and the MCP server (`/mcp` + tab bridge); typing/generating/testing the key live-persists it and reconnects the bridge. MCP hints and the bridge idle error now point at this section instead of the stale “Data tab”.
## [2.7.2] — 2026-09-17

### Fixed

- **Reload wiped all persisted state**: `parsePersistedState` threw during boot because `clampUiScale` read `UI_SCALE_STEP` before its declaration evaluated (TDZ); the blanket catch returned null and `loadPersisted` deleted the key, so every reload reset watchlist, settings, and everything else to defaults. Scale bounds moved above boot use; corrupt payloads are now backed up to `<key>.corrupt` with a console warning instead of silently deleted. Regression covered by `tests/persist-boot.test.ts` (fresh module-evaluation round-trip).
## [2.7.1] — 2026-09-17

### Fixed

- **Watchlist venue coverage**: MEXC now REST-polls at `refreshSec` (badge `rest`) instead of freezing after one seed — MEXC WS is kline-only, so there is no ticker mux. Kraken gains genuine Kraken REST tickers (legacy `XXBTZUSD` keys normalized; never mixed onto Binance) with the same REST poll. Data Manager quotes resolve to the underlying venue for both REST and WS (previously the REST seed always fetched Binance while WS followed the selection). CCXT-gateway status honestly reports no ticker endpoint yet.
- Worker MCP Durable Object uses `new_sqlite_classes` (`MCP_BRIDGE` / `McpBridgeDO`). Cloudflare® accounts no longer accept KV-backed `new_classes` (error 10099).
- CLI `healthFeatures` test covers `mcp` / `mcpBridge` flags (fixes `v2.7.0` npm publish which failed on `health.test.ts`).

## [2.7.0] — 2026-09-17

### Added

- **MCP server** on the Worker (`POST /mcp`, Bearer API key): tools for health, generic allowlisted `axis_request`, `/api/run`, scripts, keys, onchain, and market; resources and prompts. Live-app tools (`app_invoke` / `app_get` / `app_set`) RPC to a connected PWA via `McpBridgeDO` (`/api/mcp/bridge`). In-app host (`window.__AXIS_MCP__`) covers chart, editor, indicators, alerts, library, watchlist, panels, plugins, theme, drawings, workspace, logs. CLI: `axis mcp` (stdio proxy) and `axis mcp config` (`@hoox-sh/axis-cli` 0.3.3). Settings → General → Connect this tab to MCP. Docs: [MCP (agents)](https://hoox.sh/axis/docs/enduser/guides/mcp) · [MCP server](https://hoox.sh/axis/docs/worker/mcp).
- Pane script badge **load source** (file icon, second after settings) opens that script in the docked editor.
- Topbar and editor **Add ▾** menus include **Add built-in script…** (same picker as ⌘K).
- **Screenshot** (camera, module bar, before Studio): capture price / all panes / workspace, drawings overlay, watermark, 1×/2×, copy or download PNG. Session icons (theme, fullscreen, chart-only, screenshot, Studio) sit on the right of the second topbar row.
### Fixed

- CI unit: SVG stub implements `replaceChildren`; on-chain health probe assertion no longer treats `worker.axis.hoox.sh` as the SPA host; Python runtime locks skip when numpy/antlr4 are missing on the runner.
- E2E: `/run` mock matches engine paths only (not Vite `runner-*.js`); Script Logs waits for the docked editor instead of toggling it closed while the lazy pane loads.

## [2.6.8] — 2026-09-16

### Added

- **First-party built-in scripts**: original AXIS Pine catalog (moving averages, channels, oscillators, trend, volume, volatility, pivots, session, and classic strategies). Scripts panel **Built-in** picker and command palette **Add built-in script…** (type `rsi` / `macd` to jump). These are AXIS originals — not TradingView® templates.
- **Named watchlists**: create, rename, duplicate, and delete lists. Lists persist with the workspace (`watchlist.lists` + `activeId`); a legacy symbols-only payload becomes a **Main** list.
- **Watchlist alerts**: row bell opens a compact price alert (cross / above / below) at last.
- **Autoload chart** (Settings → General): when on (default), symbol / interval / venue changes fetch immediately and the topbar Load button is hidden; when off, Load is shown and field changes wait for an explicit load.
### Fixed

- **Built-in studies:** Sessions uses `hour`/`minute` in the chosen timezone (PYNE `time()` ignores session args); VWAP / VWAP bands reset on the daily change; TRIX is triple-smoothed EMA (not TEMA); Rel Vol is Dorsey RVI; ZigZag plots confirmed pivots; pivot-reversal latches the last pivot for exits; applying a built-in no longer copies the editor input bag.
- Watchlist rename **Escape** cancels (blur no longer saves the in-progress name).
- Overlay opacity slider is shown only for edge chart overlays — float/window docks no longer expose a no-op control.
- Hover-slide idle hide waits while the panel has focus, the dock menu is open, a drag is active, or the watchlist alert popover is open, and re-arms when those end so typing (or the portaled form) does not collapse the peek strip.
- Watchlist price-alert popover is portaled (and flipped above the row when it would clip) so last-row Create is reachable; outside click / another row / removing the symbol dismisses it.
- System Logs strip was locked to 28px and horizontally centered, so it could not expand. It is left-aligned and expands to the log body again.
- Status-bar **N bars** opens the Data Source Manager.
- Library script cards were forced into a 32px centered row.
- Layouts menu is portaled out of the command bar so it is no longer clipped.
- Plugins catalog **Use** activates the selected source / stream / engine / storage again.
- Pyodide interpret no longer crashes at bar 0 with `_expect_series() got an unexpected keyword argument`: the runtime was replacing pyne 0.5's helper (which takes `last_sample_ok` / `allow_period_only`) with a 2-arg shim. Drop the stale `ta.stdev` full-recompute override and wrap `_expect_number` (dict-`default` unwrap, then the wheel helper) instead of replacing it.

### Changed

- Topbar / editor **Run** controls are labeled **Add** (same apply behavior; ▾ still adds another instance).
- **Chart overlay** keeps dock layout: overlay-on panels sit on the chart inner edge (plot does not shrink). Overlay-all makes the chart full width with panels on top. Overlay-off panels stay on the outer frame. Overlay panels stack in a single column (not side-by-side). Menu includes an opacity slider (default 75%). Slide-on-hover hides after 3s idle.
- Panel chrome: the per-panel icon is the dock menu (click) and drag handle (hold). The extra hamburger glyph is gone.
- Topbar command bar: venue + symbol (search inside the field) + interval; type + compare + reload; thin dividers between groups; theme / fullscreen / chart-only / Studio (gear, accent, trailing) on the right.
- **Workstation chrome polish**: two-bar command + module switch, 4/8px grid, 1px hairline, periwinkle `#8B9CFF` on `#07080C` / `#0C0E14`, Live as a 6px pulse, HUD capsules, 32px watchlist rows, 32×32 drawing rail, 26px status strip, tablet overlay drawers, mobile Chart/List/Editor/More. Same product — density and grouping only.
- Engine picker is a 3-icon switch (server / edge worker / Pyodide). Run, Live, and Replay share one action cluster.
- **Default history depth is 5000 bars** (`HISTORY_BARS_DEFAULT`). Existing saved `historyBars` values are unchanged.
## [2.6.7] — 2026-09-14

### Added

- **Convert to Pine v6** in the editor overflow menu and command palette. Rewrites any older version (missing `//@version` counts as v1) toward v6: colors / `n` / timeframe names, `ta.*` / `math.*` / `request.*`, `study(` → `indicator(`, typed `input.*()`, `iff` / `offset`. Not a semantic v6 migrator.
- **Alerts panel**: create form covers percent-change, drawing-touch, and indicator plot conditions (not only price / on-chain). Delivery is browser notifications, a compact HTTPS webhook, and an optional L2 webhook (`channel: "l2"` payload). Live stream ticks evaluate the book.
- **Pine `alert()` / `alertcondition()`**: interpret runs export engine `alerts` into the book (`pine_alert`). Arm any/`alert()`/`alertcondition()` (optional title) on a strategy or indicator; last-bar watermark avoids backtest spam. Strategy `alert_message` fills are included. Pyodide interpret exports the same payload.
- **Compile-path Pine alerts**: in-browser compile records `alert()` / `alertcondition()` in the object-mode bar loop (PYNE's compiler used to emit empty statements for Numba). Remote Flask/pyne-worker compile still cannot collect Python alert events, so AXIS sends **interpret** when the script calls those builtins.
### Fixed

- Fold marker labels were inverted (expanded blocks announced “Unfold”). They now read **Fold block** / **Unfold block**.
- **Convert to Pine v6** no longer prefixes UDF definitions, parameters, or unpack targets that collide with `ta.*` / `math.*` (set01–04 older scripts parse 323/323 after convert).
### Changed

- **Cloudflare rename**: Worker script `pynescript-axis` → `worker-axis` (`https://worker.axis.hoox.sh`). Pages project `pynescript-axis` → `axis` (`https://axis.hoox.sh`; previews `*.axis.pages.dev`). Health JSON `service` is `worker-axis`. Legacy `pynescript-axis.pages.dev` and `pynescript-axis.*.workers.dev` hosts still match in CORS / client heuristics.
- **Live stream on by default**: Settings → General → Enable live stream (`live.preferAfterLoad`, default on). Saving starts or stops the venue WebSocket; boot starts live when history is already loaded. Persist no longer writes a false default when the flag was missing.
- **Server/Pyodide execution default is Auto** (try compiler, fall back to interpreter). Strict Compiler is not the default: Flask/Numba is not prewarmed, first compile JITs, and some Pine stays object-mode. HUD and first-run now follow the engine schema instead of showing Interpreter when mode was never saved.
- **Editor fold gutter**: 14px Lucide chevrons replace the 10px `▾`/`▸` glyphs (down = expanded, right = folded), with a clickable `⋯` placeholder on folded blocks. Tab close/add and header Run/Library/Profiler use the same icon set and size.
- **Editor color tools**: one working color (picker overlay + any-form input + transparency) instead of a disconnected converter that stayed on `#939fff`. Chip captions use `#RRGGBB tN` so `color.new(...)` is not truncated; formats list copies the draft; Replace / Replace all / Jump; checkerboard swatches show Pine transparency.
## [2.6.6] — 2026-09-12

### Fixed

- **`axis secret put ADMIN_TOKEN` vs Cloudflare 10053** (`@hoox-sh/axis-cli` 0.3.2): empty `[vars] ADMIN_TOKEN = ""` is still a binding, so Wrangler refuses the secret. `axis secret put` now comments the plaintext var, deploys once to drop it, retries on 10053, then sets the secret. `axis keys create` prompts for the token (CLI cannot read Worker secrets) and doctor warns on a leftover `[vars]` stub.
## [2.6.5] — 2026-09-12

### Added

- **AXIS CLI cloud-storage bootstrap** (`@hoox-sh/axis-cli` 0.3.1): `axis setup --prod` / `axis setup kv` create and bind `API_KEYS` KV; `axis keys create` / `validate` mint and check `pn_…` keys; `axis deploy` applies the remote D1 schema first; `axis health --scripts` and `axis doctor --remote` probe `/api/scripts` and `features.keys`. Typical prod path is now `setup --prod` → `secret put ADMIN_TOKEN` → `deploy all` → `keys create`.
### Changed

- CLI `run()` now times out Wrangler (`wrangler whoami` in doctor) with SIGTERM then SIGKILL so `axis doctor --json` cannot hang.

## [2.6.4] — 2026-09-12

### Added

- **Script version history on every storage engine**: local (IndexedDB/`localStorage` snapshots, FIFO 50) and cloud Worker (`script_versions` + `GET /api/scripts/:id/versions`) now implement the same `listVersions` / `readAtRevision` contract as git. The library history panel is no longer git-only.
- **Worker URL + API key in Settings**: Script storage credentials for the cloud Worker (`endpoint` + `pn_…` key, generate demo key, test connection) live in Settings → General / Studio Settings as well as Script Library. Switching to Cloud no longer requires hunting the library panel first.
- **Workers inventory skeleton**: while backends are probing, the Workers page shows pulse placeholder cards (and an inspector skeleton) instead of an empty grid.
### Fixed

- **Cloud script storage used the Pine engine URL**: `resolveCloudConfig` no longer falls back to `store.endpoint` (`:5002` / `/api/run`). Worker base defaults to wrangler `:8787` on localhost or the production workers.dev host.
- **Storage engine switch deleted the source library**: copy between engines never calls `remove` on the source. Dialog primary action is **Copy scripts**; **Switch without copying** leaves both libraries as-is.
- **Minimap height restored**: short files no longer stretch the overview canvas to the full editor column — 2px per line, compressed only when the document exceeds the host.
- **Update reload asks first**: Update now / Hard reload (and `hardReload` itself) open a confirm prompt with current → new version before the app reloads.
- **Studio always opens Settings**: the topbar / palette Studio button lands on Settings every time (no longer restores the last rail page). Settings is the first Workspace rail item. The Studio click handler no longer falls through `??` into Runtime then Workers because those callbacks return `void`.
- **Workers is a full-viewport studio page**: same overlay as Settings/Runtime/Wire/Plugins (not a half-width right sheet). Escape closes it.
### Changed

- Storage-change dialog copy: “Copy scripts” / “Switch without copying” instead of migrate-and-delete / start fresh.

## [2.6.3] — 2026-09-12

### Fixed

- **Docker image build failed on `sync:versions`**: `bun run build` stamps Dockerfile/compose/bake VERSION fallbacks, but the image context did not copy those files → `ENOENT /app/Dockerfile` during GHCR bake. Missing stamp files are skipped, and the three files are copied into the build stage.
## [2.6.2] — 2026-09-12

### Added

- **Editor minimap (interactive)**: a scaled canvas overview docked to the editor right edge — one row per line, accent viewport box, cursor line. Click/drag scrolls the editor; auto-hides in narrow containers. Toggle in the editor overflow menu (View → Minimap, persisted `editorMinimapEnabled`, default on).
- **Foldable code sections**: indent-based folding for Pine (StreamLanguage has no syntax tree) with a void-styled fold gutter plus standard fold keybindings.
- **Indent grid**: faint `·` dots for leading whitespace plus one vertical guide per completed 4-space indent level, width-preserving and viewport-scoped.
- **Per-tab version/type badges + Save**: each editor tab shows `vN` (from `//@version=`, `–` fallback) and `STR`/`IND`/`LIB` (from the declaration call, `–` fallback) plus a Save button that persists that tab via the existing library/draft path.
- **Workers stays a right-side non-modal sheet**: the Workers overlay remains a right-aligned sheet with a left scrim that click-throughs to the chart/editor (modality unchanged: no focus trap, no Escape-steal) — not a full-width page like Runtime/Wire/Settings/Plugins.
- **Language Feature Bar above the editor status strip**: a chip row (Hover · Sig · Complete · Lint · Marks · Chips · Remote) where each chip is colored only while the feature is actually firing (open card / list / hint, running check, rendered marks) — dimmed while switched off — so the bar shows which features the current script uses and which could be disabled. Click toggles the master switch, long-press (~550ms) or right-click opens a popover with the group's full settings. The row itself is a persisted “Language Feature Bar” option (Settings → Editor intelligence → View, default on; `editorFeatureBarEnabled` in the store).
- **Standalone CLI binaries (bun compile)**: `bun run build:binaries` (`packages/cli/scripts/build-binaries.ts`) cross-compiles the CLI into single-file executables for 7 targets — linux x64/arm64 (glibc + musl), macOS x64/arm64, Windows x64 — with a native `--version`/`--help` smoke test. Own package metadata is now embedded at bundle/compile time (`src/own-package.ts` static JSON import) and preflight recognizes a new `binary` install context (`$bunfs` → "standalone binary (bun compile)"), so version display, engine checks, and drift detection work without a package.json on disk. Binaries ship as `axis-cli-<version>-bun-<target>` release assets and are covered by `SHA256SUMS` (bare asset filenames — a flat download verifies with one `sha256sum -c`).
- **`VERSION` single source of truth**: the repo-root `VERSION` file now owns the release number — `bun run sync:versions` (runs with `bun run build`) stamps `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `public/version.json` (served at `/version.json`), and the generated `src/version.ts` (`APP_VERSION`, also shown in About) + `worker/src/version.ts` (`WORKER_VERSION`, surfaced on `/` + `/health`). `bun run check:versions` asserts the whole set; the Makefile reads `VERSION` directly.
- **Update manager + notification**: the app polls the deployed `/version.json` (5 min interval + focus/visibility/online, cache-busted) and a waiting service worker routes through the same state — a new deploy shows an `axis-update-banner` (Update now / Hard reload / Later), announces via screen-reader live region + status line, and fires a Browser Notification when permission was already granted (never prompts). Hard reload unregisters workers, deletes `axis-*` caches, and navigates cache-busted. Covered by `tests/update-manager.test.ts` + `tests/version.test.ts`.
- **Window-close confirmation**: `src/pwa/close-guard.ts` installs one `beforeunload` listener per page and prompts only while a registered predicate reports unsaved work — the tabbed editor registers dirty-tab state (both chart and popout shells). Master switch + custom message APIs included; covered by `tests/close-guard.test.ts`.
### Fixed

- **Pyodide engine crashed on bars containing null (`eval_code` traceback + empty drawings)**: the browser bridge interpolated raw `JSON.stringify(bars)` into Python source, so JSON `null`/`true`/`false` became Python `NameError`s before Pine ever ran — surfacing only as a truncated `_pyodide/_base.py` traceback with `drawings: []`. `src/engines/catalog.ts`, `src/engines/index.js`, and `worker/src/pyodide_runtime.ts` now pass JSON strings via `globals` + `json.loads`, return `drawings: []` on bridge failures, and surface the full Python traceback (new `callPyodideRunScript` / `formatPyodideBridgeError`, covered by `tests/pyodide-bridge.test.ts`). `pyodide/pynescript_runtime.py` re-synced with the deployed `public/pyodide` copy (drawing-registry reset + compile-path GC).
- **Pyodide bridge errors kept their head, not the exception tail**: `formatPyodideBridgeError` cut long tracebacks with `full.slice(0, 6000)`, dropping the final `NameError: …` line that users need; it now trims the *middle* (keeps the `eval_code` head + the exception tail) in `src/engines/catalog.ts`, the legacy `src/engines/index.js`, and `worker/src/pyodide_runtime.ts` — which previously surfaced only `err.message` (Pyodide's `…`-truncated form). Covered by a new `tests/pyodide-bridge.test.ts` case.
- **Language Feature Bar nits**: clicking a chip whose settings menu is open now dismisses the popover instead of flipping the group's master switch (long-press opens the menu; the natural dismissal — a short press on the same chip — accidentally toggled the feature off). Number settings (Hover delay, Max options, …) now draft raw keystrokes and clamp/commit on blur or Enter, so values below a field's `min` can be typed instead of snapping mid-entry. Clicking a *different* chip while a popover is open switches the popover without toggling.
- **Test DOM stub Symbol-safety**: `tests/setup.ts` `dataset` proxy now passes through non-string keys (e.g. `Symbol.toPrimitive`) instead of throwing on `console.log`/inspect, and the traceback-trim budgets are named constants kept in sync across `src/engines/catalog.ts`, `src/engines/index.js`, and `worker/src/pyodide_runtime.ts`.
- **Docker builds were broken by the git-hooks `prepare` script**: root `package.json` gained `"prepare": "git config core.hooksPath .githooks"` (commit `d5f0cf89`), which runs on every `bun install` — including inside the image `deps` stage, where git is not installed → exit 127 on every bake since then (v2.6.1 GHCR images never published). The Dockerfile now installs with `--ignore-scripts` (no dep needs lifecycle scripts; native binaries ship as platform optionalDeps) — verified with a local `build` target bake (`dist/.version` = 2.6.1). Stale version fallbacks (`2.3.0`/`2.3.1`) refreshed to `2.6.1` across `Dockerfile`, `docker-bake.hcl`, and `docker-compose.yml`.
- **Service worker no longer cache-first `/version.json` probes**: cache-busted `/version.json?t=*` polls were classified as same-origin static and stuffed unique entries into the 96-entry runtime cache, evicting hashed chunks and `/pyodide/*`. Those probes now bypass the SW. Cache names bumped `v6` → `v7` so poisoned runtime caches are dropped on activate.
- **Close-guard disabled before update hard/soft reload**: the unsaved-work `beforeunload` prompt blocked Update now / Hard reload; the update path now disables the guard immediately before navigating.
- **Drawings e2e counts user-drawing SVG only**: the chart overlay SVG count no longer includes chrome/grid paths, so the trend-line persistence assertion is not a false pass.
- **`openStudio` no longer toggle-closes a slow overlay**: opening Studio while the sheet is still animating in no longer treats a second click as a close.
- **CLI binary install URL documents app tag vs CLI version**: GitHub Release tags use the app `VERSION` (`v2.6.2`); standalone binaries are named with the CLI package version (`axis-cli-0.3.0-bun-linux-x64`). The CLI README curl snippet now uses both current values so the documented URL is not a 404.
- **Docker build stamps `VITE_APP_VERSION` from the `VERSION` file**: compose/bake ARG fallbacks are no longer the Vite stamp, so `docker compose up --build` without `VERSION=` matches `/version.json`. `Dockerfile` `ARG VERSION=`, compose `${VERSION:-}`, and bake `variable "VERSION"` defaults join `sync:versions` / `check:versions`.
- **Feature bar long-press/contextmenu no longer race-dismiss; dialog focus**: the chip popover no longer closes on the same pointer that opened it, and the settings dialog receives focus.
- **Minimap pointercancel + full-height hit target**: `pointercancel` ends a drag the same way `pointerup` does, and the hit area spans the editor height so clicks near the gutter register.
- **Workers non-modal sheet restored**: Workers is a right-aligned sheet again (not full-width), with a left scrim that click-throughs to the chart/editor.
- **`IndentWidget.eq` so guides don't rebuild on every scroll**: indent-grid widgets compare equal across viewport updates, so CodeMirror does not reconstruct guides on each scroll.
### Changed

- **Coverage push toward 80/85%**: ~260 new unit tests across gateway, signed-fetch, pine-logs, watchlist tickers/live, symbol catalog, bars-cache, streams catalog, workers probe, git-oauth, dataset sinks/expand, data-source-manager, credentials, and drawing coords (`createCoordContext` with stub scales — coords 36% → ~100%) — scoped core gate up 82.8% → ~90% (passes the 80% and 85% floors), app lines 80.1% → 82.6%. Fixed 5 wrong expectations in the generated data-coverage tests (walk-loop `expanded` semantics, same-bucket merge conflicts, sink-merge unions) and 2 cross-suite leaks (probe teardown deleting the shared `window` stub, a real-timer device-flow poll). Overall lcov sits at ~79.3% — the remainder is browser/chart/worker-runtime code (drawing layer, pane manager, pyne-lsp, durable session) that needs E2E rather than unit tests.
- **Drawings e2e + chart DOM harness**: new `e2e/charts.ts` harness (stubbed network, mock-bar boot, toolbar tool selection, chart clicks, SVG shape counting) and `e2e/drawings.spec.ts` — draws a trend line via the real toolbar, asserts the SVG overlay renders, reloads to prove storage persistence, and switches tools. Covers the browser-bound drawing layer that unit tests cannot reach (no layout engine/canvas in bun).
- **GitHub Release now carries CLI + worker artifacts**: a new `release-assets` job in `.github/workflows/release.yml` attaches, for every `v*` tag, the offline-install CLI tarball (`axis-cli-<cli-version>.tgz` via `npm pack` — verified with an offline `npm i -g` + `axis --version` smoke), a deployable worker source snapshot (`axis-worker-<tag-version>.tar.gz` — `LICENSE` + `worker/` minus `node_modules` / `.wrangler` / `.dev.vars`, sanity-checked for `wrangler.toml.example` + `src/index.ts`), and `SHA256SUMS-<tag-version>.txt`. The job waits for the desktop workflow to create the Release (creates it itself if desktop never does) and uploads with `--clobber`; existing tags can be backfilled via `gh workflow run release.yml --ref main -f tag=vX.Y.Z`.
- **CLI binary smoke test runs on host-native targets**: `packages/cli/scripts/build-binaries.ts` no longer assumes a linux-x64 host — it smoke-tests whichever wanted target matches the running platform/arch (e.g. `bun-darwin-arm64`) and skips cleanly when none does, so `bun run build:binaries` cross-compiling on macOS/ARM64 dev machines no longer fails on the smoke step. Classic CI (ubuntu-x64) smoke is unchanged.
- **Pyodide runtime surfaces drawing-GC failures instead of silently no-opping**: `pyodide/pynescript_runtime.py` (synced to `public/pyodide`) now warns once on stderr when `DrawingRegistry` export/limits or the compile-path `gc_exported_drawings` call fails (e.g. a pyne wheel API change/move) rather than swallowing the error while `meta` still advertises the caps. `max_*_count` declaration parsing now strips `//` and `/* */` comments so a cap mentioned in a comment isn't captured, and the redundant `"mode"` entry is dropped from `compile_meta`.
## [2.6.1] — 2026-09-08

### Fixed

- **Desktop bundles carried the wrong version**: the v2.6.0 GitHub Release shipped desktop assets named `2.4.1` because `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` were never bumped past v2.4.1 — `tauri-action` derives bundle versions from the Tauri config, not the git tag. All four version stamps are now `2.6.1`, and a new `bun run check:versions` guard (`scripts/check-versions.mjs`, enforced in CI + the desktop workflow) fails on any drift.
### Changed

- **Script Logs moved into the editor**: the topbar `Script Logs` button and the shell-level `ScriptLogsPanel` (`src/ui/ScriptLogsPanel.tsx`, deleted) are gone — logs now live as an editor-local `ScriptLogsPane` (`src/editor/ScriptLogsPane.tsx`) above the editor statusbar, toggled by a `Logs` button beside `Symbols` (`axis-editor-logs-toggle` + `axis-editor-logs-badge`) and via the palette (`axis-editor-show-logs` event). Statusbar clusters now wrap as units (`flex-wrap`, actions `flex-shrink-0`) so buttons stay clickable in narrow docks instead of squeezing under each other. Guards: Playwright smoke `Script Logs lives in the editor bottom bar, not the topbar`.
- **Default timeframe is now 15m**: the chart-slot fallback (`src/chart/layout.ts`) and workspace-snapshot build/parse fallbacks (`src/storage/workspace-snapshot.ts`) changed from `1d` to `15m`, matching the store default — new chart slots and restored snapshots without an interval start on the 15-minute TF.
- **Studio opens on Settings**: `lastStudioPage` initial in `src/app.tsx` changed `runtime` → `settings` — the first Studio open (topbar button / palette) lands on Settings (subsequent opens still remember the last page).
- **Workers page is non-modal**: `AppPage` (`src/ui/studio/AppPage.tsx`) gains a `modal` prop; `StudioHost` renders Workers non-modally — transparent click-through scrim (new `.ax-page-backdrop--nonmodal` sheet in `studio.css`), no focus trap, no Escape-steal — so the chart and editor stay interactive while Workers is open. Modality follows the active rail page; other pages are unchanged.
- **Workers top status grid removed**: the aggregate Healthy / Health / Active backend summary deleted from `src/ui/workers/WorkersPage.tsx` — status now exists only per worker (inventory cards + detail pane + footer probe line). Guards: Playwright smoke `Workers page is non-modal` (scrim pointer-events, no top status, Escape does not close).
### Added

- **Versioned git hooks** (`.githooks/`): **pre-commit** runs Biome (`check`) on staged files only (fast); **pre-push** runs `bun run typecheck` (tsc) + `bun run lint` (errors fail, warnings pass). Auto-configured via the root `prepare` script (`git config core.hooksPath .githooks`) on every `bun install`; bypass with `--no-verify`.
- **CLI installation self-check** (`@hoox-sh/axis-cli` 0.3.0): every `axis` command self-verifies on start (`packages/cli/src/utils/preflight.ts`) — engine compliance (Node ≥ 20 / Bun ≥ 1.2), install context (npm install / npx cache / repo checkout), and **version drift** when a globally installed CLI is older than the repo checkout it operates on (warns `npm i -g @hoox-sh/axis-cli`). Warnings-only on stderr: skipped for `--version` / `--help`, silenced by `--quiet` / `--json`, never blocks or fails a command. `axis doctor` gains the optional **CLI installation** row (`cli-install` in `--json`). Tests: `packages/cli/tests/preflight.test.ts` (context detection, engines, drift, doctor row).
### Changed

- **Docs are CLI-first**: all `bun run axis:*` invocations across `README.md`, `AGENTS.md`, `docs/**` (cloudflare, local-dev, index, topologies, vps-demo), `worker/README.md`, and `packages/cli/README.md` replaced with the primary `axis <command>` form; `bun run axis:*` is now documented as a repo-only alias (alias tables flipped in `docs/devops/cli.mdx` and `docs/enduser/getting-started/installation.mdx`). New **Installation self-check** section in the CLI docs.
## [2.6.0] — 2026-09-08

### Added

- **Keypress feedback for consumed shortcuts**: `dispatchShortcut` now emits an `axis-shortcut-fired` CustomEvent (id / chord / description — `src/ui/shortcuts/runtime.ts`) and a transient bottom-center chip (`src/ui/shortcuts/Feedback.tsx`, `data-testid="axis-shortcut-feedback"`, `aria-live="polite"`, pointer-events none, ~1.2 s auto-hide, platform-correct chord glyphs via `formatChord`) confirms every consumed binding — main shortcut keys no longer feel dead even when the side effect is subtle.
### Changed

- **Docs synced to v2.5.0**: `docs/index.mdx` + `docs/enduser/getting-started/installation.mdx` version stamps; `docs/ui/ui-shell.mdx` gains **Keyboard shortcuts** (dispatch hub, scopes, recorder, Shortcuts modal) and **Mobile shell (phones / tablets)** sections; `docs/ui/index.mdx` subsystem table mentions shortcuts + mobile shell; `docs/ui/results-and-strategy.mdx` and `docs/enduser/guides/strategy-and-results.mdx` document the v2.4.3 results overhaul (Events Stream/Open⇄Close position-cycle views, single-column strategy tab, saved-run stats snapshots, shared `walkStrategyEvents` walker).
### Fixed

- **Keyboard shortcuts were dead: `ShortcutHub` was never mounted** (the component had zero importers, so the capture-phase keydown dispatcher in `src/ui/shortcuts/Hub.tsx` and the whole `src/ui/shortcuts/actions.ts` registration side effect never loaded) — `Ctrl/Cmd+K` / `Ctrl/Cmd+Shift+P` (command palette), `Shift+?` (shortcuts help), `Ctrl/Cmd+,` (settings), `Ctrl/Cmd+\` (toggle editor), `Esc`, and every `chart.*` binding (zoom / pan / tool letters / grid layouts) silently no-oped. The product shell (`src/app.tsx`) now mounts `<ShortcutHub />` (plus `<ShortcutFeedback />`). Only the parallel `Mod-S` / `Mod-G` handler in `src/editor/tabbed-editor.tsx` survived, which is why save worked while the palette was unreachable by keyboard. Guard tests: `tests/shortcut-feedback.test.ts` and the Playwright smoke `Mod-K opens and closes the command palette (shortcut hub guard)` in `e2e/smoke.spec.ts`.
## [2.5.0] — 2026-09-07

### Added

- **Mobile-first responsive shell** (phones ≤767px, tablets 768–1023px; desktop ≥1024px unchanged):
  - **Viewport signal** (`src/ui/responsive.ts`): reactive `phone | tablet | desktop` mode + `pointer: coarse` detection — all JS layout branching keys off this instead of CSS-only hacks, because panel geometry is persisted px state.
  - **App-style phone shell**: compact header (brand · venue picker · symbol picker via SymbolModal · interval select) + bottom tab bar (Chart · Panels · Editor · Studio · More) replace the desktop Topbar/StatusBar; Panels list and More drawer (Run, Live, Studio pages, Settings, theme, About) open as nav overlays.
  - **Panel sheets** (`FloatableShell` mobile mode): docked/floating panels render as full-viewport sheets under the header / above the tab bar — one active sheet at a time (`src/ui/panels/mobile-sheet.ts`); drag-to-undock, resize handles, and hover-slide are disabled on phones. Sheets dismiss via **swipe-down** on the title bar (grabber affordance + live translate feedback) or the close button. Desktop geometry is **bypassed, never overwritten**, so phone↔desktop switches preserve the user's layout. Phones boot chart-first (open panels don't steal the viewport).
  - **Chart force-single on phones**: 2H/2V/4 layouts collapse to the active slot with a slot-switcher chip row; other slots stay preserved in `store.chartLayout`.
  - **Tablet**: desktop shell kept, topbar becomes horizontally scrollable.
  - **Dialogs → bottom sheets** on phones (`sc-dialog`), safe-area insets (`viewport-fit=cover`, `env(safe-area-inset-*)`), `100dvh` app root, `interactive-widget=resizes-content` for soft-keyboard handling, ≥44px touch targets in mobile chrome (`pointer: coarse`).
  - **Studio tables** wrap cells on phones instead of forcing horizontal overflow.
- **PYNE runtime 0.5.0**: vendored `pynescript-0.5.0-py3-none-any.whl` (built from the sister pyne repo via `scripts/sync-pyne-wheel.sh`); stale 0.4.x wheels dropped; hard-coded wheel paths in `src/engines/catalog.ts` / `src/engines/index.js` updated (`hoox_pyne-0.4.2` / `pynescript-0.4.0` → `pynescript-0.5.0`). Pine language builtins unchanged.
### Changed

- **Zero Biome lint errors** (368 → 0) across 641 checked files:
  - **Tooling**: Biome 2.5 (`biome.json`, lint-only — Prettier keeps formatting), `lint` / `lint:fix` scripts, Prettier 3.9 pinned (`.prettierrc` single-quote/width-100, `.prettierignore`), project `opencode.json` enabling LSP + formatter.
  - **Real fixes**: regex `exec`-loops → `matchAll()` (pine-colors, preevaluate, pyne-lsp, script-inputs, library-publish, …), `type="button"` on ~18 buttons, keyboard handlers (Enter/Escape) + `tabIndex`/ARIA value semantics on interactive widgets, `role="region"` divs → `<section>`, global-shadowing renames (`escape` → `escapeHtml`, `valueOf` → `readFieldValue`), duplicate object keys removed, `const enum` → `enum` (isolatedModules safety).
  - **Justified suppressions** (each with reason): intentional control-char sanitization regexes (injection safety), CSS `env(safe-area-inset)` fallbacks, backdrop click-away surfaces, custom-widget rows with nested buttons, sticky-regex tokenizer.
  - Verified regression-free: `tsc --noEmit` clean; test suite identical to pre-change baseline (pre-existing `server.test.ts` hook timeout + `window.matchMedia` cross-file pollution unaffected).

---

## [2.4.3] — 2026-09-07

### Added

- **Results panel — events views & richer reports** (spec: `.opencode/specs/2026-09-07-results-views-design.md`):
  - **Events tab view switcher**: `Stream` (classic chronological list, now enriched with entry fill count / running position qty+avg, `from_entry`, remaining qty after closes, and per-fill P&L on close/exit rows) and **Open ⇄ Close** — a two-column grid with one row per position: entries on the left (fill list, pyramiding averages into the position, total qty @ avg price), exits on the right (each close fill with P&L, partial-close remainder, Open/Closed badge). Re-opens after a full close form new cycles (`id #2`); `close_all` flattens every open cycle; rows click-jump to the fill on the chart.
  - **Strategy tab — single column**: fill options → stats cards (12: trades, win rate, W/L, PF, net profit, **Return %** (compounded per-trade), max DD, avg trade/win/loss, gross profit/loss) → equity chart → closed-trades table below it, with new **Bars** (bars held) and **Fills** (pyramided entry count) columns.
  - **Saved runs tab — rich stats**: `buildResultMeta` now persists a JSON-safe strategy stats snapshot (`StrategyStatsSnapshot`) computed from the run's events (`profitFactor: null` = ∞); saved rows render a stats grid (trades, W/L, win %, PF, net P&L, return %, max DD, avg trade); legacy saved rows fall back gracefully.
  - **Pyramiding parity**: entry fills into a live position now average into the trade P&L (`entry = Σ(p·q)/Σq`) matching the pyne broker `(px − avg) × close_qty`; per-position cycles and the enriched stream are computed by a single shared walker (`walkStrategyEvents` in `src/results/strategy.ts`, re-exported via `src/results/positions.ts`).

---

## [2.4.2] — 2026-09-07

### Added

- **Global keyboard shortcuts**: app-level chord dispatch hub (`src/ui/shortcuts/`) with capture-phase handling, dialog-skip guard, per-user persisted overrides on the app store, and a live shortcut registry — wired to the command palette, editor, and chart canvas.
  - **Recorder**: Settings → Keyboard → record chord, plus a **Shortcuts modal** listing default bindings with live rendering.
- **Editor line ops** (`src/editor/cm-line-ops.ts`): `Prec.high` keymap extensions (duplicate line, toggle comment, indent/unindent, delete line) for the Pine editor; palette extensions render recorded chords.
- **CLI npm release pipeline** (`.github/workflows/release.yml`): full publish flow for `@hoox-sh/axis-cli` via org secret `NPM_TOKEN_HOOXSH` —
  - tag/version guard: `cli-v*` tags must equal `cli-v<packages/cli version>` (hard fail on mismatch); root `v*` tags publish the CLI when its version is missing from the registry and skip cleanly otherwise; `workflow_dispatch` gains a `force` re-attempt input.
  - post-publish **registry verification** (`npm view` with propagation retries).
  - **Node-only smoke test**: fetches the published tarball, installs it into a clean directory with `--ignore-scripts`, and asserts `axis --version` / `axis --help` on Node (no Bun, no repo).
  - step summary now reports tag kind, registry verify, and smoke results.
- **`@hoox-sh/axis-cli` 0.2.2** — first CLI-only release via the new pipeline: `cli-v0.2.2` tag → `Release (npm)` workflow (provenance publish, registry verification, Node-only smoke test of the published tarball). Code identical to 0.2.1; release exercises the full publish path end-to-end.
### Fixed

- **UI review findings (`/.opencode/review/`)** — 23 of the 25 consolidated findings (editor-audit + pass1/2/3) fixed across the editor, drawing chrome, panels, and themes:
  - **Escape friction cluster** (`AXIS-ED-ESC-OVERLAY`, `AXIS-P1-ESC-CANCEL-DRAFT`, `AXIS-UI-DRAW-MEASURE-ESC`, `AXIS-UI-KB-ESC-RECORD`): new CodeMirror Escape command dismisses suggest / hover / signature overlays in order; drawing drafts (measure, …) now always cancel on Escape (capture-phase handler immune to other preventDefault consumers); the Keyboard shortcut recorder records Escape as a chord with `stopImmediatePropagation` + a `data-axis-recording-chord` guard so the Studio page no longer closes mid-recording; conflict flags are scope-aware (`app.escape` vs `chart.cancel-draft` layer by design, no false conflict).
  - **Drawing flyout clipping** (`AXIS-P1-DRAW-MENU-CLIP`, `AXIS-UI-DRAW-MENU-CLIP`): Line / Fib / Shapes / Annot / Measure flyouts and the settings popover clamp to the nearest clipping ancestor — tall menus (13-item Shapes) scroll instead of spilling past the viewport, and flip upward when there is no room below.
  - **Callout / text prompts** (`AXIS-UI-DRAW-CALLOUT`, `AXIS-UI-DRAW-TEXT-FOCUS`): all blocking `window.prompt` calls (callout, note, anchored text, text tool, double-click re-edit) replaced with a non-blocking in-app dialog (`src/chart/drawings/tools/text-prompt.ts`) that autofocuses the input, commits on Enter, cancels on Escape — also fixes Tauri webviews where `window.prompt` is unsupported.
  - **Bar replay dismiss** (`AXIS-P1-REPLAY-DBL-CLOSE`, `AXIS-UI-REPLAY-DBLCLICK`): topbar toggle trusts both the subscribed UI state and the module session (a missed emission can no longer turn an exit click into a start), and Escape exits replay.
  - **Results staleness** (`AXIS-ED-RESULTS-STALE`): the store tracks the newest run (`newestRunId`); the script selector shows a "new run" marker when focus lags the footer.
  - **Status / System Logs clash** (`AXIS-UI-STATUS-LOGS-CLASH`): the System Logs expanded body is clamped to the viewport (reserving topbar + workspace + status strip), so an oversized persisted height can no longer push the Status strip off-screen.
  - **Diagnostic cascade** (`AXIS-ED-DIAG-CASCADE`): the pre-eval balance scanner no longer carries an unterminated string across lines (one bad quote suppressed every later structural diagnostic), and remote parse errors only shadow local errors on the same line — semantic errors after a parse failure now surface.
  - **A11y live region** (`AXIS-ED-A11Y-LIVE`): diagnostics changes announce politely via the shared SR live region; the Problems count is a `role="status"` live element.
  - **Long-line clip** (`AXIS-ED-LINE-CLIP`): `overflow-wrap: anywhere` on editor content so wrap mode breaks long tokens instead of clipping.
  - **Contextual autocomplete** (`AXIS-ED-AC-CONTEXT`): completions rank by prefix quality, cursor position (statement start boosts keywords, value position boosts series / user locals) and in-buffer local bindings.
  - **`input.int` hover** (`AXIS-ED-HOVER-INPUTINT`): exact catalog member beats the last-segment type fact, so hovers show signature + params instead of namespace docs.
  - **Contrast** (`AXIS-ED-LIGHT-CONTRAST`, `AXIS-UI-THEME-GRAPHITE-CONTRAST`): theme bridge enforces contrast floors for `--color-text-dim` / `--color-text-faint` (WCAG-ish 4:1 / 3.2:1) with correct mix direction per base; static light-theme faint token darkened (#8b8e9c → #666a78).
  - **Focus + labels** (`AXIS-ED-FOCUS`, `AXIS-ED-ICON-LABELS`): visible focus rings on editor tool / status / tabbar buttons and the CM surface; editor tab strip uses proper `tablist`/`tab` semantics with a real (non-nested) close button; aria-labels on icon-only git bar, topbar panel toggles, and Problems copy button.
  - **Eraser on locked drawings** (`AXIS-UI-DRAW-ERASER-LOCK`): locked erase / delete attempts now show a transient toast + assertive SR notice instead of a silent no-op.
- **Architecture apply guard**: `applyArchitecture` only preloads Pyodide when a real DOM append target exists. The unit-test document stub now exposes `querySelector`, which previously flipped the browser-detection gate and made `prefetchPyodideAssets` throw on `document.head.appendChild` under `applyArchitecture` tests (`commits Offline Lab`, `clears the stream slot`).

---

## [2.4.1] — 2026-09-06

### Fixed

- **Worker typecheck**: clean `tsc --noEmit` under the strict `worker/tsconfig.json` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
  - `auth.extractBearer`: regex capture non-null assertion — match guarantees the capture.
  - `scripts.rowToMeta` / `listD1`: build `ScriptMeta` with optional `description` / `path` only when set (no implicit `undefined`).
  - `scripts.handleScripts` draft put: include `name` only when defined; `parts[0]` non-null after the `_draft` / empty-path guards.

No runtime behavior change; only type compliance so `worker tsc` matches the pre-push gate.

---

## [2.4.0] — 2026-09-06

### Added

- **DSM-first data plane**: AXIS now loads datasets first — the chart paints instantly from the DatasetStore (repaired), then a background DSM job auto-completes the series (validate → classify gaps → sliced walk-back backfill) with progressive repaints as slices land. Venue REST remains the fallback/seed path; the Reload button forces a venue refetch (`preferDataset: false`).
- **DatasetStore** (`src/data/dataset-store.ts`): single source of truth for OHLCV datasets with pluggable persistence sinks — `session` (memory only), `local` (IndexedDB, default), `git` / `worker` (storage-plugin documents, debounced + retried, never blocking the chart). All consumers (chart loads, DSM jobs, live ticks, compare, CSV upload) read/write through it.
- **Dataset validation & repair** (`src/data/dataset-validate.ts`): `repairBars` drops corrupt rows, dedupes, sorts, and snaps individually off-phase bars to the series' dominant open-time phase (≥3 bars, ≥60% agreement — consistent venue offsets are preserved). `classifyGaps` splits gaps into **fillable** vs **legitimate** (weekend closures for session venues, declared maintenance windows) so the DSM stops chasing phantom gaps. `validateDataset` composes both into a report.
- **Dataset merge with conflict detection** (`src/data/merge-datasets.ts`): overlapping timestamps whose OHLCV disagree beyond a relative tolerance are conflicts, auto-resolved by policy (`newest-wins` default, `keep-current`, `prefer-incoming`); non-overlapping bars always union.
- **Settings → Data → Dataset persistence** main switch: `Session | Local | Git | Worker` (default Local), persisted as `store.datasetPersistence` and synced to the DatasetStore on boot/change.
- **Sliced-backfill progress chip** in the topbar Data group: live `loaded / expected` bar count while a DSM job completes the current dataset in the background.
### Fixed

- **DatasetStore reads** are memory-first and never wipe the mirror on a sink miss; switching persistence copies in-memory series into the new sink.
- **Git/Worker sinks** return pending bars from `get` (no empty merge during DSM walk-back), serialize per-key flushes so a retry cannot clobber a newer put, and write-through to IndexedDB as a durable front. `onSinkError` lands in system logs.
- **Progressive paint** no longer goes through `loadBars` (that re-fitted the viewport every slice). `paintDataset` is generation-guarded so a slower prior load cannot paint over a newer symbol.
- **DSM jobs** repair + `validateDataset` / fillable gaps (not raw `validateBarCoverage`); `ensureDatasetComplete` uses the source calendar class. In-flight jobs for the same key are reused; the progress chip counts bars in the target window.
### Changed

- **Topbar order**: the Venue picker moved to the front of the Market group (Venue → Symbol → Interval → Type → Compare) since it determines valid symbols/intervals; the Data group keeps plugin config, upload, datasets, Load, and Reload.
- **DSM job engine** reads and writes now route through the DatasetStore (session-mode safe, progressive repaints fire on every merged slice); `expand-cache` (cache→now + live ticks) and the Data Manager source do the same, with a repair pass on Data Manager resolves and CSV uploads.
- **Reload** shows the same loading spinner / `loadSeq` as Load.
### Tests

- `tests/dataset-validate.test.ts` — repair (corrupt rows, phase-aware snap, dedupe, sort), gap classification (24/7 vs session venues, maintenance windows), dataset reports.
- `tests/merge-datasets.test.ts` — conflict detection tolerance, merge policies, union/sort behavior.
- `tests/dataset-store.test.ts` — sink routing (session vs local), conflict-resolved merges, replace/remove, change subscription, persistence-mode switch.
- `tests/dataset-sinks.test.ts` — remote `get` returns pending bars before flush.
- `tests/integration/load-symbol.test.ts` — DSM-first cache paint without hitting the venue.

---

## [2.3.1] — 2026-09-05

### Fixed

- **Doctor**: missing gitignored `worker/wrangler.toml` is a warning until `axis setup`, not a hard fail.
- **Live badge**: show Reconnecting… / Offline while the websocket is down; one reconnect warning per disconnect burst.
- **Static PWA server**: `GET /health` is `ok` (not SPA HTML); OPTIONS 204; favicon served.
- **Versions**: product identity is 2.3.1 everywhere (About, Tauri, docs).
- **Desk / PYNE path**: sibling repo is `../pyne` (fallback `../pynescript`).
### Added

- Modest **Install app** chip on `beforeinstallprompt` (no nag).
- Quick Start defines SRC / STR / ENG / STO in plain language.

### Changed

- **Default editor width** is 30% of the viewport (was 50%) on first load and layout reset.
- **Default chart interval** is `15m` (was `1d`).
- **Timeframes**: topbar / settings / DSM / watchlist interval list now includes `3m`, `30m`, `2h`, `6h`, `8h`, `12h`, `3d`, and `1M` alongside the previous set.
- **Topbar Inputs**: removed the Inputs button and its Studio/Settings visibility toggle. Script inputs still open from the Scripts list, command palette, and the existing inputs modal.
## [2.3.0] — 2026-09-05

### Fixed

- **CI unit tests**: plugin bootstrap now re-registers after `registry.clear()` (catalog flags reset together). Store/runner tests reset `resultsFocusId` so `setLastRun` is not skipped. Data-manager selection is cleared in stream catalog tests. CI pins Bun `1.3.14` (`latest` was racing global store/registry). `bun test --max-concurrency=1` for deterministic unit runs. Worker origin URL helpers live in `src/data/worker-origin.ts` so `store` → HTTP client → market-worker → on-chain proxy no longer hits a TDZ on import.
### Changed

- **Repo description & tags**: GitHub / package / PWA / desktop copy no longer frames AXIS as “for Pine Script”. Tagline covers CEX OHLCV, drawings, on-chain overlays, and Pine Script™ via PYNE; extra GitHub topics and package keywords.
### Added

- **Per-tool drawing settings**: style bar grows context chips (extend L/R, show price, lock, custom color) plus a gear popover for fib levels, text/font size, risk/reward, arrow caps, and stats toggles. Last-used extras persist per kind in `drawingPrefs.byKind`. Paint honors extend flags, custom fib ratios (including reverse), highlighter width, long/short RR, and double-click text re-edit.
### Tests

- **Tool settings catalog** — `tests/tool-settings.test.ts`: every drawing kind has controls; ray/highlighter/long defaults; fib + RR helpers; normalize keeps `meta.fibLevels`.
- **Store `byKind` merge** — `setDrawingPrefs` deep-merges per tool without wiping siblings.

---

## [2.2.0] — 2026-09-04

### Added

- **Results → Raw JSON tree**: collapsible VOID-colored viewer (keys / strings / numbers / bools) with key filter, Expand / Collapse, and Tree | Source. Large `plots` / `series` arrays page in (32 at a time) so a full run does not mount thousands of nodes. Click a primitive to copy it. Footer Copy / JSON still export the full payload.
### Changed

- **Studio fullscreen canvas**: Runtime, Wire, Settings, Workers, and Plugins (plus nested tabs) now use the full overlay width instead of a reading-column cap. Wide layouts are two columns — Runtime (engine | endpoint), Settings General / Data / Topbar / Editor / Theme token grids, Workers inventory | inspector, Plugins catalog cards, Results strategy table. Legacy `sc-settings-*` chrome on Editor intelligence, exchange keys, and stacked plugin fields is replaced with studio `ax-*` primitives.
- **Theme color field**: Settings → Theme uses one `StudioColorInput` per token (swatch picker + text). Accepts hex, `rgb()` / `rgba()`, CSS names, and Pine `color.*` enums; the picker rewrites in the same form.
- **Editor color chips**: clicking an inline script color chip opens a native picker and replaces the source in the original form (`#hex`, `color.red`, `color.rgb`, `color.new`), keeping transparency.
- **Studio scroll**: nested panes, tables, code blocks, and library lists no longer scroll on their own. Only the modal canvas (`.ax-page-canvas`) scrolls.
- **Studio primitives**: status pills stay compact (no longer stretch full-width inside cards); Idle/Skipped/Degraded get the same pill chrome as Healthy/Down; cards, stats, inline buttons, and feature rows tightened. Same language applied across Runtime, Wire, Settings (all tabs), Plugins (catalog / install / library), Workers, and Results: capability badges are `ax-cap`, catalog rows are entity lists, chips-as-tags stay small, and compact `sc-*` chrome hosted in the overlay is scaled up to studio density.
- **Results overlay**: true fullscreen studio shell (`.ax-page-backdrop` + `.ax-page`, no dialog padding/blur). Header holds auto-open / script picker / saved-runs chip; Copy / JSON / CSV sit in the sticky footer. Canvas is the only scroller. Stacks above other studio pages (`z-index: 1050`) so a finished strategy is not trapped under Wire or Workers. Events, Strategy, Optimise, Plots, Metrics, Raw, and Saved use the same `ax-*` primitives as the rest of studio.
### Fixed

- **Strategy Saved-runs loop**: live silent re-runs (every-tick / bar-close) were calling `setLastRun` without `persistence: 'skip'`, so local `saveResult` wrote a new IndexedDB row about once a second. Durable save is now user-initiated Run only; deferred / skipped / superseded payloads never persist. Fire-and-forget saves are serialized so FIFO trim cannot race.
- **E2E smoke vs Studio overlay**: topbar Architecture / Runtime / Settings / Plugins hooks are `hidden` (Playwright no longer treats `sr-only` 1×1 clips as clickable, which hung behind the fullscreen button). Smoke, critical, and library journeys open those pages through the visible Studio button + rail (`axis-studio-rail-*`).
- **Editor false typo on `syminfo.mintick`**: pre-eval “unknown built-in member” only knew `syminfo.prefix` / `syminfo.ticker` from `pyne-builtins.json` (the two callables). Host variables (`mintick`, `tickerid`, `timezone`, `currency`, …) are now allowlisted with the other Pine constants, matching pyne’s implemented `syminfo.*` surface.
- **Market proxy (Worker)**: MEXC public REST is served through `/api/market/mexc/{klines,ticker/24hr,exchangeInfo}` because `api.mexc.com` does not send `Access-Control-Allow-Origin`. `fetchMexcJson` tries the Worker first and the direct host only as last-ditch fallback (offline lab, `skipWorkerProxy` tests, or Worker 5xx / network). Worker 4xx (allowlist / not found) is thrown immediately so the browser does not pay a CORS-blocked extra hop. Shared `resolveMarketWorkerBase` lives in `src/data/market-worker.ts` (re-exported from `binance-http.ts` / `mexc-http.ts`). Call sites: `watchlist-tickers.ts`, `sources/catalog.ts` (`mexcRest.fetchHistorical`), `symbol-catalog.ts` (exchangeInfo). Interval allowlist is AXIS TFs plus venue `1M` (`1h`→`60m`, `1w`→`1W`; no `1s`/`3m`/`2h`/`6h`/`8h`/`12h`/`3d`). `ticker/24hr` allowlists optional `symbol=` (single object, cached per symbol); there is no `symbols=` batch — omit the query for the full book. Watchlist uses per-symbol requests when the list is small (≤8), else the full book. No signed MEXC path yet.
### Tests

- **Run-result persist** — `tests/run-results-persist.test.ts`: `persistence: 'skip'` and ephemeral meta do not write Saved runs; interactive Run writes once; three silent `liveTick` re-runs do not append.
- **Studio / Results e2e** — `e2e/studio.ts` opens rail pages without clicking hidden topbar hooks; critical Results close uses `axis-results-close` because the fullscreen overlay covers the topbar toggle.
- **Pre-eval `syminfo.*` host vars** — `tests/preevaluate.test.ts`: `syminfo.mintick` / `tickerid` / `timezone` / `currency` are known; `syminfo.minitck` still suggests `mintick`.
- **MEXC client fetch order** — `tests/mexc-http.test.ts`: Worker first, `skipWorkerProxy` goes direct, abort does not try the next host, Worker 400 does not call `api.mexc.com`, Worker 5xx still falls through. Watchlist small-list `symbol=` vs full-book path.
- **MEXC Worker ticker `symbol=` + `1M`** — `worker/tests/market-proxy.test.ts`: optional `symbol=` forwarded and cached separately from the full book; `symbols=` rejected; native `1M` klines accepted.
- **Color rewrite helpers** — `tests/pine-colors.test.ts`: `formatPickedChipColor` keeps kind/transparency; `rewriteColorKeepingFormat` preserves hex / rgb / rgba / named.
- **JSON tree helpers** — `tests/studio-json.test.ts`: kind / preview / stats, expand-all skips huge arrays, filter does not walk 200-point plot series.

---

## [2.1.1] — 2026-08-29

### Fixed

- **CORS product-host list**: retired the legacy `*.pynescript.ai` branch from `PRODUCT_ORIGIN_RE` (worker `pickOrigin`) — production URL is `pynescript.online`, not `.ai`. The fallback default in `env.ALLOWED_ORIGIN` (and the inline fallback when none is configured) now also points at `https://pynescript.online`. Legacy `.ai` requests fall through to the allowlist fallback instead of being echoed. `isOAuthProxyBase` (git-oauth client proxy allowlist) drops the `.ai` check for symmetry. Docs (README, `docs/devops/cors-and-origins.mdx`, `docs/worker/bindings.mdx`, `docs/architecture/evaluation.mdx`, `docs/llm.txt`) updated.
### Tests

- **CORS regression**: `worker/tests/cors-origin.test.ts` adds a `does NOT echo the retired pynescript.ai product host` case that confirms `https://pynescript.ai` and `https://app.pynescript.ai` requests fall back to the configured `ALLOWED_ORIGIN` first entry (i.e. they're no longer auto-allowed as product hosts).

---

## [2.1.0] — 2026-08-29

### Added

- **Local storage: persisted run results**: `localStoragePlugin` now implements the optional `saveResult` / `loadResult` / `listResults` / `removeResult` methods so completed strategy/indicator runs can survive reloads. IndexedDB schema bumped from v1 → v2 — additive migration only, with a new `results` object store keyed by compound `[scriptId, runId]` and a `byScript` index on `meta.scriptId` for cheap per-script listing. FIFO trim keeps at most `MAX_RESULTS_PER_SCRIPT = 50` runs per script (oldest by `meta.startedAt` evicted; the just-saved run is always preserved). A `LOCAL_STORAGE_VERSION = 2` constant is exported for downstream schema detection, and the plugin now advertises `capabilities.results = true` so UI can render saved-runs affordances. localStorage JSON + in-memory `Map` fallbacks mirror the same semantics for SSR/tests (`pynescript.axis.results.v1` key + `_getMemResultsForTests` helper). Plugin contract extended in `src/plugins/types.ts` with a `results?: boolean` capability flag.
- **Storage change confirmation dialog**: new `StorageChangePrompt` (`src/ui/StorageChangePrompt.tsx`) is mounted once at the app root and hosts the existing `StorageChangeDialog` whenever the user switches storage engines. A new `promptStorageChange(oldId, newId)` helper in `src/storage/service.ts` is the single entry point — short-circuits silently when the engine is unchanged or unset (first-time set), and otherwise opens the dialog so the user can pick *Migrate scripts* or *Start fresh* before the active plugin flips. The migration itself still runs through the existing dialog (it calls `getStorage(fromId)` / `getStorage(toId)` directly so the active plugin stays pinned to the source until commit). All four storage-change call sites now route through it — `ScriptLibraryPanel` dropdown, `SettingsDialog` general tab Save, `PluginsPage` catalog activate, `PluginManager` modal activate — so there is exactly one shared dialog state, not four duplicated ones.
- **Per-panel icon in FloatableShell header**: `FloatableShell` now renders the panel-specific glyph next to the hamburger menu (testid `axis-panel-header-icon-{panelId}`), matching the Topbar panel toggle. Single source of truth is `PANEL_ICON: Record<PanelId, IconName>` in `src/ui/icon-map.ts`; TypeScript exhaustiveness guarantees every `PanelId` has an entry. Missing mappings fall back to the hamburger-only chrome without breaking the panel.
### Fixed

- **Status bar chip 1px hover wobble**: `ConnectionHud` chips (`ChipShell`, `TickPulse`, `LiveBadge`) no longer shift pixels on hover/active. Locked border-width to `border-[1px]` (Tailwind v4 `border` no longer relies on theme indirection), added `transition-none` to prevent any color flicker, and pre-applied the `ring-1` outline on `LiveBadge` so only the ring color animates between `ring-transparent` and `ring-accent` (no box-shadow structure delta). `.sc-btn-ghost` gained an explicit `box-sizing: border-box` (defensive — Tailwind v4 preflight already sets it on `*`).
- **Duplicate "Open in new tab" in editor dock menu**: the editor panel's dock menu showed both the generic DOCK_MENU "New tab" entry and an editor-specific "Open in new tab" entry passed via `menuExtra`. The `menuExtra` is now `undefined` (per the `FloatableShell` JSX usage in `EditorPane`), so the dock menu shows the generic "New tab" entry exactly once. The editor's own "Open in new tab" affordance lives only in the right-side `EditorOverflowMenu` (testid `axis-editor-btn-new-tab-overflow`), where it pops the editor out into a full browser tab instead of a docked window.
### Tests

- **Storage result round-trip + FIFO + fallback** — `tests/storage-local-results.test.ts` covers the new IndexedDB v2 `results` object store: add / load / list / remove, FIFO trim at `MAX_RESULTS_PER_SCRIPT = 50`, the `byScript` index, SSR fallback (`pynescript.axis.results.v1` + `_getMemResultsForTests`), and additive schema migration from v1.
- **Service façade + plugin opt-in** — `tests/storage-service-results.test.ts` exercises `saveRunResult` / `loadRunResult` / `listRunResults` / `removeRunResult` / `supportsRunResults` through the active plugin, including the local-only fallback when the active engine (git / cloud) doesn't implement the optional result methods.
- **Storage change prompt** — `tests/storage-change-prompt.test.ts` asserts the dialog is mounted exactly once at the app root, opens on engine change, and short-circuits silently when the engine is unchanged.
- **Editor menu dedupe** — `tests/editor-menu.test.ts` locks the regression: `EditorPane` no longer passes a `menuExtra` with a "New tab" entry, the dock menu still contains exactly one "New tab", and `EditorOverflowMenu` still owns the overflow "Open in new tab".
- **Panel header icon routing** — `tests/panel-icon.test.ts` verifies `PANEL_ICON` covers every `PanelId`, each value is a valid `IconName`, and `FloatableShell` reads `PANEL_ICON[props.id]` and emits the `axis-panel-header-icon-{panelId}` testid.

---

## [2.0.31] — 2026-08-28

### Changed

- **About modal**: removed ethos manifesto list and author section; added AXIS + PYNE version badges and brief no-walled-garden philosophy.
- **Studio consistency**: `ThemePanel` (Settings → Theme) now uses the studio `ax-*` primitives (`StudioSection`, `StudioField`, `StudioInput`, `StudioToggle`, `StudioChip`, `StudioButton`, `StudioHint`) instead of legacy `sc-settings-*` classes, matching Runtime / Wire / Workers / Plugins. Studio `--ax-*` tokens promoted to `:root` so shared panels render correctly outside the modal.
- **Theme color input**: each token uses a single color input (mono text field + non-interactive preview swatch) instead of a paired swatch picker and text box; number tokens use one number input.
- **Studio modal radius**: added a scoped `--radius-surface` token (8px inside `.ax-page`, defaulting to 3px elsewhere). Studio modal surfaces — `.ax-card`, `.ax-btn`, rail nav items, color preview, equity tooltip, HPO chart wrap, results auto-open toggle, and the Results error box — now use the higher radius. Chart/panel `<input>`/`<select>` and small chips/badges keep their existing 2–3px radius for hierarchy.
### Added

- **Results fullscreen studio modal**: replaced the docked Results panel (`FloatableShell`) with a focused fullscreen studio overlay (`ResultsModal`) opened via `store.resultsPanel.open`. Six restyled subpages — Events, Strategy, Optimise, Plots, Metrics, Raw — share one studio canvas (`ax-page` / `ax-*`) with `StudioStat`, `StudioTabs`, and `ax-list`/`ax-card` primitives. `StrategyReport` and `HpoPanel` rebuilt on studio classes (stat cards, equity card, ax-field controls, ax-list search space). Results auto-open only for `strategy()` scripts (indicators no longer auto-open).
- **Results auto-open setting**: new persisted `resultsAutoOpen` flag (default `true`) gates the strategy-only auto-open in the runner. A visible toggle sits at the top of the Results modal header ("Auto-open on strategies"); the same control is exposed in Settings → General ("Auto-open results on strategies"). Persisted via localStorage and hydrated on boot.
- **Strategy equity graph**: replaced the flat SVG line with a rich `EquityChart` — gradient area fill, zero baseline, gridlines with money-axis labels, underwater drawdown shading, and a hover crosshair + tooltip showing time, equity, and drawdown.
- **Results subpage polish**: Events list now shows colored type badges and long/short direction pills; Plots shows a sparkline card per series (positive/negative color); Optimise shows an in-sample / out-of-sample trial score chart with legend; Metrics shows a status pill plus derived stats (profit factor, max DD, plot points, script type).
- **Results full-width + 2-column subpages**: the Results modal canvas now uses the full studio width (`ax-page-canvas--wide`, no reading-column cap). Optimise uses a two-column split — search configuration + search space on the left, live study chart + trials table on the right. Strategy uses a two-column split — stats + equity curve on the left, closed-trades table on the right (stacks to one column under 64rem).
- **Topbar settings**: new 'Topbar' tab in Settings with toggles for each topbar group (brand, market, data, compute, layout, panels, system) and individual panel buttons (watchlist, editor, library, scripts, inputs, layers, DSM, on-chain, alerts, values, results, script logs, system logs, status). Settings are persisted via localStorage.
- **HPO (Optimise) polish**: the search config (trials, sampler, objective, validation, holdout/walk-forward sizes, min trades, and per-param bounds) now persists across reloads; the trial chart pins its x-axis to the trial index (IS/OOS lines no longer desync when trials error), marks the best trial, and shows the score scale; the results header gained a status chip, best IS/OOS scores, and a Clear button; categorical params show their choices and the search-space list has an empty state.
- **HPO tier gating**: added a persisted `tier` (`free` / `pro` / `self-hosted`) — the free tier disables walk-forward validation (shown as "(Pro)") with an upgrade hint, while Pro / Self-hosted show a tier badge and unlock it. The engine-runs cap was raised from 400 → 1000 so walk-forward fits within the trial ceiling.
### Fixed

- **Workers probe non-blocking**: initial backend probe deferred past first paint (double `requestAnimationFrame`) and a non-blocking "Probing backends…" hint shows while the first snapshot loads — the Workers panel is ready and interactive immediately, regardless of slow/failed probes.
- **Indicator engine correctness**: styled Pine plots (`histogram` / `area` / `columns` / `stepline` / `baseline` / `line` / `cross` / `circles`) were silently dropped because `splitSeriesByKind` only accepted `plot`/`hline` kinds — they now route to line plots (missing-kind and unknown-kind both default to line). Engine `status: 'success'` is no longer downgraded to error by a stray non-fatal `error`/`message` string. Series↔time-axis alignment is now derived from the exact bars the engine evaluated (passed through `getOhlcvTimesForApply`), fixing misaligned/blank newest bars on live ticks and HPO holdout slices. Explicit `overlay=true` is no longer auto-demoted to a sub-pane by the oscillator-scale heuristic. The `getOhlcvTimesForApply` cache is reused for the common `store.bars` case (the bypass path only applies to a genuinely different axis) and invalidates on a `store.bars` reference change.
- **Results panel dock cleanup**: removed the dead `results` panel from the dock registry (`PanelId`, `PANEL_META`, `PANEL_IDS`, `DOCK_STACK_ORDER`) so the bottom dock no longer reserves ~220px of empty space — Results is now a fullscreen modal driven solely by `resultsPanel.open`.
- **Input override no-op on chart**: changing a script input (e.g. RSI length 14→56) now repaints the whole series. `PaneManager.syncOverlayLines`/`syncOverlayOhlc`/`syncBgcolorBands` gained a `forceFull` owner option; `runAndApplyInner` passes `forceFull: opts.liveTick !== true` so interactive runs / input recomputes bypass the tip-only smart-apply (which only patched the last bar when length + last time were unchanged). Live ticks keep the fast path via `liveTick: true` in the multiplex re-run loop.
- **Wire page**: removed separate scrolling sections; now uses single-scroll ax-page-canvas pattern matching Runtime, Settings, Workers, and Plugins.
- **Settings polish**: consolidated duplicate `sc-settings-*` CSS into single definitions, added `sc-settings-section--plain` and `sc-settings-content--compact` variants to replace `!important` overrides, added `color-mix` fallback, `focus-visible` on color swatches, and `prefers-reduced-motion` guard; replaced `!mt-0 !border-t-0 !pt-0` with semantic variant and fixed ThemePanel compact gap override.
- **Workers probe**: fixed `requestAnimationFrame` leak — now cancels on unmount and removes dead `hasLoaded` signal; probe defers to next frame without blocking studio paint.
- **Vendor**: removed obsolete `pynescript-0.4.0/0.4.1` wheels (replaced by `hoox_pyne-0.4.2`).
## [2.0.30] — 2026-08-26

### Fixed

- **plot display= in compile mode**: `plot(..., display=display.data_window)` was not carried in `plot_meta` because the compiler didn't fold Pine `display.*` constants. Both axes now resolve `display.data_window`/`display.pane`/etc. to bitfield integers and pass them through to `plot_meta`.
- **Pyne wheel** — vendor `pynescript-0.4.2` (was 0.4.1). Compiler display folding + server compile-path backfill.
## [2.0.29] — 2026-08-26

### Changed

- **Engine default mode** — both Pro and Pyodide engines now default to `auto` (try compile, fall back to interpret) instead of `interpret`.
### Fixed

- **hline linestyle in compile mode**: server-side compile path did not include `linestyle`/`color`/`price` in `plot_meta` because `plot_attrs` is empty for hline/fill. Backfill from `__drawings` now fills missing visual attrs.
- **Pyne wheel** — vendor `pynescript-0.4.1` (was 0.4.0). Server compile-path backfill fix.
## [2.0.28] — 2026-08-26

### Fixed

- **hline linestyle in interpret mode**: the interpret path (Pyodide default) did not synthesize `plot_meta` from `__drawings`, so LWC price lines for `hline()` always rendered solid regardless of `linestyle=`. Both interpret and compile paths now synthesize `plot_meta` with kind/linestyle/color/price for hline, fill, and plotshape drawing types.
## [2.0.27] — 2026-08-26

### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.4.0` (was 0.3.7). Engine catalog, legacy JS engine, SW cache test, and editor builtins synced from pyne 0.4.0.
### Fixed

- **hline linestyle**: `hline(linestyle=hline.style_dashed)` rendered solid — the drawing path only checked `r.style` (never `r.linestyle`), and the compile-mode overlay path lacked `plot_meta` entirely so the LWC price-line never received the style. Both paths now covered: `pyne-drawings.ts` falls back to `r.linestyle`, and both Pyodide runtimes synthesize `plot_meta` from `__drawings` (hline/fill/plotshape kinds with linestyle, color, price).
- **multi-chart**: same indicator on every grid cell showed identical values — the runner evaluates Pine against `store.bars` (active plane), but focusing another slot never swapped in that slot's cached history, so every Run/add computed from whichever chart was loaded last. `setActiveChartSlot` now restores the focused slot's own bars (+ gen bump), stops stale bar replay, restarts live for the slot's market, and silently re-runs applied scripts so each chart shows its own values.
- **multi-chart**: switching to a 2×2 grid could overwrite the active chart with a sibling's symbol — ChartHost "prefetched" inactive slots via `loadSymbolData`, which always writes the active plane (last-mounted sibling won). Removed; empty cells load on focus instead.
- **tables**: render Pine `table.cell` `text_valign` (top/middle/bottom) and `text_size` tokens/numeric points in the table HUD — parsed previously but rendered fixed 10px/middle; defaults unchanged when absent.
- **bgcolor**: carry band titles into `syncBgcolorBands` and apply them as series titles on create/update, matching the offline `buildPlotVisuals` path.
## [2.0.26] — 2026-08-24

### Added

- **Pages security headers** — `public/_headers` ships the nginx/server.ts hardening baseline to Cloudflare Pages deploys (CSP with self scripts + `wasm-unsafe-eval` for Pyodide, https/wss connect, plus nosniff / referrer / frame-deny), so axis.hoox.sh gets enforced headers instead of only Page Shield's Report-Only placeholder.
- **Native MEXC CEX** — `mexc-rest` / `mexc-ws` as a built-in venue (public spot klines, no CCXT). Venue picker lists MEXC with Binance/OKX/Bybit; signed REST uses `X-MEXC-APIKEY`. MEXC was removed from the pinned CCXT shortlist.
### Fixed

- **`hline()` levels vanished once `bgcolor()` rendered** — `priceLineHost` picked the first non-overlay series, which after the bgcolor fix could be a `bgcolor_*` histogram living on its own hidden 0–1 price scale; hlines attached there mapped far off-viewport. Host selection now skips bgcolor underlays (TradingView paints backgrounds *behind* panes — they never host price lines).
- **`bgcolor()` / `barcolor()` drew nothing** — response normalization coerced every series sample through `Number()`, turning engine color arrays (`rgba(8, 153, 129, 0.298)` per bar) into all-`null`, so the histogram bands were filtered out before reaching the chart. CSS color samples now pass through normalization untouched (`coerceSeriesSample`); value plots still coerce as before.
- **Workers status chips stayed “Unknown”** — `StudioStatus` closed over the first `props.status` (`unknown` while probes ran). The CSS class updated (green/red dot) but the word did not. Label is now read from props on each render.
### Changed

- **Topbar Studio** — one **Studio** button replaces Wire, Runtime, and Settings. Those pages stay in the studio rail (and ⌘K). The button reopens the last studio page.
- **Wire recipe grid** — the hatch is a behind-layer at lower opacity. The right-edge fade no longer masks preset names.

- **PYNE Pro API origin is `https://pynescript.online`** — Hetzner VPS (nginx → gunicorn `:5002`). `axis.hoox.sh` is the Cloudflare Pages PWA, not same-origin with the API. Default Backend URL, Workers Manager probe, datafeed gateway, and Settings/Runtime presets follow the new origin; saved `axis.hoox.sh` / old VPS IP endpoints remap on load.
## [2.0.25] — 2026-08-23

### Fixed

- **Script Settings inputs no longer lose to editor defaults** — re-running an applied script from the editor keeps per-instance `inputValues` / strategy properties. Empty `{}` bags no longer wipe saved settings. Overrides persist only when they differ from the script default and are keyed by title, id, and LHS var name so the engine actually applies them.
### Changed

- **npm publish uses org secret `NPM_TOKEN_HOOXSH`** — `release.yml` no longer looks for a repo `NPM_TOKEN`. Root Bun tests ignore `packages/**` so `axis-cli` suites run only after `packages/cli` deps are installed. Authenticated skip detection treats an already-published version as success.
## [2.0.24] — 2026-08-23

### Added

- **Production-grade `@hoox-sh/axis-cli` 0.2.0** — first npm publish of the AXIS CLI. Node-compatible `dist/` + `npm i -g @hoox-sh/axis-cli`, AGPL `LICENSE` in the tarball, provenance on tag publish, CI coverage for `packages/cli`.
### Fixed

- **`plot(..., display=)` was ignored at apply time** — editor already knew `display.data_window` / `none` / `pane` / `price_scale` / `status_line` / `all`, but every series still painted on the pane and in the Data Window. AXIS now reads `plot_meta.display` (token or Pine bitfield): `none` hides everywhere, `data_window` keeps Data Window and skips the chart, `price_scale` / `status_line` gate last-value labels. PYNE packs `display=` on plot/hline/shape/fill/bgcolor.
- **E2E smoke vs studio pages** — Plugins is opened from the Runtime rail (topbar hook is sr-only). Wire Apply waits for an exact `Wire · Offline Lab` title so a drifted `Offline Lab +N` plan is not applied as Live Crypto.

- **`axis setup --remote-d1` skipped local D1** — `setup d1` treated `--remote` as exclusive of local even when `local: true` was passed, so bootstrap never applied the schema locally. `--remote` alone stays remote-only; `--local --remote` and `--remote-d1` apply both.
- **Worker `/health` probe accepted any HTTP 2xx** — `probeHealth` OR'd the JSON `status === "healthy"` check with `res.ok`, so a 200 HTML page counted as healthy. Requires a JSON `status` of `healthy` or `ok`.

- **Failed `axis deploy worker` ran wrangler deploy twice** — on inherit/quiet failure the CLI re-invoked deploy to capture stderr. Capture once, parse the workers.dev URL, never redeploy on error.
- **`--json` mixed human banners into stdout** — `--json` now implies `--quiet` so doctor/health/deploy emit parseable JSON only.

- **Docker GHCR version tags could skip on `v*`** — `docker.yml` path-filtered `push`, and GitHub applies that filter to tag pushes. Tag/main image builds no longer use a path filter (PRs still do).
- **Unknown `axis` commands dumped a generic wrapper error** — Commander help/version/unknown-command now exit with Commander's own code instead of `handleError`.
### Changed

- **npm release workflow** — pin Bun 1.3.14, `id-token: write` + `npm publish --provenance`, pack dry-run (LICENSE/dist/bin required), org secret `NPM_TOKEN_HOOXSH`. CI unit job now typechecks and tests `packages/cli`. Dead `@clack/prompts` dependency removed.
## [2.0.23] — 2026-08-23

### Changed

- **Drawings / plot parity plan** — `docs/architecture/drawings-parity.mdx` lists P0–P3 work: user-tool move/handles, Pine pane routing, PYNE export gaps (tables, fill meta, plotshape Y, OHLC).
### Fixed

- **Pre-eval treated `chart.fg_color` as a typo** — `pyne-builtins.json` only lists `chart.point.*` callables, so `chart.bg_color` / `chart.fg_color` (and the `color_background` / `color_foreground` aliases, plus viewport `left_visible_bar_time` / `right_visible_bar_time` / `is_standard`) were flagged “not a built-in member”. Allowlisted with the other Pine host constants.
- **1-point drawings did not body-move** — `shiftDrawing` only special-cased `text` / `priceLabel`. Note, flag, crossline, anchored text, and arrow marks now shift `p1` (and `points[]` when present). Third-anchor `p3` handles hit-test and resize.

- **Linefill GC was a no-op** — `garbageCollectScriptDrawings` ignored `skip.linefill` on the early-return. Overflowing linefill-only batches now trim oldest. Polyline/linefill copy `force_overlay`; polyline `fill_color` maps to fill.
- **`overlay=false` bgcolor/fill always hit the price pane** — bgcolor bands take `paneId`; fills use the script-pane drawing layer when the indicator is not overlay. Empty `drawings: []` clears script SVG even on silent live re-runs.

- **plotshape on oscillator panes** — `setShapeMarkers` takes a pane id; overlay=false scripts attach LWC markers to the first overlay series on `ind_*` instead of price candles. Trade markers stay on price.
- **Drawing tool settings** — Fill slider covers channel, triangle, gann boxes, ranges, highlighter; highlighter stroke no longer multiplies width ×6; horizontal ray places on one click; XABCD / head-and-shoulders commit on the 5th point.

- **Hide drawings hid only user tools** — the eye toggle now also clears Pine script SVG and `fill()` bands (every pane layer). `label.style_text_outline` paints outlined text; `yloc.abovebar` / `belowbar` sit 8px off the wick. First Add Indicator re-owns plotshape / fills / script drawings from `__editor__` to the script id. Histogram overlays honor `plot_meta.histbase` when the engine sends it.
## [2.0.22] — 2026-08-23

### Added

- **Topbar Venue picker** — Data group is now Venue (native CEX / pinned CCXT / CCXT… / local) instead of a raw source-plugin list. Picking Bitget (CCXT) writes `ccxt-rest`+`ccxt-ws` and both `exchange` bags together; `store.provider.id` is `ccxt:bitget`. Exchange ID stays on the topbar only for **CCXT…**. Stream remains hidden while paired.
- **CCXT symbol browse uses that exchange's markets** — with Source = CCXT (Gateway), the symbol modal loads `GET /markets?exchange=` and keeps unified `BTC/USDT` tickers (slash is no longer stripped). Stream is hidden on the topbar while it still matches the source pairing (Wire / HUD Fix if it drifts).

- **CCXT session API keys** — Settings → Data can store a key + secret (+ passphrase / uid) per CCXT exchange id (`ccxt:bybit`, …) in the RAM vault (never `pluginsConfig` / localStorage). Save POSTs `POST /datafeed/session`; Load/Live then pass only `cred=` on OHLCV/watch. Public candles still work without a key. Topbar shows an **API key** chip next to the CCXT exchange picker. Gateway `auto|pyne|sidecar` moved to Settings (advanced). Sidecar accepts `/ohlcv` and `/datafeed/ohlcv`. PYNE `POST /datafeed/session` accepts `apiKey`/`secret`/`password` in the JSON body.
- **npm release pipeline for the AXIS CLI** — `@hoox-sh/axis-cli` (`packages/cli`) is now publishable: dropped `"private"`, and a new `.github/workflows/release.yml` typechecks, tests, builds and publishes the package to npm on `v*` tags using an `NPM_TOKEN` repository secret. A registry-version guard skips cleanly when the version is already published (safe tag re-runs); run summary reports local vs registry versions.

- **"What's in this repo" section in README** — table mapping every part of the repo to its role and paths: app/PWA, datafeed pipeline, calc engines + Workers Manager, vendored Pyodide runtime, on-chain plane, Cloudflare Worker (API/WS/D1/KV/R2), allowlisted `/api/onchain` proxy, Tauri desktop shell, npm-published CLI, tests/ops.
- **Plugin config `advanced` fields + Settings section** — schema fields can now be marked `advanced` (API base URL, Bars, Synthesize on failure, …). They are hidden from the Topbar config row and rendered in Settings → "Source & stream plugins" with full descriptions, using the shared form classes.

- **Full unified ccxt exchange dropdown** — the Exchange ID select is fed by the gateway's complete ccxt exchange list (`/health` → new `ccxt_exchanges`, mirrors `ccxt.exchanges`; ~103 venues) instead of only the native adapters. PYNE side: `backend/api/datafeed.py` health payload extended accordingly.
### Changed

- **Studio full-page overlay** — Runtime, Wire, and Settings are no longer right-edge drawers. They share one full-viewport page (`src/ui/studio/`, `ax-*` classes) with a left rail, 16px type root, and large fields. Compact `sc-dialog` stays for Symbol / Script Settings / About / ⌘K.
- **Runtime uncoupled from Workers and Plugins** — Topbar **Runtime** is the active engine / endpoint / exec mode / health. Workers (backend inventory) and Plugins (contract catalog) are sibling pages from the rail, ⌘K, or Runtime cards — not tabs inside Runtime. Engine/endpoint/mode moved out of Settings → General; storage stays a Wire slot.

- **Workers studio restyle** — Backend inventory is a full `ax-*` studio page (`WorkersPage`): large health cards + inspector (probe features, numbered install steps, Use as calculation backend). No inner Overview/Detail/Install/Configure tabs and no `sc-btn` chrome. Engine writes go through `saveEngineConfig`. Open Plugins is a sibling cross-link, not a nested catalog.
- **Plugins studio restyle** — Contract catalog is a full `ax-*` studio page (`PluginsPage`), sibling of Runtime. Catalog / Install / Script Library stay as `StudioTabs` (e2e tab name **Catalog**). Kind chips, large rows with Use + capability badges, URL install + example cards, Script Library embed, active src/eng/stm/stor footer + Done. Open Workers and Open Wire are sibling cross-links. Close stays on the AppPage shell (`axis-plugins-close`); `axis-manager` stays on the dialog only.

- **Data tab no longer duplicates bar count or Binance API host** — how many bars to load lives only under General → Historical bars. Native CEX host URLs stay as fetch defaults (Binance already has host + Worker fallback). Gecko proxy/network, CCXT gateway, and synthesize-on-failure remain.
- **Docker release images tagged by version, not sha** — `docker-bake.hcl` release targets now push `pwa-v<VERSION>` / `pwa-nginx-v<VERSION>` (e.g. `ghcr.io/hoox-sh/axis:pwa-v2.0.21`) instead of `pwa-sha-<sha>`. The git SHA remains on the image as the `org.opencontainers.image.revision` label and build arg; workflow docs updated to match.
### Fixed

- **Plugin config row — first-save, apply, and exchange dropdown** — shared source/stream fields now (1) resolve a stored value from *any* target bag before falling back to a schema default (stream `exchange` is no longer hidden by a source default of `''`), (2) persist text/number keystrokes but only reload history on blur/Enter (selects/checkboxes still apply immediately), (3) treat the exchange control as a `<select>` only when the gateway list is actually populated, with a placeholder `Select exchange…` option and a free-text fallback when the fetch fails or returns empty, (4) cache the ccxt list per gateway mode, and (5) wire stacked-form `label for` to the control `id`. Gecko `baseUrl`/`network`, Coinbase granularity, and Mock Walk start price are Settings-only (`advanced`). Topbar Load no longer bails out while a previous fetch is in flight.
- **Pre-eval scanners close paired typographic quotes** — `“…”` / `‘…’` now close on the matching right quote (not only the same code point), so a pasted title string no longer marks the rest of the file as an unclosed string and block Run. Shared `isQuoteClose` in `pine-scan-util.ts`.

- **`array<string>` survived as `array` after Add types** — the declaration rewriter captured the collection token but dropped `<string>` when inserting a missing type1 qualifier. Generic args are preserved (`simple array<string> vals = …`).
- **Type methods and `export enum` missed as user bindings** — indented `method profit(this) =>` inside a `type` body and `export enum Name` now register as declared names (same as `export type`).

- **`const` (and line-leading keywords) colored inconsistently — green vs violet** — a float ending in a trailing dot (`2.`, `0.`) was split into number + lone `.`, leaving the tokenizer's `afterDot` state set at end-of-line. The state leaked across comments/blank lines, so the *next* code line's first word (`const`, `series`, …) rendered as a member property (green) instead of a keyword (violet accent). Number scanning now consumes trailing-dot floats and `afterDot` resets at every line start.
- **Pre-eval typo checker round 3 — validated against the real 2222-line grid strategy** — found via local reproduction on `grid.pine`: generic typed declarations (`var series array<string> TP1 = …`) were not parsed by the assignment regex, so TP1/SL1/TRL1-class vars were never registered as declared; library import coordinates (`import cryptolinx/String/1 as strx`) leaked into both the declaration collector and ident scanner (`String`/`Hoox` flags); and dotted method calls (`.init()`, `.show()`, `.abs()`) were treated as bare-call typos. All three fixed; checker now reports **0** typos on grid.pine, grid.2.pine.

- **Pre-eval typo checker round 2 — declaration coverage + copy-paste resilience** — remaining false positives addressed: `strategy(linktoseries=…)` whitelisted (pyne accepts arbitrary declaration kwargs); typographic/curly quotes (`“”‘’`) now treated as string delimiters in every scanner so pasted text no longer leaks as identifiers; `enum` members + enum/type names, `type` fields, and `for [i, v] in …` loop vars are collected as declared bindings; dotted-path roots (`Mode.SINGLE`) skipped by the ident scanner.
- **Pre-eval typo checker flooded false positives (~260 per script)** — pyne's LSP metadata only lists functions/namespaces, so the pre-eval linter treated core built-in series variables (`close`, `high`, `low`, `open`, `volume`, `ohlc4`, `hl2`…), type qualifiers (`simple`/`series`/`const`) and `text.align_*` / `text.wrap_*` constants as unknown identifiers and suggested nonsense ("Unknown `close` — did you mean `CROSS`?"). Added a curated `PINE_BUILTIN_VARS` supplement (OHLCV + derived, time/bar state, calendar parts) plus the missing `text.*` members to the known-path index; qualifiers also join the bare-call skip set. Regression tests cover the reported failure pattern (now zero typos).

- **Config row crash on first save** — `setField` wrote `pluginsConfig` through a deep Solid store path whose parent bag did not exist yet; solid-js/store does not auto-create intermediate nodes, so the first-ever config change threw `TypeError: can't access property "exchange"` and never persisted. Bag creation is now guarded (`writePluginField`), covered by regression tests and a browser e2e run.
- **Gateway select had no choices** — the ccxt `gateway` schema fields lacked `options`, so the dropdown rendered only its current value. `auto | pyne | sidecar` are now declared on both `ccxt-rest` and `ccxt-ws`.

- **Config row deduplication** — the Topbar renders one shared row for the union of active source/stream config fields (was: duplicated per picker); changes write through to all declaring plugins so ccxt-rest and ccxt-ws stay in sync.
- **Gateway loopback on remote pages (hardened VPS)** — `gatewayBase` resolved `pyne`/`auto` to `http://127.0.0.1:5002/datafeed` even when the page was served from a remote host, so browsers on `axis.hoox.sh` fired doomed cross-origin requests at the *visitor's* machine (CORS NetworkError). Remote pages now resolve to same-origin `/datafeed` on product hosts (nginx) or the product API origin cross-origin (Pages previews); loopback behavior is unchanged for local dev. Explicit endpoint overrides still win.

- **ccxt-ws `require()` actually removed** — v2.0.21 added the static `gatewayWs` import but left the shadowing CommonJS `require('../data/gateway')` call in place, so the browser bundle still threw on stream start. The `require` is now gone.
### Changed

- **Plugin config moved to Settings → Data** — the "Source & stream plugins" section (with the advanced fields) now lives in the Data tab above Exchange API keys, with a note that CCXT Gateway venues serve public market data and need no keys. Native-source keys (Binance/OKX/Bybit/Coinbase/Kraken) remain session-only in the browser vault and sign requests client-side.
- **Config row styled like the Source picker** — inline plugin config fields now render through `TopbarField` (integrated uppercase label, shared `axis-tb-field` chrome, focus-within ring), matching Symbol/Source/Interval exactly; the Settings variant keeps the dialog's stacked form classes.

- **Stream config pass-through** — `multiplex.startLive` now passes `store.pluginsConfig[stream:<id>]` into `stream.start({ config })`, matching the source path, so ccxt-ws receives the configured exchange id.
- **ccxt plugins: clear error for unconfigured exchange** — `ccxt-rest` / `ccxt-ws` no longer fire requests with an empty `exchange=` param; they surface "exchange id not configured" instead.
## [2.0.21] — 2026-08-21

### Fixed

- **ccxt-ws stream: `require()` in browser ESM** — replaced CommonJS `require('../data/gateway')` with a static import. The `require` call threw `ReferenceError` in the Vite browser bundle when activating the `ccxt-ws` stream (Bun tests masked it since Bun honors `require` in ESM).
- **ccxt-rest backfill window inversion** — `endTime` was forwarded as CCXT `since`, which pages *forward* from that timestamp, breaking the Data Source Manager walk-back contract (bars must end at/before `endTime`). Now derives `since = endTime − limit·timeframe` so each page covers `[endTime − limit·tf, endTime]` and gap-fill converges.
## [2.0.20] — 2026-08-21

### Added

- **Datafeed gateway transport** (`src/data/gateway.ts`) — resolves gateway URL (auto/pyne/sidecar/direct), probes sidecar health with 30s TTL cache, and provides `gatewayFetch`/`gatewayWs` helpers for plugins that route through the PYNE datafeed gateway or local sidecar.
- **ccxt-rest source plugin** — long-tail exchange OHLCV via the PYNE datafeed gateway or sidecar. Routes `ccxt:<exchange>` venues through `GET /datafeed/ohlcv`. Credentials stay server-side; browser never holds API keys.

- **ccxt-ws stream plugin** — real-time klines via the datafeed gateway WebSocket. Routes through `WS /datafeed/watch` with exchange+symbol+timeframe params.
- **Gateway-aware active resolution** — when provider gateway is not `direct` and the venue is a `ccxt:<exchange>` long-tail id, active source resolves to `ccxt-rest` and stream to `ccxt-ws`. Native venues (binance, okx, etc.) are never swapped.
## [2.0.19] — 2026-08-20

### Fixed

- **Hex color lint false positive** — pre-eval `scanIdentRefs` no longer treats hex color tails (e.g. `d3ee` in `#22d3ee`) as unknown identifiers. Scans backward past hex digits to detect the `#` prefix and skips the entire literal.
- **Pre-existing TypeScript errors** — resolved 23 type errors across 7 files: null barIndex guard, CSS `TextAlign` narrowing, `PineTable` camelCase property reads via `Record<string, unknown>`, `linefill` missing from `DrawingLimits` / drawing caps/counts/skip, `cancelled` status narrowed type assertions, `ParamValue` import + explicit typing, legacy `panelWindows`/`dockLayout` access on `AppState`.
### Changed

- **CI typecheck gate** — added `bunx tsc --noEmit` as a first step in the CI workflow (runs before unit + security tests). Added `typecheck` script to `package.json`.
## [2.0.18] — 2026-08-20

### Added

- **Provider session** — chart aggregators inherit a locked venue identity (`store.provider`: source + stream + market + auth mode). Source changes re-pair the live stream; HUD shows venue and a **Fix** chip when stream mismatches. Data Source Manager follows the chart source unless "different source" is checked.
- **`kraken-rest`** — public Kraken OHLC source, paired with `kraken-ws`.
- **Exchange API keys** — Settings → **Data** stores key/secret/passphrase in a **session vault** (RAM only). Saving a key for the active venue sets `provider.authMode = authenticated`. Secrets never go to localStorage, `pluginsConfig`, or error-share dumps.
- **Signed Binance klines** — with a vault key, history uses HMAC REST then the Worker `GET /api/market/binance/signed/klines` (request-scoped `X-Exchange-Key` / `X-Exchange-Secret`, not a Worker vault). Public allowlisted proxy is unchanged.
- **Venue HMAC signers** — thin Binance / OKX / Bybit / Coinbase / Kraken signers in `src/data/venues/` (no CCXT).
- **Test key** — Settings → Data **Test key** button verifies saved credentials with a signed 1-bar kline fetch. Shows success, 401/403 rejection, or CORS/network warnings.
- **ADR-016** — provider-locked market data architecture decision record.
- **SessionDO multi-venue** — Worker Durable Object relay now supports all 5 venues (Binance, OKX, Bybit, Coinbase, Kraken) via `venue` query param. Each venue's WS URL and subscribe message handled correctly. Browser → DO control messages accept `venue` for resubscribe.
- **Shared venue WS builders** — `src/streams/ws-venues.ts` provides `buildVenueWs()` for both browser-side StreamPlugins and the Worker DO. Single source of truth for URL patterns and subscribe messages.
- **`@hoox-sh/axis-datafeed`** — optional Bun sidecar (`packages/datafeed/`) using CCXT Pro for users who want local WS without running Flask. Mirrors the PYNE datafeed gateway contract: `GET /datafeed/ohlcv`, `GET /datafeed/markets`, `WS /datafeed/watch`, `POST /datafeed/session`. Run with `bun run dev:datafeed`.
### Fixed

- **Mixed-provider quotes** — watchlist no longer falls back to Binance tickers for Kraken (or unknown venues).
- **Coinbase live bars** — stream uses Advanced Trade venue candles folded into the chart interval, not ticker buckets.
- **Binance synthetic fallback** — `fallback` defaults **off**, so a network error cannot look like real prices.
## [2.0.17] — 2026-08-19

Visible pre-eval squiggles, Problems that drop on edit, and idle lint for named args and declared vars.

### Added

- **Named-arg typos** — idle lint flags unknown function/method parameters (`plot(..., coltor=color.green)` → `color=`) from curated signatures, builtin docs, and user-function parameter lists.
- **User-var typos** — assignment / `var` / tuple-unpack / function-parameter names are added to the typo map (declaration is source of truth), so `length = 14` then `lenght` suggests `length`.
### Fixed

- **Lint underlines** — pre-eval / error marks use a high-precedence squiggle (SVG + wavy underline + inset line), not CodeMirror `baseTheme`, so they stay visible against Tailwind. Empty decoration sets rebuild when underlines are on. The tab-switch effect no longer loops and cancel the idle lint timer, which left the buffer with Problems but no squiggles.
- **Stale Problems** — pre-eval rows drop as soon as the buffer diverges from the last linted source. Idle lint no longer stamps the live buffer onto old diagnostics, and rescheduling the same buffer does not wipe a completed lint (fixing a typo no longer leaves the old error in the list).
## [2.0.16] — 2026-08-19

Restore editor hover, lint underlines, and chips after a dead Settings bag and clipped hover cards.

### Fixed

- **Editor intel dead bag** — an all-off persisted Settings bag (checkbox mount / store-proxy spread) no longer disables hover, lint underlines, completions, and chips. Hydrate recovers defaults; user patches write `rev`.
- **Hover cards clipped** — Pine hover tooltips set `clip: false` so overflow-hidden editor chrome no longer hides cards on the first lines.
- **Hover hide-on-apply** — decoration / selection transactions no longer dismiss hover cards; only document edits do.
- **Editor hover catalog** — bare `close` / `new` no longer steal `strategy.close` / `array.new`. Hover facts win; completions still walk modules.
- **`display.pane`** — real Pine v5+ member is allowlisted (no more typo → `display.none`). Invented `math.isnan` / `math.isfinite` completions removed.
- **Editor intel timeouts** — Hover / Completion timeout settings now reach `/lsp/*` (were hardcoded).
- **Intel number fields** — clamp on blur / spinner, not every keystroke, so `1500` is typeable.
- **Diagnostic hover** — respects Show errors / warnings / typos / info flags.
- **Pre-eval flags apply live** — toggling lint generation immediately re-runs or clears marks.
- **Hide + tables** — `table.*` HUDs follow visibility; drawings / fills / `barcolor` are owner-scoped so hide with a sibling no longer leaves the hidden script’s artifacts.
- **Hide exclusive pane** — empty oscillator strip is destroyed; show recreates it.
- **`*br` primitives** — `destroyPane` detaches line-break primitives; attach failure is not cached; segments are cached and culled to the visible range.
- **Last-bar drawings** — script paint no longer grows `rightOffset` up to 500 bars for wall-clock `timenow` (one-bar `bar_index+1` still maps).
- **PYNE Agent seed** — same-origin plugin install no longer writes a hardcoded Worker URL; chat stays off until the operator sets the endpoint.
- **Unstamped last-run marks** — engine underlines drop unless `meta.axisSource` (or `script`) still matches the buffer.
### Improved

- **Hover facts** — `hl2` / `ohlc4` / `hlcc4` use midpoint / OHLC / HLCC wording (only `hlc3` is typical price).
- **`plotshape` / `plotchar`** — curated params include `format`, `precision`, `force_overlay`; `series` is `int/bool`.
- **Docs** — `areabr` is only on the broken-segment row; debugging mermaid includes pre-eval → Problems.
## [2.0.15] — 2026-08-19

Editor intelligence settings, Supertrend `linebr` gaps, live script hide/run, and PYNE Agent chat markdown.

### Added

- **Editor intelligence settings** — Settings → **Editor** (and command *Open Editor Settings*) exposes every lint / pre-eval / hover-card / signature-hint / autocomplete / underline / gutter / inline-chip option, plus idle / tab-switch / remote timeouts. Defaults match the previous hardcoded behavior; **Reset defaults** restores them.
- **Strategy chart trade size** — entry/exit markers print `Long N` / `Short N` (and exit id + qty) so the filled amount is visible on the chart, not only the order id.
- **Hide plot names on last-value labels** — Settings and chart **[T]** clear `RSI` / `Overbought` titles beside the last value; the numeric label stays. Independent of **[N]**.
### Improved

- **Pre-eval timings** — idle lint stays **1s** after the last keystroke (configurable 200–3000 ms). Tab switch uses a separate **200 ms** beat (was a hardcoded 120 ms). Remote `/lsp/diagnostics` wait is **2s** (configurable) and only starts after idle; local marks still publish immediately. Stale “2s idle” editor comment removed.
- **PYNE Agent chat markdown** — replies render headings, lists, and **bold** instead of raw `###` / `1. **Foo**`. Plugin default API endpoint is empty (set in plugin config); no hardcoded Worker URL.
- **Editor hover + param checklist** — mouseover covers keywords, types/qualifiers, series (`close` / `bar_index`), namespaces (`ta.`), user inputs/functions, and hex colors. Call hints list type + default; current param is emphasized (no strikethrough on used). Hover cards use a void-theme header, parameter definition list, and inset example.
- **Pre-eval / Problems / debug chips** — idle lint is 1s; `study()` and bare `security()` warn; duplicate `indicator()`/`strategy()` warn; Problems label **pre-eval** vs **run**; debug chips have higher contrast and truncate long logs.
- **Live scripts auto-run** — starting a stream immediately re-runs every **visible** script on the chart (no extra Run). Hide pauses execution and clears that script’s plots (series, markers, drawings, fills, `barcolor` when it is the last visible script); show re-runs it. `library()` sources stay out of the live / reapply loop.
- **Editor type highlighting** — `int` / `float` / `string` / … and declared UDTs / enums (`type Point`, `export enum Easing`, `m.Easing`) use the type token in **bold**. `series` / `simple` are bold only as type qualifiers; `m.SuperTrend(` stays a library member.
- **Strategy Properties wiring** — Apply persists only changed `strategy()` kwargs (so leverage is not overwritten by default margin %). Leverage ↔ margin UI no longer writes the auto-filled sibling into the bag. Editor Properties apply on isolate/HPO runs. Execution flags are documented as not implemented in PYNE.
### Fixed

- **`plot.style_linebr` / `steplinebr` / `areabr` on `na`** — Lightweight Charts Line/Area series drop whitespace points and connect the remaining samples, so Supertrend-style `bull ? st : na` plots drew a diagonal through inactive stretches. `*br` styles now hide the LWC connector and stroke each finite run (isolated samples stay a tick). `plot.style_line` still spans `na`.
- **Hide mid-run** — an in-flight live apply no longer paints after Hide; empty-bar `startLive` no longer logs `No bars loaded`.
- **Last-value names** — compare / on-chain titles survive **[T]**; volume stays number-only unless a title was set. Default `exactOnCandle` puts `Long N` on the side arrow, not the in-bar circle.
- **Isolate / HPO strategy bag** — explicit `strategyProps: {}` means no rewrite; isolate no longer merges leftover editor broker settings onto a baked study.
- **Last-bar / `varip` drawings** — `line.new` / `box.new` / polylines / linefills that extend one bar past the series (`bar_index + 1`) are no longer snapped to the last candle (that flattened them into a vertical tick). Labels still clamp `timenow` onto the last bar. Historical `varip` **plots** already render as a normal 1-sample-per-bar series (AXIS does not send `realtime_last_bar`; enabling it would reset last-bar `varip` cells under pyne’s current re-init).
- **Remote LSP cooldown** — aborting an in-flight `/lsp/*` request (typing, hover leave, pre-eval cancel) no longer starts the 30s failure cooldown, so idle parse diagnostics still reach pyne.
- **Editor Problems / underlines** — a clean pre-eval no longer wipes last-run runtime errors. Pre-eval and last-run marks are unioned while the buffer still matches the run source.
- **`plotshape` / `plotchar` / `plotarrow` `style=`** — completions offer `shape.*` instead of invalid `plot.style_*`.
- **Pre-eval block comments** — `"/*"` and `https://` inside strings are no longer treated as comments (which could block Run).
- **Inline debug line parse** — log values like `RSI: 55` no longer become a chip on line 55; structured `line` wins.
- **`color=` completions** — `color.new` / `color.rgb` / `color.from_gradient` stay in the list (including after `color=color.`).
### See also

- [Editor](docs/ui/editor.mdx)

## [2.0.14] — 2026-08-17

Strategy hyperparameter search in Results, isolated trial runs, and `/optimize` proxy wiring.

### Added

- **Hyperparameter Optimisation** — built-in component plugin (`hyperparameter-optimisation`) and Results → **Optimise** tab. Searches `strategy()` `input.*` values over N trials. Evaluation SoT is pyne `POST /optimize` (TPE / random / grid + holdout / walk-forward); Pyodide falls back to an isolated client loop. Apply winner **merges** into Script Inputs (unsearched fields stay). Strategies only.
- **`runScript({ isolate, bars, signal })`** — headless engine eval so HPO trials do not touch `lastRun`, the chart, or the engine HUD. Live multiplex defers while a study is running.
- Vite / Docker nginx **proxy `/optimize`** next to `/run` so same-origin VPS and `bun run dev` hit Flask.

### See also

- [Hyperparameter Optimisation](docs/enduser/guides/hyperparameter-optimisation.mdx)

## [2.0.13] — 2026-08-17

Call-parameter intelligence, richer Pine highlighting, script input enums, and Pine table lifecycle.

### Added

- **Call parameter intelligence** — hover on `plot` / `input.int` / `ta.sma` (and other curated calls) shows parameter docs + an example. After `,` inside a call, completions offer remaining named args (`title=`, `minval=`) in a **Parameters** section and already-used ones under **Already used**. A signature hint below the cursor lists every parameter and marks used / current / unused.
### Improved

- **Pine editor highlighting** — series builtins (`close`, `bar_index`, `time`, OHLC) use a cyan token distinct from user variables; `import … as` aliases and library export members (`m.Easing`) use a violet family; types get a warm token. New chrome vars `--color-cyan`, `--color-editor-builtin`, `--color-editor-lib`, `--color-editor-lib-member`, `--color-editor-type`.
### Fixed

- **Script Inputs enum values** — `input.enum(m.Easing.linear)` no longer shows the import/Python path as a text field. Members are inferred from `enum` declarations (local + imported library source), values normalize to `Type.member`, and the modal seeds from that script’s `runResults` (not another indicator’s `lastRun`).
- **Script display name** — applied scripts / pane badges always use the Pine `indicator()` / `strategy()` / `library()` title (not engine `"plot"` or a stale file name).
- **Pine tables after delete** — table HUD only shows tables from still-applied scripts’ `runResults` (orphans / `__editor__` leftovers no longer stick). First-run migrates run cache to the real script id; last-script delete clears script drawings.
- **Pine table layout** — grid size expands from cell extents when engine understates rows/columns; frame/border and cell align improved.
## [2.0.12] — 2026-08-17

Editor color chips + type declarations, chart label/marker lifecycle, topbar icon map, debug UX.

### Added

- **Editor inline color chips** — square swatches (line-height × line-height) before Pine color literals (`#hex`, `color.red`, `color.rgb(...)`, `color.new(...)`). Click selects the range.
- **Add type declarations** (editor overflow → Source) — after a successful first run, inserts missing Pine **type1** (`series` / `simple` / `const`) and **type2** (`int` / `float` / `bool` / `string` / `color` / …) on untyped assignments.
- **`ICON_MAP`** (`src/ui/icon-map.ts` + `Icons` in `icons.tsx`) — one Lucide glyph per product intent; topbar panel buttons each use a unique icon.
### Improved

- **Panel hamburger menu** — consistent 12px label / 14px icons; **New window** → **New tab**.
- **System Logs** — clear control uses trash icon instead of ×.
- **Topbar panels** — reordered List → Editor → Library → Scripts → Inputs → Layers → DSM → On-Chain → Alerts → Values → Results → Script Logs → System Logs → Status.
- **Inline debug / Chart pins** — overflow Debug items include full how-to on hover; toggle shows status-bar tips.
### Fixed

- **Duplicate last-value labels** on indicator panes (editor owner + real script id stacked series).
- **Strategy long/short labels** stayed after remove — trade markers are owner-scoped and cleared on detach.
- **Chart chrome** — removed top-right fullscreen / chart-only icon buttons (F11 / Shift+F / Esc still work).
- **Inline debug enable gate** — chips only when explicitly on; pin gutter class clears when empty.
## [2.0.11] — 2026-08-17

Chart script lifecycle, per-script indicator panes, pyne-worker engine, panel drag UX.

### Fixed

- **Panel title bar** — a plain click no longer undocks the panel to float; undock/move starts only after the pointer is dragged past a small threshold (hamburger still: click = menu, hold/drag = move).
- **Non-overlay indicators** — each `overlay=false` script gets its own sub-pane (`ind_<id>`) instead of stacking into a single shared `indicator` pane. Removing one script only clears that owner’s series and no longer destroys siblings’ full history (was left with 1–2 bars).
- **Chart scripts lifecycle** — add/remove/reopen stays correct: owner-scoped detach (no leftover series/empty panes), ChartHost no longer wipes re-applied scripts after history paint, centralized `reapplyChartScripts` restores visible scripts (with saved inputs/strategy props) after symbol load / cache paint; applied scripts are sanitized on hydrate and re-run on reopen.
### Added

- **Engine `pyne-worker`** — built-in edge evaluator plugin (default `https://pyne-worker.cryptolinx.workers.dev`), API key field, Workers Manager / Settings presets. Distinct from AXIS data-plane Worker and Flask `server`.
## [2.0.10] — 2026-08-16

Market data resilience, Script Settings input layout, and local-first editor LSP.

### Improved

- **Script Settings → Inputs formatting** — Pine `group`, `inline`, `tooltip` (`\\n`), and `active` / `active=<ident>` layout in the modal (TV Settings-style sections, same-line clusters, `?` help, grayed inactive fields). `input.text_area` uses a multi-line control.
- **Editor LSP hover + autocomplete** — local builtins/doc annotations show **immediately** (no wait on a dead Backend URL); remote Pro API is short-timeout + 30s cooldown after failure. **⌘/Ctrl-Space** triggers completion; tooltip z-index raised so hover/suggest stay above chart chrome.
### Fixed

- **Browser market data / plugins (CORS “status null”)** — when the page cannot reach venue hosts or remote plugin modules (geo, firewall, port 9443, extensions), AXIS no longer hard-depends on a single cross-origin path:
  - **Binance REST** tries `api.binance.com` → `data-api.binance.vision`, then the Worker allowlisted proxy `GET /api/market/binance/{klines,ticker/24hr,exchangeInfo}`.
  - **Binance WS** rotates `stream.binance.com:9443` → `:443` → default 443 → `data-stream.binance.vision`.
  - **PYNE Agent plugin** ships same-origin at `/plugins/axis-pine-agent.js` (legacy remote URL migrates on restore); agent API endpoint still defaults to the pyne-agent Worker.
  - **Service worker** navigation never rejects `respondWith` (offline shell HTML); cache version **v5**.

### Added

- **Worker market proxy** — `worker/src/market.ts` public allowlist for Binance klines / 24hr ticker / exchangeInfo (short isolate cache; not an open reverse proxy).
## [2.0.9] — 2026-08-15

Editor symbol catalog, richer Pine highlighting, CORS for Pages previews, and CI greens.

### Added

- **Editor symbol & emoji manager** — status-bar **Symbols** catalog of TV-editor-safe arrows, box drawing, blocks, marks, spaces, and chart emoji (IBM Plex Mono vs wide). Insert raw, quoted, or `plotchar(…)`.
### Improved

- **Pine highlighting** — stateful multiline strings + `/* */` blocks, `\\n` / hex-color atoms, namespaces (`ta.`, `label.new`), types, control vs definition keywords, function names before `(`.
- **Format** — leaves continuation lines of an unclosed string or block comment untouched.
### Fixed

- **CORS** — Cloudflare Pages previews (`*.pynescript-axis.pages.dev`) can call `https://axis.hoox.sh`. Pyne always allowlists those product Origins and treats `GET /health` as a free CORS path (AXIS Settings probe). Worker `pickOrigin` already echoed the same hosts.
- **CI** — library publish stays on the local cache when leftover/invalid git credentials fail remote (was `GitHub: Bad credentials` in the full unit suite). Smoke waits on `axis-status-message` and opens Plugins via Runtimes. Vite build on macOS/Windows resolves Solid `Topbar.tsx` / `Watchlist.tsx` instead of same-stem legacy JS. Docker push uses the `release` bake group (no `:local` docker.io tags) and bake-action v6 env overrides.
### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.3.7` (`Runtime.run(libraries=)` for `import ns/Name/ver`, ring-series skip, runtime hot path). Engine catalog, legacy JS engine, SW cache test, and editor builtins synced from pyne 0.3.7.
## [2.0.8] — 2026-08-15

Architecture modal, library publish emulator, drawings/plot parity, and the post-2.0.7 hardening stack.

### Changed

- **Pyodide PYNE wheel** — vendor `pynescript-0.3.6` (UDT `array.binary_search*` `sort_field`, drawing export/delete/fold). Engine catalog, legacy JS engine, SW cache test, and editor builtin metadata synced from pyne 0.3.6.
### Added

- **Library publish emulator** — `library()` scripts publish to git `{basePath}/published/{ns}/{Name}/{1,2,3…}/lib.pyne` (plus local cache). Library panel **Publish library**, or auto-publish on a successful Run. Consumers `import ns/Name/ver`; AXIS resolves the folder and sends sources to the engine (`register_library_source`).
- **Architecture modal** — topbar **Wire** (and command palette **Open Architecture**) opens a compose-recipe dialog: pick Offline Lab / Live Crypto / CSV Desk / On-Chain / Team Cloud, then swap or switch off any source · stream · engine · storage · dataset slot. Plan name records drift (`Live Crypto +1 −1`); Apply commits `setActivePlugin` + optional on-chain panel.
- **Pine `label` styles / yloc** — normalize passes through `style`, `yloc`, `size`/`text_size`, `textcolor`, and `color`; SVG paint supports `label.style_label_up|down|left|right|center` (and bare tokens), bubble tips, icon markers (`xcross`, triangles, …), and `yloc.abovebar` / `yloc.belowbar` when OHLC bars are available (default `yloc.price` + bubble for unknown styles).
- **About AXIS modal** — click the topbar HOOX/AXIS brand (or command palette **About AXIS** / Help → About) for product, author, and HOOX ethos from [hoox.sh/manifesto](https://hoox.sh/manifesto), with links to AXIS / PYNE / docs.
- **Script settings → Properties** — when a `strategy()` is loaded, a **Properties** tab exposes broker parameters (initial capital, order size / pyramiding, commission, leverage / margin, process orders on close, calc flags). Overrides persist per script and are merged into `strategy()` on run without rewriting the editor buffer.
- **`linefill.new` paint** — normalize + SVG quad fill between two lines (pairs with pyne `export_for_api` linefill serialization).
- **`barcolor()`** — per-bar candle body/wick tint from `kind: barcolor` series (LWC color fields).
- **plotshape multi-script** — shape markers are owner-scoped by script id so one run does not wipe another script’s shapes.
- **Non-overlay drawings** — `overlay=false` scripts paint geometry on the indicator pane Y-scale; `force_overlay` still routes to price.
- **Compile `line.set_*`** — pyne folds set events onto handles before export (final geometry for AXIS).
### Improved

- **Editor default width** — factory / layout-reset docked editor width is **50vw** (was fixed 460px); existing persisted widths unchanged.
- **Editor gutters on demand** — line-number column stays content-width (digits only; overrides CM 20px min); diagnostic + inline-debug gutters hide until they have markers (profiler-style).
- **Modal focus trap** — shared `installFocusTrap` cycles Tab inside Settings / About and restores prior focus on close.
- **Chart a11y region** — ChartHost exposes `role="region"` with symbol/interval/bar-count label; load success/error uses polite/assertive SR announcer.
- **Session DO stream sanitize** — symbol `^[A-Z0-9]{1,20}$` + Binance interval allowlist before upstream WS URL is built.
- **Prod plugin remote allowlist** — production builds default-deny remote plugin hosts (same-origin `/plugins/*` + `data:` + allowlisted PYNE Agent host); override with `VITE_ALLOW_REMOTE_PLUGINS` / `VITE_PLUGIN_REMOTE_ALLOW`.
- **Plot fill apply** — skip SVG rebuild when fill fingerprint matches; pan/zoom paint uses visible-range cull + pixel-budget stride on dense bands.
- **Runner OHLCV times cache** — live re-apply reuses the times axis when `chartDataGen` + length + last time are unchanged (open-bar ticks).
- **Webhook URL policy** — https-only, no credentials, reject loopback/private IP literals; 8s AbortController timeout.
- **Presentation Escape** — detect AXIS modals via `[role=dialog][aria-modal=true]` (not only native `<dialog open>`).
- **CSP baseline** — nginx + Bun static server send Content-Security-Policy (self scripts, wasm-unsafe-eval, https/wss connect, frame-ancestors self).
- **First-paint bundle** — chart PWA critical path no longer statically imports CodeMirror/editor or `@tauri-apps/*`: `index.tsx` dynamic-imports App vs EditorApp; `EditorPane` is Solid `lazy` + `Show` when docked editor is open; Tauri shell install is dynamic-imported after a lightweight `isTauriShell` check.
- **Multi-chart slot bars reactive** — `chart-registry` stores per-slot `bars` / `chartDataGen` in a Solid store so inactive ChartHost slots re-paint when those paths change.
- **PWA SW update UX** — stop blind `SKIP_WAITING` without a reload path; post skip-waiting only when activating a waiting update, and soft-reload once on `controllerchange` (refreshing guard) so mixed old/new modules never stick. Still skips DEV and Tauri.
- **Heavy live re-runs** — at ≥10k bars, `every-tick` indicator re-runs are treated as `bar-close` so full OHLCV is not re-encoded for the engine on every open-bar tick (`effectiveLiveRerunMode`).
- **Offline history fallback** — when venue/source fetch fails, `loadSymbolData` paints warm `bars-cache` series and reports `Offline · N cached bars` (telemetry `degraded`).
- **SW runtime cache cap** — `axis-runtime-v4` soft-caps at 96 entries (FIFO trim after put); version bump clears prior unbounded `v3` runtime caches.
- **Watchlist quote batching** — multi-symbol WS ticks coalesce to one Solid price-map write per animation frame.
- **Live tick rAF coalesce** — multiplex keeps only the newest bar until the next animation frame so trade-ticker floods (Coinbase) do not thrash store + LWC every message.
- **Pane resize coalescing** — `PaneManager` ResizeObserver callbacks flush once per rAF (was synchronous `applyOptions` per pane entry).
- **Smart series apply fingerprint** — overlay tip no-op when length + last time **and** last value match (skips redundant LWC `update` on silent re-runs).
- **Overlay tip-only re-apply** — silent live `syncOverlayLines` updates the last point without a full `toLwcLineData` map when prior meta length + lastTime match (falls back to full setData on length/time change).
- **StatusBar / Results strategy reports** — no longer rebuild trade pairing on every live `store.bars` path update; depend on `lastRun` / `chartDataGen` / fill-mode prefs.
- **`loadBars` batching** — multi-field store writes run inside Solid `batch()` for a single reactive flush.
- **Vite critical path** — `modulePreload` drops CodeMirror / pyne-builtins from first paint; gzip enabled on Docker nginx; `X-Frame-Options: DENY`.
- **OHLCV bulk paint hardening** — `mapBarsToPriceData` / volume mapper drop non-finite rows so one NaN bar cannot blank LWC series.
- **Plot styles** — distinct series kinds for `plot.style_columns` (vs histogram), `plot.style_cross` (discrete markers, no connector), and `plot.style_stepline_diamond` (stepline + vertex markers). plotshape diamond/cross map to square marks with optional `+`/`✕` glyphs. LWC still lacks column-width and native diamond/cross point markers — documented in charting docs.
- **`line.style_arrow_*`** — script lines paint SVG arrow heads for `arrow_left` / `arrow_right` / `arrow_both` (were solid stroke only).
### Fixed

- **Editor Problems panel close** — auto-open only when diagnostic count *increases*; no longer re-forces open on every pre-eval/store tick while problems remain (statusbar toggle can stay closed).
- **Worker `/api/run` auth fail-closed** — when `EXTERNAL_BACKEND` is non-empty or `PYODIDE_IN_WORKER=enabled` and `ALLOW_OPEN_KEYS` is not `"1"`, `POST /api/run` requires `requireApiKey` (also still forced by `API_KEYS` / `REQUIRE_RUN_AUTH`); local demos keep open keys without burning unauthenticated compute on a real backend.
- **Script-only drawing layer leak** — `clearScriptPaneLayers()` on ChartHost unmount (RO + time-scale subs were retained after multi-chart dispose).
- **Companion panel postMessage** — origin-bound target + receiver check (no more `*`).
- **Legacy results event CSS class** — allowlist kind tokens before interpolating into `class` (attribute breakout).
- **ResizeHandle multi-touch** — ignore non-primary pointer ids mid-drag.
- **bars-cache IDB integrity** — `pagehide` / `beforeunload` flush pending debounced puts.
### Tests

- **CI workflow** — `.github/workflows/ci.yml` runs `bun run test`, `test:security`, and Playwright `@smoke` (Chromium) on PR / main.
- **Optional firehose bench** — `tests/bench/` (`AXIS_BENCH=1` / `bun run test:bench`): 500k `appendBar` ticks on ~50k history with soft wall budget; skipped by default.
- **Drawings / plot-visuals** — unit coverage for `force_overlay` normalize, `linefill` edge cases, `barcolorSeriesToMap` / `coerceBarColor`, and GC with `linefill` present.
- **plot-visuals** — columns / cross / stepline_diamond kind mapping, histogram-family helpers, diamond/cross shape + glyph defaults.
- **chart-type / heavy-data** — non-finite OHLC filter on price + volume mappers.
- **store-append-scale** — always-on `appendBar` same-time + cap invariants.
- **multiplex-heavy-rerun / sw-strategy / load-symbol** — heavy re-run mode, runtime cache FIFO cap, offline bars-cache fallback.
- **register-sw** — pure update helpers (`shouldSoftReloadOnControllerChange`, skip-waiting) + controllerchange single-reload mocks.
- **security / runner / fills** — remote plugin prod allowlist, webhook URL policy, OHLCV times cache, plot fill signature.
## [2.0.7] — 2026-08-12

Pine drawings diagnostics and plotarrow direction; pairs with pyne 0.3.5 last-bar line export.

### Fixed

- **`line.new` / drawings apply** — prefer DrawingLayer fallback when applying Pine drawings; warn when the engine returns drawings that normalize to zero or when no layer is mounted (load bars first).
- **`plotarrow`** — negative series samples render as down arrows (were always up).
## [2.0.6] — 2026-08-12

Test suite isolation and store hydrate defaults hardening.

### Fixed

- **Tests** — isolate store/state defaults across suites; strategy-extra uses event prices (not bar fills); engine `isReady` mock returns JSON health; hydrate never restores plane telemetry from disk.
- **Store seed** — createStore no longer aliases nested `DEFAULTS` objects (telemetry/panels/live), so path updates cannot poison factory defaults.
## [2.0.5] — 2026-08-12

Panel manager defaults / reset / chart overlay; classic Status + System Logs chrome; editor open-in-new-tab.

### Added

- **Panel manager** — per-panel **default position** (dock + size + float coords in `PANEL_META`); panel menu **Reset to default**.
- **Chart overlay** — per-panel toggle and bulk **Chart overlay: all on/off** (`setAllPanelsChartOverlay`); edge-docked panels float over the chart without shrinking it.
- **Editor** — **Open in new tab** in overflow panel options (and left dock menu).
### Changed

- **Status bar** — restored classic fixed footer look (no panel title chrome).
- **System Logs** — restored classic collapsible strip (expand/collapse body); topbar shows/hides the strip. Label **System Logs** (not bare “Logs”).
## [2.0.4] — 2026-08-11

Script Logs / System Logs naming and Status / System Logs topbar toggles.

### Changed

- **Script Logs / System Logs** — Script `log.*` pane titled **Script Logs** (editor tool + panel); app telemetry titled **System Logs**.
- **Status & System Logs** — topbar toggles for **Script Logs**, **System Logs**, **Status**.
## [2.0.3] — 2026-08-11

Runtimes hub, editor save-before-run / idle lint, Workers Manager reliability, and hardened VPS probe routing.

### Fixed

- **Workers Manager endless probing** — open-effect no longer tracks `store.endpoint` (backend changes re-fired probes); every probe gets a hard timeout merged with the modal abort; Pyodide probe uses HEAD instead of downloading full `pyodide.js`; `probeAllWorkers` uses `allSettled`.
- **Workers Manager / hardened VPS** — pyne Pro probes use same-origin `https://axis.hoox.sh/health` (nginx → loopback :5002) instead of client `127.0.0.1:5002`, which UFW correctly blocks on the public VPS.
### Changed

- **Runtimes hub** — single dialog for **Status** (Workers Manager) and **Plugins** (catalog / install / library); topbar **Runtimes** entry; cross-links between sections; models remain separate.
- **Save before Run** — clicking Run (editor header, topbar split, Mod-Enter, command palette) auto-saves the active script to the library when the tab is dirty or not yet bound (`libraryId`). Save failure blocks the run.
- **Idle lint** — editor underlines (e.g. `plt()` → unknown) reappear after **2s** without typing, not only after Save/Run. Mid-keystroke marks stay cleared; bare call typos like `plt()` flagged locally.
- **Workers Manager UX** — distinct icon per catalog worker; **Usage / When to use** copy on Detail + Install; docs updated.
- **Editor line numbers** — gutter width follows digit count only (no fixed min-width / heavy padding).
## [2.0.2] — 2026-08-11

Editor chrome polish and docked panel **hover slide**.

### Added

- **Panel hover slide** — docked panels can collapse to a peek strip and slide open/closed on pointer enter/leave. Toggle **Slide on hover** in the panel hamburger menu (left/right/bottom only). Store APIs: `setPanelHoverSlide`, `togglePanelHoverSlide`, `isPanelHoverSlide`. Preference persists on `panelChrome[id].hoverSlide`.
### Changed

- **Editor chrome polish** — header tools always show **icon + label** (no hover slide-in); **Format** removed from the editor header and tab strip (still available via overflow **Format document** and `Shift+Alt+F` / `Mod+Shift+F`).
- **Library from editor** — primary **Library** tool opens the script library panel; overflow menu also has **Open library**.
### Fixed

- **Tab close / switch** — closing a tab left of the active one no longer jumps focus; CM buffer is snapshotted before add/close/switch; `setDoc` no-ops on identical content.
## [2.0.1] — 2026-08-11

Security and performance release from the multi-agent **harden-perf** audit
(4 specialist scanners + synthesis). Report: `docs/devops/harden-perf-audit-2026-08-11.md`.

### Security

- Fail-closed Worker auth when D1 is bound without `API_KEYS` KV (`API_KEYS_REQUIRED`).
- CORS: product hosts + project-scoped `*.pynescript-axis.pages.dev` only (no open `*.pages.dev`).
- `/api/run`: auth when `API_KEYS` or `REQUIRE_RUN_AUTH`; per-IP/key rate limit (30/min); script/bars size caps; upstream proxy timeout.
- Git OAuth: env `GITHUB_OAUTH_CLIENT_ID` / `GITLAB_OAUTH_CLIENT_ID` wins over body `clientId`; tighter start/poll rate limits.
- Watchlist: build rows with `textContent` (no unescaped symbol `innerHTML`).

### Performance & reliability

- bars-cache: memory-first `getCachedBars`, IDB hydrate, `getCachedBarCount` / range without full clone when warm.
- DSM gap-fill progress uses `getCachedBarCount` instead of full series loads.
- engine-ws: 45s dead cool-down — keep dead client so live re-runs do not thrash reconnects.

### Commits

- `0a668e00` — fix(security,perf): gate /api/run, OAuth clientId, WS cool-down
- `156221b9` — fix(security,perf): fail-closed Worker auth, CORS, bars-cache


---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

---

## Full history (recursive)

### 2026-10 (158 commits)

#### Features

- `10b88f78` (2026-10-19) — feat(ci): GitHub Release notes from CHANGELOG version section
- `6efb6967` (2026-10-19) — feat(chart): topbar market select for spot vs USDT-M / COIN-M
- `0984b889` (2026-10-17) — feat(mcp): live-plane capabilities — chart.lag/bars, engine.*, stream.*
- `5be393e1` (2026-10-16) — feat(engine): three-tier close verification with strength surfacing (F-28)
- `490051fe` (2026-10-16) — feat(engine): engine-owned stream data plane (F-01–F-20)
- `035d9659` (2026-10-16) — feat(maintenance): build-time maintenance mode page (VITE_MAINTENANCE_MODE)
- `6427387c` (2026-10-16) — feat(engine): delta envelopes for session ticks with merge + fallback
- `7684ff8d` (2026-10-14) — feat(engine): PYNE endpoint parity — health, prewarm, batch, sessions, Pro, runner
- `dc5402b4` (2026-10-13) — feat(engine): wire every-tick Pro mode through runner, chart, and live ticks
- `4091d4cf` (2026-10-13) — feat(theme): sync community presets to OpenCode palettes
- `1f5b299e` (2026-10-13) — feat(engine): skip local OHLCV persistence in engine-owned live mode
- `d6a1f701` (2026-10-13) — feat(engine): engine-owned data sessions and capability-driven live modes
- `49e1f7be` (2026-10-13) — feat(theme): vendor 24 community chart presets (hoox-themes)
- `db0ec11e` (2026-10-13) — feat(engine): O(delta) live ticks via PYNE live sessions
- `160df5c3` (2026-10-13) — feat(data): dataset depth vs chart window split, reload page walk, interactive status bar
- `6a2ec9e5` (2026-10-13) — feat(data): rolling window for engine input, and dataset size in the status strip
- `16ec9fc4` (2026-10-12) — feat(cli): axis setup artifacts for git-native script storage
- `dc2f1eb1` (2026-10-12) — feat(worker): git-native script storage on Cloudflare Artifacts
- `1bd573b4` (2026-10-12) — feat(storybook): button design explorations, shapes, microfeedback
- `8b587834` (2026-10-10) — feat(release): AXIS v2.22.0 — chart settings panel, review fix batch, hardening
- `18d589fc` (2026-10-09) — feat(edge): live tenant verify + usage flush
- `cc1e1b34` (2026-10-09) — feat(entitlements): tenant scope types + bearer classification (no enforcement)
- `fa15352b` (2026-10-08) — feat(chart): pine tables in bottom panel (September 2026 parity)
- `5ab80821` (2026-10-06) — feat(ui): ticker band controls, drag handle, and menu polish
- `3dbeacfb` (2026-10-06) — feat(ui): smooth clean snappy panel open
- `102d7542` (2026-10-05) — feat(extras): float-only time + price panels under topbar
- `aa66af89` (2026-10-04) — feat(watchlist,extras): big-price rows + ticker direction/change options
- `1d63aabd` (2026-10-04) — feat(extras): polish Extra menu + harden quote sheet
- `92fdb90b` (2026-10-03) — feat(extras): Quote dock panel with full quote sheet
- `5c5f0b51` (2026-10-03) — feat(extras): fullscreen alert overlay + styles
- `ea7139be` (2026-10-03) — feat(extras): watchlist ticker marquee band
- `f04c1d20` (2026-10-03) — feat(extras): current-price trend card overlay
- `095576c0` (2026-10-03) — feat(extras): Extra menu + module-bar button after Results
- `e4dd2867` (2026-10-03) — feat(alerts): subscribeFiredAlerts broadcast for UI overlays
- `e8ede505` (2026-10-03) — feat(extras): trendOverTicks helper for price-card arrow
- `704e770d` (2026-10-03) — feat(extras): persisted extras slice + panelsExtra topbar flag
- `f3d2133d` (2026-10-02) — feat(licensing): add Commercial (EUR 349) + Pro SaaS plans

#### Fixes

- `453258f9` (2026-10-20) — fix(stream): subscribe scripts with the chart window and their inputs
- `cf66630c` (2026-10-20) — fix(chart): keep every painted series on the candle axis
- `7fe4de9e` (2026-10-20) — fix(test): reset the shared singletons the suite leaks between files
- `a6592d2a` (2026-10-20) — fix(data): drop a dataset repaint that would paint over a moved-on chart
- `366bb039` (2026-10-20) — fix(test): restore the shared store after the chart-window test files
- `2fb50d41` (2026-10-20) — fix(chart): re-join cross-indicator series by time, and close the apply gaps
- `e08cf3c8` (2026-10-20) — fix(chart): keep the apply path aligned with the sliding chart window
- `54d52efe` (2026-10-20) — fix(data): harden the dataset manager, the chart window and the live bar path
- `4fb146c1` (2026-10-19) — fix(test): give the mock-walk reload test room on a loaded runner
- `ce6c8a67` (2026-10-19) — fix(ci): the desktop release pipeline must not fail on the changelog
- `86cd2c1c` (2026-10-19) — fix(ui): the feed chip says what the data path is, not a stale state word
- `a2a4efbd` (2026-10-19) — fix(test): pin the engine identity in the live-plane wire test
- `6a94ca03` (2026-10-19) — fix(test): reset the painted-candle range before each clamp test
- `36bc73df` (2026-10-19) — fix(ci): serialize the coverage test run
- `bcc64534` (2026-10-19) — fix(pyodide): compile mode no longer crashes on alert() / alertcondition()
- `c858620c` (2026-10-19) — fix(engine): mark /ws/run dead after an abnormal close
- `4c6f398e` (2026-10-19) — fix(data): fill internal 1m holes; cap /ws/live snapshot to 500 bars
- `c3bd51fa` (2026-10-19) — fix(data): fill stale cache→now before live on interval switch
- `6cd2b88c` (2026-10-19) — fix(streams): keep /ws/live connectable after snapshot misses
- `18198258` (2026-10-19) — fix(streams): keep /ws/live up when a script snapshot misses
- `200e27f5` (2026-10-19) — fix(streams): 120s snapshot wait after datafeed-loading; tail-align fills
- `1f20aad8` (2026-10-19) — fix(ui): pass streamId when restarting live after a market switch
- `8387a36d` (2026-10-19) — fix(ui): MCP chip on the command bar; overlay plots above price
- `c2dd8746` (2026-10-18) — fix(streams): handshake /ws/live with api_key instead of blocking on auth.ok
- `5c713b67` (2026-10-18) — fix(storage): keep Worker and engine API keys across restarts
- `950957d2` (2026-10-18) — fix(streams): wait for auth.ok and cap live subscribe history
- `a89e66e9` (2026-10-18) — fix(streams): pair-form REST keys and pause live-wire reconnects
- `51b290b1` (2026-10-18) — fix(streams): live P3 — no engine drive on venue ticks
- `8b169927` (2026-10-18) — fix(streams): live P1 — series/study push apply and reconnect resume
- `f3826c4b` (2026-10-18) — fix(streams): live P0 — venue-first paint, subscribe-once, pair-form keys
- `fa885c34` (2026-10-17) — fix(streams): append venue forming bar after engine snapshot in stream mode
- `846ab06d` (2026-10-17) — fix(streams): keep the venue's forming tip across engine-owned repaints
- `020f2c12` (2026-10-17) — fix(engine): drive the engine's series from the stream plane
- `158dd86a` (2026-10-17) — fix(engine): ignore a superseded engine socket's events and frames
- `675364d4` (2026-10-17) — fix(chart): prune co-painted series on a moved window and paint new engine windows
- `3bf910e1` (2026-10-17) — fix(engines): repair a stale engine series instead of back-dating the chart
- `6008eb54` (2026-10-17) — fix(engine): authenticate the live socket and accept flat engine error frames
- `ec33bdc0` (2026-10-17) — fix(chart): close the pre-paint hole in the co-painted candle-range clamp
- `0b419b89` (2026-10-17) — fix(live): hoist appendVenueBars above stream-route early return (TDZ crash)
- `4e342e91` (2026-10-16) — fix(engine): honor every-tick indicator re-runs on heavy histories
- `454c1260` (2026-10-16) — fix(engine): engine-owned live throttle no longer fires every tick
- `1e4c9848` (2026-10-16) — fix(engine): stop per-tick full-window tick+download in engine-owned live
- `d77772ba` (2026-10-16) — fix(data): engine-owned load flips status to ready and reapplies scripts
- `19f956b1` (2026-10-16) — fix(engine): end add-indicator lag, time-join session series, per-chart clamp
- `73b44ae4` (2026-10-15) — fix(chart): clamp co-painted series to the candle time range
- `58a4459a` (2026-10-15) — fix(engine): persist Pro API engine key across reloads
- `1b28d5e4` (2026-10-15) — fix(engine): unblock engine-owned data plane and honor free-tier caps
- `cfa7daed` (2026-10-15) — fix(engine): live-mode regressions — frozen overlays and reset re-run setting
- `de198e3b` (2026-10-14) — fix(workers): carry compile readiness through the probe result; use the rest of /health
- `f4925103` (2026-10-13) — fix(engine): harden O(delta) live sessions and engage them under auto
- `8384ab86` (2026-10-13) — fix(engine): one live session per script instance, rebase on rewritten history
- `91000a9c` (2026-10-13) — fix(chart): repair setData payloads — LWC asserts at render, not at setData
- `aa39ca1f` (2026-10-13) — fix(engine): session eligibility recorded up front, not via live array identity
- `81ccb8ad` (2026-10-13) — fix(engine): forward liveTick for chart-bars runs so sessions engage
- `083d3749` (2026-10-13) — fix(ci): pin Bun, and enforce the coverage gate at its measured floor
- `1d2036a1` (2026-10-13) — fix(ci): install worker dependencies before the root test run
- `7a12cabe` (2026-10-13) — fix(health): probe upstreams with HEAD, not GET
- `c4ccfce9` (2026-10-13) — fix(worker): repair dead market + on-chain proxies and get CI green
- `8b1b07cc` (2026-10-11) — fix(chart): sanitize setData payloads, per-series failure contexts
- `e6e32fd0` (2026-10-11) — fix(chart): fib circles/arcs X/Y radii, fills relocation, n-point drag
- `75f580b5` (2026-10-09) — fix(edge): run waitUntil ctx, hashed rate keys, scope fail-closed
- `2f892a42` (2026-10-06) — fix(ui): seamless ticker loop and calmer price band
- `2969fef5` (2026-10-05) — fix(tests): isolate cloud-config and cache keys across suites
- `d7d2ed17` (2026-10-05) — fix(build): add vite-env.d.ts for vite/client types
- `60f1fe56` (2026-10-05) — fix(tests): de-flake snapshot, menu and slot-switch tests
- `5c8ce723` (2026-10-05) — fix(datafeed): plug WS close-leak, version from package.json
- `34c65617` (2026-10-05) — fix(extras): live-tick trend, countdown prefix, ticker under topbar
- `dac8a48d` (2026-10-04) — fix(tests): derive panel-icon count from PANEL_IDS
- `1977e11b` (2026-10-04) — fix(extras): harden extra chrome widgets after review
- `ed39d933` (2026-10-03) — fix(extras): align price card right, clear of price scale
- `ec1c4994` (2026-10-03) — fix(extras): ticker auto-seeds watchlist symbols, single mux lifecycle
- `85358351` (2026-10-03) — fix(live): keep every tick in background tabs + DSM auto gap repair
- `54ae5acc` (2026-10-03) — fix(chart): harden engine overlays, HA cache, paint and lifecycle

#### Performance

- `0d7cfb1e` (2026-10-20) — perf(store): copy the sliding window once, and keep the benches honest
- `0d0ffd1c` (2026-10-13) — perf(engine): run Pyodide in a dedicated Web Worker
- `5ed34ef1` (2026-10-05) — perf(scripts): prefer Bun-native file, hash, spawn and image APIs

#### Refactors

- `d5b40875` (2026-10-17) — refactor(hud): unify chips on ChipShell, stable footprint, slimmer panels
- `f0b7ff4e` (2026-10-16) — refactor(indicators): decompose runAndApplyInner into apply stages (F-25)
- `b71179eb` (2026-10-07) — refactor: remove the pre-Solid static shell
- `e3553e41` (2026-10-07) — refactor(worker): consolidate HTTP helpers and proxy routing

#### Documentation

- `6d13a542` (2026-10-19) — docs(changelog): refresh the recursive history block
- `39a73dd6` (2026-10-19) — docs(changelog): note the CI serialization and live-plane coverage in 2.24.7
- `6f4dfedc` (2026-10-17) — docs: refresh landing index to 2.24.5 with a What's new section
- `9719ad50` (2026-10-17) — docs: regenerate llm.txt + llms.txt from the pynescript pipeline
- `c8895052` (2026-10-13) — docs(engine): mark migration steps done; note coalescing is the epoch mechanism
- `c6770b50` (2026-10-13) — docs: apply Cloudflare® / TradingView® / Pine Script™ brand marks across docs
- `b3610844` (2026-10-13) — docs: use Cloudflare® brand marks in worker + cli docs
- `9503fe6f` (2026-10-09) — docs: commercial licence upcoming, prices removed
- `5fe7f2e7` (2026-10-08) — docs: review against last 20 commits, fix repo identity and voice
- `cbb5bff0` (2026-10-05) — docs(readme): fix CLI release tag, add datafeed sidecar and recent highlights
- `24422117` (2026-10-05) — docs(changelog): record CI test-isolation fixes
- `c7959187` (2026-10-05) — docs(changelog): Unreleased entry for Bun-native session

#### Tests

- `c719f49c` (2026-10-19) — test(streams): cover the engine-owned live plane end to end
- `03dc1405` (2026-10-14) — test: stop cross-file store leakage from making CI order-dependent
- `e5453220` (2026-10-13) — test(datasession): mint an API key in the e2e harness
- `c5100b3f` (2026-10-13) — test(datasession): cross-repo e2e against the PYNE /data store
- `3c7ed9f4` (2026-10-13) — test(data): cover job validation and retention in the Data Source Manager

#### Chores

- `119c77b7` (2026-10-20) — chore(release): AXIS v2.25.1
- `069bd8d9` (2026-10-20) — chore(release): AXIS 2.25.0
- `2aed84f1` (2026-10-19) — chore(release): AXIS 2.24.8
- `0b851707` (2026-10-19) — chore(release): AXIS 2.24.7
- `833f0d6f` (2026-10-18) — chore(release): AXIS v2.24.6 — live stream feed and MCP plane
- `632aaca3` (2026-10-17) — chore(pyne-wheel): vendor PYNE 0.6.12 for the in-browser Pyodide engine
- `d946a42e` (2026-10-17) — chore(release): AXIS 2.24.5
- `13d89fdd` (2026-10-15) — chore(release): AXIS v2.24.2 — engine data-plane fixes
- `6bb1c521` (2026-10-15) — chore(release): AXIS v2.24.1 — engine live-mode fixes
- `7f16933c` (2026-10-14) — chore(docs): regenerate llm packs with the fixed identifier minifier
- `ec0ec5c4` (2026-10-14) — chore(release): AXIS v2.24.0 — PYNE endpoint parity
- `4092018e` (2026-10-13) — chore(brand): remove email-signatures
- `c906248e` (2026-10-13) — chore(pyne-wheel): vendor PYNE 0.6.9 for the in-browser Pyodide engine
- `85eab77e` (2026-10-13) — chore(release): AXIS v2.23.0 — proxy repair, rolling window, CI green
- `bf010b3d` (2026-10-13) — chore(okf): refresh the stale knowledge bundle
- `e520a138` (2026-10-08) — chore(deps): pyodide 0.29.5 + pynescript wheel 0.6.8
- `1709f092` (2026-10-07) — chore(release): 2.21.0
- `670fe2dd` (2026-10-06) — chore(dev): add storybook scaffolding
- `eb4ace84` (2026-10-04) — chore(license): unify headers under HOOX AXIS / axis
- `8949d283` (2026-10-03) — chore(release): 2.19.0 — Extra chrome widgets
- `db4e3862` (2026-10-03) — chore: ignore local git worktrees

#### Merges

- `129c9656` (2026-10-04) — Merge branch 'feat/quote-panel' — Quote dock panel + Extra menu polish
- `277bb465` (2026-10-04) — Merge branch 'main' into feat/quote-panel
- `6051219e` (2026-10-03) — Merge branch 'feat/extra-widgets' — Extra chrome widgets

### 2026-09 (162 commits)

#### Features

- `bc2e748a` (2026-09-29) — feat(brand): add email signature templates
- `7551dfec` (2026-09-27) — feat(ui): tune chrome motion and polish data, watchlist, and drawings
- `4f2fc64b` (2026-09-27) — feat(ui): quiet the trader shell and collapse the connection HUD
- `00c19cce` (2026-09-27) — feat(editor): function tree, sticky Problems, and quieter live runs
- `eaab5b13` (2026-09-26) — feat(ui): use the HOOX mark as the favicon and show price in the title
- `a4df8e72` (2026-09-26) — feat(chart): add right-click menus on the chart and panels
- `a6e06b62` (2026-09-26) — feat(theme): save named chart themes and bar colorings
- `f88b9d4a` (2026-09-24) — feat(chart): enhance drawing toolbar visual polish
- `7f9c044b` (2026-09-24) — feat(chart): drawing toolbar structure and pixel polish
- `1d289805` (2026-09-24) — feat(chart): center the loading splash and tuck the tool arrow in
- `3ef62fe6` (2026-09-24) — feat(okf): compile an OKF bundle on every commit
- `15b2ba38` (2026-09-23) — feat(ui): polish studio settings layout and live scale
- `e3f8dea3` (2026-09-23) — feat(chart): dockable drawing toolbar and classic level colors
- `1f46feda` (2026-09-22) — feat(ui): polish script library and layers panels
- `12b6ab81` (2026-09-19) — feat(plugins): PYNE Agent Persona field (pine/axis/trader)
- `79f65da6` (2026-09-17) — feat(mcp): drawings control, settings control, session indicator
- `1d795fb6` (2026-09-17) — feat(settings): unified Worker API key for cloud storage and MCP
- `b215b995` (2026-09-17) — feat(library): Builtin and Personal tabs in Script Library
- `15be69c3` (2026-09-16) — feat(mcp): remote MCP server for Worker APIs and live-app control
- `96310628` (2026-09-16) — feat(ui): load-source, Add built-in, and chart screenshot
- `5de57792` (2026-09-16) — feat(scripts): first-party AXIS built-in Pine catalog
- `fdf3b656` (2026-09-16) — feat(ui): named watchlists, overlay docks, Add, and pyne interpret fix
- `3afd072d` (2026-09-14) — feat: pine alerts, live-by-default, and worker-axis rename
- `44bb0eaa` (2026-09-14) — feat(editor): convert older Pine to v6
- `1dc6c089` (2026-09-12) — feat(cli): cloud-storage setup, keys, and D1 schema deploy
- `c111371a` (2026-09-12) — feat(storage): copy-on-switch, Worker settings, version history
- `a9f7bb6e` (2026-09-12) — feat(release): VERSION single source of truth with update manager and close guard
- `319403fb` (2026-09-10) — feat(editor): minimap, folding, indent grid, tab badges, workers full width
- `8e9e8d6b` (2026-09-10) — feat(editor): Language Feature Bar with live activity chips
- `4d565427` (2026-09-08) — feat(cli): standalone binaries via bun compile; fix Docker prepare-hook break
- `1fef94c3` (2026-09-08) — feat(ui): default TF 15m, studio opens on Settings, non-modal Workers, no top status
- `77d8600e` (2026-09-08) — feat(cli): installation self-check on start + doctor cli-install row
- `716a26eb` (2026-09-07) — feat(ui): mobile-first responsive shell (phone sheets, tab bar, force-single chart)
- `74418b05` (2026-09-07) — feat(results): events views (Open⇄Close), single-column strategy tab, rich saved stats
- `e00b6c97` (2026-09-06) — feat(shortcuts): shortcuts modal + Settings → Keyboard recorder
- `6efa590a` (2026-09-06) — feat(shortcuts): palette extensions with live shortcut rendering
- `47706d85` (2026-09-06) — feat(shortcuts): wire chart keymap through the dispatch hub
- `acc5ce93` (2026-09-06) — feat(shortcuts): editor keymap extensions with Prec.high line ops
- `e07ecb8c` (2026-09-06) — feat(shortcuts): wire app-level bindings through the dispatch hub
- `2795ac72` (2026-09-06) — feat(shortcuts): capture-phase dispatch hub with dialog-skip guard
- `50467b3d` (2026-09-06) — feat(shortcuts): persisted overrides slice on the app store
- `902741d1` (2026-09-06) — feat(shortcuts): chord parser, registry, and default bindings
- `da5e96d7` (2026-09-06) — feat(data): route all dataset paths through the DatasetStore
- `f597806b` (2026-09-06) — feat(ui): dataset persistence switch + sliced-backfill progress chip
- `257342d1` (2026-09-06) — feat(data): DSM-first load pipeline with progressive paint
- `a5caf0ab` (2026-09-06) — feat(data): DatasetStore with pluggable persistence sinks
- `d105e161` (2026-09-06) — feat(data): dataset merge with conflict detection & policies
- `19c92dd1` (2026-09-06) — feat(data): dataset validation & repair with gap classification
- `a63c3b69` (2026-09-06) — feat(ui): move Venue picker to front of Market group
- `be830abe` (2026-09-05) — feat(chart): per-tool drawing settings (v2.3.0)

#### Fixes

- `b063f231` (2026-09-29) — fix(chart): owner-clear drawings, fills, and barcolor on script delete
- `6f829378` (2026-09-29) — fix(editor): index every name in comma-separated Pine declarations
- `cb9e0cf2` (2026-09-28) — fix(chart): stop the drawing rail from clipping tool menus
- `921cd58e` (2026-09-28) — fix(chart): drop the unreachable drawing-clear status check
- `5e7b07d7` (2026-09-28) — fix(chart): place script drawings on the candle clock
- `11f60823` (2026-09-27) — fix(okf): match file names in query and align the agent guide
- `d18b6f7d` (2026-09-26) — fix(editor): silence false-positive pre-eval typo diagnostics
- `1b341a4b` (2026-09-25) — fix(toolbar): snapshot gesture-start anchor for drag tracking
- `095ccdc4` (2026-09-25) — fix(plots): keep explicit panel picks, refresh auto colors on re-run
- `869a7cfc` (2026-09-25) — fix(plots): resolve Pine color forms to CSS at every apply point
- `6f98cb3f` (2026-09-25) — fix(data): preserve DEX symbol case in backfill and cache expand
- `9c05483b` (2026-09-24) — fix(okf): drop unused initializers
- `6920e022` (2026-09-23) — fix(chart): zigzag pivots, plotshape markers, and Pine bar time
- `c0e07b55` (2026-09-23) — fix(plugin): ship PYNE Agent 0.1.7
- `ebe7d7a6` (2026-09-23) — fix(indicators): plot Ultimate Oscillator without ta.uo
- `7d02544b` (2026-09-20) — fix(chart,ui): clip drawings to plot, catalog line.fill, log chrome
- `c23c446c` (2026-09-19) — fix(chart): merge top-level compile plot_meta so fill bands apply
- `c1b1fdc1` (2026-09-19) — fix(chart): fill edges, color-split bands, and linefill quads
- `8da70490` (2026-09-19) — fix(mcp): 405 SSE GET on /mcp so streamable HTTP clients handshake
- `5a122934` (2026-09-19) — fix(mcp): single-tab invoke, key rotation, and WS tickets
- `1b6c2093` (2026-09-18) — fix(tests): deterministic fetch mocks + stale DSM status guard
- `8c648982` (2026-09-18) — fix(plugins): PYNE Agent endpoint seeding + Workers config UI
- `d758a6c6` (2026-09-17) — fix(store): reload no longer wipes persisted state (TDZ in boot parse)
- `695e22c4` (2026-09-17) — fix(watchlist): venue-correct quotes for MEXC, Kraken, and Data Manager
- `bf1984ad` (2026-09-17) — fix(cli): cover mcp/mcpBridge in healthFeatures test
- `07ee5f2a` (2026-09-17) — fix(docs): escape &lt; and &gt; in generated changelog subjects
- `76a4d753` (2026-09-17) — fix(worker): MCP_BRIDGE Durable Object uses new_sqlite_classes
- `0d99cdcb` (2026-09-16) — fix(scripts): builtin formula correctness and editor-draft isolation
- `74c7b947` (2026-09-16) — fix(ui): watchlist rename Escape, overlay slider, hover-slide, alert pop
- `a19488bd` (2026-09-15) — fix(ui): autoload, engine switch, layouts menu, and plugin Use
- `14daa3d6` (2026-09-14) — fix(ui): OnChainPanel error title rejects null
- `b3fc629b` (2026-09-13) — fix(editor): Lucide chevrons for fold gutter
- `c862227b` (2026-09-13) — fix(editor): unify color tools around one working color
- `bbf7bc9d` (2026-09-12) — fix(cli): drop empty ADMIN_TOKEN var before secret put
- `99eb5f20` (2026-09-12) — fix(ui): Studio Settings home, Workers fullscreen, minimap height
- `9e963eab` (2026-09-12) — fix(docker): skip missing VERSION stamp files in image build
- `ff4674a1` (2026-09-12) — fix: harden PWA, editor, e2e, and Docker; release 2.6.2
- `3a5de985` (2026-09-12) — fix(pwa): retry transient fetch failures in SW cache-first
- `cb089b18` (2026-09-12) — fix(e2e): retry twice on CI runners
- `b3915c90` (2026-09-12) — fix(e2e): wait for boot in openStudio, upload failure artifacts
- `8f8c91cd` (2026-09-12) — fix(docker): copy version-stamped files into build context
- `60aa2c4e` (2026-09-12) — fix(ci, docker): copy VERSION into build stage, harden studio helper
- `bd8d1c0c` (2026-09-11) — fix(pyodide, editor, cli): bridge traceback tail, feature-bar popover, host-native smoke
- `364776c5` (2026-09-09) — fix(pyodide): pass bars via globals + json.loads, surface full traceback
- `e4888c72` (2026-09-08) — fix(ci): SHA256SUMS used CI paths for binaries — sha256sum -c unusable
- `7d16a7bb` (2026-09-08) — fix(ci): CLI tgz mv target — packages/cli/.. is packages/, not the root
- `144ef3d3` (2026-09-08) — fix(ci): GITHUB_ENV var casing — release-assets referenced empty vars
- `cdb188b9` (2026-09-08) — fix(ci): worker bundle sanity check — wrangler.toml is gitignored
- `cb6f00f5` (2026-09-08) — fix(ci): check-versions fails on Windows runners — CRLF line endings
- `d4082f4c` (2026-09-08) — fix(shortcuts): mount ShortcutHub + keypress feedback
- `c06a14cf` (2026-09-07) — fix(test): make CI test suite green (server hook timeout, matchMedia stubs)
- `81f24c76` (2026-09-07) — fix(lint): resolve all Biome lint errors (368→0); add Biome + Prettier tooling
- `7d9f2dec` (2026-09-07) — fix(ui): resolve 23 UI-review findings across editor, drawings, panels, themes
- `464a9497` (2026-09-06) — fix(architecture): only preload Pyodide when the DOM can host asset links
- `8d5daf5c` (2026-09-06) — fix(worker): clean up tsc errors under noUncheckedIndexedAccess & exactOptionalPropertyTypes
- `7ee49cc4` (2026-09-06) — fix(data): DatasetStore memory-first, DSM paint/gaps, v2.4.0
- `520869dc` (2026-09-05) — fix: setup review — doctor, live HUD, static health, 2.3.1
- `16499ac7` (2026-09-04) — fix(results): skip live-tick persist and unstick studio e2e

#### Performance

- `57741698` (2026-09-25) — perf(chart): single-tick resize for charts, overlays and drawings
- `09b00fb3` (2026-09-21) — perf(chart): keep large OHLCV histories interactive

#### Refactors

- `eac5016e` (2026-09-25) — refactor(patterns): share emitter/singleton, collapse registry, venue asserts
- `ac0d8a90` (2026-09-08) — refactor(editor): move Script Logs into the editor bottom bar

#### Documentation

- `7643ae3c` (2026-09-23) — docs: match AXIS 2.13.0 catalogs, engines, and repo paths
- `f16f868b` (2026-09-19) — docs: pyodide-in-worker use case, NO_BACKEND contract, test conventions
- `7655bb25` (2026-09-14) — docs(changelog): drop raw &lt;cmd&gt; so MDX sync can parse
- `477084bf` (2026-09-08) — docs(changelog): note bare-filename SHA256SUMS for binaries
- `055d73d5` (2026-09-08) — docs: CLI-first command surface (axis &lt;cmd&gt; primary, bun run axis:* as repo alias)
- `9b75c459` (2026-09-08) — docs(readme): real badge row, stack cross-links, unified stack footer
- `efa7e87c` (2026-09-08) — docs(readme): add official Codecov coverage badge
- `e38a72f9` (2026-09-07) — docs: sync docs to v2.5.0 — shortcuts, mobile shell, results views
- `eecca17d` (2026-09-06) — docs(changelog): regenerate full history for v2.4.0
- `e9df22fe` (2026-09-06) — docs(changelog): DSM-first dataset store, validation, persistence switch
- `d10a9ea4` (2026-09-05) — docs(screenshots): wire stills into README and matching guides
- `adcb846d` (2026-09-05) — docs(screenshots): close editor except on editor-focused stills
- `3211bfe0` (2026-09-05) — docs(screenshots): recapture at 1920x1080 and 2560x1440
- `9b820a77` (2026-09-05) — docs(screenshots): capture PWA, Studio, and CLI stills plus GIFs

#### CI

- `60a0c8d6` (2026-09-08) — ci(release): attach CLI tarball + worker source bundle to GitHub Releases
- `d5f0cf89` (2026-09-08) — ci(hooks): versioned .githooks — pre-commit biome (staged), pre-push tsc + lint
- `cdb68ff9` (2026-09-08) — ci: split Codecov uploads per flag, bump action to v7, target 75%
- `9fe171a6` (2026-09-08) — ci: upload unit + CLI coverage to Codecov
- `637cfa87` (2026-09-06) — ci(cli): full npm release pipeline with tag guard, registry verify, Node smoke

#### Tests

- `d3e21123` (2026-09-16) — test(e2e): mock engine /run without intercepting runner.js
- `077c6c69` (2026-09-16) — test(e2e): open editor before asserting Script Logs toggle
- `8638f3c0` (2026-09-16) — test: wipe pluginsConfig with reconcile so engine mode stays auto
- `1962bfb9` (2026-09-16) — test: unstick CI unit failures on bun SVG stub and Worker URL
- `079f1569` (2026-09-12) — test(e2e): drawings overlay spec with chart DOM harness
- `3e6778ea` (2026-09-12) — test(coverage): lift scoped core gate 82.8% to 89.9%
- `6527e3de` (2026-09-10) — test(editor): cover folding, indent grid, minimap class
- `2c9643b3` (2026-09-05) — test(pwa): stub beforeinstallprompt without DOM Event
- `c0d88523` (2026-09-05) — test(load-symbol): isolate live stream and leftover scripts

#### Chores

- `7ea9e8ef` (2026-09-28) — chore(release): AXIS v2.18.0 — script drawings and watchlist flash
- `b94be4bb` (2026-09-27) — chore(release): AXIS v2.17.1 — quiet trader shell
- `1f81f4c8` (2026-09-26) — chore(release): AXIS v2.17.0 — context menus, favicon, and live title
- `c58e45a3` (2026-09-26) — chore(release): AXIS v2.16.0 — named themes and bar colorings
- `d62a2ee6` (2026-09-24) — chore(release): AXIS v2.14.0 — splash, toolbar, and studio
- `9ad5b004` (2026-09-23) — chore(release): AXIS v2.13.0 — drawing toolbar and classic colors
- `ee32dab4` (2026-09-22) — chore(release): AXIS v2.12.0 — library and layers panels
- `6e28ccf6` (2026-09-21) — chore(release): AXIS v2.11.0 — large-history chart, DSM, MCP
- `1b9357fa` (2026-09-18) — chore(release): AXIS v2.10.0 — toasts, notification settings, MCP activity
- `b327a28a` (2026-09-10) — chore: stop tracking .grok/ and AGENTS.md (local-only)
- `28420c09` (2026-09-08) — chore(release): v2.6.1 — sync desktop version stamps + check:versions guard
- `67723020` (2026-09-08) — chore(release): v2.6.0 — shortcut hub fix, keypress feedback
- `a78a7fca` (2026-09-07) — chore(release): v2.5.0 — mobile shell, pyne 0.5.0, zero lint errors
- `8d6a7c70` (2026-09-07) — chore(engines): vendor pynescript wheel 0.5.0 from pyne
- `9ae3e3da` (2026-09-07) — chore(release): v2.4.3 — results events views, single-column strategy, saved stats
- `aaf4d9ac` (2026-09-07) — chore(release): v2.4.2 — UI review fixes, keyboard shortcuts, line ops
- `fa49a6c1` (2026-09-06) — chore(cli): release @hoox-sh/axis-cli 0.2.2
- `36ba501c` (2026-09-06) — chore(release): v2.4.1 — worker tsc compliance
- `e84b8325` (2026-09-04) — chore(release): prepare v2.2.0

#### Other

- `9ee19452` (2026-09-17) — release: 2.7.0 MCP server, docs, and CLI 0.3.3
- `697e55ed` (2026-09-16) — release: 2.6.8 first-party built-in scripts and watchlist chrome
- `d6e6fd9c` (2026-09-14) — release: 2.6.7 convert-to-v6 UDF-safe prefixes

### 2026-08 (237 commits)

#### Security

- `d2b50220` (2026-08-13) — a11y,security: focus trap, chart region, SessionDO stream sanitize
- `4321c4b9` (2026-08-13) — security,perf: plugin allowlist, webhook policy, CSP, fill/runner hot paths
- `72869743` (2026-08-13) — perf,security,ci: multi-agent optim stack (registry, overlay tip, auth, SW, bundle, CI)
- `ebfc9955` (2026-08-07) — harden chart, data, and run paths for performance and crash resilience

#### Features

- `783a1003` (2026-08-30) — feat(ui): fullscreen studio overlay, Results JSON tree, and market proxy hardening
- `9081a559` (2026-08-29) — feat(worker): MEXC public REST through /api/market/mexc/* proxy
- `fb193c25` (2026-08-29) — feat(panel): per-panel icon in FloatableShell header
- `9196e4cb` (2026-08-29) — feat(ui): storage-change migration dialog
- `008fb22a` (2026-08-29) — feat(storage): persist strategy/indicator run results via StoragePlugin
- `eb86c103` (2026-08-28) — feat(results): fullscreen results studio, HPO polish, and tier gating
- `28a1f202` (2026-08-27) — feat(settings): add topbar tab to SettingsPage (studio view)
- `339f6a05` (2026-08-27) — feat(settings): add topbar visibility settings tab
- `67b1558d` (2026-08-24) — feat(security): enforce CSP baseline on Cloudflare Pages deploys
- `3fb40122` (2026-08-24) — feat(data): native MEXC spot venue + PYNE Pro origin pynescript.online
- `09e047cd` (2026-08-24) — feat(ui): single Studio button replaces Wire/Runtime/Settings
- `cd0148ca` (2026-08-23) — feat(cli): ship production-grade @hoox-sh/axis-cli 0.2.0
- `0d45a6f2` (2026-08-23) — feat(ui): full-page studio overlay for Runtime, Wire, and Settings
- `6900c093` (2026-08-22) — feat(ui): slide-over drawers for Settings, Runtimes, and Wire
- `c685a2d4` (2026-08-22) — feat(ui): Venue picker pairs native CEX and CCXT in one control
- `fe0ed9c7` (2026-08-22) — feat(ui): CCXT symbol catalog and hide paired stream
- `95144094` (2026-08-22) — feat(data): CCXT session keys and plugin-config/editor fixes
- `339175f0` (2026-08-21) — feat(ui): advanced config fields in Settings + full ccxt exchange list
- `203b4492` (2026-08-21) — feat(ui): topbar plugin config row for source/stream configSchema
- `6b4d5543` (2026-08-21) — feat(plugins): gateway-aware active source/stream resolution
- `1631975f` (2026-08-21) — feat(stream): ccxt-ws gateway stream plugin
- `c1887afd` (2026-08-21) — feat(source): ccxt-rest gateway source plugin
- `a47baf04` (2026-08-21) — feat(data): gateway transport layer for CCXT datafeed
- `3c72d089` (2026-08-20) — feat(release): AXIS v2.0.18 multi-venue DO, credential vault, CCXT sidecar
- `c42992e8` (2026-08-19) — feat(release): AXIS v2.0.17 editor lint underlines and typos
- `720237a1` (2026-08-19) — feat(release): AXIS v2.0.16 editor intel recovery
- `fd23d4a8` (2026-08-19) — feat(release): AXIS v2.0.15 editor intelligence and linebr
- `cbe6369f` (2026-08-19) — feat(editor): richer hover, param checklist, and pre-eval
- `a2178fc9` (2026-08-18) — feat: live script execution, chart labels, and strategy properties
- `35557be3` (2026-08-17) — feat(release): AXIS v2.0.14 strategy hyperparameter optimisation
- `9ec62e96` (2026-08-17) — feat(release): AXIS v2.0.13 params, highlighting, input enums, tables
- `db3b42c1` (2026-08-17) — feat(release): AXIS v2.0.12 editor UX, chart lifecycle, icon map
- `f96319e3` (2026-08-17) — feat(release): AXIS v2.0.11 chart scripts lifecycle and pyne-worker engine
- `7f85d664` (2026-08-16) — feat(release): AXIS v2.0.10 market proxy, inputs layout, local-first LSP
- `2cae2b72` (2026-08-15) — feat(editor): symbol catalog and richer Pine highlighting
- `9411a16b` (2026-08-15) — feat(pyodide): vendor pynescript 0.3.7 wheel
- `fe6dfb18` (2026-08-15) — feat(library): git versioned publish emulator for import ns/Name/ver
- `4d1e8647` (2026-08-13) — feat(ui): architecture modal to wire plugin slots from recipes
- `814cb21f` (2026-08-13) — feat(editor): 50vw default width; content-sized gutters
- `80f25012` (2026-08-13) — feat(pyodide): vendor pynescript 0.3.6 wheel
- `904ec110` (2026-08-12) — feat(drawings): paint line.style_arrow_left/right/both heads
- `669ee31d` (2026-08-12) — feat(drawings,plot): label styles/yloc, plot columns/cross/diamond
- `8b80166b` (2026-08-12) — feat(drawings): non-overlay pane Y + force_overlay routing
- `46229069` (2026-08-12) — feat(drawings,plot): linefill paint, barcolor, multi-script shapes
- `4b379391` (2026-08-12) — feat(ui): strategy Properties tab in Script settings
- `4bf973e4` (2026-08-12) — feat(ui): About AXIS modal on logo click
- `e96114b0` (2026-08-12) — feat(editor): handle PYNE Agent insert/open script events
- `e29aa644` (2026-08-12) — feat(ui,panels): panel defaults, chart overlay, classic logs chrome
- `a00ad891` (2026-08-11) — feat(ui): dockable Status and System Logs; Script Logs naming
- `7f44667e` (2026-08-11) — feat(runtimes,editor): hub, idle lint, save-before-run, tight line gutters
- `0c4a812d` (2026-08-11) — feat(editor,panels): hover-slide docks and editor chrome polish
- `7abea423` (2026-08-10) — feat(chart): price-scale decimals with auto from symbol/bars
- `235079b7` (2026-08-10) — feat(editor): autoformat, color tools, and chrome redesign
- `9ce5e0f3` (2026-08-10) — feat: plot style chart parity, preeval constants, and storage versions
- `dee91540` (2026-08-10) — feat(ui): fullscreen modes, price-pane scale controls, brand density
- `8aa9dddc` (2026-08-10) — feat(ui): symbol modal and richer Scripts panel cards
- `60502d08` (2026-08-10) — feat(cli): add AXIS CLI for install, setup, deploy, and doctor
- `da9dd6fd` (2026-08-10) — feat: Workers Manager modal and Tauri desktop shell
- `cf938db1` (2026-08-09) — feat(examples): add Pine v6 script library starter pack
- `a21dc811` (2026-08-08) — feat(plugins): install PYNE Agent component and enable component URL load
- `fae48240` (2026-08-08) — feat(onchain): refresh jobs, CSV export, and popular protocol presets
- `61c9993c` (2026-08-08) — feat(onchain): alerts UI, data view, commands, and ADR-015
- `8ad97cb8` (2026-08-07) — feat(onchain): alerts, layers, HUD health, and DSM walk-back polish
- `f91a10f7` (2026-08-07) — feat(onchain): data plane with DefiLlama TVL, DEX OHLCV, and events
- `f62611a0` (2026-08-07) — feat(editor): typo marks, wrap toggle, resizable Problems
- `259204e5` (2026-08-07) — feat(editor): pre-eval marks wrong code and disables Run
- `6a945396` (2026-08-07) — feat(drawings): merge parallel agent tool packs with full tests
- `9427a565` (2026-08-07) — feat(drawings): Gann, fib extras, patterns, and forecast tools
- `963f5f87` (2026-08-07) — feat(drawings): seed types and catalog for next parity packs
- `aaa2cca5` (2026-08-07) — feat(drawings): pitchfork, brush, callout, and more parity tools
- `1abe0795` (2026-08-07) — feat(drawings): registry-based tools toward charting platform parity
- `807262a4` (2026-08-07) — feat(data): dataset manager load window, venue live, expand to now
- `0e4ae885` (2026-08-06) — feat(data): raise historical bars cap to 100k
- `58ff7be5` (2026-08-06) — feat(data): cached datasets browser and Data Manager chart source
- `c1d45d00` (2026-08-06) — feat(ui): high-end theme presets, Scripts panel, Run accent only while busy
- `4a6c5e49` (2026-08-06) — feat(data): background Data Source Manager for multi-page OHLCV backfill
- `b7887c92` (2026-08-06) — feat(editor): slide-in tool labels on hover
- `4d533975` (2026-08-06) — feat(strategy): close fills, slippage next-open, marker prefs; fix script settings focus
- `4705cb96` (2026-08-06) — feat: symbol-scoped drawings, chart refresh, labels, editor docs
- `43b0de57` (2026-08-04) — feat(docker): full Buildx bake + Compose stack for AXIS PWA
- `b51879b0` (2026-08-04) — feat(ui): move chart Theme Manager to its own Settings tab
- `5f6863f0` (2026-08-03) — feat: chart Theme Manager (Pine chart.bg_color/fg_color) and UI hardening
- `26a8358d` (2026-08-03) — feat: GitHub/GitLab OAuth connect, multi-script results focus, hoox-sh org
- `902f3d4f` (2026-08-03) — feat: multi-agent PWA hardening for rock-solid reliability
- `b844a76f` (2026-08-02) — feat(ui): library panel, editor run/tab, live-after-load default
- `ed812a67` (2026-08-02) — feat(chart): render Pine fill(plot1, plot2, color=…) as SVG bands
- `7b481574` (2026-08-02) — feat(library): default git scripts to .pyne under pyne-library
- `52e2aa8c` (2026-08-02) — feat(library): drag-drop .pine files into script library
- `0b0df8e7` (2026-08-01) — feat(editor,topbar): parallel polish — ruler, diagnostics, git, pins, problems
- `10dd5074` (2026-08-01) — feat(editor): show cursor line:col in stats strip
- `c44f4cd9` (2026-08-01) — feat(chart): script action icons on pane name badges
- `ee31517a` (2026-08-01) — feat: TV-class power features from parallel agents
- `a6cd8e1b` (2026-08-01) — feat(editor): inline debug, wrap, stats; layers left slide-in
- `9309f9a2` (2026-08-01) — feat(layers): list and select user drawings in Layers panel
- `f45bf320` (2026-08-01) — feat(drawings): vline, extend, arrow, ellipse + toolbar polish
- `40430f6b` (2026-08-01) — feat(chart): multi-chart layouts, indicator align, editor full height
- `bacedac8` (2026-08-01) — feat(ui): chart reflow with docks, reload/reset, float editor fixes
- `0f9c4433` (2026-08-01) — feat(ui): stack multiple docked panels one below the other
- `f982e0d8` (2026-08-01) — feat(chart): multi-pane sync, scale controls, drawing GC, history depth

#### Fixes

- `defaccea` (2026-08-29) — fix(data): try MEXC Worker proxy first, direct host as fallback
- `167921f2` (2026-08-29) — fix(worker): update CORS product hosts to pynescript.online (retire .ai)
- `8426f3d9` (2026-08-29) — fix(editor): remove duplicate 'Open in new tab' entry
- `6178bced` (2026-08-29) — fix(ui): status bar chips wobble on hover
- `e0b8d4a8` (2026-08-27) — fix(chart): repaint full series on input override recompute
- `5fe39320` (2026-08-27) — fix(ui): fine-tune settings polish and worker probe
- `ad473102` (2026-08-27) — fix(ui): polish settings pages and fix worker health probe blocking
- `bb702efb` (2026-08-27) — fix(wire): remove separate scrolling sections from wire page
- `f38a0239` (2026-08-26) — fix(compile): display= folding into plot_attrs for data_window-only plots
- `cb9c1773` (2026-08-26) — fix(compile): hline linestyle via plot_meta backfill + default auto mode
- `5bc18f5d` (2026-08-26) — fix(hline): synthesize plot_meta in interpret path for hline linestyle
- `d417025f` (2026-08-26) — fix(multi-chart): restore slot history on focus so each cell computes independently
- `5025302f` (2026-08-26) — fix(hline): carry linestyle through both drawing and overlay paths
- `b07befb9` (2026-08-25) — fix(chart): render table cell valign/text-size; carry bgcolor band titles
- `86b86bd7` (2026-08-24) — fix(chart): never host hlines on bgcolor underlays
- `53cef490` (2026-08-24) — fix(chart): finish PlotSample widening in runner types
- `2db34902` (2026-08-24) — fix(chart): preserve engine color series so bgcolor/barcolor render
- `68b13118` (2026-08-23) — fix(settings): keep user inputs on applied scripts
- `ea13ba50` (2026-08-23) — fix(ui): seed Wire plan on mount and expose source for e2e
- `70d0b378` (2026-08-23) — fix(chart): honor Pine plot display.* flags
- `bed28c62` (2026-08-23) — fix(chart): hide Pine drawings, label pad, histbase, re-own
- `a05e42d8` (2026-08-23) — fix(chart): plotshape pane routing and drawing tool settings
- `098bfee4` (2026-08-23) — fix(chart): drawing move, linefill GC, overlay pane routing
- `55e26ddd` (2026-08-22) — fix(editor): stop afterDot state leak from trailing-dot floats
- `d98048a8` (2026-08-22) — fix(editor): pre-eval typo round 3 — generics, import paths, dotted calls
- `47beaa62` (2026-08-22) — fix(editor): pre-eval typo round 2 — decl forms, curly quotes, linktoseries
- `5f0c3f36` (2026-08-22) — fix(editor): stop pre-eval typo flood on built-in vars, qualifiers, text.*
- `2f8ff1d2` (2026-08-22) — fix(ui): plugin config first-save crash + gateway select options
- `a6323558` (2026-08-21) — fix(ui): single shared plugin config row + exchange dropdown
- `7e74a266` (2026-08-21) — fix(gateway): remote-page loopback resolution + drop shadowed require
- `67361dc6` (2026-08-21) — fix(datafeed): ccxt-ws browser ESM require + ccxt-rest walk-back window
- `aefa3baf` (2026-08-20) — fix(editor): skip hex color tails in pre-eval identifier scanner
- `d408f110` (2026-08-20) — fix: resolve all 23 pre-existing TypeScript errors + CI typecheck gate
- `804c5662` (2026-08-20) — fix(test): reset store provider state in credentials beforeEach
- `b160498e` (2026-08-19) — fix: review follow-up for hover, hide, linebr, and agent seed
- `35efaed7` (2026-08-19) — fix(plugins): render PYNE Agent markdown and drop default endpoint
- `7ccd745d` (2026-08-19) — fix(chart): break plot.style_linebr on na
- `dbcf1f0a` (2026-08-18) — fix: review follow-up for live hide, labels, and strategy props
- `fa57f639` (2026-08-17) — fix(editor): LSP pre-eval marks and last-bar drawings
- `f0235ac1` (2026-08-15) — fix(ci): desktop Watchlist case clash and GHCR-only docker push
- `42cb454f` (2026-08-15) — fix(ci): green unit, smoke, desktop build, and docker bake
- `4d34d82a` (2026-08-13) — fix(editor): allow Problems panel to stay closed
- `eb61d218` (2026-08-12) — fix(drawings,plot): line.new last-bar export path + plotarrow direction
- `299ec83c` (2026-08-12) — fix(test,store): green suite — isolate defaults, health mock, bar fills
- `41099e71` (2026-08-11) — fix(plugins): clearer errors when cross-origin plugin import lacks CORS
- `3bc43323` (2026-08-11) — fix(panels): harden hover-slide reflow for non-DOM test windows
- `0a668e00` (2026-08-11) — fix(security,perf): gate /api/run, OAuth clientId, WS cool-down
- `156221b9` (2026-08-11) — fix(security,perf): fail-closed Worker auth, CORS, bars-cache
- `9bfc801b` (2026-08-10) — fix(editor,run): defer syntax lint; enum completions; protect interactive Run
- `24f9cf68` (2026-08-08) — fix(run): Re-run replace, add-instance menu, clear stuck Running
- `77d2727e` (2026-08-08) — fix(onchain): health probe always targets Worker base
- `b24fbd19` (2026-08-08) — fix(onchain): honor empty health endpoint override
- `f8e3ae47` (2026-08-08) — fix(onchain): always use AXIS Worker proxy; allow product CORS origins
- `794ecadb` (2026-08-08) — fix(onchain): do not proxy DefiLlama via axis.hoox.sh SPA host
- `6d672e34` (2026-08-07) — fix(editor): recognize strategy qty constants; copy problems
- `3557ac99` (2026-08-07) — fix(drawings): keep trendline draft when tool re-syncs mid-place
- `b81991da` (2026-08-06) — fix(deploy): same-origin Pro API on https://axis.hoox.sh
- `3e1f3a76` (2026-08-06) — fix(git): harden storage integrity and OAuth device flow
- `6f870e52` (2026-08-06) — fix(data): backfill from now with gap validate; theme chrome; editor tools
- `ebddd006` (2026-08-06) — fix(data): multi-page walk-back without startTime+endTime trap
- `fdb4c6b1` (2026-08-06) — fix(ui): repair DrawingToolbar JSX after badge layout comment
- `1fd8b64f` (2026-08-06) — fix(ui): keep script badges above drawing toolbar chrome
- `9140e31d` (2026-08-04) — fix(strategy): correct PnL for Long/Short reverse entries
- `260a59c4` (2026-08-04) — fix(strategy): stop zeroing net PnL from placeholder prices/profit
- `0867b1ce` (2026-08-04) — fix(ui): make log copy buttons work on HTTP (clipboard fallback)
- `10313f67` (2026-08-04) — fix(strategy): qty-aware PnL, equity curve, and Strategy results tab
- `4b32864d` (2026-08-04) — fix(pyodide): align vendored wheel dist-info with pynescript filename
- `7f516350` (2026-08-04) — fix(ui): stop overlapping PRICE, indicator, and symbol badges
- `73fd9d3d` (2026-08-03) — fix: strategy events, plot colors, and price-scale labels
- `16a381d1` (2026-08-03) — fix(ui): icon-only editor tools; new tab in panel hamburger
- `a4cc7b27` (2026-08-02) — fix(chart): collapse stacked same-text Pine status labels
- `146bb090` (2026-08-02) — fix(results): drop no-fill closes; recover Source inputs; clamp future labels
- `134414dc` (2026-08-02) — fix(library): strip TradingView Expand (N lines) chrome on import
- `3d89f4ac` (2026-08-02) — fix(library): open every dropped .pine as its own editor tab
- `abcf5eb2` (2026-08-02) — fix(library): block browser file-open on pine drag-drop
- `85e037be` (2026-08-01) — fix(dock): side-by-side panels on left/right (indicators left of editor)
- `33305aec` (2026-08-01) — fix(chart): plot indicators on stable sub-pane id
- `4fd29aea` (2026-08-01) — fix(chart): stop oscillator scripts vanishing on the price pane
- `8a11fdc5` (2026-08-01) — fix(editor): restore full height so lines are editable
- `3a77976d` (2026-08-01) — fix(replay): start with full history, not a single candle
- `f89b9cc6` (2026-08-01) — fix(editor): sync full Pine builtins corpus from pyne

#### Performance

- `de00cbf3` (2026-08-13) — perf(pwa): heavy live re-run throttle, offline bars fallback, SW v4 cap
- `a9375440` (2026-08-13) — perf: coalesce live ticks, resize, and strategy UI; harden paint/security
- `cb901eb4` (2026-08-10) — perf: full-app hardening — live ticks, overlays, load abort, boot split
- `a9f57958` (2026-08-10) — perf(chart): heavy history paint, conflation, and O(1) live ticks

#### Refactors

- `afb85816` (2026-08-26) — refactor(about): remove ethos/author, add versions and philosophy
- `6041c2d6` (2026-08-22) — refactor(ui): move plugin config section into Settings → Data tab
- `f19fe9a2` (2026-08-08) — refactor: rename remaining pine-* modules to pyne-*
- `18eedc78` (2026-08-08) — refactor: rename pine-language/lsp/builtins editor stack to pyne-*
- `096a799f` (2026-08-08) — refactor: rename pine-editor CSS, DOM, and PyneEditor component
- `b52526af` (2026-08-08) — refactor: rename pine-editor.js to pyne-editor.js
- `f0a1446b` (2026-08-02) — refactor: rename chart palette TV→VOID; document Pine naming parity

#### Documentation

- `0a705de9` (2026-08-27) — docs(changelog): add topbar settings and wire page fix entries
- `35dacd21` (2026-08-24) — docs: studio shell, MEXC venue, and PYNE Pro origin across guides
- `dce471b0` (2026-08-21) — docs(devops): list /datafeed/ among nginx-proxied Pro API paths
- `27b5ca13` (2026-08-21) — docs(changelog): datafeed gateway phase 4 additions
- `36900319` (2026-08-15) — docs(cors): document Pages preview origins for axis.hoox.sh
- `d3172dbb` (2026-08-11) — docs: AXIS 2.0.1 docs, CLI-first ops, Pine Script v6 examples
- `78c22e85` (2026-08-11) — docs(release): recursive changelog, AGENTS release workflow, v2.0.1
- `f7c30e04` (2026-08-09) — docs: prefix internal links with /axis/docs
- `3d6fe1ab` (2026-08-08) — docs(ui): clarify on-chain uses public APIs unless Worker endpoint
- `f21dcc47` (2026-08-08) — docs: update llm.txt for PyneEditor rename
- `95e181c3` (2026-08-08) — docs: document on-chain data plane in README, hubs, and worker
- `df7b77ab` (2026-08-07) — docs: add PYNE Agent (pyne-agent-worker) plugin guides
- `5d1dc0f0` (2026-08-07) — docs: add PYNE Agent (pyne-agent-worker) plugin guides
- `dc62332f` (2026-08-03) — docs: regenerate llm.txt and llms.txt agent corpora
- `5dc92693` (2026-08-01) — docs: align UI and end-user guides with last 15 commits

#### CI

- `0c963fc6` (2026-08-23) — ci(cli): do not fail release when access public is forbidden
- `88ca0133` (2026-08-23) — ci(cli): treat already-published 0.2.0 as success and set public
- `c35de1fe` (2026-08-23) — ci(cli): auth registry checks and always set package public
- `e07c59df` (2026-08-23) — ci(cli): force @hoox-sh/axis-cli public after npm publish
- `dd3ebf85` (2026-08-23) — ci(cli): publish with NPM_TOKEN_HOOXSH and isolate CLI tests
- `75c4543c` (2026-08-22) — ci: versioned docker tags and npm publish for axis-cli
- `3ddc4193` (2026-08-10) — ci(docker): fix image build, enhance make targets, add GHCR workflow
- `5b4bbef4` (2026-08-10) — ci: build Tauri desktop app on every main push

#### Tests

- `5d5844ae` (2026-08-23) — test(e2e): open Plugins via studio rail; exact Offline Lab apply

#### Chores

- `862631e6` (2026-08-29) — chore(release): prepare v2.1.1
- `40668dbc` (2026-08-29) — chore(release): prepare v2.1.0
- `f34c76cf` (2026-08-26) — chore(release): bump to v2.0.27 — PYNE wheel 0.4.0, hline linestyle, multi-chart fix
- `d323c8fd` (2026-08-24) — chore(release): v2.0.26
- `a01be631` (2026-08-23) — chore(release): AXIS v2.0.23
- `22966e62` (2026-08-23) — chore(release): AXIS v2.0.22
- `3e7236ef` (2026-08-21) — chore(release): v2.0.20
- `b4b3227b` (2026-08-15) — chore(release): AXIS v2.0.8
- `236d042f` (2026-08-12) — chore(release): AXIS v2.0.7
- `5f6d7a9a` (2026-08-12) — chore(release): AXIS v2.0.6
- `12cffe27` (2026-08-11) — chore: ignore local multi-agent sync notice files
- `33e11930` (2026-08-06) — chore(worker): gitignore wrangler.toml and ship example
- `9cb4dad0` (2026-08-06) — chore: vendor latest pyne 0.3.0 wheel (parity Aug 6)
- `9fba8aaf` (2026-08-03) — chore: rename SuperChart branding to AXIS including CF project id
- `0cbda10b` (2026-08-01) — chore(pyodide): vendor pynescript 0.3.0 wheel with drawing GC

#### Style

- `21676494` (2026-08-22) — style(ui): render inline plugin config fields via TopbarField

#### Merges

- `938835cb` (2026-08-08) — Merge pull request #1 from hoox-sh/feat/onchain-data-plane

#### Other

- `e6491985` (2026-08-08) — merge: resolve main conflicts for on-chain docs

### 2026-07 (79 commits)

#### Security

- `8c4a635c` (2026-07-24) — Harden + bugs + polish (16 changes)

#### Features

- `593bb8aa` (2026-07-31) — feat(inputs): OHLC source enums and cross-indicator plot sources
- `501761db` (2026-07-30) — feat(ui): make all panels border-resizable down to 1px
- `852d2fa2` (2026-07-30) — feat(ui): Scriptlogs rename; editor FloatableShell + tools
- `745e3426` (2026-07-30) — feat(ui): Pine Logs panel and Editor Profiler mode
- `a2ed35e6` (2026-07-30) — feat(chart): multi-type price series and fix settings save race
- `d0e52bb2` (2026-07-29) — feat: live watchlist WS quotes and TV-style drawing chrome
- `9487673c` (2026-07-29) — feat(ui): softer inputs and collapsible panel dock menu
- `4e9a6100` (2026-07-29) — feat(ui): density scale slider and floatable dockable panels
- `4e3f029d` (2026-07-29) — feat(ui): data window, layers, script inputs; plot visuals + strategy
- `60c7e2f9` (2026-07-29) — feat(settings): presets for VPS UI + local pyne compile
- `52cd2668` (2026-07-29) — feat(editor): prefer pyne Pro API LSP for completion and hover
- `08fdbf24` (2026-07-29) — feat(editor): Pine completion and hover from LSP builtin metadata
- `ebb4db8d` (2026-07-29) — feat(hud): ENG/RUN/MODE/PATH chips with sticky hover info
- `ba480687` (2026-07-29) — feat(settings): expose PYNE execution mode (interpret/compile/auto)
- `7dc63117` (2026-07-27) — feat(axis): connection HUD, WSS engine path, chart stability
- `7cf3d357` (2026-07-27) — feat(axis): quality stack at 95% coverage, e2e, and ops polish
- `55a5a0c2` (2026-07-26) — feat(axis): self-host Pyodide and preload on idle
- `e264c91e` (2026-07-26) — feat(axis): source-aware watchlist with interval and refresh settings
- `5de17948` (2026-07-26) — feat(axis): plugin capability badges and storage status chrome
- `b56e4f61` (2026-07-26) — feat(axis): git script storage and Pine table HUD
- `3e00e1e1` (2026-07-26) — feat(axis): script library, storage plugins, and drawing polish
- `6322cd7b` (2026-07-26) — feat(axis): render Pine drawings and drag user drawings
- `c9d2a0e8` (2026-07-26) — feat(axis): interactive chart drawing tools
- `31b7eed8` (2026-07-26) — feat(axis): jump-to-trade from Results and status-bar P&L
- `9c0e3b06` (2026-07-26) — feat(axis): strategy trade markers, equity pane, and event normalization
- `bd0a106b` (2026-07-26) — feat(axis): ship AXIS charting PWA, evaluator corpus fixes, and /run/batch
- `c2f27a02` (2026-07-25) — feat: SuperChart rewrite + Pine evaluator runtime fidelity
- `acee8d1c` (2026-07-24) — feat: slide-in editor pane with push-layout and drag resize
- `2a6a2163` (2026-07-23) — feat: Pyodide engine rewrite, watchlist sidebar, URL hash sync, demo scripts
- `40db7f47` (2026-07-23) — feat(pwa): wire multi-tab editor (CodeMirror 6 with tab persistence)
- `68da3cce` (2026-07-23) — feat(pwa): plugin manager, script library, theme switcher, symbol autocomplete, plugin examples
- `fe90be7b` (2026-07-23) — feat(pwa): settings dialog, multi-pane, volume, time presets, strategy tester
- `9be7d819` (2026-07-23) — feat(frontend): modular PWA + Cloudflare Worker backend
- `28b57862` (2026-07-20) — feat(v6): multiline strings, export const runtime, strategy state, library import

#### Fixes

- `d5e487f2` (2026-07-31) — fix(profiler): compute gutter % from Σ line cost, not wall ms
- `4d5ad0a0` (2026-07-31) — fix(profiler): send profiler over WS and auto-run on enable
- `34cb26a3` (2026-07-31) — fix(editor): render LSP hover markdown and round tooltip corners
- `0abecff8` (2026-07-31) — fix(profiler): pass profiler flag to API and map profile/logs
- `33308a88` (2026-07-29) — fix(ui): stop pine drawing flicker; indigo loader accent
- `3c6dbbae` (2026-07-29) — fix(engine): REST fallback after WS timeout must not reuse dead AbortSignal
- `7b4b951e` (2026-07-29) — fix(settings): clearer endpoint probe errors for NetworkError
- `156e8c7f` (2026-07-29) — fix(hud): keep ENG plane in sync with selected engine
- `8ffa6c5c` (2026-07-29) — fix(ui): pyodide load hint, clarify MODE vs ENG chips, clip tick pulse
- `9dfeab37` (2026-07-29) — fix(pyodide): install local wheels with deps=false
- `f4dd5d0b` (2026-07-29) — fix(settings): always show execution mode for server/pyodide
- `57814bd1` (2026-07-29) — fix(settings): show execution mode for pyodide engine too
- `7d0021d2` (2026-07-29) — fix(engine): tolerate bare NaN in REST /run responses
- `b97649fd` (2026-07-29) — fix(engine): send execution mode in REST /run body
- `22178b3a` (2026-07-27) — fix(api): accept null optional symbol on WS live re-runs
- `431b3da2` (2026-07-26) — fix(axis): serve pyodide wheels from public/ and stop SPA HTML fallback
- `2d10a39a` (2026-07-26) — fix(axis): open Indicators panel from topbar toggle
- `f75867d8` (2026-07-26) — fix(axis): return multi-plot series from /run and harden trade pairing
- `49ddff4e` (2026-07-26) — fix(axis): multi-plot series with colors and bar-mode crossover
- `cf36ed70` (2026-07-26) — fix(axis): serve example plugins from /plugins in production
- `754b433c` (2026-07-26) — fix(axis): split plugin-badge utils for bun tests; drop wrangler d.ts
- `1ef06799` (2026-07-26) — fix(axis): resolve marker time from bar_time and kind from parity events
- `4252dc9e` (2026-07-26) — fix(evaluator): Console UDT multi-dispatch, bare na, and bar-loop lock
- `95479073` (2026-07-24) — fix(chart): fix chart and volume pane CSS layout
- `6642164d` (2026-07-24) — Fix chart overlap: absolute-position the loading skeleton
- `086277c3` (2026-07-24) — Fix data window positioning: use fixed coords + getBoundingClientRect
- `aaff9631` (2026-07-24) — Fix 4 layout/UX issues: loading skeleton, auto-run demos, watchlist, data window
- `4bc3132f` (2026-07-24) — fix: stdev always returns None due to AdvancedIndicators dispatch + PineSeries initial None
- `e0854e83` (2026-07-24) — fix: dict/NoneType errors in Pyodide engine (input.int, color.new, arith)
- `40568a06` (2026-07-24) — fix: builtin dispatch only passes kwargs if handler accepts them
- `7f2d7928` (2026-07-24) — fix: SMA constant values and RSI None crash in Pyodide engine
- `c35b12d6` (2026-07-23) — fix: merge kwargs into positional args for builtins in Pyodide runtime

#### Documentation

- `6bd9c848` (2026-07-29) — docs: inline TSDoc and module headers across the codebase
- `a3ee4a19` (2026-07-29) — docs(cors): allow any localhost/127 port on Worker; skip 0.0.0.0
- `2b09f248` (2026-07-28) — docs(license): AGPL-3.0-only (not or-later)
- `8fe2058f` (2026-07-28) — docs: cross-link HOOX / pyne / axis with hoox.sh websites

#### Tests

- `1e314369` (2026-07-29) — test(engine): assert REST /run body includes execution mode

#### Chores

- `42bf3ba9` (2026-07-29) — chore(pyodide): vendor latest pyne wheel and sync bridge
- `e6040569` (2026-07-28) — chore: bootstrap standalone axis repo from pyne frontend/
- `8dff3a71` (2026-07-28) — chore(license): relicense to AGPL-3.0-or-later under jango_blockchained
- `202a0499` (2026-07-23) — chore: switch frontend + worker to Bun + TypeScript 6

#### Style

- `1ee7f8ea` (2026-07-26) — style(axis): larger drawing toolbar icons
- `432dcf51` (2026-07-26) — style(axis): swap Hell Flieder for void indigo from landing pack

#### Other

- `514b90d1` (2026-07-24) — Add copy buttons with SVG icons to status bar + results panels

### 2026-01 (1 commits)

#### Features

- `bb224279` (2026-01-13) — feat: Google Server Setup and Closed Source Transition

### 2025-10 (2 commits)

#### Features

- `38a00b82` (2025-10-24) — feat(script): Add overlay series for line chart and improve data handling

#### Other

- `5613175b` (2025-10-20) — Add technical analysis built-ins and corresponding tests

---

## How to update

1. Edit **[Unreleased]** (or the new version section) by hand for the story.
2. Regenerate the recursive history block:

```bash
python3 scripts/generate-changelog.py
```

3. Commit changelog with the release; then tag, push, publish, sync
   (see `AGENTS.md` § Changelog & releases).

