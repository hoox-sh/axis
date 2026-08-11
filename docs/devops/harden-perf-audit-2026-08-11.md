# AXIS Hardening + Performance Audit

**Date:** 2026-08-11  
**Scope:** Specialist findings across security, hardening, reliability, and performance (Worker, client, desktop).  
**Method:** De-duplicate, drop false positives, rank by (severity × user impact × inverse effort). Spot-checked critical paths in-repo.

---

## Executive summary

AXIS has a **production-critical Worker auth gap**: `worker/wrangler.toml` commits `ALLOW_OPEN_KEYS = "1"` with **D1 bound** and **`API_KEYS` KV commented out**. In that configuration, `requireApiKey` accepts **any non-empty Bearer**, partitioning the script library by hash of attacker-chosen tokens with **no minting/revocation**. Even with open keys off, unbound KV still accepts any well-formed `pn_…` shape key.

Alongside that, browser-callable Worker surfaces are overly open: **CORS echoes any `https://*.pages.dev` Origin**, **`POST /api/run` is unauthenticated** (and uncapped/untimeouted), the **GitHub device-flow OAuth proxy** can accept body `clientId` and return `repo`-scoped tokens with weak rate limits, and the **client plugin loader** can dynamically import arbitrary HTTPS URLs into the app origin.

On the product path, the highest user-visible reliability/perf debt is **OHLCV cache thrash** (`getCachedBars` prefers IDB over warm memory; DSM re-validates/full-loads every page), **multi-MB DefiLlama protocol payloads** cached whole, **engine WS dead-client thrash**, **Session DO shared-upstream teardown**, and **full-series normalize/JSON on every live re-run** plus **editor keystroke cost**.

**Recommended posture:** Ship a small security + bars-cache PR first (S effort, outsized risk/perf), then `/api/run` + OAuth hardening, then WS/DO and live-tip apply path.

**De-dupe notes:** Two identical `server.ts` ETag `arrayBuffer()` findings merged (kept as medium). `/api/run` auth and size/timeout findings treated as one top fix. Related bars-cache IDB issues kept separate in backlog (eviction, write amp, list `getAll`).

**False positives:** None of the provided items were rejected after review. Severity of open auth is **not** overstated for any deploy that uses committed `wrangler.toml` vars against real D1.

---

## Critical / High

### Critical

| Area | File | Issue | Fix | Effort |
|------|------|-------|-----|--------|
| security | `worker/wrangler.toml` (+ `worker/src/auth.ts`) | Open keys + D1 without `API_KEYS` KV | Prod: unset/`0` `ALLOW_OPEN_KEYS`, bind KV, mint-only keys; refuse open+D1 deploys | S |

### High — Security

| Area | File | Issue | Fix | Effort |
|------|------|-------|-----|--------|
| security | `worker/src/index.ts` | `PRODUCT_ORIGIN_RE` allows any `*.pages.dev` | Project-scoped Pages hosts or `ALLOWED_ORIGIN` only | S |
| security | `worker/src/runtime.ts` | Unauthed `/api/run`; no rate/size; hung proxy | `requireApiKey` in prod; rate limits; body caps; `AbortSignal.timeout` | M |
| security | `worker/src/git-oauth.ts` | Body `clientId`; `repo` scope token return; weak RL | Env-only client id; reduce scope; Origin + durable IP limits | M |
| security | `src/plugins/loader.ts` | Arbitrary remote `import()` + restore + `host.fetch` | Default-deny remote in prod; allowlist + SRI; sandbox; confirm restore | L |

### High — Reliability

| Area | File | Issue | Fix | Effort |
|------|------|-------|-----|--------|
| reliability | `src/engines/engine-ws.ts` | Dead clients recreated every call → no cool-down | Cool-down TTL; skip WS while dead | M |
| reliability | `worker/src/durable-objects/session.ts` | One client error kills shared upstream; no reconnect/cleanup | Per-client drop; backoff reconnect; hibernation cleanup | M |
| reliability | `src/engines/catalog.ts` (Pyodide) | `runPython` sync; ignores AbortSignal; can freeze UI | Wall-clock timeout; async eval if available; wire real signal | L |
| reliability | `public/sw.js` | Unbounded `axis-runtime-v3` cache | LRU/max entries·bytes; keep `strategy.ts` in sync | M |

