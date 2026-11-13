// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings → chart wiring.
 *
 * Two preferences used to be written to the store and never pushed to the
 * chart, so the Save button looked like a no-op until a pane rebuild:
 *
 * - the three label toggles (right scale / last-value badges / names) only
 *   reached `PaneManager` from `ChartHost` at pane creation,
 * - the three fill-display toggles were read when markers were *built*, so
 *   existing markers kept the old style while Results → Strategy repainted.
 */

import { describe, expect, it } from 'bun:test';

import { applyLabelPrefsToChart } from '../src/chart/label-prefs';
import { reapplyTradeMarkersFromStore } from '../src/results/reapply-markers';
import { setStore, store } from '../src/store';
import type { PaneManager } from '../src/chart/pane-manager';

/** Minimal stand-in: records the calls the real PaneManager would receive. */
function fakeManager() {
  const calls: string[] = [];
  const manager = {
    setPriceScaleLabelsVisible: (v: boolean) => calls.push(`price:${v}`),
    setLastValueLabelsVisible: (v: boolean) => calls.push(`last:${v}`),
    setLastValueNamesVisible: (v: boolean) => calls.push(`names:${v}`),
    setTradeMarkers: (markers: unknown[], owner?: string) =>
      calls.push(`markers:${Array.isArray(markers) ? markers.length : 0}:${owner ?? ''}`),
  };
  return { manager: manager as unknown as PaneManager, calls };
}

describe('applyLabelPrefsToChart', () => {
  it('is a no-op without a chart', () => {
    expect(() => applyLabelPrefsToChart(null)).not.toThrow();
  });

  it('pushes all three prefs, treating undefined as on', () => {
    const { manager, calls } = fakeManager();
    applyLabelPrefsToChart(manager);
    expect(calls).toEqual(['price:true', 'last:true', 'names:true']);
  });

  it('pushes explicit off values', () => {
    const prev = {
      price: store.priceScaleLabelsVisible,
      last: store.lastValueLabelsVisible,
      names: store.lastValueNamesVisible,
    };
    try {
      setStore('priceScaleLabelsVisible', false);
      setStore('lastValueLabelsVisible', false);
      setStore('lastValueNamesVisible', false);
      const { manager, calls } = fakeManager();
      applyLabelPrefsToChart(manager);
      expect(calls).toEqual(['price:false', 'last:false', 'names:false']);
    } finally {
      setStore('priceScaleLabelsVisible', prev.price);
      setStore('lastValueLabelsVisible', prev.last);
      setStore('lastValueNamesVisible', prev.names);
    }
  });

  it('swallows a disposed-chart throw', () => {
    const manager = {
      setPriceScaleLabelsVisible: () => {
        throw new Error('disposed');
      },
    } as unknown as PaneManager;
    expect(() => applyLabelPrefsToChart(manager)).not.toThrow();
  });
});

describe('reapplyTradeMarkersFromStore', () => {
  it('is a no-op without a chart', () => {
    expect(() => reapplyTradeMarkersFromStore(null)).not.toThrow();
  });

  it('does not touch the chart when the run carried no events', () => {
    const { manager, calls } = fakeManager();
    reapplyTradeMarkersFromStore(manager);
    // The default store has no lastRun, so nothing should be painted.
    if (!store.lastRun?.events?.length) {
      expect(calls).toEqual([]);
    }
  });
});
