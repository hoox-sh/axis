/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * RSI must not paint on the price pane.
 *
 * Server-Side prefers the WebSocket run. That mapper used to drop a top-level
 * `script_type` and omit `overlay`, and `resolveOverlayFlag` then treated the
 * script as a strategy (price overlay). The 5000-bar guest cap retry often
 * comes back with an empty line series, so the oscillator-scale demotion did
 * not fire either. The source declaration is the guard. The other candidate
 * paths (apply-pane throw → price, stale SlotChart index, indicator bound at
 * index 0) are covered in `tests/chart/v1-chart-host.test.ts` and below.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import { alignApplySeries } from '../src/indicators/apply-context';
import { ensureApplyPane } from '../src/indicators/apply-pane';
import type { RunResult } from '../src/indicators/runner';
import { setStore, store } from '../src/store';
import type { Bar } from '../src/store/types';

const RSI_SRC = 'indicator("RSI", overlay=false)\nr = ta.rsi(close, 14)\nplot(r, "RSI")\n';
const SMA_SRC = 'indicator("SMA", overlay=true)\nplot(ta.sma(close, 20), "SMA")\n';

function bars(n = 32): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 50_000,
    high: 50_100,
    low: 49_900,
    close: 50_000 + i,
    volume: 10,
  }));
}

function rsiValues(n = 32): number[] {
  return Array.from({ length: n }, (_, i) => 30 + (i % 40));
}

function result(partial: Partial<RunResult> & { meta?: RunResult['meta'] }): RunResult {
  return {
    status: 'success',
    plots: [],
    series: {},
    events: [],
    ...partial,
    meta: partial.meta ?? {},
  };
}

describe('RSI stays off the price pane', () => {
  it('keeps overlay=false when the server omits overlay and script_type', () => {
    const aligned = alignApplySeries(
      RSI_SRC,
      result({
        plots: rsiValues(),
        series: { RSI: rsiValues() },
        meta: { windowBars: 5000 },
      }),
      bars(),
      { silent: true },
    );
    expect(aligned.overlay).toBe(false);
  });

  it('keeps overlay=false when the server says overlay true', () => {
    const aligned = alignApplySeries(
      RSI_SRC,
      result({
        series: { RSI: rsiValues() },
        meta: { overlay: true, script_type: 'indicator' },
      }),
      bars(),
      { silent: true },
    );
    expect(aligned.overlay).toBe(false);
  });

  it('keeps overlay=false on the 5000-bar cap path when series are still empty', () => {
    const aligned = alignApplySeries(
      RSI_SRC,
      result({ plots: [], series: {}, meta: { windowBars: 5000 } }),
      bars(),
      { silent: true },
    );
    expect(aligned.overlay).toBe(false);
  });

  it('demotes a plots-only oscillator when the engine omits the flag and the source does not declare overlay', () => {
    const values = rsiValues();
    const aligned = alignApplySeries(
      'x = ta.rsi(close, 14)\nplot(x)\n',
      result({ plots: values, series: {}, meta: {} }),
      bars(),
      { silent: true },
    );
    expect(aligned.overlay).toBe(false);
  });

  it('leaves an explicit price overlay (SMA) on the price pane', () => {
    const sma = bars().map((b) => b.close);
    const aligned = alignApplySeries(
      SMA_SRC,
      result({ series: { SMA: sma }, meta: {} }),
      bars(),
      { silent: true },
    );
    expect(aligned.overlay).toBe(true);
  });

  it('does not retarget a sub-pane script onto price when pane setup throws', () => {
    setStore('panes', [{ id: 'price', type: 'price', label: 'Price', visible: true }]);
    setStore('scripts', []);
    const manager = {
      getPane: (id: string) => (id === 'price' ? { id } : undefined),
      createPane: () => {
        throw new Error('chart disposed');
      },
      syncTimeScales: () => {},
      setVisible: () => {},
      setLabel: () => {},
      getAllPanes: () => [],
      destroyPane: () => {},
      removeOverlaysForOwner: () => {},
    };
    const id = ensureApplyPane({
      overlay: false,
      existing: undefined,
      indicatorId: 'rsi1',
      scriptName: 'RSI',
      manager: manager as never,
      storePanes: store.panes,
      storeScripts: store.scripts,
    });
    expect(id).not.toBe('price');
    expect(id.startsWith('ind_')).toBe(true);
  });
});
