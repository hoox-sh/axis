/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Chart context menu: region hit-testing, item lists, action routing,
 * and drawing-layer duplicate / reorder used by the menu.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildChartMenu,
  classifyChartPointer,
  pointerPrice,
  type PaneHitBox,
} from '../src/chart/context-menu';
import { dispatchChartMenu, scrollChartToLatest, type ChartMenuEnv } from '../src/chart/context-actions';
import { clampMenuPosition } from '../src/ui/context-menu';
import { DrawingLayer } from '../src/chart/drawing-layer';
import type { Drawing } from '../src/chart/drawing-types';

const ROOT = resolve(import.meta.dir, '..');

function box(
  paneId: string,
  paneType: string,
  host: PaneHitBox['host'],
  plot: PaneHitBox['plot'],
): PaneHitBox {
  return { paneId, paneType, host, plot };
}

const pricePlot = {
  left: 0,
  top: 0,
  width: 340,
  height: 260,
  rightScale: 60,
  timeScale: 40,
};

const pricePane = box(
  'price',
  'price',
  { left: 10, top: 20, width: 400, height: 300 },
  pricePlot,
);

describe('classifyChartPointer', () => {
  it('splits plot, right price scale, and time scale', () => {
    expect(classifyChartPointer(100, 80, [pricePane])?.region).toBe('plot');
    expect(classifyChartPointer(380, 80, [pricePane])?.region).toBe('price-scale');
    expect(classifyChartPointer(100, 290, [pricePane])?.region).toBe('time-scale');
    // Bottom-right corner belongs to the price scale column.
    expect(classifyChartPointer(380, 290, [pricePane])?.region).toBe('price-scale');
  });

  it('treats a volume pane as plot when it has no time scale', () => {
    const volume = box(
      'volume',
      'volume',
      { left: 10, top: 320, width: 400, height: 80 },
      { left: 0, top: 0, width: 340, height: 80, rightScale: 60, timeScale: 0 },
    );
    const hit = classifyChartPointer(40, 340, [pricePane, volume]);
    expect(hit).toEqual({ paneId: 'volume', paneType: 'volume', region: 'plot' });
    expect(classifyChartPointer(380, 340, [pricePane, volume])?.region).toBe('price-scale');
  });

  it('returns null outside every pane', () => {
    expect(classifyChartPointer(0, 0, [pricePane])).toBeNull();
    expect(classifyChartPointer(100, 80, [])).toBeNull();
  });

  it('picks the smaller pane when boxes overlap', () => {
    const tight = box(
      'rsi',
      'indicator',
      { left: 10, top: 40, width: 100, height: 40 },
      { left: 0, top: 0, width: 80, height: 40, rightScale: 20, timeScale: 0 },
    );
    expect(classifyChartPointer(30, 50, [pricePane, tight])?.paneId).toBe('rsi');
  });
});

describe('pointerPrice', () => {
  it('converts a plot-relative Y and ignores bad series reads', () => {
    expect(pointerPrice(120, 20, 0, (y) => 1000 - y)).toBe(900);
    expect(pointerPrice(120, 20, 0, () => null)).toBeNull();
    expect(pointerPrice(120, 20, 0, () => Number.NaN)).toBeNull();
    expect(
      pointerPrice(120, 20, 0, () => {
        throw new Error('scale');
      }),
    ).toBeNull();
    expect(pointerPrice(120, 20, 0, undefined)).toBeNull();
  });
});

describe('clampMenuPosition', () => {
  it('flips the menu back inside the viewport', () => {
    expect(clampMenuPosition(900, 700, 200, 160, 1000, 800)).toEqual({ x: 792, y: 632 });
    expect(clampMenuPosition(4, 4, 100, 40, 1000, 800)).toEqual({ x: 8, y: 8 });
  });
});

