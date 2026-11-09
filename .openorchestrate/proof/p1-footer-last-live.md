# P1: Footer Last + Live chip — engineering proof

Date: 2026-11-09
Seat: oo-spec-2 (draft)

## Cause

1. **Last.** `TickPulse` rendered `store.telemetry.lastTick` with no symbol scope. `loadBars` / `noteTick` did not drop a previous pair’s tick, so BTCUSDT → ETHUSDT kept ~75,128 until reload. Quote/price panels already filtered; the scanline did not.
2. **Live.** The chip used `store.stream.status === 'connected'` (venue plugin). Script cards use `store.live.scriptStatus` / the engine `/ws/live` wire. Venue `connected` + `wire.open=false` / `degraded · websocket · no-auth` still said **Live**.

## Fix

- `loadBars` clears `lastTick` + pending `frameTick` on symbol/interval/exchange change.
- `noteTick` / flush ignore a foreign symbol.
- `lastTickForSymbol` + `displayedLastPrice` on the scanline Last chip.
- `liveBadgeTone` / `liveBadgeWord`: Live only when the arm is open; otherwise Degraded / Offline / REST. `readLiveArm()` shared by ConnectionHud, Topbar, mobile.

## Verify

```text
bun test --isolate tests/hud-model.test.ts tests/hud-inspector.test.ts tests/store.test.ts tests/store-live-frame.test.ts tests/extras-quote.test.ts
```

Result: **131 pass, 0 fail**, exit 0.

Local app was not up (no :5173). No browser after-shot this gate. Pages (`axis.hoox.sh`) still serves the previous build.

## Not this card

P2: Quiet Binance CORS/401 console and honest degraded feed.
