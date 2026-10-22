---
type: "Code Module"
title: "src/hp/axb1"
description: "AXB1 binary protocol (HP PR 1)."
resource: "src/hp/axb1"
tags: [axb1, code, hp]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-10-22T11:00:42Z
sources:
  - id: tree
    resource: "src/hp/axb1"
    title: "src/hp/axb1"
    author: process:git
okf_lock: generated
---

# Files

* `binary.ts` — BinReader, BinWriter, assertI64Aligned
* `constants.ts` — AXB1_HDR_COMPRESSED, AXB1_HDR_HAS_SUB_ID, AXB1_HEADER_BYTES, AXB1_MAGIC, AXB1_MAX_PAYLOAD, AXB1_STATUS_CODES, AXB1_VERSION, Axb1Opcode, Axb1StatusCode, HOT_CAP, HPC1_MAGIC, PRICE_SCALE_DEFAULT
* `decode.ts` — Axb1Envelope, bytesToHex, decodeEnvelope, decodeFrame, hexToBytes, looksLikeAxb1
* `encode.ts` — encodeEnvelope, encodeFrame
* `hash.ts` — fnv1a32
* `index.ts` — assertI64Aligned
* `ticks.ts` — assertPriceScale, decimalToTicks, float32LosesTicks, priceToTicks, ticksToPrice
* `types.ts` — Axb1Frame, Axb1HeaderFields, Axb1OhlcvSnapshot, Axb1PlotColumn, Axb1TipFields

# Used by

* [scripts](/code/scripts.md)
* [src/hp](/code/src/hp.md)
* [src/hp/calc](/code/src/hp/calc.md)
* [src/hp/memory](/code/src/hp/memory.md)
* [src/hp/workers](/code/src/hp/workers.md)
* [tests/hp](/code/tests/hp.md)
