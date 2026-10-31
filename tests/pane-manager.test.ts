/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PaneManager with mocked lightweight-charts + document stub.
 * Guards series create/update/clear and multi-pane wiring without real LWC.
 */

import './setup';
import { describe, expect, it, beforeAll, beforeEach, afterEach } from 'bun:test';
import { installLightweightChartsMock } from './helpers/mock-lwc';
import { _resetSyncSampleForTests } from '../src/chart/v1/invariants';
import { setStore, store } from '../src/store';
import { PANE_RESIZE_LAYOUT } from '../src/chart/series-factory';

beforeAll(() => {
  installLightweightChartsMock();
});

const { PaneManager, peekOverlayLineTip, toLwcLineData, inferOverlayTitle } =
  await import('../src/chart/pane-manager');

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

  afterEach(() => {
    try {
      pm.dispose();
    } catch {
      /* ignore */
    }
    try {
      container.remove();
    } catch {
      /* ignore */
    }
  });

  it('createPane / getPane / getAllPanes', () => {
    const p = pm.createPane('price', 'price', 'Price');
    expect(p.id).toBe('price');
    expect(pm.getPane('price')).toBe(p);
    expect(pm.getAllPanes()).toHaveLength(1);
  });

  it('single layout puts volume on the price chart and keeps candles when volume goes', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const volume = pm.createPane('volume', 'volume', 'Volume', 80);
    const volumeEl = document.getElementById(pm.paneDomId('volume'));
    expect(volumeEl?.style.display).toBe('none');
    const panes = (
      volume.chart as unknown as {
        panes: () => Array<{
          getHTMLElement: () => { dataset?: { axisPaneChrome?: string } } | null;
        }>;
      }
    ).panes();
    expect(panes[1]?.getHTMLElement()?.dataset?.axisPaneChrome).toBe('volume');
    expect(
      (volumeEl as unknown as { dataset?: { axisPaneChrome?: string } } | null)?.dataset
        ?.axisPaneChrome,
    ).toBeUndefined();
    const series = volume.chart.addSeries('LineSeries' as never, {});
    expect((series as { _paneIndex?: number })._paneIndex).toBe(1);
    expect(price.chart.addSeries('LineSeries' as never, {})).toBeTruthy();
    expect(
      (price.chart.addSeries('LineSeries' as never, {}) as { _paneIndex?: number })._paneIndex,
    ).toBe(0);
    pm.destroyPane('volume');
    expect(pm.getPane('price')).toBe(price);
    expect(pm.getPane('volume')).toBeUndefined();
    price.chart.timeScale().getVisibleLogicalRange();
  });

  it('single layout uses LWC pane resize and skips the custom handle', () => {
    const price = pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    expect(document.getElementById('pane-handle-volume')).toBeNull();
    const opts = (price.chart as { _options?: { layout?: { panes?: typeof PANE_RESIZE_LAYOUT } } })
      ._options;
    expect(opts?.layout?.panes?.enableResize).toBe(true);
    expect(opts?.layout?.panes?.separatorColor).toBe(PANE_RESIZE_LAYOUT.separatorColor);
  });

  it('single layout resize sets IPaneApi height, not the whole chart', () => {
    const price = pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    const panes = price.chart as {
      panes: () => Array<{ getHeight: () => number }>;
      _applied?: unknown;
    };
    const appliedBefore = panes._applied;
    pm.resize('volume', 160);
    expect(panes.panes()[1]?.getHeight()).toBe(160);
    expect(panes._applied).toBe(appliedBefore);
  });

  it('single layout pointerup persists LWC pane heights into the store', () => {
    setStore('panes', [
      { id: 'price', type: 'price', height: 400, order: 0, visible: true, label: 'Price' },
      { id: 'volume', type: 'volume', height: 80, order: 1, visible: true, label: 'Volume' },
    ]);
    const price = pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    (price.chart as { panes: () => Array<{ setHeight: (h: number) => void }> })
      .panes()[1]
      ?.setHeight(132);
    const host = document.getElementById(pm.paneDomId('price')) as {
      dispatchEvent: (ev: { type: string }) => void;
    } | null;
    host?.dispatchEvent({ type: 'pointerup' });
    expect(store.panes.find((p) => p.id === 'volume')?.height).toBe(132);
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

  it('single layout does not copy the logical range onto a second chart', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const volume = pm.createPane('volume', 'volume', 'Volume', 80);
    let sets = 0;
    const ts = price.chart.timeScale() as { setVisibleLogicalRange: (range: unknown) => void };
    const orig = ts.setVisibleLogicalRange.bind(ts);
    ts.setVisibleLogicalRange = (range: unknown) => {
      sets += 1;
      orig(range);
    };
    pm.alignTimeRangesFromPrice();
    pm.syncTimeScales();
    expect(sets).toBe(0);
    expect(pm.getPane('volume')?.chart).toBe(volume.chart);
  });

  it('single layout samples matching logical ranges without mirroring', () => {
    const price = pm.createPane('price', 'price', 'Price');
    pm.createPane('rsi', 'indicator', 'RSI', 140);
    let sets = 0;
    let gets = 0;
    const range = { from: 0, to: 10 };
    const chart = price.chart as unknown as {
      timeScale: () => {
        getVisibleLogicalRange: () => { from: number; to: number };
        setVisibleLogicalRange: (range: unknown) => void;
      };
    };
    const origTs = chart.timeScale.bind(chart);
    chart.timeScale = () => {
      const ts = origTs();
      const origSet = ts.setVisibleLogicalRange.bind(ts);
      ts.getVisibleLogicalRange = () => {
        gets += 1;
        return range;
      };
      ts.setVisibleLogicalRange = (next) => {
        sets += 1;
        origSet(next);
      };
      return ts;
    };
    _resetSyncSampleForTests();
    const messages: string[] = [];
    pm.alignTimeRangesFromPrice({
      dev: true,
      warn: (message) => messages.push(message),
    });
    expect(sets).toBe(0);
    expect(gets).toBeGreaterThanOrEqual(2);
    expect(messages).toEqual([]);
  });

  it('single layout wires one crosshair listener and does not mirror', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const rsi = pm.createPane('rsi', 'indicator', 'RSI', 140);
    const priceChart = price.chart as unknown as {
      setCrosshairPosition: (...args: unknown[]) => void;
      _crosshairHandlers: Array<(p: unknown) => void>;
    };
    const rsiChart = rsi.chart as unknown as {
      setCrosshairPosition: (...args: unknown[]) => void;
      _crosshairHandlers: Array<(p: unknown) => void>;
    };
    expect(rsiChart._crosshairHandlers).toBe(priceChart._crosshairHandlers);
    let mirrors = 0;
    const orig = priceChart.setCrosshairPosition.bind(priceChart);
    priceChart.setCrosshairPosition = (...args: unknown[]) => {
      mirrors += 1;
      orig(...args);
    };
    let rsiMirrors = 0;
    const origRsi = rsiChart.setCrosshairPosition.bind(rsiChart);
    rsiChart.setCrosshairPosition = (...args: unknown[]) => {
      rsiMirrors += 1;
      origRsi(...args);
    };
    const T = 1_700_000_000;
    const times: unknown[] = [];
    let lastTime: unknown;
    pm.syncCrosshair((data) => {
      lastTime = data.time;
      times.push(data.time);
    });
    expect(priceChart._crosshairHandlers).toHaveLength(1);
    expect(rsiChart._crosshairHandlers).toHaveLength(1);
    priceChart._crosshairHandlers[0]!({
      time: T,
      point: { x: 10, y: 20 },
      seriesData: new Map(),
    });
    const uniqueTimes = [...new Set(times)];
    expect(lastTime).toBe(T);
    expect(times).toEqual([T]);
    expect(uniqueTimes).toEqual([T]);
    expect(mirrors).toBe(0);
    expect(rsiMirrors).toBe(0);
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

    let lastTime: unknown;
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
    let lastTime: unknown;
    pm.syncCrosshair((data) => {
      calls += 1;
      lastTime = data.time;
    });

    // Simulate pointer over price pane only
    (pm as unknown as { pointerInside: boolean; hoveredPaneId: string }).pointerInside = true;
    (pm as unknown as { hoveredPaneId: string }).hoveredPaneId = 'price';

    // One chart has one crosshair subscription — owned by the first pane iterated.
    const priceHandlers = (
      price.chart as unknown as { _crosshairHandlers: Array<(p: unknown) => void> }
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

    // Live series update re-fire (no sourceEvent) while the pointer hovers a
    // different pane → ignored
    (pm as unknown as { hoveredPaneId: string }).hoveredPaneId = 'volume';
    priceHandlers[0]!({
      time: 1_700_000_100,
      point: { x: 11, y: 21 },
      seriesData: new Map(),
    });
    expect(lastTime).toBe(1_700_000_000);
    expect(calls).toBe(1);

    // Outside chart: data-driven re-fire ignored
    (pm as unknown as { hoveredPaneId: string }).hoveredPaneId = 'price';
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
    pm.syncOverlayLines('ind_script1', [{ name: 'ATR', data, color: '#00f' }], {
      ownerId: '__editor__',
    });
    const afterEditor = pm.getPane('ind_script1')!;
    const editorKeys = Object.keys(afterEditor.series).filter((k) => k.startsWith('overlay_'));
    expect(editorKeys.length).toBe(1);
    expect(editorKeys[0]).toContain('__editor__');

    pm.syncOverlayLines('ind_script1', [{ name: 'ATR', data, color: '#00f' }], {
      ownerId: 'script1',
    });
    const afterReal = pm.getPane('ind_script1')!;
    const overlayKeys = Object.keys(afterReal.series).filter((k) => k.startsWith('overlay_'));
    // Only the real-owner series remains — no stacked last/current labels
    expect(overlayKeys.length).toBe(1);
    expect(overlayKeys[0]).toContain('script1');
    expect(overlayKeys[0]).not.toContain('__editor__');
  });

  it('price pane keeps sibling owners but drops editor leftovers for same plot', () => {
    pm.createPane('price', 'price', 'Price');
    const data = [{ time: 1_700_000_000, value: 1 }];
    pm.syncOverlayLines('price', [{ name: 'EMA', data, color: '#0f0' }], { ownerId: 'sibling' });
    pm.syncOverlayLines('price', [{ name: 'EMA', data, color: '#f00' }], { ownerId: '__editor__' });
    pm.syncOverlayLines('price', [{ name: 'EMA', data, color: '#f00' }], { ownerId: 'mine' });
    const keys = Object.keys(pm.getPane('price')!.series).filter((k) => k.startsWith('overlay_'));
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

  it('setShapeMarkers paneId keeps overlay=false shapes off price candles', () => {
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    const osc = pm.createPane('ind_rsi', 'indicator', 'RSI');
    osc.series['overlay_RSI'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;

    const spec = {
      time: 1000,
      position: 'aboveBar' as const,
      color: '#f00',
      shape: 'circle' as const,
      text: 'S',
      id: 's1',
    };
    pm.setShapeMarkers([spec], 'rsi', 'ind_rsi');
    const internal = pm as unknown as {
      shapePaneByOwner: Map<string, string>;
      shapeMarkersByOwner: Map<string, unknown[]>;
    };
    expect(internal.shapePaneByOwner.get('rsi')).toBe('ind_rsi');
    expect(internal.shapeMarkersByOwner.get('rsi')?.length).toBe(1);

    pm.setShapeMarkers([spec], 'price_script', 'price');
    expect(internal.shapePaneByOwner.get('price_script')).toBe('price');

    pm.clearShapeMarkers('rsi');
    expect(internal.shapePaneByOwner.has('rsi')).toBe(false);
    expect(internal.shapePaneByOwner.get('price_script')).toBe('price');
  });

  it('reownShapeMarkers moves editor preview onto the script id', () => {
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = {
      setData: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      seriesOrder: () => 1,
      setSeriesOrder: () => {},
    } as never;
    pm.setShapeMarkers(
      [
        {
          time: 1000,
          position: 'aboveBar',
          color: '#f00',
          shape: 'circle',
          text: 'S',
          id: 's1',
        },
      ],
      '__editor__',
      'price',
    );
    pm.reownShapeMarkers('__editor__', 'ind_1');
    const internal = pm as unknown as {
      shapePaneByOwner: Map<string, string>;
      shapeMarkersByOwner: Map<string, unknown[]>;
    };
    expect(internal.shapeMarkersByOwner.has('__editor__')).toBe(false);
    expect(internal.shapeMarkersByOwner.get('ind_1')?.length).toBe(1);
    expect(internal.shapePaneByOwner.get('ind_1')).toBe('price');
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

  it('syncBgcolorBands applies band titles on create and update', () => {
    const p = pm.createPane('price', 'price', 'Price');
    const applied: unknown[] = [];
    // The factory isn't injectable here — exercise the update path by
    // injecting a fake series into the registry before syncing.
    const existing = {
      setData: () => {},
      applyOptions: (o: unknown) => {
        applied.push(o);
      },
      priceScale: () => ({ applyOptions: () => {} }),
    } as never;
    p.series['bgcolor_t'] = existing;
    pm.syncBgcolorBands(
      [{ name: 't', title: 'My Band', data: [{ time: 1, value: 1, color: '#123456' }] }],
      {},
    );
    expect(applied).toContainEqual({ title: 'My Band' });
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

  it('hlines host on plot series, never on bgcolor underlays', () => {
    // Regression: bgcolor_* histograms live on a hidden 0..1 price scale;
    // hosting hlines there mapped them far off-viewport (invisible).
    const pane = pm.createPane('ind_gc', 'indicator', 'CCI');
    pm.syncBgcolorBands(
      [{ name: 'bg', data: [{ time: 100, value: 1, color: 'rgba(8,153,129,0.3)' }] }],
      { ownerId: 's1', paneId: 'ind_gc' },
    );
    expect(Object.keys(pane.series).some((k) => k.startsWith('bgcolor_'))).toBe(true);

    pm.syncOverlayLines(
      'ind_gc',
      [
        { name: 'CCI', data: [{ time: 100, value: 10 }], color: '#ffffff' },
        { name: 'high', kind: 'hline', data: [], price: 70 },
        { name: 'mid', kind: 'hline', data: [], price: 50 },
        { name: 'low', kind: 'hline', data: [], price: 30 },
      ],
      { ownerId: 's1' },
    );

    const bgKey = Object.keys(pane.series).find((k) => k.startsWith('bgcolor_')) as string;
    const bg = pane.series[bgKey] as never as { _priceLines: unknown[] };
    expect(bg._priceLines).toHaveLength(0);
    const total = Object.entries(pane.series)
      .filter(([k]) => k !== bgKey)
      .reduce(
        (n, [, s]) => n + ((s as never as { _priceLines?: unknown[] })._priceLines?.length ?? 0),
        0,
      );
    expect(total).toBe(3);
  });

  it('dispose cleans up', () => {
    pm.createPane('price', 'price', 'Price');
    pm.createPane('volume', 'volume', 'Volume', 80);
    pm.dispose();
    expect(pm.getAllPanes()).toHaveLength(0);
  });

  it('destroyPane purges pane-scoped meta + hover listener (recreate repaints)', () => {
    pm.createPane('price', 'price', 'Price');
    pm.syncOverlayLines(
      'price',
      [{ name: 'EMA', data: [{ time: 1_700_000_000, value: 1 }], color: '#0f0' }],
      { ownerId: 's1' },
    );
    pm.rememberSeriesTitle('price', 'overlay_s1__EMA', 'EMA');
    const internal = pm as unknown as {
      overlayDataMeta: Map<string, unknown>;
      overlaySeriesKinds: Map<string, unknown>;
      lastValueTitleByKey: Map<string, string>;
      pointerUnsubs: Array<() => void>;
      panePointerUnsubs: Map<string, () => void>;
    };
    expect([...internal.overlayDataMeta.keys()].some((k) => k.startsWith('price:'))).toBe(true);
    const unsubsBefore = internal.pointerUnsubs.length;
    pm.destroyPane('price');
    expect([...internal.overlayDataMeta.keys()].some((k) => k.startsWith('price:'))).toBe(false);
    expect([...internal.overlaySeriesKinds.keys()].some((k) => k.startsWith('price:'))).toBe(false);
    expect([...internal.lastValueTitleByKey.keys()].some((k) => k.startsWith('price:'))).toBe(
      false,
    );
    expect(internal.panePointerUnsubs.has('price')).toBe(false);
    expect(internal.pointerUnsubs.length).toBe(unsubsBefore - 1);
    // Recreate + re-apply repaints (no stale tip fast-path leaving it empty)
    const again = pm.createPane('price', 'price', 'Price');
    pm.syncOverlayLines(
      'price',
      [{ name: 'EMA', data: [{ time: 1_700_000_000, value: 1 }], color: '#0f0' }],
      { ownerId: 's1' },
    );
    expect(Object.keys(again.series).some((k) => k.includes('s1'))).toBe(true);
  });

  it('setOverlayLineColor resolves owner-scoped series without owner id', () => {
    const p = pm.createPane('price', 'price', 'Price');
    let applied: unknown;
    p.series['overlay_s1__Fast'] = {
      setData: () => {},
      applyOptions: (o: unknown) => {
        applied = o;
      },
    } as never;
    expect(pm.setOverlayLineColor('price', 'Fast', '#ff00aa')).toBe(true);
    expect(applied).toEqual({ color: '#ff00aa' });
    applied = undefined;
    expect(pm.setOverlayLineColor('price', 'Fast', '#00ff00', 's1')).toBe(true);
    expect(applied).toEqual({ color: '#00ff00' });
    expect(pm.setOverlayLineColor('price', 'Missing', '#fff')).toBe(false);
  });

  it('applyBarColors maps through Heikin-Ashi and honors replay prefix', async () => {
    const p = pm.createPane('price', 'price', 'Price');
    let painted: Array<Record<string, unknown>> = [];
    p.series['candle'] = {
      setData: (d: never) => {
        painted = d as never as Array<Record<string, unknown>>;
      },
      applyOptions: () => {},
    } as never;
    const bars = [1000, 1060, 1120].map((t, i) => ({
      time: t,
      open: 10 + i,
      high: 12 + i,
      low: 9 + i,
      close: 11 + i,
      volume: 5,
    }));
    setStore('bars', bars);
    setStore('chartType', 'heikinashi');
    try {
      const n = pm.applyBarColors([{ time: 1060, color: '#ff0000' }], 's1');
      expect(n).toBe(1);
      expect(painted).toHaveLength(3);
      // HA-transformed first open is (o+c)/2 = 10.5, not the raw candle open
      expect(painted[0]!['open']).not.toBe(10);
      expect(painted[1]!['color']).toBe('#ff0000');
      expect(painted[0]!['color']).toBeUndefined();

      const { startReplaySession, stopReplaySession } = await import('../src/chart/bar-replay');
      startReplaySession(3, { cursorIndex: 0 });
      try {
        painted = [];
        const nReplay = pm.applyBarColors([{ time: 1000, color: '#00ff00' }], 's1');
        expect(nReplay).toBe(1);
        // Only the scrubbed prefix reaches the chart during replay
        expect(painted).toHaveLength(1);
        expect(painted[0]!['color']).toBe('#00ff00');
      } finally {
        stopReplaySession();
      }
    } finally {
      setStore('bars', []);
      setStore('chartType', 'candles');
    }
  });
});

describe('pruneCoPaintedSeriesToPaintedRange', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
  });

  it('drops script rows outside a moved candle window and leaves other overlays alone', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const candle = [{ time: 200 }, { time: 300 }];
    let overlay = [
      { time: 100, value: 1 },
      { time: 200, value: 2 },
      { time: 300, value: 3 },
      { time: 400, value: 4 },
    ];
    let band = [
      { time: 100, value: 9 },
      { time: 200, value: 9 },
    ];
    let equity = [
      { time: 300, value: 5 },
      { time: 400, value: 6 },
    ];
    const applied: Array<{ key: string; data: unknown[] }> = [];
    let compareSets = 0;
    price.series['candle'] = { setData: () => {}, data: () => candle } as never;
    price.series['overlay_s1__vwma'] = {
      setData: (d: unknown[]) => {
        applied.push({ key: 'overlay', data: d });
        overlay = d;
      },
      data: () => overlay,
    } as never;
    price.series['bgcolor_s1__'] = {
      setData: (d: unknown[]) => {
        applied.push({ key: 'bgcolor', data: d });
        band = d;
      },
      data: () => band,
    } as never;
    price.series['equity'] = {
      setData: (d: unknown[]) => {
        applied.push({ key: 'equity', data: d });
        equity = d;
      },
      data: () => equity,
    } as never;
    // Compare overlays own an independent window and must never be pruned.
    price.series['compare'] = {
      setData: () => {
        compareSets += 1;
      },
      data: () => [{ time: 50 }],
    } as never;
    // A series without data() is skipped rather than throwing.
    price.series['overlay_plain'] = { setData: () => {} } as never;

    // First paint establishes the window; every script row is inside it.
    pm.notePaintedCandleRange(100, 400);
    expect(applied).toHaveLength(0);
    expect(compareSets).toBe(0);

    // The window slides forward (repair / reload): rows past the candles must go.
    // The pruned series are padded back to one row per candle (Pine `na`
    // whitespace) so a short series cannot shift the pane's logical range
    // against the price pane.
    pm.notePaintedCandleRange(200, 300);
    expect(applied).toEqual([
      {
        key: 'overlay',
        data: [
          { time: 200, value: 2 },
          { time: 300, value: 3 },
        ],
      },
      { key: 'bgcolor', data: [{ time: 200, value: 9 }, { time: 300 }] },
      { key: 'equity', data: [{ time: 300, value: 5 }] },
    ]);
    expect(compareSets).toBe(0);

    // A repeated identical note is a no-op.
    pm.notePaintedCandleRange(200, 300);
    expect(applied).toHaveLength(3);
  });

  it('clamps when the recorded range is read back before any paint', () => {
    const container2 = document.createElement('div') as unknown as HTMLElement;
    const pm2 = new PaneManager(container2);
    const price = pm2.createPane('price', 'price', 'Price');
    let rows = [{ time: 1 }, { time: 99_999 }];
    price.series['overlay_x'] = {
      setData: (d: unknown[]) => {
        rows = d;
      },
      data: () => rows,
    } as never;
    expect(pm2.getPaintedCandleRange()).toBeNull();
    pm2.notePaintedCandleRange(10, 20);
    expect(pm2.getPaintedCandleRange()).toEqual({ first: 10, last: 20 });
    expect(rows).toEqual([]);
  });
});

describe('live candle axis', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = { update: () => {}, setData: () => {}, data: () => [] } as never;
    setStore('chartType', 'candles');
  });

  function axis(): number[] | null {
    return (pm as unknown as { paintedCandleTimesList: number[] | null }).paintedCandleTimesList;
  }

  function bar(time: number): {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } {
    return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
  }

  it('does not grow the indicator axis on forming ticks, and extends it once on a new candle', () => {
    pm.notePaintedCandleRange(100, 220, [100, 160, 220]);
    // Several updates of the open candle used to push 220 again on every tick.
    pm.appendBar(bar(220));
    pm.appendBar({ ...bar(220), close: 1.6 });
    pm.appendBar({ ...bar(220), close: 1.7 });
    expect(axis()).toEqual([100, 160, 220]);
    // The new candle is one more bar, not one more copy of the bar that just closed.
    pm.appendBar(bar(280));
    expect(axis()).toEqual([100, 160, 220, 280]);
    pm.appendBar({ ...bar(280), close: 1.8 });
    expect(axis()).toEqual([100, 160, 220, 280]);
  });

  it('collapses a tail of duplicate times when the next candle arrives', () => {
    const internal = pm as unknown as { paintedCandleTimesList: number[] | null };
    pm.notePaintedCandleRange(100, 220, [100, 160, 220]);
    internal.paintedCandleTimesList = [100, 160, 220, 220, 220];
    pm.appendBar(bar(280));
    expect(axis()).toEqual([100, 160, 220, 280]);
  });
});

