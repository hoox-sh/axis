# P0: `/api/ws/live` ticket mint 200 then Firefox WSS upgrade fails

Date: 2026-11-19  
Seat: oo-spec-2

## Root cause

**Worker → engine WebSocket upgrade fails with Cloudflare HTTP 525 (SSL handshake failed).**

Evidence chain:

1. Connected PWA `stream.get`: `wire.open=false`, `openedOnce=false`, `reconnectAttempts=37`, `lastFail={reason:"connect", message:"ingest error"}` while venue Bybit WS stays open.
2. Ticket mint succeeds: `GET https://worker.axis.hoox.sh/api/ws/live?issue=ticket` → **200** `{ticket, expiresIn:60}` (~Firefox/HTTP/3 path matches the user report).
3. Browser WSS upgrade to `wss://worker.axis.hoox.sh/api/ws/live?ticket=…` → **502**  
   `{"status":"error","code":"UPSTREAM_WS","message":"engine /ws/live upgrade failed — check EXTERNAL_BACKEND"}`.  
   Firefox surfaces that non-101 as “can't establish a connection” / “interrupted while the page was loading”.
4. `wrangler tail` on the failing upgrade:

   ```json
   {
     "type": "live_relay_upstream_open",
     "connect_ms": 203,
     "upstream_host": "pynescript.online",
     "error": "upstream refused websocket upgrade (HTTP 525)"
   }
   ```

5. Direct `wss://pynescript.online/ws/live` from this host opens (**~420 ms**). Local **workerd** `fetch`+`Upgrade: websocket` to the same URL returns **101 + webSocket**.
6. Prior fail-closed fix (`2a45779a`, `openUpstreamLiveWs` / 502 `UPSTREAM_WS`) **is live** on Worker `2.30.0` / git `8925ab26` — not regressed. The opaque Firefox message is now the correct fail-closed 502, not a fake 101.
7. Related “pynescript.online down” / local Docker card is a separate outage path; public engine HTTP+WSS are up now. The break is specifically **CF Worker subrequest → pynescript.online Upgrade → 525**.

Not a client mint race: mint 200 then upgrade 502 is deterministic from curl/websockets with a fresh ticket.

## Fix landed (repo; needs Pages + Worker ship)

| Change                                                        | Why                                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `worker/src/live-proxy.ts`                                    | `UPSTREAM_WS` body uses the peer error string (e.g. `HTTP 525`) so DevTools is actionable.                                  |
| `src/hp/workers/ingest.worker.ts` + `protocol.ts` + `host.ts` | After a ticket upgrade fails before open, dial direct `wss://engine/ws/live?api_key=` and keep that choice for the session. |
| `src/engine/ws-client.ts`                                     | Same session stickiness for the JSON/main-thread transport.                                                                 |
| Tests + CHANGELOG                                             | Pin 502 message, `directUrl` on connect, proxy→direct fallback, and reconnect stickiness.                                   |

## Stickiness (checker fail, 2026-11-19)

Rule: prefer-direct sticks for the session's reconnects only after a ticket upgrade fails **before that socket opens**. Clear it on explicit disconnect or a new session (new client, or an ingest `connect` whose url / token / proxy / directUrl changed). A proxy socket that reached open does not set the flag, so reconnects remint and do not put `api_key` on the Worker URL.

| Path                        | What changed                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Redesign2WsClient.connect` | No longer clears `preferDirect` on entry (`scheduleReconnect` and `ensureConnected` both re-enter `connect`). `disconnect()` clears it.                            |
| `openSocketOnce` catch      | Dropped the `openedOnce` guard. A later pre-open ticket failure still takes the direct leg, and that leg still arms `scheduleReconnect` so the loop does not stop. |
| Ingest `connect` message    | Keeps `preferDirect` when the host posts `connect` while down on the same target. `disconnect` or a different target clears it.                                    |
| `tryDirectFallback`         | Uses a per-socket open set, not session `openedOnce`. A clean close after open remints. A pre-open failure still falls back after an earlier socket had opened.    |

New tests:

- `scheduleReconnect dials directUrl not ticket after direct fallback opens`
- `pre-open ticket failure after an earlier open still falls back and reconnects on directUrl`
- `disconnect clears prefer-direct so the next session remints a ticket`
- `reconnect remints a one-time ticket` (already held; healthy proxy open)
- `ingest host connect while down dials directUrl not ticket after direct fallback opens`
- `ingest host connect while down remints when the ticket path reached open`
- `ingest pre-open ticket failure after an earlier open still dials directUrl`
- `ingest disconnect then connect tries the Worker ticket before direct`

`axisDebugSafeUrl` still strips the query. Debug lines in this run show `wss://pynescript.online/ws/live` with no `api_key`.

Ops still owns the durable proxy fix: Cloudflare SSL / origin path so Worker `fetch` Upgrade to `EXTERNAL_BACKEND` (`pynescript.online`) stops returning 525 (or point `EXTERNAL_BACKEND` at a grey-cloud / direct origin that Workers can Upgrade).

## Verify commands

```bash
# Unit / worker suite (ran green this session)
cd /mnt/data/home/jango/Git/hoox-open-trading-stack/axis
bun test worker/tests/live-proxy.test.ts \
  tests/engine/ws-client.test.ts \
  tests/hp/ingest-host.test.ts \
  tests/engine/live-ticket.test.ts
# → 73 pass, 0 fail (2026-11-19 stickiness re-run)

# Live probe (Mozilla UA; bare urllib gets CF 1010)
UA='Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
# mint with Authorization: Bearer <pn_…> → 200 ticket
# then HTTP/1.1 Upgrade to ?ticket= → 502 UPSTREAM_WS (until origin SSL fixed)
# direct: wss://pynescript.online/ws/live → open
```

## Deploy / decision needed

- **Pages deploy** required for client direct-fallback (ingest worker bundle).
- **Worker deploy** required for richer `UPSTREAM_WS` message text.
- **Origin/SSL or EXTERNAL_BACKEND** change required for the proxy path itself (525). Ask before production secret / CF SSL changes.

## Done checks

- [1] Artifact exists at `.openorchestrate/proof/p0-ws-live-upgrade-fail.md`
- [2] Verified: bun test 73 pass / 0 fail (stickiness included) + earlier live mint→502 + wrangler 525 + direct WSS open
- [3] Engineering-only (no push/deploy/secret mutation)
