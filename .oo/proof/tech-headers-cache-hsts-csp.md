# Tech: hashed /assets immutable cache, HSTS, tighter CSP connect-src

Engineering draft. No commit. P1/P2 work left uncommitted.

## What changed

| Surface | Cache | HSTS | CSP connect-src |
| --- | --- | --- | --- |
| `public/_headers` (`/*`) | `public, max-age=0, must-revalidate` | `max-age=15552000; includeSubDomains` (no preload) | allowlist, not `https:`/`wss:` |
| `public/_headers` (`/assets/*`) | `public, max-age=31536000, immutable` | same | same (Pages path rules replace, they do not merge) |
| `docker/nginx.conf` + `nginx.proxy.conf` | assets 1y immutable; HTML must-revalidate | same | same allowlist |
| Worker `fetch` / `withSecurityHeaders` | n/a (API) | same | n/a |
| Tauri `app.security.csp` | n/a | n/a | same allowlist |
| Bun/Python PWA servers | assets immutable; else must-revalidate | local HTTP — not stamped | n/a |

`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` on Pages + nginx.

Canonical list: `src/hp/security-headers.ts`.

## connect-src hosts

`'self'` `blob:` localhost http/ws `127.0.0.1:*`/`localhost:*`

- `https://axis.hoox.sh`
- `https://worker.axis.hoox.sh` `wss://worker.axis.hoox.sh`
- `https://pynescript.online` `wss://pynescript.online`
- `https://pynescript-axis.pages.dev` `https://*.pynescript-axis.pages.dev`
- `https://axis.pages.dev` `https://*.axis.pages.dev`
- `https://pyne-worker.cryptolinx.workers.dev` `wss://pyne-worker.cryptolinx.workers.dev`
- `https://pyne-agent-worker.cryptolinx.workers.dev`
- Binance REST: `api.binance.com` `data-api.binance.vision` `fapi.binance.com` `dapi.binance.com`
- Binance WS: `stream.binance.com` `:9443` `data-stream.binance.vision` `fstream.binance.com` `dstream.binance.com`
- MEXC: `api.mexc.com` `wss://wbs.mexc.com` `wss://wbs-api.mexc.com`
- OKX: `www.okx.com` `wss://ws.okx.com:8443`
- Bybit: `api.bybit.com` `wss://stream.bybit.com`
- Coinbase: `api.exchange.coinbase.com` `advanced-trade-ws.coinbase.com` `ws-feed.exchange.coinbase.com`
- Kraken: `api.kraken.com` `wss://ws.kraken.com`
- On-chain fallback: `api.llama.fi` `api.geckoterminal.com`
- Plugin: `api.coingecko.com`
- Git: `api.github.com` `gitlab.com`

`wasm-unsafe-eval` kept for Pyodide. Cloudflare Insights beacon **not** in `script-src` (comment in `_headers`: edge inject on `axis.hoox.sh` vs `pages.dev`).

Known limit: user-typed alert webhooks / custom engine URLs outside this list are blocked by CSP.

## Verify

```text
bun test --isolate tests/hp/security-headers.test.ts tests/hp/isolation-headers.test.ts worker/tests/http.test.ts worker/tests/health-deep.test.ts
```

39 pass / 0 fail (2026-11-09).

## Checklist

```text
[1] pass — public/_headers, nginx, worker, tests, CHANGELOG Unreleased
[2] pass — command above, 39/0
[3] pass — hosts from src/data + src/streams + src/engines + src/workers; HSTS/cache from task
[4] pass — engineering only; P1/P2 left in tree; llama rate-limit card untouched; no chrome restyle
```