describe('load paint while the user is zooming', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
  });

  it('drops co-painted times the next candles will not have', () => {
    const price = pm.createPane('price', 'price', 'Price');
    const volume = pm.createPane('volume', 'volume', 'Volume', 80);
    let overlay = [
      { time: 1, value: 1 },
      { time: 99, value: 9 },
    ];
    let vol = [
      { time: 1, value: 1 },
      { time: 2, value: 2 },
      { time: 50, value: 5 },
    ];
    price.series['candle'] = { data: () => [{ time: 1 }, { time: 2 }], setData: () => {} } as never;
    price.series['overlay_s1__vwma'] = {
      data: () => overlay,
      setData: (d: { time: number; value: number }[]) => {
        overlay = d;
      },
    } as never;
    volume.series['volume'] = {
      data: () => vol,
      setData: (d: { time: number; value: number }[]) => {
        vol = d;
      },
    } as never;
    pm.notePaintedCandleRange(1, 2, [1, 2]);
    pm.prepareCoPaintedForCandleTimes(new Set([2, 3]));
    // 99 and 50 are not in the next candles. 1 is already on the candles but
    // the next payload drops it. 2 is in both, so it stays.
    expect(overlay.map((row) => row.time)).toEqual([2]);
    expect(vol.map((row) => row.time)).toEqual([2]);
  });

  it('does not fit the time scale while a zoom gesture is down', () => {
    const price = pm.createPane('price', 'price', 'Price');
    let fits = 0;
    const ts = {
      fitContent: () => {
        fits += 1;
      },
      getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      setVisibleLogicalRange: () => {},
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    };
    (price.chart as { timeScale: () => typeof ts }).timeScale = () => ts;
    pm.afterDataReload();
    expect(fits).toBeGreaterThan(0);
    const div = document.getElementById(pm.paneDomId('price'));
    div?.dispatchEvent(new Event('pointerdown'));
    fits = 0;
    pm.afterDataReload();
    expect(fits).toBe(0);
    div?.dispatchEvent(new Event('pointerup'));
  });
});

