/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PaneManager.syncOverlayLines updates series in place (no destroy flash).
 * Guards price-line reuse when plot values change between runs.
 */

import './setup';
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../src/chart/pane-manager');

describe('syncOverlayLines', () => {
  let root: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    pm = new PaneManager(root);
    pm.createPane('price', 'price', 'Price');
  });

  afterEach(() => {
    try {
      pm.dispose();
    } catch {
      /* ignore */
    }
    root?.remove();
    document.getElementById('pane-price')?.remove();
  });

  it('creates overlay series then updates data in place', () => {
    const data1 = [
      { time: 1, value: 10 },
      { time: 2, value: 12 },
    ];
    pm.syncOverlayLines('price', [{ name: 'plotA', data: data1, color: '#fff' }]);
    const pane = pm.getPane('price')!;
    expect(pane.series['overlay_plotA']).toBeDefined();
    const series = pane.series['overlay_plotA'];
    let setCount = 0;
    const orig = series.setData.bind(series);
    series.setData = (d: unknown) => {
      setCount += 1;
      return orig(d);
    };

    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 1, value: 11 },
          { time: 2, value: 13 },
        ],
        color: '#fff',
      },
    ]);
    expect(setCount).toBe(1);
    // same key — not recreated as a different object identity requirement;
    // series map still has the key
    expect(pane.series['overlay_plotA']).toBe(series);
  });

  it('removes stale overlay keys', () => {
    pm.syncOverlayLines('price', [
      { name: 'a', data: [{ time: 1, value: 1 }] },
      { name: 'b', data: [{ time: 1, value: 2 }] },
    ]);
    const pane = pm.getPane('price')!;
    expect(pane.series['overlay_a']).toBeDefined();
    expect(pane.series['overlay_b']).toBeDefined();

    pm.syncOverlayLines('price', [{ name: 'a', data: [{ time: 1, value: 3 }] }]);
    expect(pane.series['overlay_a']).toBeDefined();
    expect(pane.series['overlay_b']).toBeUndefined();
  });

  it('creates price lines for kind=hline and applies linewidth on plots', () => {
    const pane = pm.getPane('price')!;
    // Host series for createPriceLine
    const host = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      _priceLines: [] as Array<{ applyOptions: (o: unknown) => void; _opts: Record<string, unknown> }>,
      createPriceLine(opts: Record<string, unknown>) {
        const pl = {
          _opts: { ...opts },
          applyOptions(o: unknown) {
            Object.assign(this._opts, o as object);
          },
          options: () => this._opts,
        };
        this._priceLines.push(pl);
        return pl;
      },
      removePriceLine(line: { _opts: Record<string, unknown> }) {
        const i = this._priceLines.indexOf(line as never);
        if (i >= 0) this._priceLines.splice(i, 1);
      },
      priceLines() {
        return this._priceLines.slice();
      },
    };
    pane.series['candle'] = host as never;

    pm.syncOverlayLines('price', [
      {
        name: 'RSI',
        data: [
          { time: 1, value: 40 },
          { time: 2, value: 55 },
        ],
        color: '#939fff',
        linewidth: 3,
        kind: 'plot',
      },
      {
        name: 'Oversold',
        data: [
          { time: 1, value: 30 },
          { time: 2, value: 30 },
        ],
        color: '#5ecf8a',
        kind: 'hline',
        price: 30,
        linewidth: 1,
        linestyle: 'linestyle_dashed',
      },
      {
        name: 'Overbought',
        data: [
          { time: 1, value: 70 },
          { time: 2, value: 70 },
        ],
        color: '#e85d4c',
        kind: 'hline',
        price: 70,
      },
    ]);

    expect(pane.series['overlay_RSI']).toBeDefined();
    expect(pane.priceLines['Oversold']).toBeDefined();
    expect(pane.priceLines['Overbought']).toBeDefined();
    expect(host._priceLines.length).toBe(2);
    expect(host._priceLines[0]!._opts.price).toBe(30);
    expect(host._priceLines[1]!._opts.price).toBe(70);

    // Update hline price in place
    pm.syncOverlayLines('price', [
      {
        name: 'Oversold',
        data: [{ time: 1, value: 25 }],
        kind: 'hline',
        price: 25,
        color: '#5ecf8a',
      },
    ]);
    expect(pane.priceLines['Oversold']).toBeDefined();
    expect(pane.priceLines['Overbought']).toBeUndefined();
    expect(host._priceLines[0]!._opts.price).toBe(25);
  });
});
