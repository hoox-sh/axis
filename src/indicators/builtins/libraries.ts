// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-party AXIS **built-in libraries** — versioned Pine `library()`
 * sources shipped with the app, resolvable without the published cache or
 * git via `import axis/<Name>/<version> as alias`.
 *
 * These are the crown jewels of the built-in catalog: stateful UDTs with
 * method receivers, full type declarations, na-safe numerics, and documented
 * seeding semantics. They back the `axis-kit-*` indicators and the OOP-style
 * built-ins (ema / rma / atr), and are importable from any user script.
 *
 * Both libraries also export a fluent chain API: a `MaChain` / `OscChain`
 * pipeline built once in a `var` initializer (`axisMa.newChain().ema(9).rma(14)`)
 * and advanced one bar at a time with `feed(...)` — no per-bar plumbing.
 *
 * Unlike published libraries (see `storage/library-publish.ts`) these never
 * hit the network; `resolveLibrariesForScript` consults this registry first
 * and only falls back to the published cache / git for everything else.
 * The `axis` namespace is reserved for first-party libraries.
 *
 * @module indicators/builtins/libraries
 */

import { AXIS_PINE_BANNER } from './pine';

/** One first-party built-in library. */
export interface BuiltinLibrary {
  /** Always `axis` — the reserved first-party namespace. */
  namespace: 'axis';
  /** Library name as declared in `library("Name")` — e.g. `AxisMa`. */
  name: string;
  /** Library version pinned in imports: `import axis/AxisMa/1 as ma`. */
  version: number;
  /** Short picker / docs title. */
  title: string;
  /** One-line description for catalogs and docs. */
  description: string;
  /** Public TA idea this covers (not a vendor product name). */
  covers: string;
  tags: readonly string[];
  /** Full Pine source, starting with the AXIS banner + `//@version=6`. */
  source: string;
}

/** Engine payload for a resolved library import (`{ namespace, name, version, source }`). */
export interface BuiltinLibraryEnginePayload {
  namespace: string;
  name: string;
  version: number;
  source: string;
}