describe('auditTimeParity', () => {
  let container: HTMLElement;
  let pm: InstanceType<typeof PaneManager>;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
  });

  it('names the series that holds a bar the candles do not have', () => {
    // The library's shared time scale is the union of every series' rows:
    // an overlay row at a bar the candles dropped makes the candlestick
    // renderer fail with `Value is null` and no other clue.
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = {
      setData: () => {},
      data: () => [{ time: 100 }, { time: 300 }],
    } as never;
    price.series['overlay_s1__vwma'] = {
      setData: () => {},
      data: () => [{ time: 100 }, { time: 200 }, { time: 300 }],
    } as never;

    pm.notePaintedCandleRange(100, 300, [100, 300]);

    const issues = pm.auditTimeParity();
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('overlay_s1__vwma');
    expect(issues[0]).toContain('200');
  });

  it('is silent when every series sits on the candle axis', () => {
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = {
      setData: () => {},
      data: () => [{ time: 100 }, { time: 300 }],
    } as never;
    price.series['overlay_s1__vwma'] = {
      setData: () => {},
      data: () => [{ time: 100 }, { time: 300 }],
    } as never;

    pm.notePaintedCandleRange(100, 300, [100, 300]);

    expect(pm.auditTimeParity()).toEqual([]);
  });
});