### High — Performance

| Area | File | Issue | Fix | Effort |
|------|------|-------|-----|--------|
| performance | `src/data/bars-cache.ts` | `getCachedBars` ignores warm memory; stale IDB vs memory SoT | Memory-first; hydrate on IDB hit; count helper | S |
| performance | `src/data/data-source-manager.ts` | Per-page full validate + double get for `.length` | In-memory density; validate at phase ends; bar-count helper | M |
| performance | `src/onchain/defillama.ts` (+ worker onchain cache) | Full multi-MB protocol JSON for `body.tvl` only | Strip to name/slug/tvl; avoid full-body cache | M |
| performance | `src/indicators/runner.ts` + `src/streams/multiplex.ts` | Full normalize + full OHLCV JSON every live re-run | Tip/delta payloads; tip-only map when length stable | M–L |
| performance | `src/editor/PyneEditor.tsx` | Full `doc.toString`, tab map, stats, color scan per key | Debounce/incremental; delay materialization | M |

---

## Medium / Low backlog

### Medium — Security / hardening

- **`worker/src/auth.ts`**: `?key=` query bearer → header-only; short-lived WS tickets; scrub logs (S).
- **`worker/src/durable-objects/session.ts`**: Unauthed `/api/stream` relay; symbol/interval into Binance URL; shared default session (M).
- **`src/ui/watchlist.js`** (+ chart.js, symbol-autocomplete): `innerHTML` with symbols/labels → `textContent`/escape + color allowlist (S).
- **`src/ui/panels/FloatableShell.tsx`**: `postMessage(..., '*')` and no `event.origin` check (S).
- **`src-tauri/tauri.conf.json`**: `app.security.csp: null` → strict CSP (M).

### Medium — Reliability

- **`src/data/bars-cache.ts`**: IDB series never evicted (memory is capped) (M).
- **`src/data/bars-cache.ts`**: Full-series IDB put every `putCachedBars` during multi-page backfill (write amp) (M).
- **`src/storage/local.ts`**: `migrateOnce` sets `migrated=true` before durable success (S).
- **`src/alerts/webhook.ts`**: `fireWebhook` fetch without timeout (S).
- **`worker/src/onchain.ts`**: `memCache` full clear at 64 → LRU; sticky protocols list (S).

### Medium — Performance

- **`src/ui/DataViewPanel.tsx`**: Crosshair rebuild clones all on-chain points (S).
- **`src/ui/VolumeProfileOverlay.tsx`**: 400ms poll + full-history recompute (S).
- **`src/ui/ScriptLogsPanel.tsx`**: Unvirtualized log `For` (M).
- **`src/chart/ChartHost.tsx`**: Theme `JSON.stringify(overrides)`; stacked paint effects; inactive slot steals global manager (M).
- **`src/results/plot-visuals.ts`**: Full shape marker rebuild each run (M).
- **`src/data/bars-cache.ts` / `src/onchain/cache.ts`**: `list*` via `getAll()` of full payloads for metadata (M).
- **`src/onchain/manager.ts`**: attach/refresh always network; ignore dataset cache TTL (S).
- **`src/data/watchlist-tickers.ts`**: Coinbase REST ≤24 parallel calls for 12 symbols (S).
- **`server.ts`**: ETag via full `arrayBuffer()` every GET (S) — *de-duped from dual medium/low reports*.

### Low

- **`src/storage/idb.ts`**: `openDb` missing `onblocked` / open timeout (S).
- **`src/ui/SystemLogs.tsx`**: Renders up to `MAX_LOGS` (500) without virtualization (S).
- **`worker/src/scripts.ts`**: `listD1` no `LIMIT`/cursor (S).

### High deferred from top-12 cut (still important)

- Pyodide main-thread freeze / ignored AbortSignal (`src/engines/catalog.ts`) — L effort, UX-critical when local engine selected.
- SW unbounded runtime cache (`public/sw.js`) — quota risk over time.

---

## Recommended first PR (3–6 concrete file-level changes)

**Theme:** “Fail closed on Worker identity + stop bars-cache self-DoS” — shippable in one review, low regression surface.

