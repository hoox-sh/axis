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
 * Feed wire protocol primitives: canonical feed keys, delta/snapshot
 * payloads, sequencing, and a pure merge for incremental bars.
 *
 * Dependency-free except for the {@link Bar} type. Everything here is pure:
 * no store access, no I/O, no clocks. Seq tracking is delegated to
 * {@link FeedSeqTracker}; {@link applyFeedDelta} merges strictly by bar time
 * and deliberately knows nothing about seq ordering.
 *
 * Wire kinds at the trust boundary (see {@link parseFeedMessage}):
 *   { kind: 'snapshot', feed, seq, from, to, bars: [...] }
 *   { kind: 'delta',    feed, seq, forming, upTo, times/open/high/low/close/volume }
 *
 * `seq` is the ordering primitive. `upTo` is an opaque high-water mark
 * supplied by the venue (bar time, Unix seconds) and is informational only.
 *
 * @module engine/feed-client
 */

import type { Bar } from '../store/types';

/** Adjustment mode carried by a feed key. */
export type FeedAdjustment = 'none' | 'split' | 'dividend';

/** `public`, or `user:<hash>` for an authenticated scope. */
export type FeedAuthScope = 'public' | `user:${string}`;

/** The coordinates that identify one feed. All fields are canonical (see encode). */
export interface FeedKey {
  /** Venue id, lowercase (e.g. `binance`). */
  venue: string;
  /** Market segment, lowercase (e.g. `spot`, `linear`). */
  market: string;
  /** Pair-form symbol, uppercase (e.g. `BTC/USDT`). */
  symbol: string;
  /** Bar interval (e.g. `1m`, `4h`, `1d`). */
  interval: string;
  /** Price adjustment applied by the venue. */
  adjustment: FeedAdjustment;
  /** Auth scope: `public` or `user:<hash>`. */
  authScope: string;
}

const VENUE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/;
const INTERVAL_RE = /^[0-9]+[smhdwMy]$/;
const AUTH_SCOPE_RE = /^(public|user:[A-Za-z0-9._-]+)$/;
const ADJUSTMENTS: ReadonlySet<string> = new Set(['none', 'split', 'dividend']);
const FEED_KEY_SEPARATOR = '|';
const FEED_KEY_PARTS = 6;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFeedAdjustment(value: unknown): value is FeedAdjustment {
  return typeof value === 'string' && ADJUSTMENTS.has(value);
}

/**
 * Canonical feed key: `venue|market|SYMBOL|interval|adjustment|authScope`.
 * Venue and market are lowercased, the symbol is uppercased, the rest are
 * validated verbatim. Throws on empty or non-canonical parts — encode never
 * produces a key a strict {@link decodeFeedKey} would reject.
 */
export function encodeFeedKey(parts: FeedKey): string {
  if (parts === null || typeof parts !== 'object') {
    throw new Error('feed-client: FeedKey parts must be an object');
  }
  const raw: ReadonlyArray<unknown> = [
    parts.venue,
    parts.market,
    parts.symbol,
    parts.interval,
    parts.adjustment,
    parts.authScope,
  ];
  for (const part of raw) {
    if (!isNonEmptyString(part)) {
      throw new Error('feed-client: feed key parts must be non-empty strings');
    }
  }

  const venue = (parts.venue as string).trim().toLowerCase();
  const market = (parts.market as string).trim().toLowerCase();
  const symbol = (parts.symbol as string).trim().toUpperCase();
  const interval = (parts.interval as string).trim();
  const adjustment = (parts.adjustment as string).trim();
  const authScope = (parts.authScope as string).trim();

  if (!VENUE_RE.test(venue))
    throw new Error(`feed-client: invalid venue: ${JSON.stringify(parts.venue)}`);
  if (!VENUE_RE.test(market))
    throw new Error(`feed-client: invalid market: ${JSON.stringify(parts.market)}`);
  if (!SYMBOL_RE.test(symbol))
    throw new Error(`feed-client: invalid symbol: ${JSON.stringify(parts.symbol)}`);
  if (!INTERVAL_RE.test(interval))
    throw new Error(`feed-client: invalid interval: ${JSON.stringify(parts.interval)}`);
  if (!isFeedAdjustment(adjustment)) {
    throw new Error(`feed-client: invalid adjustment: ${JSON.stringify(parts.adjustment)}`);
  }
  if (!AUTH_SCOPE_RE.test(authScope)) {
    throw new Error(`feed-client: invalid authScope: ${JSON.stringify(parts.authScope)}`);
  }

  return [venue, market, symbol, interval, adjustment, authScope].join(FEED_KEY_SEPARATOR);
}

