# Direct `/ws/live` fallback keeps the engine key off the URL

Date: 2026-11-19
Seat: oo-spec-2
Card: Live fallback must not put the engine key on the WebSocket URL

## Checklist

[1] PASS direct fallback URL is `wss://<engine>/ws/live` with an empty query (`endpointToRedesign2WsUrl` drops any incoming search, including `api_key`)
[2] PASS auth still sends `{ type: 'auth', payload: { token } }` after open; fixture token is `pyn_test` and is not on the URL
[3] PASS a rejected key (`UNAUTHORIZED` / "Invalid or missing API key", `retryable: false`) clears prefer-direct, does not open another socket, and surfaces `error` then `closed`
[4] PASS pre-open ticket failure still dials the direct URL (no `?ticket=`) on reconnect and on a later host `connect` while down
[5] PASS a proxy socket that reached open still remints; `disconnect` still clears prefer-direct so the next session tries the Worker ticket first
[6] PASS `axisDebugSafeUrl` is unchanged and still strips query/hash (`tests/axis-debug.test.ts` still pins that; not part of this suite)
[7] PASS PYNE was not modified. `serve_live_ws` already upgrades with an empty `extract_handshake_key` and `_handle_auth` accepts the auth frame
[8] PASS command proof: exit 0, 75 pass, 0 fail, 285 expect() calls

## Server check (no PYNE edit)

`/mnt/data/home/jango/Git/hoox-open-trading-stack/pynescript/backend/api/live_ws.py`

- `extract_handshake_key` reads `Authorization` or `?api_key=` / `?token=` and returns `""` when both are absent. It does not reject the upgrade.
- `serve_live_ws` sets `authed` only when that value validates, then keeps the socket open for an `auth` frame.
- `LiveConnection._handle_auth` validates `payload.token` and replies `auth.ok` or `{ type: "error", code: "UNAUTHORIZED", message: "Invalid or missing API key", retryable: false }`.

The tree at `/mnt/data/home/jango/Git/pynescript` has no engine sources. No deploy.

## Verify

```bash
cd /mnt/data/home/jango/Git/hoox-open-trading-stack/axis
bun test tests/engine/ws-client.test.ts tests/hp/ingest-host.test.ts tests/engine/live-ticket.test.ts worker/tests/live-proxy.test.ts
```

This process: 75 pass, 0 fail, 285 expect() calls, exit 0.

Ledger: `oo proof attach` id `ddba83b2-ce54-4984-97db-a39a586c6af1`, `--run`, expected exit 0, got exit 0.
