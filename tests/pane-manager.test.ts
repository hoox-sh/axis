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

const { PaneManager, peekOverlayLineTip, toLwcLineData, inferOverlayTitle } = await import('../src/chart/pane-manager');

describe('peekOverlayLineTip', () => {
  it('returns tip when raw length matches expected mapped length', () => {
    const peek = peekOverlayLineTip(
      [
        { time: 1, value: 10 },
        { time: 2, value: 12 },
      ],
      2,
    );
    expect(peek).toEqual({
      len: 2,
      lastTime: 2,
      lastVal: 12,
      tip: { time: 2, value: 12 },
    });
  });

  it('emits whitespace tip when last value is na', () => {
    const peek = peekOverlayLineTip(
      [
        { time: 1, value: 10 },
        { time: 2, value: undefined },
      ],
      2,
    );
    expect(peek).not.toBeNull();
    expect(peek!.lastVal).toBeNaN();
    expect(peek!.tip).toEqual({ time: 2 });
    expect('value' in peek!.tip).toBe(false);
  });

  it('returns null on length mismatch or non-finite tip time', () => {
    expect(peekOverlayLineTip([{ time: 1, value: 1 }], 2)).toBeNull();
    expect(peekOverlayLineTip([{ time: Number.NaN, value: 1 }], 1)).toBeNull();
    expect(peekOverlayLineTip([], 0)).toBeNull();
  });

  it('matches toLwcLineData tip for finite rows (fast-path contract)', () => {
    const data = [
      { time: 10, value: 1 },
      { time: 20, value: 2 },
      { time: 30, value: 3.5 },
    ];
    const mapped = toLwcLineData(data);
    const peek = peekOverlayLineTip(data, mapped.length);
    expect(peek).not.toBeNull();
    expect(peek!.len).toBe(mapped.length);
    expect(peek!.lastTime).toBe(Number(mapped[mapped.length - 1]!.time));
    expect(peek!.lastVal).toBe((mapped[mapped.length - 1] as { value: number }).value);
  });
});

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
    // leaving the chart clears Data Window crosshair (callback fires null → last bar fallback)
    expect(lastTime).toBeNull();
  });

  it('syncCrosshair ignores data-driven moves from non-hovered panes', () => {
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

    let calls = 0;
    let lastTime: unknown = undefined;
    pm.syncCrosshair((data) => {
      calls += 1;
      lastTime = data.time;
    });

    // Simulate pointer over price pane only
    (pm as unknown as { pointerInside: boolean; hoveredPaneId: string }).pointerInside = true;
    (pm as unknown as { hoveredPaneId: string }).hoveredPaneId = 'price';

    const priceHandlers = (
      price.chart as unknown as { _crosshairHandlers: Array<(p: unknown) => void> }
    )._crosshairHandlers;
    const volHandlers = (
      vol.chart as unknown as { _crosshairHandlers: Array<(p: unknown) => void> }
    )._crosshairHandlers;

    // User move on price (sourceEvent present) → accepted
    priceHandlers[0]!({
      time: 1_700_000_000,
      point: { x: 10, y: 20 },
      seriesData: new Map(),
      sourceEvent: { clientX: 1, clientY: 2 },
    });
    expect(lastTime).toBe(1_700_000_000);
    expect(calls).toBe(1);

    // Live series update re-fire on volume (no sourceEvent, not hovered) → ignored
    volHandlers[0]!({
      time: 1_700_000_100,
      point: { x: 11, y: 21 },
      seriesData: new Map(),
    });
    expect(lastTime).toBe(1_700_000_000);
    expect(calls).toBe(1);

    // Outside chart: data-driven re-fire ignored
    (pm as unknown as { pointerInside: boolean }).pointerInside = false;
    priceHandlers[0]!({
      time: 1_700_000_200,
      point: { x: 12, y: 22 },
      seriesData: new Map(),
    });
    expect(lastTime).toBe(1_700_000_000);
    expect(calls).toBe(1);
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

  it('last value labels toggle applies to series', () => {
    const price = pm.createPane('price', 'price', 'Price');
    let lastVal: boolean | undefined;
    price.series['candle'] = {
      applyOptions: (o: { lastValueVisible?: boolean }) => {
        if (o.lastValueVisible != null) lastVal = o.lastValueVisible;
      },
    } as never;
    expect(pm.isLastValueLabelsVisible()).toBe(true);
    expect(pm.setLastValueLabelsVisible(false)).toBe(false);
    expect(lastVal).toBe(false);
    expect(pm.toggleLastValueLabelsVisible()).toBe(true);
    expect(lastVal).toBe(true);
  });

  it('plot name titles toggle clears series title but not last value', () => {
    const price = pm.createPane('price', 'price', 'Price');
    let title: string | undefined;
    let lastVal: boolean | undefined;
    price.series['overlay_RSI'] = {
      applyOptions: (o: { title?: string; lastValueVisible?: boolean }) => {
        if (o.title != null) title = o.title;
        if (o.lastValueVisible != null) lastVal = o.lastValueVisible;
      },
    } as never;
    pm.rememberSeriesTitle('price', 'overlay_RSI', 'RSI');
    expect(pm.isLastValueNamesVisible()).toBe(true);
    expect(pm.setLastValueNamesVisible(false)).toBe(false);
    expect(title).toBe('');
    expect(lastVal).toBeUndefined();
    expect(pm.toggleLastValueNamesVisible()).toBe(true);
    expect(title).toBe('RSI');
  });

  it('inferOverlayTitle strips owner prefix', () => {
    expect(inferOverlayTitle('overlay_RSI')).toBe('RSI');
    expect(inferOverlayTitle('overlay_script1__Overbought')).toBe('Overbought');
    expect(inferOverlayTitle('overlay_ohlc_Haiken')).toBe('Haiken');
    expect(inferOverlayTitle('volume')).toBe('');
    expect(inferOverlayTitle('compare')).toBe('Compare');
    expect(inferOverlayTitle('compare_main_pct')).toBe('Main %');
    expect(inferOverlayTitle('onchain_tvl')).toBe('tvl');
    expect(inferOverlayTitle('onchain_dex_volume')).toBe('dex_volume');
  });

  it('compare / on-chain remembered titles survive [T] toggle', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const titles: Record<string, string> = {};
    const attach = (key: string) => {
      price.series[key] = {
        applyOptions: (o: { title?: string }) => {
          if (o.title != null) titles[key] = o.title;
        },
      } as never;
    };
    attach('compare');
    attach('compare_main_pct');
    attach('onchain_tvl');
    pm.rememberSeriesTitle('price', 'compare', 'ETHUSDT %');
    pm.rememberSeriesTitle('price', 'compare_main_pct', 'Main %');
    pm.rememberSeriesTitle('price', 'onchain_tvl', 'TVL');
    expect(pm.setLastValueNamesVisible(false)).toBe(false);
    expect(titles['compare']).toBe('');
    expect(titles['compare_main_pct']).toBe('');
    expect(titles['onchain_tvl']).toBe('');
    expect(pm.setLastValueNamesVisible(true)).toBe(true);
    expect(titles['compare']).toBe('ETHUSDT %');
    expect(titles['compare_main_pct']).toBe('Main %');
    expect(titles['onchain_tvl']).toBe('TVL');
  });

  it('volume last-value stays number-only unless a title was remembered', () => {
    const vol = pm.createPane('volume', 'volume', 'Volume');
    let title: string | undefined;
    vol.series['volume'] = {
      applyOptions: (o: { title?: string }) => {
        if (o.title != null) title = o.title;
      },
    } as never;
    expect(pm.setLastValueNamesVisible(false)).toBe(false);
    expect(title).toBe('');
    expect(pm.setLastValueNamesVisible(true)).toBe(true);
    expect(title).toBe('');
  });

  it('removeOverlays forgets remembered last-value titles', () => {
    const price = pm.createPane('price', 'price', 'Price');
    let title: string | undefined;
    const attach = () => {
      price.series['overlay_RSI'] = {
        applyOptions: (o: { title?: string }) => {
          if (o.title != null) title = o.title;
        },
      } as never;
    };
    attach();
    pm.rememberSeriesTitle('price', 'overlay_RSI', 'Custom RSI');
    pm.removeOverlays('price');
    attach();
    title = undefined;
    pm.setLastValueNamesVisible(false);
    pm.setLastValueNamesVisible(true);
    expect(title).toBe('RSI');
  });

  it('removeOverlays forgets remembered price-line titles', () => {
    const price = pm.createPane('price', 'price', 'Price');
    let title: string | undefined;
    const attach = () => {
      price.priceLines['OB'] = {
        line: {
          applyOptions: (o: { title?: string }) => {
            if (o.title != null) title = o.title;
          },
        },
        host: { removePriceLine: () => {} },
      } as never;
    };
    attach();
    pm.rememberPriceLineTitle('price', 'OB', 'Overbought');
    pm.removeOverlays('price');
    attach();
    title = undefined;
    pm.setLastValueNamesVisible(false);
    pm.setLastValueNamesVisible(true);
    expect(title).toBe('OB');
  });

  it('removeOverlaysForOwner forgets that owner’s last-value titles', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const key = 'overlay_script1__ATR';
    let title: string | undefined;
    const attach = () => {
      price.series[key] = {
        applyOptions: (o: { title?: string }) => {
          if (o.title != null) title = o.title;
        },
      } as never;
    };
    attach();
    pm.rememberSeriesTitle('price', key, 'Average True Range');
    pm.removeOverlaysForOwner('price', 'script1');
    attach();
    title = undefined;
    pm.setLastValueNamesVisible(false);
    pm.setLastValueNamesVisible(true);
    expect(title).toBe('ATR');
  });

  it('owner-scoped sync drops editor leftovers so last-value labels are not doubled', () => {
    // Exclusive indicator sub-pane: first apply under __editor__, then real id
    pm.createPane('ind_script1', 'indicator', 'ATR Volatility');
    const data = [
      { time: 1_700_000_000, value: 10 },
      { time: 1_700_000_060, value: 12 },
    ];
    pm.syncOverlayLines(
      'ind_script1',
      [{ name: 'ATR', data, color: '#00f' }],
      { ownerId: '__editor__' },
    );
    const afterEditor = pm.getPane('ind_script1')!;
    const editorKeys = Object.keys(afterEditor.series).filter((k) =>
      k.startsWith('overlay_'),
    );
    expect(editorKeys.length).toBe(1);
    expect(editorKeys[0]).toContain('__editor__');

    pm.syncOverlayLines(
      'ind_script1',
      [{ name: 'ATR', data, color: '#00f' }],
      { ownerId: 'script1' },
    );
    const afterReal = pm.getPane('ind_script1')!;
    const overlayKeys = Object.keys(afterReal.series).filter((k) =>
      k.startsWith('overlay_'),
    );
    // Only the real-owner series remains — no stacked last/current labels
    expect(overlayKeys.length).toBe(1);
    expect(overlayKeys[0]).toContain('script1');
    expect(overlayKeys[0]).not.toContain('__editor__');
  });

  it('price pane keeps sibling owners but drops editor leftovers for same plot', () => {
    pm.createPane('price', 'price', 'Price');
    const data = [{ time: 1_700_000_000, value: 1 }];
    pm.syncOverlayLines(
      'price',
      [{ name: 'EMA', data, color: '#0f0' }],
      { ownerId: 'sibling' },
    );
    pm.syncOverlayLines(
      'price',
      [{ name: 'EMA', data, color: '#f00' }],
      { ownerId: '__editor__' },
    );
    pm.syncOverlayLines(
      'price',
      [{ name: 'EMA', data, color: '#f00' }],
      { ownerId: 'mine' },
    );
    const keys = Object.keys(pm.getPane('price')!.series).filter((k) =>
      k.startsWith('overlay_'),
    );
    // sibling kept; editor dropped; mine kept
    expect(keys.some((k) => k.includes('sibling'))).toBe(true);
    expect(keys.some((k) => k.includes('mine'))).toBe(true);
    expect(keys.some((k) => k.includes('__editor__'))).toBe(false);
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

  it('owner-scoped trade markers clear on removeOverlaysForOwner (strategy detach)', () => {
    const p = pm.createPane('price', 'price', 'Price');
    p.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    const long = {
      time: 1000,
      position: 'belowBar' as const,
      color: '#0f0',
      shape: 'arrowUp' as const,
      text: 'L',
    };
    const short = {
      time: 2000,
      position: 'aboveBar' as const,
      color: '#f00',
      shape: 'arrowDown' as const,
      text: 'S',
    };
    pm.setTradeMarkers([long as never], 'strat_a');
    pm.setTradeMarkers([short as never], 'strat_b');
    const internal = pm as unknown as {
      tradeMarkerList: unknown[];
      tradeMarkersByOwner: Map<string, unknown[]>;
    };
    expect(internal.tradeMarkersByOwner.has('strat_a')).toBe(true);
    expect(internal.tradeMarkersByOwner.has('strat_b')).toBe(true);
    expect(internal.tradeMarkerList.length).toBe(2);

    // Detach path: removeOverlaysForOwner clears that owner’s trade markers
    pm.removeOverlaysForOwner('price', 'strat_a');
    expect(internal.tradeMarkersByOwner.has('strat_a')).toBe(false);
    expect(internal.tradeMarkersByOwner.has('strat_b')).toBe(true);
    expect(internal.tradeMarkerList.length).toBe(1);

    pm.clearTradeMarkers('strat_b');
    expect(internal.tradeMarkerList.length).toBe(0);
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
