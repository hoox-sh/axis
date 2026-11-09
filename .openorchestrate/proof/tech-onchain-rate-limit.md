# Tech: rate-limit on-chain llama proxy; Worker security headers

Engineering draft. No commit. Other review work left uncommitted.

## Limits

| Surface | Limit |
| --- | --- |
| `GET /api/onchain/health` | Public small JSON. Unmetered (`skipHealth`). |
| `GET /api/onchain/llama/protocols` | **10 GET / IP / 60s**. Guest body **≤ 1 MiB** after slim `{slug,name,tvl,category}` (TVL-desc truncate). Advertised `RateLimit-Limit: 10`, `RateLimit-Policy: 10;w=60`, `Retry-After: 60` on 429. |
| Other `/api/onchain/*` data | **120 GET / IP / 60s**. |
| Upstream GET (gecko / protocol slug) | **8 MiB** — 413 `PAYLOAD_TOO_LARGE` if `Content-Length` or buffered body exceeds (body cancelled). |
| Upstream GET (llama protocols, to slim) | **16 MiB** read, then slim; never forwarded raw (~9.5 MB dump). |
| Default `fetchUpstreamJson` | **4 MiB**. |

## Worker JSON headers (`withSecurityHeaders`, already on every `fetch`)

Filled gaps only (no second wrapper, no CSP on JSON):

- `Strict-Transport-Security: max-age=15552000; includeSubDomains` (existing, no preload)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

## Files

- `worker/src/http.ts` — size-capped `fetchUpstreamJson`, JSON security headers
- `worker/src/onchain.ts` — slim + 10/min llama protocols, skipHealth
- `worker/src/proxy-router.ts` — `ipLimit.skipHealth`
- `worker/tests/onchain-proxy.test.ts`
- `worker/tests/upstream-fetch.test.ts`
- `worker/tests/http.test.ts`
- `worker/tests/health-deep.test.ts`
- `tests/hp/security-headers.test.ts`
- `CHANGELOG.md` Unreleased
- `worker/README.md`, `docs/worker/index.mdx`

## Verify

```bash
bun test --isolate worker/tests/onchain-proxy.test.ts worker/tests/upstream-fetch.test.ts worker/tests/http.test.ts worker/tests/health-deep.test.ts worker/tests/proxy-router.test.ts tests/hp/security-headers.test.ts
```

**86 pass / 0 fail** (2026-11-09).

Guest cannot freely download multi-MB llama protocols: 11th list GET is 429; fat dumps lose `chainTvls` / `tokens` and stay under 1 MiB.
