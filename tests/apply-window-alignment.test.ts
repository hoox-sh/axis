/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Apply-path guards: the chart window slides, and the apply must not lose
 * its bearings.
 *
 * - The chart window drops its head on every new candle, so a bar **index**
 *   the engine stamped is relative to a window that has moved on. The
 *   absolute `bar_time` is the authority.
 * - The markers an apply paints must survive the same apply.
 * - Two scripts that plot a series with the same name must not collide.
 */

import './setup';
import { describe, expect, it, beforeAll, beforeEach } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';
import { signalBarIndex, normalizeStrategyEvents } from '../src/results/events';
import type { Bar } from '../src/store/types';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../src/chart/pane-manager');

function bars(n: number, start = 1_700_000_000, step = 60): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: start + i * step,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1,
  }));
}

describe('strategy events survive a window slide', () => {
  it('resolves a signal by its time, not by a stale index', () => {
    const window = bars(5);
    // The engine evaluated a window that started one bar earlier, so its
    // index 2 points at the *second* bar of the current window.
    const event = {
      kind: 'entry',
      id: 'L',
      direction: 'long',
      qty: 1,
      bar_index: 2,
      bar_time: window[3]!.time,
      ohlc: [100, 102, 99, 101],
    };
    expect(signalBarIndex(event as never, window)).toBe(3);
  });

  it('falls back to the index when the event carries no usable time', () => {
    const window = bars(5);
    const event = { kind: 'entry', id: 'L', bar_index: 2, bar_time: 0 };
    expect(signalBarIndex(event as never, window)).toBe(2);
  });

  it('fills the entry price from the bar the time points at', () => {
    const window = bars(5);
    const normalized = normalizeStrategyEvents(
      [
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          qty: 1,
          bar_index: 1,
          bar_time: window[3]!.time,
        },
      ],
      { bars: window, includeOrders: false, fillMode: 'close' },
    );
    expect(normalized[0]?.price).toBe(window[3]!.close);
  });
});

describe('owner-scoped markers', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = { setData: () => {}, data: () => [] } as never;
  });

  it('keeps the markers when only the series are removed', () => {
    const internal = pm as unknown as {
      shapeMarkersByOwner: Map<string, unknown[]>;
      tradeMarkersByOwner: Map<string, unknown[]>;
    };
    pm.setShapeMarkers(
      [{ time: 10, position: 'aboveBar', color: '#f00', shape: 'square', text: 'x', id: 'sig_1' }],
      'script_a',
      'price',
    );
    pm.setTradeMarkers(
      [{ time: 10, position: 'aboveBar', color: '#0f0', shape: 'square', text: 'L', id: 't_1' }],
      'script_a',
    );
    expect(internal.shapeMarkersByOwner.has('script_a')).toBe(true);
    expect(internal.tradeMarkersByOwner.has('script_a')).toBe(true);

    // A series-only cleanup (the apply path does this on the price pane
    // right after painting the markers) must not drop them.
    pm.removeOverlaysForOwner('price', 'script_a', { keepMarkers: true });
    expect(internal.shapeMarkersByOwner.has('script_a')).toBe(true);
    expect(internal.tradeMarkersByOwner.has('script_a')).toBe(true);
  });

  it('clears the markers on a full owner removal', () => {
    const internal = pm as unknown as {
      shapeMarkersByOwner: Map<string, unknown[]>;
      tradeMarkersByOwner: Map<string, unknown[]>;
    };
    pm.setShapeMarkers(
      [{ time: 10, position: 'aboveBar', color: '#f00', shape: 'square', text: 'x', id: 'sig_1' }],
      'script_b',
      'price',
    );
    pm.setTradeMarkers(
      [{ time: 10, position: 'aboveBar', color: '#0f0', shape: 'square', text: 'L', id: 't_1' }],
      'script_b',
    );
    pm.removeOverlaysForOwner('price', 'script_b');
    expect(internal.shapeMarkersByOwner.has('script_b')).toBe(false);
    expect(internal.tradeMarkersByOwner.has('script_b')).toBe(false);
  });

  it('gives two scripts with the same plot name distinct marker ids', () => {
    const internal = pm as unknown as {
      shapeMarkersByOwner: Map<string, { id: string }[]>;
    };
    const marker = {
      time: 10,
      position: 'aboveBar' as const,
      color: '#f00',
      shape: 'square' as const,
      text: '',
      id: 'signal_0',
    };
    pm.setShapeMarkers([marker], 'script_a', 'price');
    pm.setShapeMarkers([marker], 'script_b', 'price');
    const a = internal.shapeMarkersByOwner.get('script_a')?.[0]?.id ?? '';
    const b = internal.shapeMarkersByOwner.get('script_b')?.[0]?.id ?? '';
    expect(a).not.toBe(b);
  });
});
