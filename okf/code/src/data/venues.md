---
type: "Code Module"
title: "src/data/venues"
description: "Venue HMAC signers for authenticated CEX REST (spot klines / private GET)."
resource: "src/data/venues"
tags: [code, data, venues]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/data/venues"
    title: "src/data/venues"
    author: process:git
okf_lock: generated
---

# Files

* `binance.ts` — BINANCE_BASE, BINANCE_KLINES_PATH, signBinance
* `bybit.ts` — BYBIT_BASE, BYBIT_KLINE_PATH, signBybit
* `coinbase.ts` — COINBASE_BASE, signCoinbase
* `index.ts` — BINANCE_BASE, BINANCE_KLINES_PATH, BYBIT_BASE, BYBIT_KLINE_PATH, COINBASE_BASE, DEFAULT_RECV_WINDOW, KRAKEN_BASE, KRAKEN_OHLC_PATH, MEXC_BASE, MEXC_KLINES_PATH, OKX_BASE, OKX_CANDLES_PATH
* `kraken.ts` — KRAKEN_BASE, KRAKEN_OHLC_PATH, signKraken
* `mexc.ts` — MEXC_BASE, MEXC_KLINES_PATH, mexcKlineInterval, mexcSpotSymbol, mexcWsKlineInterval, signMexc
* `okx.ts` — OKX_BASE, OKX_CANDLES_PATH, OkxCreds, okxHeaders, signOkx
* `types.ts` — DEFAULT_RECV_WINDOW, SignInput, SignedRequest, VenueId, absoluteUrl, base64ToBytes, buildQueryString, bytesToBase64, bytesToHex, concatBytes, encodeUtf8, hmacDigest

# Used by

* [src/data](/code/src/data.md)
* [src/sources](/code/src/sources.md)
* [src/streams](/code/src/streams.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