1. **`worker/wrangler.toml`**  
   - Set `ALLOW_OPEN_KEYS = "0"` (or remove).  
   - Document / uncomment `API_KEYS` KV binding with real id for prod.  
   - Keep open keys only in local/dev overlays, never in the committed prod-facing `[vars]`.

2. **`worker/src/auth.ts`**  
   - When `env.DB` (or script routes) are active and `API_KEYS` is unbound, **do not** accept open or shape-only keys.  
   - Prefer: require KV for any durable partition; reject with clear `API_KEYS_REQUIRED`.

3. **`worker/src/index.ts`**  
   - Replace open `(?:[\w-]+\.)*pages\.dev` with project-scoped host(s) (e.g. `*.pynescript-axis.pages.dev`) and/or rely on `ALLOWED_ORIGIN` list.  
   - Update `worker/tests/cors-origin.test.ts` accordingly.

4. **`src/data/bars-cache.ts`**  
   - `getCachedBars`: if `peekMemoryBars(key)` is warm, return a slice immediately; on IDB hit, hydrate `memory` then return.  
   - Add `getCachedBarCount()` (or extend `getCachedRange`) so DSM gap progress does not need full clones.

5. **`worker/src/runtime.ts` (minimal slice if room)**  
   - Reject oversized `script` / `data` arrays; `AbortSignal.timeout` on `proxyToExternal`.  
   - Full `requireApiKey` gate can land here or immediately in PR2 if scope must stay tiny.

6. **Optional same-PR XSS quick wins**  
   - `src/ui/watchlist.js` (+ symbol-autocomplete / chart label paths): stop unescaped `innerHTML` for symbols/labels.

**Out of first PR:** OAuth redesign, plugin sandbox, DO session rewrite, tip-only engine protocol, editor incremental architecture, Tauri CSP (needs careful connect-src inventory).

---

## Out of scope notes

- **Not invented:** No issues beyond the specialist JSON; ranking and merge only.
- **Deploy secrets / CF dashboard IDs:** Binding real `API_KEYS` / `USAGE` KV ids is an ops step; code and `wrangler.toml` can enforce fail-closed but cannot invent production namespace IDs.
- **External services:** Binance/Coinbase/DefiLlama availability and their own rate limits; we only fix AXIS relay/cache behavior.
- **Pine language / pyne Pro API contract changes:** Tip/delta run payloads may need pyne coordination if the engine API must change; client-side tip-only **apply** can proceed without that.
- **TradingView / trademark APIs:** Not implicated; do not introduce fictional host SDKs while fixing XSS/CSP.
- **Full plugin isolation architecture** (iframe/worker sandbox, capability tokens): tracked as L; first step is default-deny + allowlist, not a complete plugin platform.
- **E2E of production OAuth apps / GitHub App rotation:** Policy and App settings outside this repo audit.
- **Desktop packaging / store review** beyond setting a non-null CSP in `tauri.conf.json`.

---

## Suggested follow-on PR sequence

| PR | Focus | Why |
|----|--------|-----|
| 1 | Auth fail-closed + CORS + memory-first cache | Critical risk + S-effort perf correctness |
| 2 | `/api/run` gate, rate limits, body caps, proxy timeout | Stops public compute abuse |
| 3 | Git OAuth env-only client, scope, durable RL | Token theft / abuse surface |
| 4 | DSM walkBackRange + DefiLlama strip + attach cache-first | Bandwidth/CPU on data plane |
| 5 | engine-ws cool-down + Session DO lifecycle | Live chart stability |
| 6 | Tip-only apply + multiplex delta; editor keystroke | Sustained UI perf |
| 7 | Plugins default-deny + Tauri CSP + postMessage origin | Client hardening |
| 8 | SW LRU, IDB eviction/meta list, webhook/migrate/idb open | Backlog reliability |

---

## Ranking rubric (applied)

1. **Severity** (critical > high > medium > low).  
2. **User impact** (data/account compromise, public compute cost, chart freezes, multi-MB downloads, every-keystroke jank).  
3. **Effort** (prefer S/M for top_fixes when severity ties).  
4. **Dependency** (auth/CORS before metering; memory-first cache before DSM rewrite pays off fully).