const AXIS_MA_SOURCE = `${AXIS_PINE_BANNER}// @description Stateful moving-average engine for AXIS: EMA and RMA as typed UDTs, plus a chained pipeline API.
// Seeds with the SMA of the first \`len\` non-na source values (like ta.ema / ta.rma), then recurses with alpha.
// Chained usage (built once per chart, evaluated once thanks to \`var\`):
//   var axisMa.MaChain pipe = axisMa.newChain().ema(20).rma(9)
//   out = pipe.feed(close)
library("AxisMa")

/// Exponential moving average state for one series.
/// Seeds with the SMA of the first \`len\` non-na source values, then recurses
/// with alpha = 2 / (len + 1) — identical to \`ta.ema\`.
/// @field value Current EMA; \`na\` until the seed window fills
/// @field len   Smoothing length (clamped to >= 1 at construction)
/// @field alpha Smoothing factor 2 / (len + 1)
/// @field sum   Accumulator for the seeding window (first \`len\` samples)
/// @field count Samples seen while seeding
export type EmaState
    float value
    int len
    float alpha
    float sum
    int count

/// Wilder RMA (smoothed moving average) state for one series.
/// Seeds with the SMA of the first \`len\` non-na source values, then recurses
/// with alpha = 1 / len — identical to \`ta.rma\`.
/// @field value Current RMA; \`na\` until the seed window fills
/// @field len   Smoothing length (clamped to >= 1 at construction)
/// @field alpha Smoothing factor 1 / len
/// @field sum   Accumulator for the seeding window (first \`len\` samples)
/// @field count Samples seen while seeding
export type RmaState
    float value
    int len
    float alpha
    float sum
    int count

/// Create an empty EMA state.
/// @param len Smoothing length; values < 1 are clamped to 1
export newEma(int len) =>
    int safeLen = math.max(1, len)
    EmaState.new(na, safeLen, 2.0 / (safeLen + 1), 0.0, 0)

/// Create an empty RMA state.
/// @param len Smoothing length; values < 1 are clamped to 1
export newRma(int len) =>
    int safeLen = math.max(1, len)
    RmaState.new(na, safeLen, 1.0 / safeLen, 0.0, 0)

/// Advance the EMA by one bar.
/// The first \`len\` non-na sources seed the average as their SMA; afterwards the
/// exponential recursion applies. Na source holds the state unchanged and
/// yields na. Field writes use arithmetic expressions on purpose: assigning a
/// bare series parameter to a UDT field stores a live series reference, so the
/// read-back would drift to the current bar — computed expressions snapshot.
/// @param this EMA state, mutated in place
/// @param src  Current source value (na-safe)
/// @returns    The current EMA, or na until seeded
export method update(EmaState this, float src) =>
    float out = na
    if na(src)
        out := this.value
    else if not na(this.value)
        this.value := this.alpha * src + (1.0 - this.alpha) * this.value
        out := this.value
    else
        this.sum := this.sum + src
        this.count := this.count + 1
        if this.count == this.len
            this.value := this.sum / this.len
            out := this.value
    out

/// Advance the RMA by one bar.
/// The first \`len\` non-na sources seed the average as their SMA; afterwards the
/// Wilder recursion applies. Na source holds the state unchanged and yields na.
/// @param this RMA state, mutated in place
/// @param src  Current source value (na-safe)
/// @returns    The current RMA, or na until seeded
export method update(RmaState this, float src) =>
    float out = na
    if na(src)
        out := this.value
    else if not na(this.value)
        this.value := this.alpha * src + (1.0 - this.alpha) * this.value
        out := this.value
    else
        this.sum := this.sum + src
        this.count := this.count + 1
        if this.count == this.len
            this.value := this.sum / this.len
            out := this.value
    out

/// Fluent, chained moving-average pipeline. Build once with \`var\`, then feed one
/// source value per bar — no per-bar state plumbing at the call site:
/// \`var axisMa.MaChain pipe = axisMa.newChain().ema(20).rma(9)\`
/// \`out = pipe.feed(close)\`
/// Stages run in the order they were added; each consumes the previous stage's
/// output. Building is a \`var\` initializer, so it runs once, not every bar.
/// An empty chain passes the source through unchanged. \`value\` mirrors the most
/// recent \`feed()\` output.
/// Implementation notes (this engine):
/// - Legs live in two parallel arrays of FLAT UDTs (\`array<EmaState>\` /
///   \`array<RmaState>\`) plus one \`array<int>\` for the leg order
///   (1 = EMA, 2 = RMA). An array of UDTs whose fields are themselves UDTs
///   reads back as \`na\` on this runtime, so there is deliberately no
///   stage/wrapper UDT here.
/// - \`feed\` walks \`order\` with two running counters, one per leg array.
/// - The loop is wrapped in \`if order.size() > 0\` because this runtime executes
///   \`for i = 0 to -1\` once instead of zero times (verified 2026-11); the guard
///   keeps an empty chain a pure pass-through.
/// - Arrays are grown with functional \`array.push\` on purpose — the
///   method-call sugar \`this.emas.push(x)\` silently drops the element on this runtime.
/// @field emas   EMA legs, in feed order
/// @field rmas   RMA legs, in feed order
/// @field order  Leg kinds in feed order: 1 = EMA, 2 = RMA
/// @field value  Latest \`feed()\` output (na until the chain seeds)
export type MaChain
    array<EmaState> emas
    array<RmaState> rmas
    array<int> order
    float value

/// Create an empty chain. Extend it with \`.ema(len)\` / \`.rma(len)\`.
export newChain() =>
    MaChain.new(array.new<EmaState>(), array.new<RmaState>(), array.new<int>(), na)

/// Append an EMA stage and return the chain (for chaining).
/// @param this Chain being built (mutated in place)
/// @param len  Smoothing length (clamped to >= 1 at construction)
export method ema(MaChain this, int len) =>
    array.push(this.emas, newEma(len))
    array.push(this.order, 1)
    this

/// Append an RMA (Wilder) stage and return the chain (for chaining).
/// @param this Chain being built (mutated in place)
/// @param len  Smoothing length (clamped to >= 1 at construction)
export method rma(MaChain this, int len) =>
    array.push(this.rmas, newRma(len))
    array.push(this.order, 2)
    this

/// Advance the whole chain by one bar and return the last stage's output.
/// Stage outputs are na until every window has seeded; na propagates stage to stage.
/// @param this Chain to advance
/// @param src  Current source value (na-safe)
/// @returns    The chain output for this bar (na until seeded)
export method feed(MaChain this, float src) =>
    float v = src
    int emaIdx = 0
    int rmaIdx = 0
    int n = this.order.size()
    if n > 0
        for i = 0 to n - 1
            int kind = this.order.get(i)
            if kind == 1
                EmaState e = this.emas.get(emaIdx)
                v := e.update(v)
                emaIdx := emaIdx + 1
            else
                RmaState r = this.rmas.get(rmaIdx)
                v := r.update(v)
                rmaIdx := rmaIdx + 1
    this.value := v
    v
`;

