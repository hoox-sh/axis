// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for the pure Results-overlay formatters.
 *
 * These lived inside `ResultsModal.tsx` (a 1.6k-line Solid component) and were
 * only reachable through a rendered dialog. Extracted to
 * `src/ui/results/format.ts`, they are plain functions again.
 */

import { describe, expect, it } from 'bun:test';

import {
  defaultSavedLabel,
  formatEventTime,
  formatFillQty,
  formatPosPrice,
  formatSavedAt,
  formatSavedDuration,
  formatSavedPct,
  formatSavedPf,
  readSavedStats,
  savedRunMarket,
} from '../src/ui/results/format';
import type { ResultMeta } from '../src/storage/service';

const meta = (over: Partial<ResultMeta> = {}): ResultMeta =>
  ({
    scriptId: 's1',
    runId: 'r1',
    startedAt: Date.UTC(2026, 7, 29, 12, 34, 56),
    durationMs: 234,
    scriptKind: 'strategy',
    ...over,
  }) as ResultMeta;

describe('formatSavedAt', () => {
  it('renders a local timestamp and rejects junk', () => {
    expect(formatSavedAt(Date.UTC(2026, 7, 29, 12, 34, 56))).toMatch(
      /^2026-08-29 \d{2}:\d{2}:\d{2}$/,
    );
    expect(formatSavedAt(0)).toBe('—');
    expect(formatSavedAt(Number.NaN)).toBe('—');
    expect(formatSavedAt(-1)).toBe('—');
  });
});

describe('formatSavedDuration', () => {
  it('picks ms / s / m tiers', () => {
    expect(formatSavedDuration(234)).toBe('234 ms');
    expect(formatSavedDuration(1200)).toBe('1.20s');
    expect(formatSavedDuration(45_000)).toBe('45.0s');
    expect(formatSavedDuration(125_000)).toBe('2m 5s');
  });

  it('rejects negative and non-finite input', () => {
    expect(formatSavedDuration(-5)).toBe('—');
    expect(formatSavedDuration(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('defaultSavedLabel', () => {
  it('title-cases the kind and appends the timestamp', () => {
    expect(defaultSavedLabel(meta())).toStartWith('Strategy @ 2026-08-29 ');
  });

  it('falls back to "run" when the kind is unknown', () => {
    expect(defaultSavedLabel(meta({ scriptKind: undefined }))).toStartWith('Run @ ');
  });
});

describe('savedRunMarket', () => {
  it('reads symbol/timeframe, then ticker/interval aliases', () => {
    expect(savedRunMarket(meta({ inputs: { symbol: 'BTCUSDT', timeframe: '1h' } }))).toEqual({
      symbol: 'BTCUSDT',
      timeframe: '1h',
    });
    expect(savedRunMarket(meta({ inputs: { ticker: 'ETHUSD', interval: '15' } }))).toEqual({
      symbol: 'ETHUSD',
      timeframe: '15',
    });
  });

  it('returns empty strings when inputs are absent', () => {
    expect(savedRunMarket(meta())).toEqual({ symbol: '', timeframe: '' });
  });
});

describe('readSavedStats', () => {
  it('keeps only numeric fields', () => {
    const out = readSavedStats({
      trades: 12,
      winRate: 55.5,
      wins: 6,
      losses: 6,
      totalPnl: -120.5,
      returnPct: 0.04,
      maxDD: 0.12,
      avgTrade: -10,
      profitFactor: 1.8,
      ignored: 'nope',
    });
    expect(out).toEqual({
      trades: 12,
      winRate: 55.5,
      wins: 6,
      losses: 6,
      totalPnl: -120.5,
      returnPct: 0.04,
      maxDD: 0.12,
      avgTrade: -10,
      profitFactor: 1.8,
    });
  });

  it('preserves an explicit null profit factor (∞)', () => {
    expect(readSavedStats({ profitFactor: null }).profitFactor).toBeNull();
  });

  it('returns {} for non-objects', () => {
    expect(readSavedStats(null)).toEqual({});
    expect(readSavedStats('x')).toEqual({});
  });
});

describe('formatSavedPct', () => {
  it('signs the value and scales by 100', () => {
    expect(formatSavedPct(0.042)).toBe('+4.20%');
    expect(formatSavedPct(-0.042)).toBe('-4.20%');
    expect(formatSavedPct(0.042, 1)).toBe('+4.2%');
  });

  it('returns an em dash when unknown', () => {
    expect(formatSavedPct(undefined)).toBe('—');
    expect(formatSavedPct(Number.NaN)).toBe('—');
  });
});

describe('formatSavedPf', () => {
  it('shows ∞ for missing or infinite factors', () => {
    expect(formatSavedPf(null)).toBe('∞');
    expect(formatSavedPf(undefined)).toBe('∞');
    expect(formatSavedPf(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(formatSavedPf(2.345)).toBe('2.35');
  });
});

describe('formatEventTime', () => {
  it('accepts unix seconds and epoch ms', () => {
    expect(formatEventTime(1_700_000_000)).toBe('2023-11-14 22:13');
    expect(formatEventTime(1_700_000_000_000)).toBe('2023-11-14 22:13');
  });

  it('returns an em dash for unusable values', () => {
    expect(formatEventTime(0)).toBe('—');
    expect(formatEventTime('abc')).toBe('—');
  });
});

describe('formatFillQty', () => {
  it('keeps integral quantities whole, else 4 decimals', () => {
    expect(formatFillQty(3)).toBe('3');
    expect(formatFillQty(1.5)).toBe('1.5000');
    expect(formatFillQty(0.0001234)).toBe('0.0001');
  });
});

describe('formatPosPrice', () => {
  it('uses 2 decimals at or above 1, compact form below', () => {
    expect(formatPosPrice(42.1234)).toBe('42.12');
    expect(formatPosPrice(0.5)).not.toBe('—');
    expect(formatPosPrice(Number.NaN)).toBe('—');
  });
});