describe('buildChartMenu', () => {
  const scale = { auto: true, log: false, labels: true, last: true, names: false };

  it('lists view, scale, chart type, and screenshot rows for the plot', () => {
    const ids = buildChartMenu({
      kind: 'plot',
      scale,
      chartType: 'candles',
      priceLabel: '64210.50',
    })
      .filter((e) => e.type === 'item')
      .map((e) => e.id);
    expect(ids).toContain('view.reset');
    expect(ids).toContain('scale.auto');
    expect(ids).toContain('price.copy');
    expect(ids).toContain('price.alert');
    expect(ids).toContain('type.candles');
    expect(ids).toContain('type.heikinashi');
    expect(ids).toContain('shot.save');
    expect(ids).toContain('app.settings');
    const candles = buildChartMenu({ kind: 'plot', scale, chartType: 'candles' }).find(
      (e) => e.type === 'item' && e.id === 'type.candles',
    );
    expect(candles && candles.type === 'item' && candles.checked).toBe(true);
  });

  it('uses scale and label toggles on the price scale', () => {
    const ids = buildChartMenu({ kind: 'price-scale', scale, priceLabel: '1.00' })
      .filter((e) => e.type === 'item')
      .map((e) => e.id);
    expect(ids).toContain('scale.reset');
    expect(ids).toContain('scale.labels');
    expect(ids).toContain('scale.names');
    expect(ids).toContain('price.copy');
    expect(ids).not.toContain('type.candles');
  });

  it('keeps the time scale to reset and scroll', () => {
    const ids = buildChartMenu({ kind: 'time-scale' })
      .filter((e) => e.type === 'item')
      .map((e) => e.id);
    expect(ids).toEqual(['view.reset', 'view.latest', 'app.settings']);
  });

  it('offers hide plus script rows on an indicator pane', () => {
    const ids = buildChartMenu({
      kind: 'pane',
      paneLabel: 'RSI',
      canHidePane: true,
      paneScripts: [{ id: 's1', name: 'RSI', visible: true }],
    })
      .filter((e) => e.type === 'item')
      .map((e) => e.id);
    expect(ids).toContain('script.settings.s1');
    expect(ids).toContain('script.remove.s1');
    expect(ids).toContain('pane.hide');
    const hide = buildChartMenu({
      kind: 'pane',
      paneLabel: 'Volume',
      canHidePane: true,
    }).find((e) => e.type === 'item' && e.id === 'pane.hide');
    expect(hide && hide.type === 'item' && hide.label).toBe('Hide Volume');
  });

  it('disables drawing edits while locked', () => {
    const items = buildChartMenu({
      kind: 'drawing',
      drawing: { label: 'Trend line', locked: true, hidden: false, lockAll: false },
    });
    const del = items.find((e) => e.type === 'item' && e.id === 'drawing.delete');
    const lock = items.find((e) => e.type === 'item' && e.id === 'drawing.lock');
    expect(del && del.type === 'item' && del.disabled).toBe(true);
    expect(lock && lock.type === 'item' && lock.label).toBe('Unlock');
  });
});

describe('dispatchChartMenu', () => {
  function env(partial: Partial<ChartMenuEnv> = {}): ChartMenuEnv & { calls: string[] } {
    const calls: string[] = [];
    const mark =
      (name: string) =>
      (...args: unknown[]) => {
        calls.push(args.length ? `${name}:${args.join(',')}` : name);
      };
    return {
      calls,
      resetView: mark('reset'),
      scrollLatest: mark('latest'),
      toggleAuto: mark('auto'),
      toggleLog: mark('log'),
      resetScale: mark('scale-reset'),
      toggleLabels: mark('labels'),
      toggleLast: mark('last'),
      toggleNames: mark('names'),
      setChartType: (id) => calls.push(`type:${id}`),
      copyPrice: mark('copy'),
      addAlert: mark('alert'),
      saveShot: mark('shot'),
      copyShot: mark('shot-copy'),
      openSettings: mark('settings'),
      hidePane: mark('hide-pane'),
      scriptSettings: (id) => calls.push(`settings:${id}`),
      scriptVisible: (id) => calls.push(`visible:${id}`),
      scriptSource: (id) => calls.push(`source:${id}`),
      scriptRerun: (id) => calls.push(`rerun:${id}`),
      scriptRemove: (id) => calls.push(`remove:${id}`),
      drawingDuplicate: mark('dup'),
      drawingLock: mark('lock'),
      drawingHide: mark('hide'),
      drawingFront: mark('front'),
      drawingBack: mark('back'),
      drawingDelete: mark('delete'),
      ...partial,
    };
  }

  it('routes stable ids and ignores unknown ones', () => {
    const e = env();
    dispatchChartMenu('view.reset', e);
    dispatchChartMenu('type.bars', e);
    dispatchChartMenu('script.remove.abc', e);
    dispatchChartMenu('nope', e);
    expect(e.calls).toEqual(['reset', 'type:bars', 'remove:abc']);
  });
});

