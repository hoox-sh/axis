---
type: "Code Module"
title: "src/engine"
description: "Redesign2 engine module barrel."
resource: "src/engine"
tags: [code, engine]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-26T04:52:20Z
sources:
  - id: tree
    resource: "src/engine"
    title: "src/engine"
    author: process:git
okf_lock: generated
---

# Files

* `apply-bridge.ts` — ApplyStreamInput, StreamFullPayload, StreamVia, _clearApplyBridgeCachesForTests, applyStreamDelta, applyStreamPayload, resolveStreamExecutionContext, streamFullToPrecomputed
* `bar-close-verify.ts` — ClosedOhlcv, Redesign2BarCloseVerifier, VerificationResult, VerifyRequest, compareClosedOhlcv, verifyRequestFor
* `client-apply.ts` — ApplyState, DeltaApplierDelta, DeltaApplierFull, DeltaApplyOutcome, Redesign2ApplyStateManager, Redesign2DeltaApplier, readTimeList, scriptDeltaTimeTail
* `feature-flag.ts` — STREAM_ENGINE_FLAG_KEY, isStreamEngineDisabled, isStreamEngineEnabled, setStreamEngineEnabled
* `frames.ts` — DeltaBlock, FrameBar, Redesign2AuthFrame, Redesign2AuthOkFrame, Redesign2CloseFrame, Redesign2DeltaFrame, Redesign2ErrorFrame, Redesign2Frame, Redesign2FullFrame, Redesign2PingFrame, Redesign2PongFrame, Redesign2RepairFrame
* `index.ts`
* `live-ticket.ts` — LIVE_TICKET_TTL_S, LiveProxy, LiveTicketError, isLiveTicketError, liveProxyForEngine, liveTicketRetryable, mintLiveTicket, shouldUseLiveProxy, workerLiveHttpUrl, workerLiveWsUrl
* `live-wire.ts` — EvalScriptInput, HIDDEN_WAKE_MS, StreamFallbackError, StreamLiveWire, WireClient, WireFrame, WireHandlers
* `market-identity.ts` — CatalogSymbol, MarketIdentity, currentSeriesKey, marketIdentityKey, pairFormSymbol, sameMarketIdentity
* `policy.ts` — ClientVenueStreamMode, DATA_PLANE_DEFAULT_LEVERS, DEFAULT_DATA_PLANE_POLICY, DataPlanePolicy, EngineProfile, EngineProfileCaps, profileForCapabilities
* `rest-fallback.ts` — Redesign2RestRequest, Redesign2TailEnvelope, Redesign2TailRequest, buildSessionTailUrl, requestRedesign2RestFrame, requestSessionTail
* `router.ts` — RouteDecision, routeEngineRun
* `session-broker.ts` — Redesign2Session, Redesign2SessionBroker
* `session-multiplexer.ts` — Redesign2SessionHandler, Redesign2SessionMultiplexer
* `wire-bookkeeping.ts` — PendingRequests, ReconnectHandlers, WireStats, wireStats
* `ws-client.ts` — Redesign2WsAuth, Redesign2WsClient, Redesign2WsClientOptions, Redesign2WsFrame, Redesign2WsFrameType, endpointToRedesign2WsUrl

# Depends on

* [src](/code/src.md)
* [src/data](/code/src/data.md)
* [src/engine/v1](/code/src/engine/v1.md)
* [src/engines](/code/src/engines.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/utils](/code/src/utils.md)

# Used by

* [src/engine/v1](/code/src/engine/v1.md)
* [src/engines](/code/src/engines.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [src/mcp](/code/src/mcp.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests/engine](/code/tests/engine.md)
* [tests/hp](/code/tests/hp.md)
* [tests/integration](/code/tests/integration.md)

# Nested

* [src/engine/v1](/code/src/engine/v1.md)
