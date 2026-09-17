/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Boot hydration regression: stored watchlist + settings must survive a fresh
 * module boot (the real reload path: `loadPersisted()` at store module load).
 *
 * Background: `parsePersistedState` once threw during boot because
 * `clampUiScale` read the `UI_SCALE_STEP` const before its declaration was
 * evaluated (TDZ). The blanket try/catch returned null, `loadPersisted`
 * deleted the key, and every reload reset the app to defaults. Calling
 * `parsePersistedState` after boot always worked, so no unit test caught it —
 * only a fresh module evaluation does. The `?boot-persist` query forces Bun
 * to evaluate a second store instance for exactly that.
 */

import { describe, expect, it } from 'bun:test';
import { installDocumentStub, installMemoryLocalStorage, installWindowStub } from './setup';

describe('persist boot round-trip', () => {
  it('hydrates watchlist + settings on fresh boot and keeps the key', async () => {
    const mem = installMemoryLocalStorage();
    installDocumentStub();
    installWindowStub();
    mem.setItem(
      'pynescript.axis.v1',
      JSON.stringify({
        symbol: 'ETHUSDT',
        interval: '4h',
        source: 'kraken-rest',
        theme: 'light',
        uiScale: 1.1,
        historyBars: 1000,
        autoload: false,
        watchlist: {
          open: true,
          width: 300,
          refreshSec: 30,
          activeId: 'wl-alt',
          symbols: ['ETHUSDT'],
          lists: [
            { id: 'wl-main', name: 'Main', symbols: ['BTCUSDT'] },
            { id: 'wl-alt', name: 'Alts', symbols: ['ETHUSDT', 'SOLUSDT'] },
          ],
        },
        live: { streamId: 'kraken-ws', preferAfterLoad: false, rerunOn: 'bar-close' },
        activePlugins: {
          source: 'kraken-rest',
          stream: 'kraken-ws',
          engine: 'server',
          storage: 'local',
        },
        panelChrome: { watchlist: { open: true, w: 300 } },
        shortcuts: { overrides: {} },
        compare: { enabled: false, symbol: '', mode: 'percent', normalizeMain: false },
        telemetry: { hud: { compact: true, overlay: false }, shareOnError: false },
        priceScaleLabelsVisible: false,
        lastValueLabelsVisible: false,
        lastValueNamesVisible: false,
        resultsAutoOpen: true,
        tier: 'pro',
        pluginsConfig: {},
        scripts: [],
        drawings: [],
        savedLayouts: [],
      }),
    );

    // @ts-expect-error — query suffix forces a fresh module evaluation (Bun);
    // tsc cannot resolve query-suffixed specifiers, but the runtime can.
    const mod = await import('../src/store/index.ts?boot-persist-roundtrip');

    expect(mod.store.watchlist.symbols).toEqual(['ETHUSDT', 'SOLUSDT']);
    expect(mod.store.watchlist.lists).toHaveLength(2);
    expect(mod.store.watchlist.activeId).toBe('wl-alt');
    expect(mod.store.watchlist.refreshSec).toBe(30);
    expect(mod.store.interval).toBe('4h');
    expect(mod.store.symbol).toBe('ETHUSDT');
    expect(mod.store.source).toBe('kraken-rest');
    expect(mod.store.uiScale).toBeCloseTo(1.1);
    expect(mod.store.theme).toBe('light');
    // Boot must not wipe a parseable payload
    expect(mem.getItem('pynescript.axis.v1')).not.toBeNull();
  });
});