/**
 * Strictly decode a canonical feed key. Returns `null` for anything that is
 * not exactly the canonical form produced by {@link encodeFeedKey} (wrong
 * segment count, non-canonical casing, bad symbol/interval/adjustment/scope).
 */
export function decodeFeedKey(key: string): FeedKey | null {
  if (typeof key !== 'string') return null;
  const segments = key.split(FEED_KEY_SEPARATOR);
  if (segments.length !== FEED_KEY_PARTS) return null;
  const [venue, market, symbol, interval, adjustment, authScope] = segments as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  if (!VENUE_RE.test(venue)) return null;
  if (!VENUE_RE.test(market)) return null;
  if (!SYMBOL_RE.test(symbol)) return null;
  if (!INTERVAL_RE.test(interval)) return null;
  if (!isFeedAdjustment(adjustment)) return null;
  if (!AUTH_SCOPE_RE.test(authScope)) return null;

  return { venue, market, symbol, interval, adjustment, authScope };
}

/** Incremental update for one feed. Parallel arrays, shared `seq`. */
export interface FeedDelta {
  /** Feed key (see {@link encodeFeedKey}). */
  feed: string;
  /** Monotonic sequence number; integer >= 0. Ordering primitive. */
  seq: number;
  /** True while the final point in this batch is still a forming bar. */
  forming: boolean;
  /** High-water mark (bar time, Unix seconds) covered by this delta. Informational. */
  upTo: number;
  times: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

/** Full-range baseline for one feed. */
export interface FeedSnapshot {
  /** Feed key (see {@link encodeFeedKey}). */
  feed: string;
  /** Sequence number the snapshot was taken at; integer >= 0. */
  seq: number;
  /** First bar time covered (Unix seconds). */
  from: number;
  /** Last bar time covered (Unix seconds); must be >= `from`. */
  to: number;
  bars: Bar[];
}

/**
 * Tracks the seq of an ordered delta stream.
 *
 * `expected` starts at `0`, which means "unknown": the first pushed seq is
 * accepted as ours. Afterwards the expected seq is exactly `lastSeq + 1`.
 * A duplicate is `seq <= lastSeq`; anything else above expected is a `gap`
 * (state is left untouched so the caller can resync from a snapshot).
 */
export class FeedSeqTracker {
  private last: number | null = null;

  /** Last accepted seq, or `null` before the first push / after `reset()`. */
  get lastSeq(): number | null {
    return this.last;
  }

  /** Next expected seq. `0` means unknown (nothing accepted yet). */
  get expected(): number {
    return this.last === null ? 0 : this.last + 1;
  }

  /**
   * Classify an incoming seq. `apply` advances the tracker; `duplicate` and
   * `gap` leave it untouched. Non-integer or negative input is a `gap`.
   */
  push(seq: number): 'apply' | 'duplicate' | 'gap' {
    if (!Number.isInteger(seq) || seq < 0) return 'gap';
    if (this.last === null) {
      this.last = seq;
      return 'apply';
    }
    if (seq === this.last + 1) {
      this.last = seq;
      return 'apply';
    }
    if (seq <= this.last) return 'duplicate';
    return 'gap';
  }

  /** Clear all tracking; the next push is accepted as the first. */
  reset(): void {
    this.last = null;
  }
}

/** Result of a successful {@link applyFeedDelta} merge. */
export interface ApplyFeedDeltaResult {
  /** New array; the input array is never mutated. */
  bars: Bar[];
  /** How many bars were appended. */
  appended: number;
  /** True when the tip bar was overwritten in place (forming bar update). */
  replacedTip: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStrictlyIncreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === undefined || curr === undefined || !(curr > prev)) return false;
  }
  return true;
}

function readNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!isFiniteNumber(item)) return null;
  }
  return value.slice();
}

/**
 * Merge a delta into `bars`, purely by bar time.
 *
 * Rules:
 * - Returns `null` when the delta is structurally invalid (bad arrays,
 *   non-finite or non-increasing times), when it does not match the optional
 *   `snapshot` feed, or when any point is older than the current last bar.
 * - A point whose time equals the last bar's time overwrites that bar in
 *   place while the bar is not `closed` (forming bar; `time` preserved).
 *   If the last bar is already `closed`, the whole delta is rejected (`null`):
 *   silently rewriting a finalized bar or duplicating its timestamp would
 *   corrupt the series.
 * - Otherwise the point is appended; appending marks the previous last bar
 *   `closed: true`. The final bar's `closed` flag is set from
 *   `!delta.forming` (all earlier bars in the batch are closed by roll-over).
 *
 * Never mutates `bars`; always returns a fresh array on success.
 */
export function applyFeedDelta(
  bars: Bar[],
  snapshot: FeedSnapshot | null,
  delta: FeedDelta,
): ApplyFeedDeltaResult | null {
  if (!Array.isArray(bars)) return null;
  if (delta === null || typeof delta !== 'object') return null;
  if (snapshot !== null && snapshot !== undefined && snapshot.feed !== delta.feed) {
    return null;
  }

  if (typeof delta.feed !== 'string' || delta.feed.length === 0) return null;
  if (!isNonNegativeInteger(delta.seq)) return null;
  if (typeof delta.forming !== 'boolean') return null;
  if (!isFiniteNumber(delta.upTo)) return null;

  const times = readNumberArray(delta.times);
  const open = readNumberArray(delta.open);
  const high = readNumberArray(delta.high);
  const low = readNumberArray(delta.low);
  const close = readNumberArray(delta.close);
  const volume = readNumberArray(delta.volume);
  if (!times || !open || !high || !low || !close || !volume) return null;

  const n = times.length;
  if (n === 0) return null;
  if (
    open.length !== n ||
    high.length !== n ||
    low.length !== n ||
    close.length !== n ||
    volume.length !== n
  ) {
    return null;
  }
  if (!isStrictlyIncreasing(times)) return null;

  const lastInput = bars.length > 0 ? bars[bars.length - 1] : undefined;
  const lastInputTime = lastInput?.time;
  if (lastInput !== undefined && !isFiniteNumber(lastInputTime)) return null;
  const firstIncoming = times[0];
  if (firstIncoming === undefined) return null;
  if (lastInputTime !== undefined && firstIncoming < lastInputTime) return null;

  const out = bars.slice();
  let appended = 0;
  let replacedTip = false;

  for (let i = 0; i < n; i += 1) {
    const t = times[i] as number;
    const incoming: Bar = {
      time: t,
      open: open[i] as number,
      high: high[i] as number,
      low: low[i] as number,
      close: close[i] as number,
      volume: volume[i] as number,
      closed: !delta.forming,
    };

    const lastIdx = out.length - 1;
    const last = lastIdx >= 0 ? out[lastIdx] : undefined;

    if (last !== undefined && t === last.time && last.closed !== true) {
      // Forming-bar overwrite; `time` preserved, history untouched.
      out[lastIdx] = incoming;
      replacedTip = true;
      continue;
    }
    if (last !== undefined && t <= last.time) {
      // Only reachable when t === last.time and the tip bar is already
      // closed — rewriting a finalized bar or duplicating its timestamp
      // would corrupt the series, so reject the whole delta.
      return null;
    }
    if (last !== undefined) {
      out[lastIdx] = { ...last, closed: true };
    }
    out.push(incoming);
    appended += 1;
  }

  const tip = out[out.length - 1];
  if (tip !== undefined) {
    out[out.length - 1] = { ...tip, closed: !delta.forming };
  }

  return { bars: out, appended, replacedTip };
}

