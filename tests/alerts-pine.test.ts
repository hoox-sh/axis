/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine `alert()` / `alertcondition()` parse, match, watermark, delivery.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { installMemoryLocalStorage } from './setup';
import {
  _resetAlertsForTests,
  buildAlertFromDraft,
  collectPineAlertEvents,
  createAlert,
  evaluatePineAlertEventsPure,
  evaluatePineAlertsFromRun,
  eventMatchesPineAlert,
  formatAlertCondition,
  formatAlertKind,
  isPineScriptAlert,
  listPineAlertTitles,
  parsePineAlertEvents,
  pineAlertsFromStrategyEvents,
  scriptHasPineAlertCalls,
} from '../src/alerts/index';
import type { Alert } from '../src/alerts/index';

function pineAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: over.id ?? 'p1',
    name: over.name ?? 'Pine',
    enabled: over.enabled ?? true,
    symbol: over.symbol ?? 'BTCUSDT',
    kind: over.kind ?? 'pine_alert',
    params: over.params ?? { source: 'any' },
    createdAt: over.createdAt ?? 1,
    cooldownMs: over.cooldownMs,
    lastFiredAt: over.lastFiredAt,
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  _resetAlertsForTests();
});
afterEach(() => {
  _resetAlertsForTests();
});

