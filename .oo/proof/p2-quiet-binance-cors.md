# P2: Quiet Binance CORS/401 + honest degraded feed — engineering proof

Date: 2026-11-09
Seat: oo-spec-2 (draft)
Worktree: isolated clone of axis @ 616b4b0d under HQ worktree `subagent-01a1be96-a9ce-76e1-b6e6-f6ab50e0d751/axis`

## Cause

1. **CORS console.** `fetchBinanceJson` (and signed HMAC, and `verifyClosedBar` tier-1) issued `fetch('https://api.binance.com/…')` from the page. A blocked origin is a browser CORS error the app cannot suppress. Worker proxy existed but ran *after* the doomed hop.
2. **401 console.** Guest / keyless engine-owned live called `GET /data/series/bars` with an empty bearer. PYNE answers 401. Same for close-verify skipWorkerProxy.
3. **Dishonest feed.** Failures `console.error`'d as Load failed while the Live chip could still read as live. Synthetic fallback is already off by default; the HUD feed was not marked degraded.

## Fix

- Browser path: Worker `/api/market/binance/…` first. Direct public Binance hosts only in tests/node (`skipWorkerProxy` / `allowDirectHosts`).
- Signed klines: skip HMAC hop when `browserBlocksDirectCexRest()`.
- `verifyClosedBar` skips venue REST in the browser (proxy / engine copy remain).
- Engine-owned paint / `getDataSeriesBars` skipped without an API key; venue paint still advances the chart.
- Load failures classify as `degraded · Binance blocked` or `Binance 401/403`; expected misses do not `console.error`.

## Environment

Could not reproduce live CORS against api.binance.com in this isolated worktree. Client-side quiet + degraded path is pinned with simulated 401 / `Failed to fetch` (CORS-shaped) failures via `_setBrowserBlocksDirectCexRestForTests(true)` and mock fetch.

## Verify

```text
cd axis
bun test --isolate tests/binance-http.test.ts tests/signed-fetch.test.ts tests/streams-stream-live-wire.test.ts tests/integration/load-symbol.test.ts tests/engine/verify-strength.test.ts tests/multiplex-engine-owned-paint.test.ts
bunx biome check --diagnostic-level=error <touched>
bun check src/data/binance-http.ts src/data/signed-fetch.ts src/data/worker-origin.ts src/data/load-symbol.ts src/streams/multiplex.ts src/streams/stream-live.ts src/sources/catalog.ts
bunx tsc --noEmit -p tsconfig.check.json
```

Assertions (2026-11-09, isolated axis):

- `bun test --isolate` 87 pass / 0 fail, exit 0 (261 expect() calls)
- biome `--diagnostic-level=error` 12 files, exit 0
- `bun check` no type errors in 245 files, exit 0
- `tsc --noEmit -p tsconfig.check.json` exit 0
- browser 401: Worker URL only, no `api.binance.com`, no `console.error`
- browser CORS: skip-direct, throw `Binance network error`
- load 401/CORS: feed status `degraded`, status sentence names 401/403 or blocked
- keyless engine: `GET /data/series/bars` count === 0 (load + live paint)

## Not this card

HQ pyodide bundle / AXIS IDE engine-rework. No production deploy. No `oo board sync`. No push.