const AXIS_OSC_SOURCE = `${AXIS_PINE_BANNER}// @description Wilder-smoothed studies for AXIS: RSI and ATR (true range), plus a chained pipeline API.
// Both recurse with alpha = 1 / len and seed from the SMA of their first \`len\` samples (like ta.rsi / ta.atr).
// Chained usage (built once per chart, evaluated once thanks to \`var\`):
//   var axisOsc.OscChain pipe = axisOsc.newChain().rsi(14)
//   out = pipe.feed(high, low, close)
library("AxisOsc")

/// Relative Strength Index state (Wilder smoothing).
/// Seeds from the SMA of the first \`len\` up/down moves, then recurses with
/// alpha = 1 / len — identical to \`ta.rsi\`. Edge cases: a perfectly flat
/// window reads 50; zero average loss with positive gain reads 100.
/// @field avgGain Wilder-smoothed average gain (na until seeded)
/// @field avgLoss Wilder-smoothed average loss (na until seeded)
/// @field prevSrc Previous source value (na until the first bar is seen).
///                Stored via an arithmetic expression (\`src + 0.0\`) on purpose:
///                assigning a bare series parameter to a UDT field stores a
///                live series reference, which would read as the *current*
///                bar's source instead of the previous one.
/// @field gainSum Accumulator for the seeding window (average-gain numerator sum)
/// @field lossSum Accumulator for the seeding window (average-loss numerator sum)
/// @field len     Smoothing length (clamped to >= 1 at construction)
/// @field count   Moves seen while seeding
export type RsiState
    float avgGain
    float avgLoss
    float prevSrc
    float gainSum
    float lossSum
    int len
    int count

/// Average True Range state (Wilder smoothing of true range).
/// Seeds from the SMA of the first \`len\` true-range samples, then recurses
/// with alpha = 1 / len — identical to \`ta.atr\`.
/// @field value Current ATR; \`na\` until the seed window fills
/// @field len   Smoothing length (clamped to >= 1 at construction)
/// @field trSum Accumulator for the seeding window
/// @field count Samples seen while seeding
export type AtrState
    float value
    int len
    float trSum
    int count

/// Create an empty RSI state.
/// @param len Smoothing length; values < 1 are clamped to 1
export newRsi(int len) =>
    int safeLen = math.max(1, len)
    RsiState.new(na, na, na, 0.0, 0.0, safeLen, 0)

/// Create an empty ATR state.
/// @param len Smoothing length; values < 1 are clamped to 1
export newAtr(int len) =>
    int safeLen = math.max(1, len)
    AtrState.new(na, safeLen, 0.0, 0)

/// True range of one bar.
/// @param high      Bar high
/// @param low       Bar low
/// @param prevClose Previous close; pass \`na\` on the first bar (falls back to high - low)
/// @returns         The bar's true range (never na for real bars)
export trueRange(float high, float low, float prevClose) =>
    na(prevClose) ? high - low : math.max(high - low, math.abs(high - prevClose), math.abs(low - prevClose))

/// RSI level from Wilder averages. Flat window (both averages zero) reads 50;
/// zero average loss with positive gain reads 100 — both defined edge cases.
rsiFromAverages(float avgGain, float avgLoss) =>
    float out = 50.0
    if avgLoss == 0.0
        out := avgGain > 0.0 ? 100.0 : 50.0
    else
        float rs = avgGain / avgLoss
        out := 100.0 - 100.0 / (1.0 + rs)
    out

/// Advance the RSI by one bar.
/// The first bar only records the reference price. The next \`len\` moves seed
/// the averages as SMAs; afterwards the Wilder recursion applies. Na source
/// holds the state unchanged and yields na.
/// @param this RSI state, mutated in place
/// @param src  Current source value (na-safe)
/// @returns    The current RSI, or na until seeded
export method update(RsiState this, float src) =>
    float out = na
    if na(src)
        out := na
    else if na(this.prevSrc)
        // Snapshot, not a bare series reference (see type docs).
        this.prevSrc := src + 0.0
    else
        float change = src - this.prevSrc
        this.prevSrc := src + 0.0
        float gain = math.max(change, 0.0)
        float loss = math.max(-change, 0.0)
        if this.count < this.len
            this.gainSum := this.gainSum + gain
            this.lossSum := this.lossSum + loss
            this.count := this.count + 1
            if this.count == this.len
                this.avgGain := this.gainSum / this.len
                this.avgLoss := this.lossSum / this.len
                out := rsiFromAverages(this.avgGain, this.avgLoss)
        else
            this.avgGain := (this.avgGain * (this.len - 1) + gain) / this.len
            this.avgLoss := (this.avgLoss * (this.len - 1) + loss) / this.len
            out := rsiFromAverages(this.avgGain, this.avgLoss)
    out

/// Advance the ATR by one bar.
/// The first \`len\` bars seed the average as a simple mean of true range;
/// afterwards the Wilder recursion applies. A na \`prevClose\` on the first bar
/// falls back to high - low.
/// @param this      ATR state, mutated in place
/// @param high      Bar high
/// @param low       Bar low
/// @param prevClose Previous close; pass \`na\` on the first bar
/// @returns         The current ATR, or na until seeded
export method update(AtrState this, float high, float low, float prevClose) =>
    float tr = trueRange(high, low, prevClose)
    float out = na
    if this.count < this.len
        this.trSum := this.trSum + tr
        this.count := this.count + 1
        if this.count == this.len
            this.value := this.trSum / this.len
            out := this.value
    else
        this.value := (this.value * (this.len - 1) + tr) / this.len
        out := this.value
    out

/// Fluent, chained oscillator pipeline. Build once with \`var\`, then feed one
/// bar per bar — no per-bar state plumbing at the call site:
/// \`var axisOsc.OscChain pipe = axisOsc.newChain().rsi(14)\`
/// \`out = pipe.feed(high, low, close)\`
/// Stages run in the order they were added; RSI legs consume the running value
/// (the previous leg's output, or \`src\` for the first leg); ATR legs consume the
/// bar's \`high\` / \`low\` and \`src\` as their close. Building is a \`var\` initializer,
/// so it runs once, not every bar. An empty chain passes \`src\` through unchanged.
/// \`value\` mirrors the most recent \`feed()\` output.
/// Implementation notes (this engine):
/// - Legs live in two parallel arrays of FLAT UDTs (\`array<RsiState>\` /
///   \`array<AtrState>\`) plus one \`array<int>\` for the leg order
///   (1 = RSI, 2 = ATR). An array of UDTs whose fields are themselves UDTs
///   reads back as \`na\` on this runtime, so there is deliberately no
///   stage/wrapper UDT here.
/// - RSI legs consume the running value fed through the chain. ATR legs ignore
///   the running value and consume the bar's \`high\` / \`low\` plus the previous
///   raw \`src\` passed to \`feed()\` as their close — tracked once per bar on the
///   chain (\`prevSrc\`), not per leg, because every ATR leg sees the same bars.
/// - \`feed\` walks \`order\` with two running counters, one per leg array. The
///   loop is wrapped in \`if order.size() > 0\` because this runtime executes
///   \`for i = 0 to -1\` once instead of zero times (verified 2026-11); the
///   guard keeps an empty chain a pure pass-through.
/// - Arrays are grown with functional \`array.push\` on purpose — the
///   method-call sugar \`this.rsis.push(x)\` silently drops the element on this runtime.
/// @field rsis     RSI legs, in feed order
/// @field atrs     ATR legs, in feed order
/// @field order    Leg kinds in feed order: 1 = RSI, 2 = ATR
/// @field prevSrc  Previous raw \`src\` seen by \`feed()\` (na until the first bar).
///                 Stored via an arithmetic expression (\`src + 0.0\`) on purpose:
///                 assigning a bare series parameter to a UDT field stores a
///                 live series reference, which would read as the *current*
///                 bar's source instead of the previous one.
/// @field value    Latest \`feed()\` output (na until every seeded leg warms up)
export type OscChain
    array<RsiState> rsis
    array<AtrState> atrs
    array<int> order
    float prevSrc
    float value

/// Create an empty chain. Extend it with \`.rsi(len)\` / \`.atr(len)\`.
export newChain() =>
    OscChain.new(array.new<RsiState>(), array.new<AtrState>(), array.new<int>(), na, na)

/// Append an RSI leg and return the chain (for chaining).
/// @param this Chain being built (mutated in place)
/// @param len  Smoothing length (clamped to >= 1 at construction)
export method rsi(OscChain this, int len) =>
    array.push(this.rsis, newRsi(len))
    array.push(this.order, 1)
    this

/// Append an ATR leg and return the chain (for chaining).
/// The leg consumes the bar passed to \`feed()\` (\`high\`, \`low\`, and \`src\` as close),
/// not the running value — placing an ATR leg anywhere in the chain yields the
/// same series. The shared \`prevSrc\` on the chain is the previous raw \`src\`.
/// @param this Chain being built (mutated in place)
/// @param len  Smoothing length (clamped to >= 1 at construction)
export method atr(OscChain this, int len) =>
    array.push(this.atrs, newAtr(len))
    array.push(this.order, 2)
    this

/// Advance the whole chain by one bar and return the last leg's output.
/// \`src\` doubles as the close for ATR legs (true range uses the previous raw
/// \`src\`, captured once per bar before any leg runs); RSI legs consume the
/// running value instead. Each ATR leg's output replaces the running value.
/// Outputs are na until every leg has seeded; na propagates stage to stage.
/// @param this Chain to advance
/// @param high Current bar high
/// @param low  Current bar low
/// @param src  Current source (RSI input, and the ATR close series)
/// @returns    The chain output for this bar (na until seeded)
export method feed(OscChain this, float high, float low, float src) =>
    float v = src
    float prevClose = this.prevSrc
    int rsiIdx = 0
    int atrIdx = 0
    int n = this.order.size()
    if n > 0
        for i = 0 to n - 1
            int kind = this.order.get(i)
            if kind == 1
                RsiState r = this.rsis.get(rsiIdx)
                v := r.update(v)
                rsiIdx := rsiIdx + 1
            else
                AtrState a = this.atrs.get(atrIdx)
                v := a.update(high, low, prevClose)
                atrIdx := atrIdx + 1
    this.prevSrc := src + 0.0
    this.value := v
    v
`;

