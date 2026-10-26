/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * manager-access bridges (`setDataToChart` / `getManager`) without Solid ChartHost.
 * Guards no-op when manager unset; mock host when installed.
 */

import './setup';
import { describe, expect, it, beforeAll, beforeEach } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const {
  getManager,
  setManager,
  getDrawingLayer,
  setDrawingLayer,
  setDataToChart,
} = await import('../src/chart/manager-access');
const { createBaseChart } = await import('../src/chart/series-factory');

describe('manager-access', () => {
  beforeEach(() => {
    setManager(undefined);
    setDrawingLayer(undefined);
    // Avoid leftover #pane-price from other suites tripping ensureDrawingLayer
    document.getElementById('pane-price')?.remove();
  });

  it('get/set manager', () => {
    expect(getManager()).toBeUndefined();
    const el = document.createElement('div') as unknown as HTMLElement;
    const chart = createBaseChart(el);
    const fake = {
      getPane: () => undefined,
      clearTradeMarkers: () => {},
      chart,
    };
    setManager(fake as never);
    expect(getManager()).toBe(fake);
  });

  it('setDataToChart no-ops without manager', () => {
    setDataToChart([{ time: 1, open: 1, high: 1, low: 1, close: 1 }]);
  });

  it('setDataToChart fills candle and volume series', () => {
    // No #pane-price → drawing layer skipped (needs real SVG DOM)
    const el = document.createElement('div') as unknown as HTMLElement;
    document.body.appendChild(el as never);

    const chart = createBaseChart(el);
    const panes = new Map<string, { id: string; series: Record<string, unknown>; chart: typeof chart }>();
    panes.set('price', { id: 'price', series: {}, chart });
    panes.set('volume', { id: 'volume', series: {}, chart });

    let markersCleared = 0;
    let priceType: string | null = null;
    setManager({
      getPane: (id: string) => panes.get(id),
      clearTradeMarkers: () => {
        markersCleared += 1;
      },
      getPriceChartType: () => priceType,
      setPriceChartType: (t: string) => {
        priceType = t;
      },
      detachPriceMarkers: () => {},
      reapplyPriceMarkers: () => {},
    } as never);

    setDataToChart([
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 2, open: 1.5, high: 2.5, low: 1, close: 1.2, volume: 12 },
    ]);
    expect(panes.get('price')!.series['candle']).toBeDefined();
    expect(panes.get('volume')!.series['volume']).toBeDefined();
    // clearMarkers path + clearChartScriptState both clear trade markers
    expect(markersCleared).toBeGreaterThanOrEqual(1);
    expect(priceType).toBe('candles');
  });

  it('setDataToChart opts can skip fit and markers', () => {
    const el = document.createElement('div') as unknown as HTMLElement;
    document.body.appendChild(el as never);
    const chart = createBaseChart(el);
    let fitCalls = 0;
    const ts = chart.timeScale();
    const origFit = ts.fitContent.bind(ts);
    ts.fitContent = () => {
      fitCalls += 1;
      return origFit();
    };
    const panes = new Map<string, { id: string; series: Record<string, unknown>; chart: typeof chart }>();
    panes.set('price', { id: 'price', series: {}, chart });
    panes.set('volume', { id: 'volume', series: {}, chart });

    let markersCleared = 0;
    let priceType: string | null = null;
    setManager({
      getPane: (id: string) => panes.get(id),
      clearTradeMarkers: () => {
        markersCleared += 1;
      },
      getPriceChartType: () => priceType,
      setPriceChartType: (t: string) => {
        priceType = t;
      },
      detachPriceMarkers: () => {},
      reapplyPriceMarkers: () => {},
    } as never);

    setDataToChart([{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }], {
      fit: false,
      clearMarkers: false,
    });
    expect(fitCalls).toBe(0);
    expect(markersCleared).toBe(0);
  });

  it('setDataToChart fit:false no-ops while manager is ranging', () => {
    let setDataCalls = 0;
    const candle = {
      setData: () => {
        setDataCalls += 1;
      },
      applyOptions: () => {},
      seriesType: () => 'Candlestick',
    };
    const ts = {
      getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      setVisibleLogicalRange: () => {},
      applyOptions: () => {},
      fitContent: () => {},
    };
    const chart = {
      timeScale: () => ts,
      priceScale: () => ({ applyOptions: () => {} }),
      addSeries: () => candle,
    };
    const panes = new Map<string, { id: string; series: Record<string, unknown>; chart: typeof chart }>();
    panes.set('price', { id: 'price', series: { candle }, chart });
    setManager({
      getPane: (id: string) => panes.get(id),
      getAllPanes: () => [...panes.values()],
      clearTradeMarkers: () => {},
      getPriceChartType: () => 'candles',
      setPriceChartType: () => {},
      detachPriceMarkers: () => {},
      reapplyPriceMarkers: () => {},
      isRanging: () => true,
    } as never);

    setDataToChart(
      [
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
      { fit: false, clearMarkers: false, clearScriptState: false },
    );
    expect(setDataCalls).toBe(0);
  });

  it('setDataToChart with fit false puts the logical range back', () => {
    let range = { from: 10, to: 40 };
    const ts = {
      getVisibleLogicalRange: () => ({ ...range }),
      setVisibleLogicalRange: (next: { from: number; to: number }) => {
        range = { from: next.from, to: next.to };
      },
      applyOptions: () => {},
      fitContent: () => {
        range = { from: 0, to: 100 };
      },
    };
    const candle = {
      setData: () => {
        range = { from: 0, to: 100 };
      },
      applyOptions: () => {},
      seriesType: () => 'Candlestick',
    };
    const chart = {
      timeScale: () => ts,
      priceScale: () => ({ applyOptions: () => {} }),
      addSeries: () => candle,
    };
    const panes = new Map<string, { id: string; series: Record<string, unknown>; chart: typeof chart }>();
    panes.set('price', { id: 'price', series: { candle }, chart });
    setManager({
      getPane: (id: string) => panes.get(id),
      clearTradeMarkers: () => {},
      getPriceChartType: () => 'candles',
      setPriceChartType: () => {},
      detachPriceMarkers: () => {},
      reapplyPriceMarkers: () => {},
    } as never);

    setDataToChart(
      [
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
      { fit: false, clearMarkers: false, clearScriptState: false },
    );
    expect(range).toEqual({ from: 10, to: 40 });
  });

  it('drawing layer get/set', () => {
    expect(getDrawingLayer()).toBeUndefined();
    setDrawingLayer({ destroy: () => {} } as never);
    expect(getDrawingLayer()).toBeDefined();
    setDrawingLayer(undefined);
  });

  it('setDataToChart paints a sibling manager without changing the active one', () => {
    const makeMgr = () => {
      const el = document.createElement('div') as unknown as HTMLElement;
      document.body.appendChild(el as never);
      const chart = createBaseChart(el);
      const candle = {
        setData: (d: unknown) => {
          (candle as { _data?: unknown })._data = d;
        },
        applyOptions: () => {},
        seriesType: () => 'Candlestick',
      };
      const panes = new Map<
        string,
        { id: string; series: Record<string, unknown>; chart: typeof chart }
      >();
      panes.set('price', { id: 'price', series: { candle }, chart });
      const mgr = {
        getPane: (id: string) => panes.get(id),
        clearTradeMarkers: () => {},
        getPriceChartType: () => 'candles',
        setPriceChartType: () => {},
        detachPriceMarkers: () => {},
        reapplyPriceMarkers: () => {},
      };
      return { mgr, candle };
    };
    const active = makeMgr();
    const sibling = makeMgr();
    setManager(active.mgr as never);
    expect(getManager()).toBe(active.mgr);

    setDataToChart(
      [
        { time: 10, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 20, open: 2, high: 2, low: 2, close: 2, volume: 1 },
      ],
      {
        fit: false,
        clearMarkers: false,
        clearScriptState: false,
        manager: sibling.mgr as never,
        slotId: 'slot-b',
      },
    );

    expect(getManager()).toBe(active.mgr);
    expect((active.candle as { _data?: unknown })._data).toBeUndefined();
    const painted = (sibling.candle as { _data?: Array<{ time: number }> })._data;
    expect(painted?.length).toBe(2);
    expect(painted?.[1]?.time).toBe(20);
  });

  it('getManager does not return stale legacy when active slot is empty', async () => {
    const { setActiveSlotId, setSlotManager, getSlotManager } = await import(
      '../src/chart/chart-registry'
    );
    const el = document.createElement('div') as unknown as HTMLElement;
    const chart = createBaseChart(el);
    const fake = {
      getPane: () => undefined,
      clearTradeMarkers: () => {},
      chart,
    };
    setActiveSlotId('slot-zombie');
    setManager(fake as never, 'slot-zombie');
    expect(getManager()).toBe(fake);
    // Simulate disposeSlotChart: null registry but leave module legacy dirty
    setSlotManager('slot-zombie', undefined);
    expect(getSlotManager('slot-zombie')).toBeUndefined();
    // Must not fall through to disposed legacy while slot id is still active
    expect(getManager()).toBeUndefined();
    setManager(undefined, 'slot-zombie');
    setActiveSlotId(null);
  });
});
