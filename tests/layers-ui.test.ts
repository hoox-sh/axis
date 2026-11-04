// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

describe('layers collapse prefs', () => {
  const withStorage = () => {
    (globalThis as { localStorage?: MemoryStorage }).localStorage = new MemoryStorage();
  };

  it('round-trips known section ids and ignores junk', async () => {
    withStorage();
    const { LAYERS_COLLAPSED_KEY, readCollapsedSections, writeCollapsedSections } = await import(
      '../src/ui/layers/prefs'
    );
    localStorage.setItem(LAYERS_COLLAPSED_KEY, JSON.stringify(['panes', 'nope', 7, 'panes']));
    expect(readCollapsedSections()).toEqual(['panes']);
    expect(writeCollapsedSections(['drawings', 'nope', 'drawings'])).toEqual(['drawings']);
    expect(readCollapsedSections()).toEqual(['drawings']);
  });

  it('toggles one section without dropping the others', async () => {
    withStorage();
    const { toggleCollapsedSection } = await import('../src/ui/layers/prefs');
    expect(toggleCollapsedSection('scripts')).toEqual(['scripts']);
    expect(toggleCollapsedSection('panes', ['scripts'])).toEqual(['scripts', 'panes']);
    expect(toggleCollapsedSection('scripts', ['scripts', 'panes'])).toEqual(['panes']);
  });

  it('survives unreadable storage', async () => {
    withStorage();
    const { LAYERS_COLLAPSED_KEY, readCollapsedSections } = await import('../src/ui/layers/prefs');
    localStorage.setItem(LAYERS_COLLAPSED_KEY, '<<<not-json>>>');
    expect(readCollapsedSections()).toEqual([]);
  });
});
