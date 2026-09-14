/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Alerts panel form validation + drawing/indicator helpers + L2 payload.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { installMemoryLocalStorage } from './setup';
import {
  ALERT_KIND_GROUPS,
  alertKindGroup,
  buildAlertFromDraft,
  buildL2WebhookPayload,
  createAlert,
  drawingAlertLabel,
  drawingPricesById,
  lastNumericSample,
  listPlotKeys,
  plotSamplesFromCache,
  prevNumericSample,
  pricesFromDrawing,
  subscribeAlerts,
  _resetAlertsForTests,
  type AlertFormDraft,
} from '../src/alerts/index';

function draft(over: Partial<AlertFormDraft> = {}): AlertFormDraft {
  return {
    name: '',
    symbol: 'BTCUSDT',
    kind: 'price_cross',
    chartSymbol: 'BTCUSDT',
    price: '100',
    pct: '',
    pctDirection: 'both',
    drawingId: '',
    drawingPrices: [],
    tolerance: '',
    indicatorId: '',
    indicatorName: '',
    plotKey: '',
    op: '>',
    threshold: '',
    protocolId: '',
    minAbsPct: '10',
    direction: 'both',
    webhookUrl: '',
    l2WebhookUrl: '',
    notifyBrowser: true,
    cooldownSec: '',
    ...over,
  };
}

describe('kind groups', () => {
  it('covers every create-form kind', () => {
    const ids = ALERT_KIND_GROUPS.flatMap((g) => [...g.kinds]);
    expect(ids).toContain('drawing_touch');
    expect(ids).toContain('pine_condition');
    expect(ids).toContain('pct_change');
    expect(alertKindGroup('drawing_touch')).toBe('drawing');
    expect(alertKindGroup('pine_condition')).toBe('indicator');
    expect(alertKindGroup('price_cross')).toBe('price');
  });
});

describe('buildAlertFromDraft', () => {
  it('builds a price_cross alert', () => {
    const r = buildAlertFromDraft(draft({ price: '42000', name: 'ATH' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.kind).toBe('price_cross');
    expect(r.input.params?.price).toBe(42000);
    expect(r.input.name).toBe('ATH');
    expect(r.input.notifyBrowser).toBe(true);
  });

  it('rejects invalid price', () => {
    const r = buildAlertFromDraft(draft({ price: '0' }));
    expect(r.ok).toBe(false);
  });

  it('builds pct_change and drawing_touch', () => {
    const pct = buildAlertFromDraft(
      draft({ kind: 'pct_change', pct: '2.5', pctDirection: 'up' }),
    );
    expect(pct.ok).toBe(true);
    if (pct.ok) {
      expect(pct.input.kind).toBe('pct_change');
      expect(pct.input.params?.pct).toBe(2.5);
      expect(pct.input.params?.direction).toBe('up');
    }

    const draw = buildAlertFromDraft(
      draft({
        kind: 'drawing_touch',
        drawingId: 'h1',
        drawingPrices: [100, 200],
        tolerance: '0.5',
      }),
    );
    expect(draw.ok).toBe(true);
    if (draw.ok) {
      expect(draw.input.kind).toBe('drawing_touch');
      expect(draw.input.params?.drawingId).toBe('h1');
      expect(draw.input.params?.prices).toEqual([100, 200]);
      expect(draw.input.params?.tolerance).toBe(0.5);
    }
  });

  it('builds pine_condition from indicator + plot', () => {
    const r = buildAlertFromDraft(
      draft({
        kind: 'pine_condition',
        indicatorId: 'ind1',
        indicatorName: 'RSI',
        plotKey: 'plot_0',
        op: '>',
        threshold: '70',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.kind).toBe('pine_condition');
    expect(r.input.params).toEqual({
      indicatorId: 'ind1',
      plotKey: 'plot_0',
      op: '>',
      threshold: 70,
    });
    expect(r.input.name).toContain('RSI');
  });

  it('rejects private webhook URLs', () => {
    const r = buildAlertFromDraft(
      draft({ webhookUrl: 'http://127.0.0.1/hook' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/https/i);
  });

  it('accepts https webhook + L2', () => {
    const r = buildAlertFromDraft(
      draft({
        webhookUrl: 'https://hooks.example/a',
        l2WebhookUrl: 'https://l2.example/alerts',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.webhookUrl).toContain('hooks.example');
    expect(r.input.l2WebhookUrl).toContain('l2.example');
  });
});

describe('drawing levels', () => {
  it('extracts hline and fib retracements', () => {
    expect(pricesFromDrawing({ kind: 'hline', price: 100 })).toEqual([100]);
    expect(pricesFromDrawing({ kind: 'vline', time: 1 } as { kind: string })).toEqual(
      [],
    );
    const fib = pricesFromDrawing({
      kind: 'fib',
      p1: { price: 0 },
      p2: { price: 100 },
    });
    expect(fib).toContain(0);
    expect(fib).toContain(50);
    expect(fib).toContain(100);
    expect(fib).toContain(61.8);
  });

  it('maps ids and labels', () => {
    const map = drawingPricesById([
      { id: 'a', kind: 'hline', price: 10 },
      { id: 'b', kind: 'vline' },
    ]);
    expect(map.a).toEqual([10]);
    expect(map.b).toBeUndefined();
    expect(drawingAlertLabel({ kind: 'hline', price: 10 })).toMatch(/hline/);
  });
});

describe('indicator samples', () => {
  it('reads last / prev numeric samples and skips na', () => {
    const series = [1, 'na', 3, null, 5];
    expect(lastNumericSample(series)).toBe(5);
    expect(prevNumericSample(series)).toBe(3);
    expect(lastNumericSample([])).toBeNull();
  });

  it('builds plotSamplesFromCache keys', () => {
    const samples = plotSamplesFromCache({
      ind1: { name: 'RSI', series: { RSI: [10, 20, 30] }, titles: { RSI: 'RSI' } },
    });
    expect(samples['ind1:RSI']).toEqual({ value: 30, prevValue: 20 });
    expect(listPlotKeys('ind1', { ind1: { series: { RSI: [1] } } }, { extra: {} })).toEqual(
      [
        { key: 'RSI', title: 'RSI' },
        { key: 'extra', title: 'extra' },
      ],
    );
  });
});

describe('L2 payload', () => {
  it('marks channel l2 and includes a message', () => {
    const body = buildL2WebhookPayload(
      {
        id: 'a1',
        name: 'Cross',
        symbol: 'BTCUSDT',
        kind: 'price_cross',
        params: { price: 100 },
        enabled: true,
        createdAt: 1,
        interval: '1h',
      },
      101,
      50,
    );
    expect(body.channel).toBe('l2');
    expect(body.source).toBe('axis');
    expect(body.message).toContain('BTCUSDT');
    expect(body.interval).toBe('1h');
    expect(body.params).toEqual({ price: 100 });
  });
});

describe('subscribeAlerts', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    _resetAlertsForTests();
  });
  afterEach(() => {
    _resetAlertsForTests();
  });

  it('notifies on create', () => {
    let n = 0;
    const stop = subscribeAlerts(() => {
      n += 1;
    });
    createAlert({
      name: 'x',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 1 },
    });
    expect(n).toBeGreaterThan(0);
    stop();
  });
});
