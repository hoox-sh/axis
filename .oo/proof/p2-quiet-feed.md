# P2: Quiet Binance CORS/401 console and honest degraded feed

Engineering draft. No commit. Local Vite `:3000` was not up this gate (curl `000`); proof is unit tests.

## Cause

1. **CORS storm.** `fetchBinanceJson` tried `api.binance.com` then `data-api.binance.vision` from the page, then the Worker proxy. A failed browser `fetch` to Binance is a CORS console error the app cannot suppress. Guest first visit (klines, tickers, exchangeInfo, watchlist daily, close-verify) multiplied that to ~25 red lines. Worker `/api/market/binance/klines` is the CORS-safe path (MEXC already did Worker-first).
2. **401 bars.** Default `rerunOn` is `every-tick`. When the engine advertises `data_session`, `isEngineOwnedLive()` is true with **no API key**. `loadSymbolData` and multiplex still called `GET /data/series/bars` (empty `X-API-Key`) → 401 in the console. The public chart is not supposed to be auth-gated; venue REST + Worker still load candles.

P1 Live chip (degraded when WS/wire is down) is unchanged.

## Fix

- Browser: never `fetch` public Binance REST hosts (`api.binance.com`, vision, fapi, dapi). Worker `/api/market/binance/…` first. Worker 4xx (incl. 451 geo) does not fall through to a doomed direct hop. One `console.warn` if the Worker misses. Tests / node / `skipWorkerProxy` still use direct hosts. Signed klines: skip direct HMAC in a real browser.
- Guest: skip engine `GET /data/series/bars` and engine-owned paint when there is no engine API key. Venue bars still paint. Feed stays degraded when WS is down (P1).

## Test

```text
bun test --isolate tests/binance-http.test.ts tests/signed-fetch.test.ts tests/integration/load-symbol.test.ts tests/multiplex-engine-owned-paint.test.ts tests/engine/verify-strength.test.ts
```

Result: **63 pass / 0 fail** (2026-11-09).

Assertions: Worker-first klines; Worker 451 never hits `api.binance.com`; real-browser document skips direct after Worker 502 and warns once; signed HMAC skipped in browser; load-symbol + multiplex do not GET `/data/series/bars` without a key; venue still appends.

## Not done

- No local app console after-shot (`:3000` down).
- Worker 451 geo is still a failed kline (honest); we do not swap Binance candles for MEXC.
- On-chain llama 9.5MB is another card.