describe('ranging defers expensive chart paints (G2 panFrame)', () => {
  let pm: InstanceType<typeof PaneManager>;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div') as unknown as HTMLElement;
    (container as { id: string }).id = 'chart-root';
    document.body.appendChild(container as never);
    pm = new PaneManager(container);
  });

  afterEach(() => {
    try {
      pm.dispose();
    } catch {
      /* ignore */
    }
    container?.remove();
  });

  it('ranging blocks overlay full setData and keeps tip update', () => {
    const price = pm.createPane('price', 'price', 'Price');
    pm.notePaintedCandleRange(1, 2, [1, 2]);
    pm.syncOverlayLines(
      'price',
      [
        {
          name: 'EMA',
          data: [
            { time: 1, value: 10 },
            { time: 2, value: 12 },
          ],
          color: '#0f0',
        },
      ],
      { ownerId: 's1' },
    );
    const key = Object.keys(price.series).find((k) => k.includes('EMA'));
    expect(key).toBeTruthy();
    const series = price.series[key!] as {
      setData: (d: unknown) => void;
      update: (d: unknown) => void;
    };
    let setDataCount = 0;
    let updateCount = 0;
    const origSet = series.setData.bind(series);
    const origUp = series.update.bind(series);
    series.setData = (d) => {
      setDataCount += 1;
      origSet(d);
    };
    series.update = (d) => {
      updateCount += 1;
      origUp(d);
    };

    const internal = pm as unknown as { ranging: boolean; userRangedAt: number };
    internal.ranging = true;
    setDataCount = 0;
    updateCount = 0;
    // Same length + tip time, new tip value → update only.
    pm.syncOverlayLines(
      'price',
      [
        {
          name: 'EMA',
          data: [
            { time: 1, value: 10 },
            { time: 2, value: 13 },
          ],
          color: '#0f0',
        },
      ],
      { ownerId: 's1' },
    );
    expect(setDataCount).toBe(0);
    expect(updateCount).toBe(1);

    // History rewrite while ranging → no full setData (meta stays stale).
    pm.notePaintedCandleRange(1, 3, [1, 2, 3]);
    setDataCount = 0;
    updateCount = 0;
    pm.syncOverlayLines(
      'price',
      [
        {
          name: 'EMA',
          data: [
            { time: 1, value: 10 },
            { time: 2, value: 12 },
            { time: 3, value: 14 },
          ],
          color: '#0f0',
        },
      ],
      { ownerId: 's1', forceFull: true },
    );
    expect(setDataCount).toBe(0);

    pm.setData('price', key!, [{ time: 1, value: 99 }]);
    expect(setDataCount).toBe(0);

    internal.ranging = false;
    internal.userRangedAt = 0;
    setDataCount = 0;
    pm.syncOverlayLines(
      'price',
      [
        {
          name: 'EMA',
          data: [
            { time: 1, value: 10 },
            { time: 2, value: 12 },
            { time: 3, value: 14 },
          ],
          color: '#0f0',
        },
      ],
      { ownerId: 's1', forceFull: true },
    );
    expect(setDataCount).toBe(1);
  });

  it('ranging defers marker setMarkers until the gesture ends', () => {
    const price = pm.createPane('price', 'price', 'Price');
    price.series['candle'] = {
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
    const internal = pm as unknown as {
      ranging: boolean;
      userRangedAt: number;
      markersApplyDeferred: boolean;
      candleMarkers: { setMarkers: (m: unknown) => void } | null;
      flushDeferredRangingPaint: () => void;
    };
    expect(internal.candleMarkers).toBeTruthy();
    let setMarkerCalls = 0;
    internal.candleMarkers!.setMarkers = () => {
      setMarkerCalls += 1;
    };

    internal.ranging = true;
    pm.setShapeMarkers([
      {
        time: 2000,
        position: 'aboveBar',
        color: '#0f0',
        shape: 'circle',
        text: 'T',
        id: 's2',
      },
    ]);
    expect(setMarkerCalls).toBe(0);
    expect(internal.markersApplyDeferred).toBe(true);

    internal.ranging = false;
    internal.userRangedAt = 0;
    internal.flushDeferredRangingPaint();
    expect(setMarkerCalls).toBe(1);
    expect(internal.markersApplyDeferred).toBe(false);
  });
});
