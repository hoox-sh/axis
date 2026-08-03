/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * boot-errors helpers: format, report throttle, window handlers.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

const {
  formatErrorMessage,
  reportUiError,
  installBootErrorHandlers,
  _resetReportThrottleForTests,
} = await import('../src/ui/boot-errors');
const { store, clearLogs, setStatus } = await import('../src/store');

describe('boot-errors', () => {
  beforeEach(() => {
    _resetReportThrottleForTests();
    clearLogs();
    setStatus('ready', 'ok');
  });

  it('formatErrorMessage from Error / string / null', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
    expect(formatErrorMessage('plain')).toBe('plain');
    expect(formatErrorMessage(null)).toBe('Unknown error');
    expect(formatErrorMessage(undefined)).toBe('Unknown error');
  });

  it('formatErrorMessage truncates long messages', () => {
    const long = 'x'.repeat(300);
    const out = formatErrorMessage(long, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('reportUiError appends log and sets status', () => {
    reportUiError(new Error('series blew up'), {
      source: 'chart',
      context: 'Chart series update failed',
      status: true,
    });
    expect(store.status).toBe('error');
    expect(store.statusMessage).toContain('Chart series update failed');
    expect(store.logs.some((l) => l.level === 'error' && l.source === 'chart')).toBe(
      true,
    );
  });

  it('reportUiError throttles identical messages', () => {
    reportUiError(new Error('same'), {
      source: 'chart',
      context: 'Live bar update failed',
      status: true,
    });
    const n1 = store.logs.filter((l) => l.source === 'chart').length;
    reportUiError(new Error('same'), {
      source: 'chart',
      context: 'Live bar update failed',
      status: true,
    });
    const n2 = store.logs.filter((l) => l.source === 'chart').length;
    expect(n2).toBe(n1);
  });

  it('reportUiError can skip status bar', () => {
    setStatus('ready', 'all good');
    reportUiError(new Error('soft'), {
      source: 'chart',
      context: 'Chart reflow failed',
      status: false,
    });
    expect(store.status).toBe('ready');
    expect(store.logs.some((l) => /reflow/i.test(l.message))).toBe(true);
  });

  it('installBootErrorHandlers surfaces unhandledrejection', () => {
    const listeners = new Map<string, Set<EventListener>>();
    const prev = (globalThis as { window?: unknown }).window;
    (globalThis as { window: Window }).window = {
      ...(typeof prev === 'object' && prev ? prev : {}),
      addEventListener(type: string, fn: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: EventListener) {
        listeners.get(type)?.delete(fn);
      },
    } as Window;

    const dispose = installBootErrorHandlers();
    try {
      const handlers = listeners.get('unhandledrejection');
      expect(handlers?.size).toBe(1);
      for (const fn of handlers || []) {
        fn({ reason: new Error('async boot fail') } as PromiseRejectionEvent);
      }
      expect(store.status).toBe('error');
      expect(store.statusMessage).toContain('Unhandled rejection');
      expect(store.logs.some((l) => l.source === 'boot')).toBe(true);
    } finally {
      dispose();
      if (prev) (globalThis as { window: unknown }).window = prev;
    }
  });

  it('installBootErrorHandlers surfaces window error events', () => {
    const listeners = new Map<string, Set<EventListener>>();
    const prev = (globalThis as { window?: unknown }).window;
    (globalThis as { window: Window }).window = {
      ...(typeof prev === 'object' && prev ? prev : {}),
      addEventListener(type: string, fn: EventListener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: EventListener) {
        listeners.get(type)?.delete(fn);
      },
    } as Window;

    const dispose = installBootErrorHandlers();
    try {
      const handlers = listeners.get('error');
      expect(handlers?.size).toBe(1);
      for (const fn of handlers || []) {
        fn({
          message: 'render explode',
          error: new Error('render explode'),
        } as ErrorEvent);
      }
      expect(store.status).toBe('error');
      expect(store.logs.some((l) => /Uncaught error/i.test(l.message))).toBe(true);
    } finally {
      dispose();
      if (prev) (globalThis as { window: unknown }).window = prev;
    }
  });
});

describe('setDataToChart error isolation', () => {
  beforeEach(() => {
    _resetReportThrottleForTests();
    clearLogs();
    setStatus('ready', 'ok');
  });

  afterEach(async () => {
    const { setManager, setDrawingLayer } = await import('../src/chart/manager-access');
    setManager(undefined);
    setDrawingLayer(undefined);
  });

  it('setDataToChart does not throw when series.setData throws', async () => {
    const { setManager, setDataToChart } = await import('../src/chart/manager-access');
    setManager({
      getPane: (id: string) =>
        id === 'price'
          ? {
              id: 'price',
              series: {
                candle: {
                  setData: () => {
                    throw new Error('LWC setData boom');
                  },
                  applyOptions: () => {},
                },
              },
              chart: {
                timeScale: () => ({ fitContent: () => {} }),
                removeSeries: () => {},
              },
            }
          : undefined,
      clearTradeMarkers: () => {},
      clearShapeMarkers: () => {},
      clearDebugPinMarkers: () => {},
      getPriceChartType: () => 'candles',
      setPriceChartType: () => {},
      detachPriceMarkers: () => {},
      reapplyPriceMarkers: () => {},
    } as never);

    expect(() =>
      setDataToChart([
        { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      ]),
    ).not.toThrow();
    expect(store.status).toBe('error');
    expect(store.statusMessage).toContain('Chart series update failed');
  });
});
