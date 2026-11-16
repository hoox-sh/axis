# Code Optimization Analysis — AXIS (2026-11-13)

## Scope

**Recently changed (HEAD~10..HEAD + working tree):** live-wire (frame ring, tip-blank resume, interval guard), `mcp/live.ts` (`results.tips`, tip freshness), `mcp/dispatch.ts` (`results.get` tail cap), `indicators/apply-live.ts` (`patchedAt`, null-tip point), `streams/multiplex.ts` (`via:'venue'`), `chart/live-append.ts`, `chart/pane-manager.ts` (LWC "Value is null" guards), `store/index.ts` (`normalizeBarPayload` OHLC sanitize), `engine/v1/metrics.ts` (`intervalMismatch`), worker MCP prompt strings.

**Hot paths read in full or in relevant part (lines):** `src/store/index.ts` 6370 (appendBar 4082–4310, flushLiveFrame 4390–4405, live-frame scheduler), `src/chart/pane-manager.ts` 4780 (setCandleData ~3545–3740, setVolumeData ~3740–3785, candleTimeSet 1013, dropRowsOutsideCandleTimes 1172), `src/engine/live-wire.ts` 2513 (noteFrame 1049, ingest/batch 1100–1160, evalScript recovery 1524–1635, release 2400), `src/streams/multiplex.ts` (flushPendingBar 663–760), `src/chart/live-append.ts` 314, `src/data/data-source-manager.ts` 1466, `src/onchain/*` (~4.2k, spot-checked manager/defillama/proxy/keys), `src/mcp/*`, `worker/src/{http,onchain,rate-limit,mcp/*,auth}.ts`.

Line counts above; total read ≈ 15k lines. **NOT read:** `src/chart/drawings/*`, `src/editor/*`, `src/onchain/manager.ts` internals beyond grep, `worker/src/{live-proxy,proxy-plane,runtime,git-*}.ts`, e2e/. No prod contact of any kind.

Verification: `bun test --isolate tests/store-append-immutable.test.ts tests/live-append.test.ts tests/pane-manager.test.ts` → 101/0; `bun test --isolate tests/engine/live-wire.test.ts tests/mcp-dispatch.test.ts tests/indicators/apply-live.test.ts` → 129/0. Working tree left untouched (no commits, no edits).

## Performance

**P2 — sanitize-on-append gap, not perf but correctness-adjacent:** `normalizeBarPayload` (store/index.ts:4313) only runs on the same-time update path (4148). New-bar paths (`setStore('bars', n, bar)` :4274, slide path `raw.push(bar)` ~4256) write the raw bar unsanitized — one NaN-bearing new bar poisons `store.bars` permanently (paint drops it every time, tip-normalizer then falls back to `0` prices). See Latent #1.

