// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import type { Drawing } from '../src/chart/drawing-types';
import {
  drawingListLabel,
  drawingMatchesQuery,
  formatBarTime,
  formatCompactUsd,
  onchainSeriesSub,
} from '../src/ui/layers/format';

function hline(price: number): Drawing {
  return { id: 'h1', kind: 'hline', color: '#fff', price };
}

describe('layers format', () => {
  it('formatBarTime accepts seconds, millis, and junk', () => {
    expect(formatBarTime(Number.NaN)).toBe('—');
    expect(formatBarTime(Date.UTC(2024, 5, 1, 12, 30) / 1000)).toBe('2024-06-01 12:30');
    expect(formatBarTime(Date.UTC(2024, 5, 1, 12, 30))).toBe('2024-06-01 12:30');
  });

  it('formatCompactUsd buckets thousands and keeps the sign', () => {
    expect(formatCompactUsd(Number.NaN)).toBe('—');
    expect(formatCompactUsd(999)).toBe('999');
    expect(formatCompactUsd(1500)).toBe('1.5K');
    expect(formatCompactUsd(2_500_000)).toBe('2.50M');
    expect(formatCompactUsd(-1_200_000_000)).toBe('-1.20B');
  });

  it('onchainSeriesSub joins provider, state, and TVL', () => {
    expect(
      onchainSeriesSub({
        provider: 'defillama',
        loading: true,
        error: 'nope',
        lastTvl: 2_000_000,
      }),
    ).toBe('defillama · loading… · error · $2.00M');
    expect(onchainSeriesSub({ providerId: 'x' })).toBe('x');
  });

  it('drawingListLabel uses the short row forms', () => {
    expect(drawingListLabel(hline(10.5))).toBe('H · 10.50');
    expect(
      drawingListLabel({
        id: 'm',
        kind: 'measure',
        color: '#fff',
        p1: { time: 1, price: 10 },
        p2: { time: 2, price: 12.25 },
      }),
    ).toBe('Δ +2.25');
    expect(
      drawingListLabel({
        id: 't',
        kind: 'text',
        color: '#fff',
        text: 'Hello',
        p1: { time: 1, price: 1 },
      }),
    ).toBe('Hello');
  });

  it('drawingMatchesQuery matches label, kind, and text', () => {
    const d = hline(10.5);
    expect(drawingMatchesQuery(d, '')).toBe(true);
    expect(drawingMatchesQuery(d, '10.50')).toBe(true);
    expect(drawingMatchesQuery(d, 'horizontal')).toBe(true);
    expect(drawingMatchesQuery(d, 'nope')).toBe(false);
  });
});