describe('scrollChartToLatest', () => {
  it('prefers scrollToRealTime, then scrollToPosition(0)', () => {
    const calls: string[] = [];
    expect(
      scrollChartToLatest({
        timeScale: () => ({
          scrollToRealTime: () => calls.push('realtime'),
          scrollToPosition: () => calls.push('pos'),
        }),
      }),
    ).toBe(true);
    expect(calls).toEqual(['realtime']);
    expect(
      scrollChartToLatest({
        timeScale: () => ({
          scrollToPosition: (n) => calls.push(`pos:${n}`),
        }),
      }),
    ).toBe(true);
    expect(calls).toEqual(['realtime', 'pos:0']);
    expect(scrollChartToLatest(null)).toBe(false);
    expect(scrollChartToLatest({ timeScale: () => ({}) })).toBe(false);
  });
});

function ensureSvgDom() {
  const doc = document as unknown as {
    createElementNS?: (ns: string, name: string) => ReturnType<typeof document.createElement>;
  };
  if (typeof doc.createElementNS !== 'function') {
    doc.createElementNS = (_ns: string, name: string) => document.createElement(name);
  }
  const w = window as unknown as {
    addEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
    removeEventListener?: (t: string, fn: (...a: unknown[]) => void) => void;
  };
  if (typeof w.addEventListener !== 'function') {
    w.addEventListener = () => {};
    w.removeEventListener = () => {};
  }
}

function hline(id: string, price: number): Drawing {
  return { id, kind: 'hline', color: '#fff', price } as Drawing;
}

describe('drawing layer context actions', () => {
  let host: HTMLElement;
  let layer: DrawingLayer;

  beforeEach(() => {
    ensureSvgDom();
    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 800,
        height: 400,
        right: 800,
        bottom: 400,
        toJSON() {
          return {};
        },
      }) as DOMRect;
    document.body.appendChild(host);
    layer = new DrawingLayer(
      host,
      {
        timeScale: () => ({
          timeToCoordinate: (t: number) => t,
          coordinateToTime: (x: number) => x,
          subscribeVisibleLogicalRangeChange: () => {},
          unsubscribeVisibleLogicalRangeChange: () => {},
        }),
      } as never,
      {
        priceToCoordinate: (p: number) => 1000 - p,
        coordinateToPrice: (y: number) => 1000 - y,
      } as never,
    );
    const svg = (layer as unknown as { svg: HTMLElement }).svg;
    svg.getBoundingClientRect = host.getBoundingClientRect.bind(host);
  });

  afterEach(() => {
    try {
      layer?.destroy();
    } catch {
      /* ignore */
    }
    host?.remove();
  });

  it('hit-tests, duplicates, and reorders user drawings', () => {
    layer.setDrawings([hline('a', 900), hline('b', 800), hline('c', 700)]);
    expect(layer.hitTestClient(40, 100)).toBe('a');
    expect(layer.hitTestClient(40, 0)).toBeNull();

    const copyId = layer.duplicateById('b');
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe('b');
    const afterDup = layer.getDrawings();
    expect(afterDup).toHaveLength(4);
    expect(afterDup[afterDup.length - 1]?.id).toBe(copyId);
    expect(layer.getSelectedId()).toBe(copyId);

    expect(layer.reorderDrawing('a', 'front')).toBe(true);
    expect(layer.getDrawings().at(-1)?.id).toBe('a');
    expect(layer.reorderDrawing('a', 'back')).toBe(true);
    expect(layer.getDrawings()[0]?.id).toBe('a');
  });

  it('refuses to duplicate a locked drawing', () => {
    layer.setDrawings([{ ...hline('a', 900), locked: true } as Drawing]);
    expect(layer.duplicateById('a')).toBeNull();
    expect(layer.getDrawings()).toHaveLength(1);
  });
});

describe('context menu wiring', () => {
  const hostSrc = readFileSync(resolve(ROOT, 'src/chart/ChartHost.tsx'), 'utf8');
  const shellSrc = readFileSync(resolve(ROOT, 'src/ui/panels/FloatableShell.tsx'), 'utf8');

  it('mounts the chart menu on every chart cell', () => {
    expect(hostSrc).toContain('<ChartContextMenu host={contextHost()} slotId={slotId()} />');
  });

  it('opens the dock menu from a title-bar right-click', () => {
    expect(shellSrc).toContain('onContextMenu=');
    expect(shellSrc).toContain('setMenuCursor({ x: e.clientX, y: e.clientY })');
    expect(shellSrc).toContain("classList={{ 'is-cursor': !!menuCursor() }}");
  });
});