1. **Redundant double/triple filtering on every full paint** — `setVolumeData` (pane-manager.ts:3753–3778): `mapBarsToVolumeData` already drops non-finite bars and coerces volume (`heavy-data.ts:190–205`); the new `candleTimes` filter (3755) and `safeVolData` finite filter (3760) can never remove anything `isFinitePriceBar` didn't — both are dead weight on every full repaint (~5k rows). Likewise `safeData` in `setCandleData` (3603) is a strict subset of what `filterValidCandleRows` (series-sanitize.ts:168) already removes — `dropped-unsafe-rows` can never fire; it's a second O(n) pass + extra array per paint. The pre-filter also duplicates the job of `dropRowsOutsideCandleTimes()` called synchronously right after (3778). Impact: microseconds each, but three overlapping mechanisms for one invariant = future confusion. Fix: keep exactly one guard, delete the others (or fold `safeVolData`'s check into `mapBarsToVolumeData`).
2. **`filterValidCandleRows` duplicate-time branch is O(n·k)** — `out.findIndex` inside the loop (series-sanitize.ts:188). Only on duplicate times (rare), but a `Map<time,index>` makes it O(n) unconditionally.
3. **`flushLiveFrame` re-creates the tip object every flush** (store/index.ts:4395–4401) — fresh `{...bar}` → new identity → Solid notifies every `bars[tip]` subscriber per frame even when nothing changed. Compare-and-skip (or only spread when a field actually changed) removes useless re-renders at tick rate.
4. **`noteFrame` allocates on every inbound frame** (live-wire.ts:1049) — object + key array + `entries.slice` per frame even when MCP never reads `wire.frames`. Frames are engine-delta-rate, not venue-tick-rate, so cost is small; gate behind a flag or a lazy ring if it ever shows up in profiles.
5. **`tipBlankResumeAt` never cleaned in `release()`/`dropScriptLocal`** (live-wire.ts:711 vs 2390–2410) — one small map entry leaks per torn-down script subscription. Trivial, unbounded only in pathological re-subscribe loops; add `this.tipBlankResumeAt.delete(subId)` next to the other `.delete` calls.
6. **Misleading `unwrap` comments** — store/index.ts:4247–4250, 4317 claim `unwrap` returns a "deep copy"; Solid's `unwrap` returns the raw reference in O(1) for proxied values (verified against `node_modules/solid-js/store/dist/store.js`). The code is fine; the comments invite future mis-optimization. Fix comments only.
7. **Redundant volume post-filter vs pre-filter** — `dropRowsOutsideCandleTimes` re-reads `series.data()` and re-filters right after `setData` already wrote filtered rows; fine as a backstop, but if you keep the pre-filters, drop the re-read for the volume series only (keep it for co-painted script series, which the pre-filter does not cover).
8. Recent work is genuinely good: rAF-coalesced slide `setData`, venue/engine paint split, `results.get` tail cap (~10k cells → default 5), `results.tips` O(plots), MCP caps — no action.

**Per-tick allocations in the hot path** (appendBar → chartDebugSample with pre-built object literals at 4198/4227 etc.) are debug-gated inside `axisDebugSample` but the argument objects are built eagerly — real but negligible; fold into the known P2 debug-ring card (`.openorchestrate/board.md`, “P2: debug log ring emits ~5 lines/s of per-bar traces…”) — referenced, not re-fixed here.

## Security

- **Worker MCP**: auth required (`requireApiKey`, fail-closed with KV/D1, `ALLOW_OPEN_KEYS` only as documented dev escape — auth.ts:118–164), per-user rate limit 60/min with batch weighting (mcp/handler.ts:40, 254–259), body cap, exists. `UNSAFE: none found.`
- **On-chain proxy** (worker/src/onchain.ts): slug/network/address regexes, query-key allowlist, per-IP limits (10/min protocols, 120/min elsewhere), size caps (1 MiB out / 8–16 MiB upstream), slim projection — solid. `clientIp` uses `cf-connecting-ip` (http.ts:334) — correct behind CF (spoofing not possible at the edge).
- **Headers**: HSTS/nosniff/XFO/Referrer-Policy/CSP/Permissions-Policy via `withSecurityHeaders` (http.ts:175) — present. **No CSP on Worker JSON responses** — deliberate (noted in board), acceptable for non-HTML.
- **No XSS sinks found**: `innerHTML` uses are static strings (`pane-badge.ts` icon SVGs, `drawing-layer.ts` clear). No `eval`, no dynamic `document.write`.
- **Keys/secrets**: none in source; `?key=` query-param API key (http.ts:59–62) can leak into logs/browser history — pre-existing, documented; prefer header-only for browser clients. Low.
- **`bun audit`**: 6 vulns in one transitive chain — `seroval@1.5.6` via `solid-js` (1 critical GHSA-p6vx… bypass, 4 high, 1 moderate). Reachability in AXIS (client-rendered PWA; no untrusted `fromJSON` input path identified) is **UNVERIFIED** — do not assume either way. Action: `bun audit fix` in a branch or override `seroval` to ≥1.6.10; verify solid-js compatibility with tests. This is a dependency decision → needs a card, not a drive-by bump.
- Rate limiter is per-isolate fixed-window (rate-limit.ts:1–22, self-documented) — fine as abuse-blunting, not a hard quota. Fine as designed.
- `pane-manager.ts` pane-badge/`setData` paths: no injection surface.

No money/permissions/production actions were taken; no remote calls made (only npm audit metadata).

## Latent issues

**L1 (the real bug).** New bars bypass sanitize: `appendBar` appends raw `bar` (store/index.ts:4274, 4256–4258). A NaN-OHLC venue/engine frame for a *new* bar enters `store.bars`; every subsequent full paint drops the row via `filterValidCandleRows` (chart silently missing that candle), and when it becomes the tip, `normalizeBarPayload` falls back to `0` for every field (store/index.ts:4316–4331) → 0-price candle and corrupted `high/low` extrema. Fix at the door: in the new-bar path, reject (`return 'ignored'` + debug) when OHLC non-finite and no finite tip fallback exists; when re-opening history is impossible, never write an unsanitizable bar. Add a test mirroring the existing NaN-tip test (tests/store-append-immutable.test.ts:84) for the new-bar branch.

**L2.** `normalizeBarPayload` zero-fill (`?? 0` at 4316–4321) writes synthetic 0 prices when the tip is also non-finite. Prefer `null`-reject (see L1) — silently writing 0 violates "never paint a fabricated price".

**L3.** Interval-mismatch guard (live-wire.ts ~2136) compares `store.interval` to `frame.interval` but `store.interval` may lag a fast switch mid-stream; a frame of the *old* timeframe arriving in the switch window can still pass the check and paint wrong-TF bars into the new window. Sequence-based guard (subscribe-issued expected interval per subId) would be airtight — the `scriptCtx` meta is already the fallback; consider making it the primary source. UNVERIFIED without repro; flag for the live-lag card owner.

**L4.** `chartDebug('setCandleData', …)` logs full `firstRow`/`lastRow` objects per full paint — pairs with the P2 ring-flood card; include in that fix, don't duplicate.

**L5.** `results.get` `capRunArrays` shallow-copies `strategy` recursively and leaves `meta`/`inputs` uncapped — a 10k-row `meta`-adjacent array would still bloat the MCP response. Bounded in practice; note only.

**L6.** `frameTipIndex` never updated on the new-bar path (only `n–1` on update at :4187, nulled at :4256) — after an append, the next flush re-spreads the *previous* (now closed) tip for no reason. Fold into Performance finding 3 above.

## Maintainability (top items only)

- Three overlapping "drop unsafe rows" mechanisms in pane-manager (3603, 3755/3760, 3778) — pick one owner (suggest `series-sanitize.ts`), delete the other two.
- `pane-manager.ts` is 4.8k lines with paint + layout + input + persistence interleaved; `setCandleData` alone does sanitize → range rebase → theme → volume → markers. Not actionable now, but any new paint feature should land in `series-sanitize.ts`/`live-append.ts`, not pane-manager.
- store/index.ts 6.4k lines mixing hydration, live, theme, MCP-adjacent state — the new OHLC sanitize belongs in a small `bars.ts` module to keep `appendBar` readable; not urgent.
- `tipBlankResumeAt`/`frameRing`/`tipCaches` lifetimes tie to subscription lifetimes — one `delete`-sweeper in `release()` keeps all three honest (L5 above + finding 5).

## Priority

**P1 (fix soon, small):** L1+L2 — reject/sanitize new bars at the door in `appendBar` + tests. Silent bad data beats loud refactor right now.
**P2:** Finding 3+6 (one-line flush guard + `frameTipIndex = n` on append); Finding 5 (`delete tipBlankResumeAt` in release); Finding 1 (delete redundant safeData/safeVolData filters, keep dropRowsOutsideCandleTimes); seroval override + `bun test` (dependency card, not a freebie).
**P3:** Findings 2, 4, 7, L3–L6, comment fixes (finding 8), and the existing P2 debug-ring card (unchanged, owner already assigned).

## Expected impact

L1/L2 remove a whole class of silent chart corruption (a single bad tick currently persists a poisoned bar). Findings 1/3/6/7 are allocation and re-render hygiene — measurable only under tick storm (expect sub-ms per tick each; cumulative on 100+ msg/s streams). Seroval triage closes/explains a critical-audit line. Nothing here changes p50 paint; the LWC `setData` cost remains the dominant term, which is exactly what the closed P0 live-lag card addressed.

## NOT checked / not done

- No runtime/browser verification, no benchmark harness — all perf statements are from code reading, not measurement.
- No production or live-engine contact; live lag/interval behavior (L3) not reproduced.
- `worker/src/{live-proxy,proxy-plane,proxy-router,runtime,git-*}.ts`, `src/onchain/manager.ts` internals, `src/editor/*`, e2e suite, and the full `git diff` of tests were skimmed/greped, not audited line-by-line.
- seroval exploitability UNVERIFIED; `bun audit` only covers JS deps (no OS/image audit).
- The board P0/P2 cards' claims were taken from the board, not independently re-measured.
- Working tree left exactly as found (2 modified areas + untracked proof files untouched).
