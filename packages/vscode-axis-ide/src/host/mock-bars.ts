// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Deterministic mock OHLCV bars for chart.full (PR-05 / Task 07).
 *
 * Wire shape (LWC candlestick-compatible, unix **seconds**):
 *   `{ time, open, high, low, close, volume }`
 */

/** Canonical bar posted on `chart.full.bars` and painted by the webview. */
export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Hard cap — keep in sync with `axis.chart.historyBars` maximum in package.json.
 * Counts above this are clamped (never silently ignored).
 */
export const MOCK_BARS_CAP = 20_000;

/** Default when neither doc nor setting supplies a count. */
export const MOCK_BARS_DEFAULT = 1500;

const INTERVAL_SECONDS: Record<string, number> = {
  '1s': 1,
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '45m': 2700,
  '1h': 3600,
  '2h': 7200,
  '3h': 10800,
  '4h': 14400,
  '6h': 21600,
  '12h': 43200,
  '1d': 86400,
  '1w': 604800,
};

/** Interval string → bar step in seconds (unknown → 60). */
export function intervalToSeconds(interval: string): number {
  const key = String(interval ?? '')
    .trim()
    .toLowerCase();
  return INTERVAL_SECONDS[key] ?? 60;
}

/** FNV-1a 32-bit — stable seed from seriesKey / symbol text. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — deterministic given a 32-bit seed. */
export function createPrng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clamp requested history length for mock generation.
 * Negatives / NaN → 0; otherwise floor and cap at {@link MOCK_BARS_CAP}.
 */
export function clampMockBarCount(count: number): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return 0;
  return Math.min(MOCK_BARS_CAP, Math.floor(count));
}

export interface GenerateMockBarsOptions {
  /** Number of bars (clamped). */
  count: number;
  /** Chart interval (`1m`, `1h`, …) — drives time step. */
  interval?: string;
  /** Seed string (seriesKey preferred) for deterministic walk. */
  seed?: string;
  /**
   * Unix seconds of the **last** bar. Defaults to a fixed epoch so tests and
   * cold starts stay deterministic without depending on `Date.now()`.
   */
  endTime?: number;
  /** Starting mid price. */
  startPrice?: number;
}

/** Fixed end time (2024-01-01T00:00:00Z) when callers omit `endTime`. */
export const MOCK_BARS_END_TIME = 1_704_067_200;

/**
 * Generate deterministic OHLCV bars.
 * Invariants per bar: `high >= max(open, close)`, `low <= min(open, close)`, volume ≥ 0.
 */
export function generateMockBars(opts: GenerateMockBarsOptions): OhlcvBar[] {
  const count = clampMockBarCount(opts.count);
  if (count === 0) return [];

  const step = intervalToSeconds(opts.interval ?? '1m');
  const endTime = opts.endTime ?? MOCK_BARS_END_TIME;
  const alignedEnd = Math.floor(endTime / step) * step;
  const startTime = alignedEnd - (count - 1) * step;
  const rand = createPrng(hashSeed(opts.seed ?? 'axis-mock'));
  let price = opts.startPrice ?? 100;

  const out: OhlcvBar[] = [];
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.48) * 2; // slight upward bias
    const open = price;
    const close = Math.max(0.01, open + drift);
    const wickUp = rand() * Math.abs(close - open) * 0.8 + rand() * 0.3;
    const wickDown = rand() * Math.abs(close - open) * 0.8 + rand() * 0.3;
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(0.01, Math.min(open, close) - wickDown);
    const volume = Math.round(100 + rand() * 900);
    out.push({
      time: startTime + i * step,
      open: round4(open),
      high: round4(high),
      low: round4(low),
      close: round4(close),
      volume,
    });
    price = close;
  }
  return out;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
