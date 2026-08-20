# frontend/worker/ — Cloudflare Worker for AXIS

## Cloudflare project naming (keep stable)

| Surface | Value | Notes |
|---------|--------|--------|
| **Wrangler / Pages project** | `pynescript-axis` | **Do not rename** in CF dashboard or `wrangler.toml` without migrating bindings, custom domains, and CI secrets. The CF project id is stable infrastructure. |
| **npm package** | `axis-worker` | Internal; can lag display brand. |
| **Health JSON `service`** | `pynescript-axis-worker` | User-facing API identity (already AXIS). |
| **Product / UI brand** | **AXIS** | Manifest, titles, landing. |

Optional later: add a CF **alias** or custom domain `axis.*` pointing at the same project — still leave the project name as `pynescript-axis` so deploys and KV/D1 ids stay put.

---

This Worker provides the **production backend** for the PWA. It can:

- Proxy `POST /api/run` to an external Python backend (Flask) — works today.
- Run Pine scripts in-Worker via Pyodide (not yet implemented, see
  `RUNTIME.md` below).
- Hold **API keys in KV** (with admin-only `X-Admin-Token`).
- Meter usage in KV (per-key, 30-day TTL).
- Persist runs/scripts in **D1** (optional, off by default).
- Cache indicator bundles in **R2** (optional, off by default).
- Relay live datastreams to the browser via a **Durable Object** that opens
  one upstream WebSocket per session and fans it out to N clients.

## Local dev

**Preferred (AXIS CLI from repo root):**

```bash
bun run axis:install
bun run axis setup worker          # ensure wrangler.toml
bun run axis setup d1 --local      # apply schemas/scripts.sql
bun run axis setup oauth --github-client-id Ov23li…
bun run axis dev worker            # wrangler :8787
bun run axis:deploy                # production Worker
bun run axis:health -- --oauth
```

**Manual:**

```bash
cd worker
cp wrangler.toml.example wrangler.toml   # gitignored local config
# edit D1 id, ALLOWED_ORIGIN, GITHUB_OAUTH_CLIENT_ID, …
bun install
bun run dev   # wrangler dev on http://127.0.0.1:8787
```

`wrangler.toml` is **gitignored** — only `wrangler.toml.example` is committed.
Copy the example once per machine (or `axis setup worker`) and fill in bindings / OAuth client ids.
Docs: [AXIS CLI](https://hoox.sh/axis/docs/devops/cli) · [bindings](https://hoox.sh/axis/docs/worker/bindings).

The PWA's `endpoint` input can be pointed at this URL for an end-to-end
local stack.

## Bindings — provision once

```bash
# KV
wrangler kv namespace create API_KEYS
wrangler kv namespace create USAGE

# D1 (optional)
wrangler d1 create pynescript

# R2 (optional)
wrangler r2 bucket create indicator-bundles

# Durable Objects — migrations are declared in wrangler.toml, apply with:
wrangler deploy
```

Paste the returned IDs into your local `wrangler.toml` (from the example).

## Endpoints

| Path                | Method | Notes                                  |
|---------------------|--------|----------------------------------------|
| `/` or `/health`    | GET    | Health check                           |
| `/api/run`          | POST   | `{ script, data, mode? }` → plots+events |
| `/api/keys?action=create` | POST | `X-Admin-Token` required               |
| `/api/keys?action=validate` | GET | `Authorization: Bearer …` or `?key=` |
| `/api/usage`        | GET    | Per-key usage counter (KV)             |
| `/api/stream`       | WS     | `?session=…&symbol=…&interval=…` (DO)  |
| `/api/scripts`      | GET/POST | List / create scripts (Bearer key)   |
| `/api/scripts/:id`  | GET/PUT/DELETE | Read / upsert / delete          |
| `/api/scripts/_draft` | GET/PUT | Per-user draft buffer              |
| `/api/onchain/health` | GET  | On-chain proxy feature flags (public) |
| `/api/market/health` | GET  | Market proxy feature flags (public) |
| `/api/market/binance/klines` | GET | Allowlisted Binance klines proxy |
| `/api/market/binance/ticker/24hr` | GET | Allowlisted Binance 24hr ticker proxy |
| `/api/market/binance/exchangeInfo` | GET | Allowlisted Binance exchangeInfo proxy |
| `/api/market/binance/signed/klines` | GET | HMAC-signed klines; headers `X-Exchange-Key` + `X-Exchange-Secret` (not cached) |
| `/api/onchain/llama/protocols` | GET | DefiLlama protocols (allowlisted) |
| `/api/onchain/llama/protocol/:slug` | GET | DefiLlama protocol TVL history |
| `/api/onchain/gecko/networks/:net/pools/:addr/ohlcv/:tf` | GET | GeckoTerminal pool OHLCV |
| `/api/onchain/gecko/search/pools` | GET | GeckoTerminal pool search |

**On-chain proxy** is public (no API key), allowlisted only — not an open reverse proxy.
The PWA uses `{endpoint}/api/onchain/llama` and `…/gecko` by default when `store.endpoint`
points at this Worker (CORS-safe DefiLlama / GeckoTerminal).

**Script library auth:** `Authorization: Bearer <api_key>` (same Pro keys as `/api/keys`).
Scripts are partitioned by a hash of the key. Without D1, an in-memory store is used
(local `wrangler dev`). Apply D1 schema: `wrangler d1 execute pynescript --file=schemas/scripts.sql`.

WebSocket: open `wss://<worker>/api/stream?session=…&symbol=BTCUSDT&interval=1m`
and the Worker routes to a Durable Object instance that fans a single
upstream Binance kline stream to N clients.

## Deploy

```bash
# 1) Bindings (one time)
wrangler kv namespace create API_KEYS
wrangler kv namespace create USAGE
# (optional) wrangler d1 create pynescript
# (optional) wrangler r2 bucket create indicator-bundles

# 2) Deploy the Worker
cd frontend/worker
wrangler deploy

# 3) Deploy the PWA as a Pages site (project name is intentional legacy id)
cd ..
bun run build   # produce frontend/dist
wrangler pages deploy dist --project-name=pynescript-axis
```

Prefer deploying **`dist/`** from the Vite Solid app, not the repo root
(legacy `main.js` shell). Project name stays `pynescript-axis` (see
naming table above).

After deployment, the PWA's `Endpoint` field should be set to the
`*.workers.dev` URL or your custom domain.

## Caching strategy

- `Cache-Control: public, max-age=60` on `/api/run` for identical
  `(script, data_hash)` pairs (deferred — see `RUNTIME.md`).
- Live stream DO: no cache, always forwards.
- `/api/keys` and `/api/usage`: no cache.

## Implementation status

- [x] `/api/run` proxy to EXTERNAL_BACKEND
- [x] `/api/keys` admin endpoint
- [x] `/api/usage` (KV-backed)
- [x] `SessionDO` Durable Object for live streams
- [x] `/api/stream` → DO routing in `src/index.ts`
- [x] In-Worker Python scaffold (`src/pyodide_runtime.ts`, gated by
      `PYODIDE_IN_WORKER=enabled`)
- [ ] Pyodide wheel upload pipeline (see `RUNTIME.md`)
- [ ] Caching layer
- [x] D1 schema (`schemas/scripts.sql`) + `/api/scripts` (memory fallback without D1)
- [x] Script library auth via Pro API keys

See `RUNTIME.md` for the in-Worker Python plan.
