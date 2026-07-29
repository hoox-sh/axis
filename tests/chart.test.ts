/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Smoke imports for chart/store modules in Bun (no DOM chart render).
 * Guards: PaneManager export exists; Solid store defaults (symbol/interval/status).
 */

import { describe, it, expect } from 'bun:test';

describe('PaneManager', () => {
  it('can be imported', async () => {
    const { PaneManager } = await import('../src/chart/pane-manager');
    expect(PaneManager).toBeDefined();
  });
});

describe('Store', () => {
  it('has default state', async () => {
    const { store } = await import('../src/store');
    expect(store.symbol).toBe('BTCUSDT');
    expect(store.interval).toBe('1d');
    expect(store.status).toBe('ready');
    expect(store.statusMessage).toBe('Ready.');
  });

  it('has stable live defaults', async () => {
    const { store } = await import('../src/store');
    expect(store.live.active).toBe(false);
    expect(store.live.streamId).toBe('binance-ws');
  });
});

describe('Series Factory', () => {
  it('exports palette', async () => {
    const { PLOT_PALETTE } = await import('../src/chart/series-factory');
    expect(PLOT_PALETTE.length).toBeGreaterThan(0);
  });
});

describe('Stream Plugin', () => {
  it('has binance stream', async () => {
    const { binanceStream } = await import('../src/streams/binance');
    expect(binanceStream.id).toBe('binance-ws');
    expect(binanceStream.name).toBe('Binance WebSocket');
  });
});
