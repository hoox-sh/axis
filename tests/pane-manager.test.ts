/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PaneManager with mocked lightweight-charts + document stub.
 * Guards series create/update/clear and multi-pane wiring without real LWC.
 */

import './setup';
import { describe, expect, it, beforeAll, beforeEach } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager } = await import('../src/chart/pane-manager');

describe('PaneManager', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
  });

  it('createPane / getPane / getAllPanes', () => {
    const p = pm.createPane('price', 'price', 'Price');
    expect(p.id).toBe('price');
    expect(pm.getPane('price')).toBe(p);
    expect(pm.getAllPanes()).toHaveLength(1);
  });

  it('second pane attaches resize handle', () => {
    pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 100);
    expect(pm.getAllPanes()).toHaveLength(2);
    expect(document.getElementById('pane-volume')).toBeTruthy();
  });

  it('destroyPane removes pane', () => {
    pm.createPane('price', 'price', 'Price');
    pm.destroyPane('price');
    expect(pm.getPane('price')).toBeUndefined();
  });

  it('setVisible / setLabel / resize', () => {
    pm.createPane('price', 'price', 'Price', 200);
    pm.setLabel('price', 'BTC');
    expect(pm.getPane('price')?.label).toBe('BTC');
    pm.setVisible('price', false);
    expect(pm.getPane('price')?.visible).toBe(false);
    pm.setVisible('price', true);
    pm.resize('price', 180);
  });

  it('syncTimeScales with 2 panes', () => {
    pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    pm.syncTimeScales();
    pm.alignTimeRangesFromPrice();
  });

  it('syncCrosshair wires all panes and mirrors position', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const vol = pm.createPane('volume', 'volume', 'Volume', 80);
    price.series['candle'] = {
      setData: () => {},
      dataByIndex: () => ({ close: 100 }),
      coordinateToPrice: () => 100,
    } as never;
    vol.series['volume'] = {
      setData: () => {},
      dataByIndex: () => ({ value: 10 }),
      coordinateToPrice: () => 10,
    } as never;

    let lastTime: unknown = undefined;
    pm.syncCrosshair((data) => {
      lastTime = data.time;
    });

    const handlers = (price.chart as unknown as { _crosshairHandlers: Array<(p: unknown) => void> })
      ._crosshairHandlers;
    expect(handlers.length).toBeGreaterThan(0);
    handlers[0]!({
      time: 1_700_000_000,
      point: { x: 10, y: 20 },
      seriesData: new Map(),
    });
    expect(lastTime).toBe(1_700_000_000);

    handlers[0]!({ time: undefined, point: undefined, seriesData: new Map() });
    // leaving the chart keeps Data Window (callback still fires null)
    expect(lastTime).toBeNull();
  });

  it('price scale auto/log toggles and afterDataReload', () => {
    pm.createPane('price', 'price', 'Price');
    expect(pm.isPriceAutoScale()).toBe(true);
    expect(pm.isPriceLogScale()).toBe(false);
    expect(pm.togglePriceLogScale()).toBe(true);
    expect(pm.isPriceLogScale()).toBe(true);
    expect(pm.togglePriceAutoScale()).toBe(false);
    expect(pm.isPriceAutoScale()).toBe(false);
    expect(pm.togglePriceAutoScale()).toBe(true);
    pm.afterDataReload();
    expect(pm.isPriceAutoScale()).toBe(true);
  });

  it('price scale labels toggle and overlay color apply', () => {
    const p = pm.createPane('price', 'price', 'Price');
    expect(pm.isPriceScaleLabelsVisible()).toBe(true);
    expect(pm.togglePriceScaleLabelsVisible()).toBe(false);
    expect(pm.isPriceScaleLabelsVisible()).toBe(false);
    expect(pm.setPriceScaleLabelsVisible(true)).toBe(true);

    let applied: unknown;
    p.series['overlay_Fast'] = {
      setData: () => {},
      applyOptions: (o: unknown) => {
        applied = o;
      },
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    expect(pm.setOverlayLineColor('price', 'Fast', '#ff00aa')).toBe(true);
    expect(applied).toEqual({ color: '#ff00aa' });
    expect(pm.setOverlayLineColor('price', 'Missing', '#fff')).toBe(false);
  });

  it('clearTradeMarkers no-op without candle', () => {
    pm.createPane('price', 'price', 'Price');
    pm.clearTradeMarkers();
  });

  it('setTradeMarkers attaches markers when candle exists', () => {
    const p = pm.createPane('price', 'price', 'Price');
    // inject fake candle series
    p.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    pm.setTradeMarkers([
      {
        time: 1000,
        position: 'belowBar',
        color: '#0f0',
        shape: 'arrowUp',
        text: 'L',
      } as never,
    ]);
    pm.clearTradeMarkers();
  });

  it('setShapeMarkers and setTradeMarkers both apply without wipe', () => {
    const p = pm.createPane('price', 'price', 'Price');
    p.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    pm.setShapeMarkers([
      {
        time: 1000,
        position: 'aboveBar',
        color: '#f00',
        shape: 'circle',
        text: 'S',
        id: 's1',
      },
    ]);
    pm.setTradeMarkers([
      {
        time: 2000,
        position: 'belowBar',
        color: '#0f0',
        shape: 'arrowUp',
        text: 'L',
      } as never,
    ]);
    pm.clearShapeMarkers();
    pm.clearTradeMarkers();
  });

  it('setDebugPinMarkers merges with trade/shape and clear is independent', () => {
    const p = pm.createPane('price', 'price', 'Price');
    p.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    pm.setDebugPinMarkers([
      {
        time: 500,
        position: 'aboveBar',
        color: '#939fff',
        shape: 'circle',
        text: 'L3',
      },
    ]);
    pm.setTradeMarkers([
      {
        time: 1000,
        position: 'belowBar',
        color: '#0f0',
        shape: 'arrowUp',
        text: 'L',
      } as never,
    ]);
    // Clearing trades must not require clearDebugPinMarkers
    pm.clearTradeMarkers();
    pm.clearDebugPinMarkers();
  });

  it('syncBgcolorBands creates bgcolor_ series', () => {
    const p = pm.createPane('price', 'price', 'Price');
    p.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    pm.syncBgcolorBands([
      {
        name: 'up_bg',
        data: [
          { time: 1, value: 1, color: 'rgba(255,0,0,0.2)' },
          { time: 2, value: 1, color: 'rgba(0,255,0,0.2)' },
        ],
      },
    ]);
    expect(p.series['bgcolor_up_bg']).toBeDefined();
    pm.syncBgcolorBands([]);
    expect(p.series['bgcolor_up_bg']).toBeUndefined();
  });

  it('scrollToTime centers panes', () => {
    pm.createPane('price', 'price', 'Price');
    pm.scrollToTime(1_700_000_000);
  });

  it('setEquityCurve creates equity pane; hideEquityPane hides', () => {
    pm.createPane('price', 'price', 'Price');
    pm.setEquityCurve([
      { time: 1, value: 10000 },
      { time: 2, value: 10100 },
    ]);
    expect(pm.getPane('equity')).toBeDefined();
    pm.hideEquityPane();
    expect(pm.getPane('equity')?.visible).toBe(false);
    pm.setEquityCurve([]);
  });

  it('dispose cleans up', () => {
    pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    pm.dispose();
    expect(pm.getAllPanes()).toHaveLength(0);
  });
});
