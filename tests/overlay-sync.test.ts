/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
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

  it('creates overlay series then full setData when length grows', () => {
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

    // Length change → full setData (not tip-only update)
    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 1, value: 11 },
          { time: 2, value: 13 },
          { time: 3, value: 14 },
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

  it('owner-scoped apply does not wipe another script’s overlays', () => {
    pm.syncOverlayLines(
      'price',
      [{ name: 'rsi', data: [{ time: 1, value: 50 }], color: '#f00' }],
      { ownerId: 'scriptA' },
    );
    pm.syncOverlayLines(
      'price',
      [{ name: 'macd', data: [{ time: 1, value: 1 }], color: '#0f0' }],
      { ownerId: 'scriptB' },
    );
    const pane = pm.getPane('price')!;
    expect(pane.series['overlay_scriptA__rsi']).toBeDefined();
    expect(pane.series['overlay_scriptB__macd']).toBeDefined();

    // B re-runs without A — A’s series must remain
    pm.syncOverlayLines(
      'price',
      [{ name: 'macd', data: [{ time: 1, value: 2 }, { time: 2, value: 3 }], color: '#0f0' }],
      { ownerId: 'scriptB' },
    );
    expect(pane.series['overlay_scriptA__rsi']).toBeDefined();
    expect(pane.series['overlay_scriptB__macd']).toBeDefined();
  });

  it('uses series.update when only last bar changes (same length + time)', () => {
    const data1 = [
      { time: 1, value: 10 },
      { time: 2, value: 12 },
    ];
    pm.syncOverlayLines('price', [{ name: 'plotA', data: data1, color: '#fff' }]);
    const pane = pm.getPane('price')!;
    const series = pane.series['overlay_plotA']!;
    let setCount = 0;
    let updateCount = 0;
    let lastUpdate: unknown;
    const origSet = series.setData.bind(series);
    const origUp = series.update?.bind(series);
    series.setData = (d: unknown) => {
      setCount += 1;
      return origSet(d);
    };
    series.update = (d: unknown) => {
      updateCount += 1;
      lastUpdate = d;
      return origUp?.(d);
    };

    // Same length, same last time — tip-only update path (no full setData)
    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 1, value: 10 },
          { time: 2, value: 99 },
        ],
        color: '#fff',
      },
    ]);
    expect(updateCount).toBe(1);
    expect(setCount).toBe(0);
    expect(lastUpdate).toEqual({ time: 2, value: 99 });

    // Identical tip → pure no-op (no update, no setData)
    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 1, value: 10 },
          { time: 2, value: 99 },
        ],
        color: '#fff',
      },
    ]);
    expect(updateCount).toBe(1);
    expect(setCount).toBe(0);
  });

  it('forceFull repaints the whole series when length + last time are unchanged', () => {
    // Regression: an input override (RSI 14 → 56) recomputes every bar, but
    // length + last time stay identical. Without forceFull the tip-only path
    // would patch only the last point and leave the history stale — the chart
    // would appear not to change.
    const data1 = [
      { time: 1, value: 10 },
      { time: 2, value: 12 },
    ];
    pm.syncOverlayLines('price', [{ name: 'plotA', data: data1, color: '#fff' }]);
    const pane = pm.getPane('price')!;
    const series = pane.series['overlay_plotA']!;
    let setCount = 0;
    let updateCount = 0;
    const origSet = series.setData.bind(series);
    const origUp = series.update?.bind(series);
    series.setData = (d: unknown) => {
      setCount += 1;
      return origSet(d);
    };
    series.update = (d: unknown) => {
      updateCount += 1;
      return origUp?.(d);
    };

    // Same length + last time, but the HISTORY changed (recompute). forceFull
    // must repaint the whole series, not just patch the tip.
    pm.syncOverlayLines(
      'price',
      [
        {
          name: 'plotA',
          data: [
            { time: 1, value: 99 },
            { time: 2, value: 88 },
          ],
          color: '#fff',
        },
      ],
      { forceFull: true },
    );
    expect(setCount).toBe(1);
    expect(updateCount).toBe(0);
  });

  it('falls back to setData when last time advances (same length)', () => {
    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 1, value: 10 },
          { time: 2, value: 12 },
        ],
        color: '#fff',
      },
    ]);
    const series = pm.getPane('price')!.series['overlay_plotA']!;
    let setCount = 0;
    let updateCount = 0;
    const origSet = series.setData.bind(series);
    const origUp = series.update?.bind(series);
    series.setData = (d: unknown) => {
      setCount += 1;
      return origSet(d);
    };
    series.update = (d: unknown) => {
      updateCount += 1;
      return origUp?.(d);
    };

    pm.syncOverlayLines('price', [
      {
        name: 'plotA',
        data: [
          { time: 2, value: 12 },
          { time: 3, value: 14 },
        ],
        color: '#fff',
      },
    ]);
    expect(setCount).toBe(1);
    expect(updateCount).toBe(0);
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

  it('hides LWC connector and attaches a break primitive for plot.style_linebr', () => {
    const data = [
      { time: 1, value: 10 },
      { time: 2, value: 11 },
      { time: 3 },
      { time: 4, value: 14 },
    ];
    pm.syncOverlayLines('price', [
      {
        name: 'ST Up',
        data,
        color: '#34d399',
        style: 'plot.style_linebr',
        linewidth: 2,
      },
    ]);
    const series = pm.getPane('price')!.series['overlay_ST Up'] as {
      _opts: { lineVisible?: boolean };
      _primitives: Array<{ segments?: () => unknown }>;
    };
    expect(series._opts.lineVisible).toBe(false);
    expect(series._primitives).toHaveLength(1);
    const segs = series._primitives[0]!.segments?.();
    expect(segs).toEqual([
      [
        { time: 1, value: 10 },
        { time: 2, value: 11 },
      ],
      [{ time: 4, value: 14 }],
    ]);
  });

  it('detaches the break primitive when style is no longer *br', () => {
    const data = [
      { time: 1, value: 10 },
      { time: 2 },
      { time: 3, value: 12 },
    ];
    pm.syncOverlayLines('price', [
      { name: 'plotA', data, color: '#fff', style: 'plot.style_linebr' },
    ]);
    const series = pm.getPane('price')!.series['overlay_plotA'] as {
      _opts: { lineVisible?: boolean };
      _primitives: unknown[];
    };
    expect(series._primitives).toHaveLength(1);
    expect(series._opts.lineVisible).toBe(false);

    pm.syncOverlayLines('price', [
      { name: 'plotA', data, color: '#fff', style: 'plot.style_line' },
    ]);
    expect(series._primitives).toHaveLength(0);
    expect(series._opts.lineVisible).toBe(true);
  });

  it('hides LWC area fill and attaches a break primitive for plot.style_areabr', () => {
    const data = [
      { time: 1, value: 10 },
      { time: 2 },
      { time: 3, value: 12 },
    ];
    pm.syncOverlayLines('price', [
      {
        name: 'zone',
        data,
        color: '#34d399',
        style: 'plot.style_areabr',
      },
    ]);
    const series = pm.getPane('price')!.series['overlay_zone'] as {
      _opts: { lineVisible?: boolean; topColor?: string; bottomColor?: string };
      _primitives: Array<{ options?: () => { area?: boolean } }>;
    };
    expect(series._opts.lineVisible).toBe(false);
    expect(series._opts.topColor).toBe('rgba(0,0,0,0)');
    expect(series._opts.bottomColor).toBe('rgba(0,0,0,0)');
    expect(series._primitives).toHaveLength(1);
    expect(series._primitives[0]!.options?.().area).toBe(true);
  });

  it('attaches a stepped break primitive for plot.style_steplinebr', () => {
    pm.syncOverlayLines('price', [
      {
        name: 'steps',
        data: [
          { time: 1, value: 10 },
          { time: 2, value: 11 },
        ],
        color: '#fff',
        style: 'plot.style_steplinebr',
      },
    ]);
    const series = pm.getPane('price')!.series['overlay_steps'] as {
      _opts: { lineVisible?: boolean };
      _primitives: Array<{ options?: () => { stepped?: boolean } }>;
    };
    expect(series._opts.lineVisible).toBe(false);
    expect(series._primitives).toHaveLength(1);
    expect(series._primitives[0]!.options?.().stepped).toBe(true);
  });

  it('does not attach a break primitive for plot.style_line (span na)', () => {
    pm.syncOverlayLines('price', [
      {
        name: 'sma',
        data: [
          { time: 1 },
          { time: 2, value: 10 },
          { time: 3, value: 11 },
        ],
        color: '#fff',
        style: 'plot.style_line',
      },
    ]);
    const series = pm.getPane('price')!.series['overlay_sma'] as {
      _opts: { lineVisible?: boolean };
      _primitives: unknown[];
    };
    expect(series._primitives).toHaveLength(0);
    expect(series._opts.lineVisible).not.toBe(false);
  });
});
