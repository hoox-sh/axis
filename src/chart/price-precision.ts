// Copyright (C) 2024-2026 jango_blockchained
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Price-scale decimal precision for Lightweight Charts series.
 *
 * - **auto**: detect from symbol heuristics + recent OHLCV samples
 * - **0–8**: fixed decimals
 *
 * @module chart/price-precision
 */

import type { Bar } from '../store/types';

/** Fixed decimals or auto-detect. */
export type PriceScaleDecimalsMode = 'auto' | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const PRICE_SCALE_DECIMALS_MIN = 0;
export const PRICE_SCALE_DECIMALS_MAX = 8;

/** LWC `priceFormat` bag for a price series. */
export type PriceFormatOpts = {
  type: 'price';
  precision: number;
  minMove: number;
};

/** Clamp integer decimals into the supported range. */
export function clampPriceDecimals(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.min(
    PRICE_SCALE_DECIMALS_MAX,
    Math.max(PRICE_SCALE_DECIMALS_MIN, Math.round(n)),
  );
}

/** Normalize unknown stored values → mode. */
export function normalizePriceScaleDecimalsMode(raw: unknown): PriceScaleDecimalsMode {
  if (raw === 'auto' || raw === 'Auto' || raw == null || raw === '') return 'auto';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 'auto';
  return clampPriceDecimals(n) as PriceScaleDecimalsMode;
}

/** Significant fraction digits in a finite number (noise-trimmed). */
export function countSignificantDecimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Avoid float junk (1.2300000001 → 1.23)
  const s = Math.abs(n).toFixed(10).replace(/\.?0+$/, '');
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Typical display decimals for a price magnitude. */
export function decimalsFromMagnitude(price: number): number {
  const p = Math.abs(price);
  if (!Number.isFinite(p) || p === 0) return 2;
  if (p >= 1000) return 2;
  if (p >= 1) return 2;
  if (p >= 0.1) return 4;
  if (p >= 0.01) return 5;
  if (p >= 0.0001) return 6;
  if (p >= 0.000001) return 8;
  return 8;
}

/**
 * Heuristic decimals from ticker (venue-agnostic).
 * Returns null when the symbol does not imply a clear tick size.
 */
export function detectDecimalsFromSymbol(symbol: string): number | null {
  const raw = String(symbol || '').trim();
  if (!raw) return null;

  // DEX / pool addresses — use bar samples only
  if (raw.includes(':') || raw.includes('/') || /^0x[a-fA-F0-9]{20,}$/i.test(raw)) {
    return null;
  }

  const s = raw.toUpperCase().replace(/[-_]/g, '');

  // Strip common quote suffixes
  const quotes = [
    'USDT',
    'USDC',
    'BUSD',
    'TUSD',
    'FDUSD',
    'DAI',
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'BTC',
    'ETH',
  ];
  let base = s;
  let quote = '';
  for (const q of quotes) {
    if (s.endsWith(q) && s.length > q.length) {
      base = s.slice(0, -q.length);
      quote = q;
      break;
    }
  }

  // Quote is JPY → usually 0–1 decimals on forex-ish pairs
  if (quote === 'JPY') return 3;

  // High-value majors vs USDT/USD
  if (['BTC', 'WBTC', 'ETH', 'BCH', 'BNB', 'XMR', 'LTC', 'AAVE', 'MKR'].includes(base)) {
    return 2;
  }
  if (['SOL', 'AVAX', 'LINK', 'DOT', 'ATOM', 'UNI', 'LDO', 'NEAR'].includes(base)) {
    return 3;
  }
  if (
    ['XRP', 'ADA', 'DOGE', 'TRX', 'MATIC', 'POL', 'XLM', 'ALGO', 'HBAR', 'VET'].includes(
      base,
    )
  ) {
    return 4;
  }
  // Micro / meme — many decimals
  if (
    ['SHIB', 'PEPE', 'FLOKI', 'BONK', 'SATS', '1000SATS', 'MEME', 'LUNC'].includes(base)
  ) {
    return 8;
  }

  // Pair quoted in BTC/ETH → more decimals
  if (quote === 'BTC' || quote === 'ETH') return 8;

  return null;
}

/**
 * Infer decimals from recent OHLCV (max observed digits + magnitude floor).
 */
export function detectDecimalsFromBars(
  bars: readonly Pick<Bar, 'open' | 'high' | 'low' | 'close'>[],
): number {
  if (!Array.isArray(bars) || !bars.length) return 2;
  const sample = bars.length > 80 ? bars.slice(-80) : bars;
  let maxDec = 0;
  let sum = 0;
  let n = 0;
  for (const b of sample) {
    for (const v of [b.close, b.open, b.high, b.low]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      maxDec = Math.max(maxDec, countSignificantDecimals(v));
      sum += Math.abs(v);
      n += 1;
    }
  }
  const avg = n > 0 ? sum / n : 0;
  const mag = decimalsFromMagnitude(avg);
  // Need enough digits for magnitude, but don't invent more than the data shows
  // (except magnitude floor so BTC always shows 2 even if all whole numbers).
  return clampPriceDecimals(Math.max(mag, Math.min(maxDec, PRICE_SCALE_DECIMALS_MAX)));
}

/**
 * Resolve effective decimals for the price scale.
 * Auto: symbol heuristic merged with bar samples.
 */
export function resolvePriceDecimals(
  mode: PriceScaleDecimalsMode | unknown,
  opts: { symbol?: string; bars?: readonly Pick<Bar, 'open' | 'high' | 'low' | 'close'>[] } = {},
): number {
  const m = normalizePriceScaleDecimalsMode(mode);
  if (m !== 'auto') return m;

  const fromSym = detectDecimalsFromSymbol(opts.symbol || '');
  const fromBars = opts.bars?.length ? detectDecimalsFromBars(opts.bars) : null;

  if (fromSym != null && fromBars != null) {
    // Prefer the larger of symbol hint and bar need (never under-precision)
    return clampPriceDecimals(Math.max(fromSym, fromBars));
  }
  if (fromSym != null) return clampPriceDecimals(fromSym);
  if (fromBars != null) return fromBars;
  return 2;
}

/** LWC priceFormat + minMove for a decimal count. */
export function priceFormatForDecimals(decimals: number): PriceFormatOpts {
  const precision = clampPriceDecimals(decimals);
  const minMove = precision <= 0 ? 1 : Number(`1e-${precision}`);
  return {
    type: 'price',
    precision,
    minMove,
  };
}

/** Format a price for UI labels using the same decimals. */
export function formatPriceWithDecimals(price: number, decimals: number): string {
  if (!Number.isFinite(price)) return '—';
  return price.toFixed(clampPriceDecimals(decimals));
}

/** Cycle mode for the scale control button: auto → 0 → … → 8 → auto. */
export function cyclePriceScaleDecimalsMode(
  current: PriceScaleDecimalsMode | unknown,
): PriceScaleDecimalsMode {
  const m = normalizePriceScaleDecimalsMode(current);
  if (m === 'auto') return 0;
  if (m >= PRICE_SCALE_DECIMALS_MAX) return 'auto';
  return (m + 1) as PriceScaleDecimalsMode;
}

/** Short label for the scale control (A or digit). */
export function priceScaleDecimalsLabel(mode: PriceScaleDecimalsMode | unknown): string {
  const m = normalizePriceScaleDecimalsMode(mode);
  return m === 'auto' ? 'A' : String(m);
}