/**
 * The two first-party built-in libraries, `axis/AxisMa/1` and `axis/AxisOsc/1`.
 * Consumers import them like any Pine library: `import axis/AxisMa/1 as ma`.
 */
export const BUILTIN_LIBRARIES: readonly BuiltinLibrary[] = [
  {
    namespace: 'axis',
    name: 'AxisMa',
    version: 1,
    title: 'AXIS Moving Average Engine',
    description:
      'Stateful EMA / Wilder RMA as typed UDTs with method receivers, plus a fluent MaChain pipeline (newChain().ema(n).rma(m).feed(src)). SMA-seeded like ta.ema / ta.rma; na-safe; reusable across studies.',
    covers: 'Exponential moving average / Wilder RMA state machines (chained pipeline)',
    tags: ['library', 'ma', 'ema', 'rma', 'oop', 'udt', 'chain'],
    source: AXIS_MA_SOURCE,
  },
  {
    namespace: 'axis',
    name: 'AxisOsc',
    version: 1,
    title: 'AXIS Wilder Oscillator Engine',
    description:
      'Wilder-smoothed RSI and ATR (true range) as typed UDTs with method receivers, plus a fluent OscChain pipeline (newChain().rsi(n).atr(m).feed(high, low, src)). SMA-seeded like ta.rsi / ta.atr; na-safe seeding and edge-case-safe zero handling.',
    covers: 'Relative Strength Index / Average True Range (Wilder, chained pipeline)',
    tags: ['library', 'rsi', 'atr', 'wilder', 'oop', 'udt', 'chain'],
    source: AXIS_OSC_SOURCE,
  },
];