/** Narrowed result of {@link parseFeedMessage}. */
export type ParsedFeedMessage =
  { kind: 'snapshot'; snapshot: FeedSnapshot } | { kind: 'delta'; delta: FeedDelta };

function readFeedString(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function parseDeltaMessage(msg: Record<string, unknown>): ParsedFeedMessage | null {
  const feed = readFeedString(msg['feed']);
  if (feed === null) return null;
  if (!isNonNegativeInteger(msg['seq'])) return null;
  if (typeof msg['forming'] !== 'boolean') return null;
  if (!isFiniteNumber(msg['upTo'])) return null;

  const times = readNumberArray(msg['times']);
  const open = readNumberArray(msg['open']);
  const high = readNumberArray(msg['high']);
  const low = readNumberArray(msg['low']);
  const close = readNumberArray(msg['close']);
  const volume = readNumberArray(msg['volume']);
  if (!times || !open || !high || !low || !close || !volume) return null;

  const n = times.length;
  if (n === 0) return null;
  if (
    open.length !== n ||
    high.length !== n ||
    low.length !== n ||
    close.length !== n ||
    volume.length !== n
  ) {
    return null;
  }
  if (!isStrictlyIncreasing(times)) return null;

  return {
    kind: 'delta',
    delta: {
      feed,
      seq: msg['seq'],
      forming: msg['forming'],
      upTo: msg['upTo'],
      times,
      open,
      high,
      low,
      close,
      volume,
    },
  };
}

function parseBar(value: unknown): Bar | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const bar = value as Record<string, unknown>;
  if (!isFiniteNumber(bar['time'])) return null;
  if (
    !isFiniteNumber(bar['open']) ||
    !isFiniteNumber(bar['high']) ||
    !isFiniteNumber(bar['low']) ||
    !isFiniteNumber(bar['close'])
  ) {
    return null;
  }
  const out: Bar = {
    time: bar['time'],
    open: bar['open'],
    high: bar['high'],
    low: bar['low'],
    close: bar['close'],
  };
  if (bar['volume'] !== undefined) {
    if (!isFiniteNumber(bar['volume'])) return null;
    out.volume = bar['volume'];
  }
  if (bar['closed'] !== undefined) {
    if (typeof bar['closed'] !== 'boolean') return null;
    out.closed = bar['closed'];
  }
  return out;
}

function parseSnapshotMessage(msg: Record<string, unknown>): ParsedFeedMessage | null {
  const feed = readFeedString(msg['feed']);
  if (feed === null) return null;
  if (!isNonNegativeInteger(msg['seq'])) return null;
  if (!isFiniteNumber(msg['from']) || !isFiniteNumber(msg['to'])) return null;
  if (msg['to'] < msg['from']) return null;
  if (!Array.isArray(msg['bars'])) return null;

  const bars: Bar[] = [];
  let prevTime = Number.NEGATIVE_INFINITY;
  for (const raw of msg['bars']) {
    const bar = parseBar(raw);
    if (bar === null) return null;
    if (!(bar['time'] > prevTime)) return null;
    prevTime = bar['time'];
    bars.push(bar);
  }

  return {
    kind: 'snapshot',
    snapshot: { feed, seq: msg['seq'], from: msg['from'], to: msg['to'], bars },
  };
}

/**
 * Narrow an unknown WS payload into a snapshot or delta. This is the trust
 * boundary: anything malformed — wrong types, non-finite numbers, mismatched
 * array lengths, non-increasing times, bad seq — returns `null`. Unknown
 * extra fields are ignored for forward compatibility; parsed payloads are
 * fresh objects, detached from the raw input.
 */
export function parseFeedMessage(raw: unknown): ParsedFeedMessage | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const msg = raw as Record<string, unknown>;
  if (msg['kind'] === 'delta') return parseDeltaMessage(msg);
  if (msg['kind'] === 'snapshot') return parseSnapshotMessage(msg);
  return null;
}