describe('parse / collect', () => {
  it('parses PYNE alert() records', () => {
    const ev = parsePineAlertEvents([
      {
        message: 'cross up',
        freq: 'once_per_bar',
        bar_index: 10,
        time: 1_700_000_000,
        source: 'alert',
      },
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.source).toBe('alert');
    expect(ev[0]!.message).toBe('cross up');
    expect(ev[0]!.bar_index).toBe(10);
  });

  it('collects alerts + true conditions + strategy alert_message, deduped', () => {
    const ev = collectPineAlertEvents({
      alerts: [
        {
          message: 'OB',
          title: 'Overbought',
          source: 'alertcondition',
          bar_index: 5,
        },
      ],
      alert_conditions: [
        {
          condition: true,
          title: 'Overbought',
          message: 'OB',
          bar_index: 5,
        },
        { condition: false, title: 'Oversold', message: 'OS', bar_index: 5 },
      ],
      events: [
        { type: 'entry', alert_message: 'buy now', bar_index: 5, id: 'Long' },
      ],
    });
    expect(ev.some((e) => e.source === 'alertcondition' && e.title === 'Overbought')).toBe(
      true,
    );
    expect(ev.filter((e) => e.title === 'Overbought')).toHaveLength(1);
    expect(ev.some((e) => e.message === 'buy now' && e.source === 'alert')).toBe(true);
    expect(ev.some((e) => e.title === 'Oversold')).toBe(false);
  });

  it('lists unique titles', () => {
    const titles = listPineAlertTitles([
      { message: 'a', source: 'alertcondition', title: 'OB', bar_index: 1 },
      { message: 'b', source: 'alertcondition', title: 'OB', bar_index: 2 },
      { message: 'c', source: 'alert', title: 'X', bar_index: 1 },
    ]);
    expect(titles.map((t) => t.title).sort()).toEqual(['OB', 'X']);
  });
});

describe('match + watermark', () => {
  it('pine_alert any source matches alert() and alertcondition()', () => {
    const a = pineAlert({ params: { source: 'any' } });
    expect(isPineScriptAlert(a)).toBe(true);
    expect(
      eventMatchesPineAlert(a, { message: 'x', source: 'alert' }),
    ).toBe(true);
    expect(
      eventMatchesPineAlert(a, { message: 'y', source: 'alertcondition', title: 'T' }),
    ).toBe(true);
  });

  it('filters by source and title and indicatorId', () => {
    const a = pineAlert({
      params: { source: 'alertcondition', title: 'OB', indicatorId: 's1' },
    });
    expect(
      eventMatchesPineAlert(
        a,
        { message: 'OB', source: 'alertcondition', title: 'OB' },
        { indicatorId: 's1' },
      ),
    ).toBe(true);
    expect(
      eventMatchesPineAlert(
        a,
        { message: 'OB', source: 'alert', title: 'OB' },
        { indicatorId: 's1' },
      ),
    ).toBe(false);
    expect(
      eventMatchesPineAlert(
        a,
        { message: 'OB', source: 'alertcondition', title: 'OS' },
        { indicatorId: 's1' },
      ),
    ).toBe(false);
    expect(
      eventMatchesPineAlert(
        a,
        { message: 'OB', source: 'alertcondition', title: 'OB' },
        { indicatorId: 'other' },
      ),
    ).toBe(false);
  });

  it('fires last-bar events once then watermarks', () => {
    const a = pineAlert({ id: 'w1', params: { source: 'alert' } });
    const events = [
      { message: 'old', source: 'alert' as const, bar_index: 8 },
      { message: 'now', source: 'alert' as const, bar_index: 10 },
    ];
    const first = evaluatePineAlertEventsPure([a], events, {
      lastBarIndex: 10,
      now: 1000,
    });
    expect(first).toHaveLength(1);
    expect(first[0]!.event.message).toBe('now');
    expect(first[0]!.alert.params.lastBarIndex).toBe(10);

    const second = evaluatePineAlertEventsPure([first[0]!.alert], events, {
      lastBarIndex: 10,
      now: 2000,
    });
    expect(second).toHaveLength(0);

    const nextBar = evaluatePineAlertEventsPure(
      [first[0]!.alert],
      [...events, { message: 'next', source: 'alert', bar_index: 11 }],
      { lastBarIndex: 11, now: 3000 },
    );
    expect(nextBar).toHaveLength(1);
    expect(nextBar[0]!.event.message).toBe('next');
  });

  it('does not fire historical bars before lastBarIndex', () => {
    const a = pineAlert();
    const fired = evaluatePineAlertEventsPure(
      [a],
      [
        { message: 'old', source: 'alert', bar_index: 1 },
        { message: 'mid', source: 'alert', bar_index: 5 },
      ],
      { lastBarIndex: 9, now: 1 },
    );
    expect(fired).toHaveLength(0);
  });
});

describe('form + format', () => {
  it('builds a pine_alert draft', () => {
    const r = buildAlertFromDraft({
      name: '',
      symbol: 'ETHUSDT',
      kind: 'pine_alert',
      chartSymbol: 'ETHUSDT',
      price: '',
      pct: '',
      pctDirection: 'both',
      drawingId: '',
      drawingPrices: [],
      tolerance: '',
      indicatorId: 'strat1',
      indicatorName: 'My strat',
      plotKey: '',
      op: '>',
      threshold: '',
      pineSource: 'alert',
      pineTitle: '',
      protocolId: '',
      minAbsPct: '',
      direction: 'both',
      webhookUrl: '',
      l2WebhookUrl: '',
      notifyBrowser: true,
      cooldownSec: '',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.kind).toBe('pine_alert');
    expect(r.input.params?.source).toBe('alert');
    expect(r.input.params?.indicatorId).toBe('strat1');
    expect(r.input.name).toContain('alert()');
  });

  it('labels pine_alert kinds', () => {
    expect(formatAlertKind('pine_alert')).toBe('pine alert');
    expect(
      formatAlertCondition({
        kind: 'pine_alert',
        params: { source: 'alertcondition', title: 'OB' },
      }),
    ).toContain('OB');
    expect(
      formatAlertCondition({ kind: 'pine_alert', params: { source: 'alert' } }),
    ).toBe('alert()');
  });
});

describe('bridge delivery', () => {
  it('POSTs webhook with Pine message on last-bar fire', async () => {
    const posts: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    createAlert({
      id: 'pa',
      name: 'Strat alert',
      symbol: 'BTCUSDT',
      kind: 'pine_alert',
      params: { source: 'alert' },
      webhookUrl: 'https://hooks.example/pine',
      notifyBrowser: false,
    });

    const fired = await evaluatePineAlertsFromRun(
      {
        alerts: [
          { message: 'RSI cross', source: 'alert', bar_index: 42, freq: 'once_per_bar' },
        ],
      },
      {
        lastBarIndex: 42,
        now: 9_000,
        price: 101,
        deliver: true,
        fetchImpl,
      },
    );
    expect(fired).toHaveLength(1);
    expect(posts).toHaveLength(1);
    const payload = JSON.parse(posts[0]!.body);
    expect(payload.message).toBe('RSI cross');
    expect(payload.kind).toBe('pine_alert');
  });
});

describe('scriptHasPineAlertCalls', () => {
  it('detects alert() and alertcondition()', () => {
    expect(scriptHasPineAlertCalls('plot(close)')).toBe(false);
    expect(scriptHasPineAlertCalls('alert("x")')).toBe(true);
    expect(scriptHasPineAlertCalls('alertcondition(ta.crossover(a,b), "t", "m")')).toBe(
      true,
    );
  });
});

describe('compile-path alert recording (pynescript_runtime)', () => {
  it('records alert() and alertcondition() from compiled object mode', () => {
    const proc = Bun.spawnSync(['python3', 'tests/pynescript-compile-alerts.py'], {
      cwd: import.meta.dir + '/..',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const err = new TextDecoder().decode(proc.stderr);
    const out = new TextDecoder().decode(proc.stdout);
    if (proc.exitCode !== 0) {
      throw new Error(`compile-alerts runtime failed:\n${err || out}`);
    }
    expect(out).toMatch(/^OK /);
  });
});

describe('strategy alert_message', () => {
  it('maps entry events with alert_message', () => {
    const ev = pineAlertsFromStrategyEvents([
      { type: 'entry', id: 'Long', alert_message: 'go long', bar_index: 3 },
      { type: 'entry', id: 'Short' },
    ]);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.message).toBe('go long');
    expect(ev[0]!.title).toBe('Long');
  });
});
