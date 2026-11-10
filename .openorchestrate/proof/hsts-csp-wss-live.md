# Live HSTS / CSP / security headers + engine WSS

Engineering draft · 2026-11-09 · no product code change · no VERSION bump.

Measured against production. Sources: `public/_headers`, `worker/src/http.ts` `withSecurityHeaders`, prior Done card *Tech: hashed /assets… HSTS, tighter CSP connect-src*.

Raw curl dumps: `_raw-pages-headers.txt`, `_raw-worker-health-headers.txt`, `_raw-assets-headers.txt`, `_raw-assets-url.txt` in this directory.

## Header matrix

| Header / claim | `https://axis.hoox.sh/` (Pages HTML) | `https://axis.hoox.sh/assets/*` | `https://worker.axis.hoox.sh/health` |
| --- | --- | --- | --- |
| `Strict-Transport-Security: max-age=15552000; includeSubDomains` (no preload) | **PASS** | **PASS** (value present; see gap) | **PASS** |
| `Content-Security-Policy` document policy | **PASS** | **PASS** (same allowlist) | **N/A** (Worker JSON — expected; `withSecurityHeaders` stamps no CSP) |
| CSP `connect-src` includes `https://pynescript.online` + `wss://pynescript.online` | **PASS** | **PASS** | n/a |
| CSP `connect-src` includes `https://worker.axis.hoox.sh` + `wss://worker.axis.hoox.sh` | **PASS** | **PASS** | n/a |
| CSP `connect-src` has no bare `https:` / `wss:` wildcards | **PASS** | **PASS** | n/a |
| `X-Content-Type-Options: nosniff` | **PASS** | **PASS** | **PASS** |
| `X-Frame-Options: DENY` | **PASS** | **PASS** | **PASS** |
| `Referrer-Policy: strict-origin-when-cross-origin` | **PASS** | **PASS** | **PASS** |
| `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` | **PASS** | **PASS** | **N/A** (not claimed on Worker) |
| HTML `Cache-Control: public, max-age=0, must-revalidate` | **PASS** | n/a | n/a |
| Assets `Cache-Control: public, max-age=31536000, immutable` | n/a | **GAP** — live header merges both `must-revalidate` and `immutable` (see below) | n/a |

### Pages HTML excerpt (`curl -D-`)

```text
HTTP/2 200
cache-control: public, max-age=0, must-revalidate
strict-transport-security: max-age=15552000; includeSubDomains
content-security-policy: … connect-src … https://pynescript.online wss://pynescript.online … https://worker.axis.hoox.sh wss://worker.axis.hoox.sh …
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

### Worker `/health` excerpt (`Origin: https://axis.hoox.sh`)

```text
HTTP/2 200
access-control-allow-origin: https://axis.hoox.sh
strict-transport-security: max-age=15552000; includeSubDomains
referrer-policy: strict-origin-when-cross-origin
x-content-type-options: nosniff
x-frame-options: DENY
```

No `Content-Security-Policy` on Worker — matches `withSecurityHeaders` comment (JSON is not a document; CSP must not fight CORS).

### Gap: `/assets/*` Cache-Control merge

Live response for a hashed JS asset (example `/assets/index-D1qjqSUi.js`):

```text
cache-control: public, max-age=0, must-revalidate, public, max-age=31536000, immutable
```

Security headers also appear twice with identical values. `public/_headers` documents path rules as replace-not-merge and repeats the security block on `/assets/*`, but the edge is concatenating `/*` + `/assets/*` (or a zone transform + `_headers`). Immutable intent is present; the pure single-value claim is **not** clean live. Out of scope to fix without a Pages/edge change (ask before production dashboard edits).

## Engine WSS path (`pynescript.online`)

### Hop model (current)

1. **Default PWA (no Worker `pn_` key in vault):** direct  
   `browser → wss://pynescript.online/ws/live`  
   (`shouldUseLiveProxy` false when key missing / loopback — `src/engine/live-ticket.ts`).
2. **With cloud Worker key:** ticket hop  
   `GET https://worker.axis.hoox.sh/api/ws/live?issue=ticket` (Bearer `pn_…`)  
   → `wss://worker.axis.hoox.sh/api/ws/live?ticket=…`  
   → Worker relays to `EXTERNAL_BACKEND` `/ws/live` (binary-transparent; PYNE `auth` frame stays on the socket).  
   Venue Binance WS stays direct; this path is **engine** only.

### Live probes

| Probe | Result |
| --- | --- |
| `https://pynescript.online/health` + `Origin: https://axis.hoox.sh` | 200, `websocket: true`, ACAO echoes axis |
| Bun `WebSocket('wss://pynescript.online/ws/live')` | **open** in ~419 ms |
| Chrome on `https://axis.hoox.sh` → `new WebSocket('wss://pynescript.online/ws/live')` | **open** in ~397 ms; **0** `securitypolicyviolation` events |
| Chrome → `wss://worker.axis.hoox.sh/api/ws/live` (no ticket) | error (expected) |
| `GET …/api/ws/live?issue=ticket` without Bearer | 401 `NO_KEY` + HSTS/nosniff/XFO/referrer |
| HTTP/1.1 Upgrade to Worker `/api/ws/live` without ticket | 401 `INVALID_TICKET` + same security headers |

No flaky CORS/CSP/ticket failure found on the default direct hop. **No client or Worker code change** this gate.

## Unit pin (source still matches claim)

```text
bun test --isolate tests/hp/security-headers.test.ts tests/hp/isolation-headers.test.ts worker/tests/http.test.ts worker/tests/health-deep.test.ts worker/tests/live-proxy.test.ts
→ 58 pass / 0 fail
```

## Checklist

```text
[1] pass — artifact `.openorchestrate/proof/hsts-csp-wss-live.md` (+ raw dumps)
[2] pass — live curl -D- + Bun/Chrome WSS opens; unit 58/0
[3] pass — claims tied to public/_headers, worker/src/http.ts, live responses, browser eval
[4] pass — engineering only; no VERSION; no CSP wildcards; vscode packages parked; no product commit
```

## Open questions

- Who owns cleaning the Pages `/assets/*` Cache-Control double-stamp (CF Pages `_headers` vs zone Transform)? Needs ask-before production edge change.
- Optional later: first-party Origin mint for `/api/ws/live?issue=ticket` (mirror open-beta `/run`) so keyless PWA can use the Worker relay — not required for healthy direct WSS today.