/** Look up a built-in library by exact coordinates. */
export function getBuiltinLibrary(
  namespace: string,
  name: string,
  version: number,
): BuiltinLibrary | undefined {
  return BUILTIN_LIBRARIES.find(
    (lib) => lib.namespace === namespace && lib.name === name && lib.version === version,
  );
}

/**
 * Resolve one import spec against the built-in registry.
 * Returns `undefined` for anything outside `axis/*` (published-cache territory).
 */
export function resolveBuiltinLibrary(spec: {
  namespace: string;
  name: string;
  version: number;
}): BuiltinLibrary | undefined {
  return getBuiltinLibrary(spec.namespace, spec.name, spec.version);
}

/** Engine payload shape (`{ namespace, name, version, source }`). */
export function builtinLibraryEnginePayload(lib: BuiltinLibrary): BuiltinLibraryEnginePayload {
  return { namespace: lib.namespace, name: lib.name, version: lib.version, source: lib.source };
}

/** Minimal shape of an import spec; `LibraryImportSpec` from storage satisfies it. */
export interface BuiltinImportSpec {
  namespace: string;
  name: string;
  version: number;
}

/**
 * Split `parseLibraryImports` output into built-in hits and the remainder.
 * Built-ins win over any published/cached library with the same coordinates —
 * the `axis` namespace is reserved for first-party code.
 */
export function resolveBuiltinLibraryImports<T extends BuiltinImportSpec>(
  specs: readonly T[],
): { libraries: BuiltinLibraryEnginePayload[]; rest: T[] } {
  const libraries: BuiltinLibraryEnginePayload[] = [];
  const rest: T[] = [];
  for (const spec of specs) {
    const hit = resolveBuiltinLibrary(spec);
    if (hit) libraries.push(builtinLibraryEnginePayload(hit));
    else rest.push(spec);
  }
  return { libraries, rest };
}
