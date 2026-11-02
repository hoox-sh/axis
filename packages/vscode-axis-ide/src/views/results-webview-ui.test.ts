// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION, decodeHostMessage } from '../../webview/results/src/protocol';
import {
  escapeHtml,
  kpiCardsInnerHtml,
  metaChipsInnerHtml,
  paintResults,
  queryResultsDom,
  resultsCardHtml,
  rowsInnerHtml,
  type ResultsDom,
} from '../../webview/results/src/render';
import {
  EMPTY_RUN_HINT,
  EMPTY_RUN_TITLE,
  ERROR_RUN_HINT,
  NO_RUN_FOCUSED,
  NO_STRATEGY_HINT,
  NO_STRATEGY_REPORT,
  buildMetaChips,
  buildResultsView,
  countList,
  countPlots,
  countSeries,
  filterRows,
  formatAbsoluteTime,
  formatNumber,
  formatRelativeTime,
  pickStrategyRows,
  runSummaryRows,
  splitStrategyKpis,
  statusOf,
  strategyBag,
} from '../../webview/results/src/state';

describe('results webview protocol', () => {
  test('decodeHostMessage accepts results.set', () => {
    const decoded = decodeHostMessage({
      v: PROTOCOL_VERSION,
      type: 'results.set',
      payload: { lastRun: { id: 'run-1' }, strategyReport: null, focusId: 'run-1' },
      ts: 1,
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.type).toBe('results.set');
    expect((decoded.payload.lastRun as { id?: string }).id).toBe('run-1');
  });

  test('decodeHostMessage accepts host.error and host.run.status; rejects junk', () => {
    expect(
      decodeHostMessage({
        v: PROTOCOL_VERSION,
        type: 'host.error',
        payload: { message: 'x' },
        ts: 1,
      }).ok,
    ).toBe(true);
    expect(
      decodeHostMessage({
        v: PROTOCOL_VERSION,
        type: 'host.run.status',
        payload: { epoch: 1, state: 'ok' },
        ts: 1,
      }).ok,
    ).toBe(true);
    expect(decodeHostMessage(null).ok).toBe(false);
    expect(decodeHostMessage('results.set').ok).toBe(false);
    expect(
      decodeHostMessage({ v: 2, type: 'results.set', payload: {}, ts: 1 }).ok,
    ).toBe(false);
    expect(
      decodeHostMessage({ v: 1, type: 'results.ready', payload: {}, ts: 1 }).ok,
    ).toBe(false);
    expect(() => decodeHostMessage(undefined)).not.toThrow();
  });
});

describe('results view-model', () => {
  test('idle empty state uses Ctrl/Cmd+Enter hint', () => {
    const view = buildResultsView('results', {
      lastRun: null,
      strategyReport: null,
      focusId: null,
    });
    expect(view.empty).toBe(true);
    expect(view.status).toBe('idle');
    expect(view.statusLabel).toBe('Idle');
    expect(view.title).toBe('Results');
    expect(view.focusLine).toBe(NO_RUN_FOCUSED);
    expect(view.emptyTitle).toBe(EMPTY_RUN_TITLE);
    expect(view.emptyMessage).toBe(EMPTY_RUN_HINT);
    expect(view.emptyMessage).toContain('Ctrl/Cmd+Enter');
    expect(view.rows).toEqual([]);
    expect(view.kpiRows).toEqual([]);
    expect(view.metaChips).toEqual([]);
    expect(view.showStrategy).toBe(false);
    expect(view.runId).toBeNull();
  });

  test('success run lists id, script, engine, seriesKey, ms, plot count + meta chips', () => {
    const now = 1_700_000_060_000;
    const view = buildResultsView(
      'results',
      {
        focusId: 'run-3',
        lastRun: {
          id: 'run-3',
          status: 'success',
          engineId: 'server',
          seriesKey: 'BINANCE:BTCUSDT:1h',
          plots: { sma: [1, 2], close: [3] },
          series: { a: 1, b: 2 },
          logs: ['l1', 'l2', 'l3'],
          diagnostics: [{ message: 'd' }],
          createdAt: 1_700_000_000_000,
          meta: { script_name: 'My SMA', ms: 12.8 },
        },
        strategyReport: null,
      },
      now,
    );
    expect(view.empty).toBe(false);
    expect(view.status).toBe('success');
    expect(view.focusLine).toBe('Focus: run-3');
    expect(view.runId).toBe('run-3');
    expect(view.relativeTime).toBe('1m ago');
    expect(view.absoluteTime.length).toBeGreaterThan(0);
    const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r.value]));
    expect(byKey.id).toBe('run-3');
    expect(byKey.script).toBe('My SMA');
    expect(byKey.engine).toBe('server');
    expect(byKey.seriesKey).toBe('BINANCE:BTCUSDT:1h');
    expect(byKey.ms).toBe('13 ms');
    expect(byKey.plots).toBe('2');
    expect(byKey.error).toBeUndefined();
    expect(view.showStrategy).toBe(false);
    const chips = Object.fromEntries(view.metaChips.map((c) => [c.key, c.value]));
    expect(chips.ms).toBe('13');
    expect(chips.plots).toBe('2');
    expect(chips.series).toBe('2');
    expect(chips.logs).toBe('3');
    expect(chips.diags).toBe('1');
  });

  test('error run adds error row, error badge, and actionable hint', () => {
    const view = buildResultsView('results', {
      focusId: 'run-e',
      lastRun: {
        id: 'run-e',
        status: 'error',
        engineId: 'server',
        seriesKey: 'k',
        error: 'compile failed <boom>',
        plots: [],
        meta: { script_name: 'Bad', ms: 4 },
      },
      strategyReport: null,
    });
    expect(view.status).toBe('error');
    expect(view.statusLabel).toBe('Error');
    expect(view.emptyMessage).toBe(ERROR_RUN_HINT);
    const err = view.rows.find((r) => r.key === 'error');
    expect(err?.value).toBe('compile failed <boom>');
  });

  test('results panel compact strategy snippet uses known keys only', () => {
    const view = buildResultsView('results', {
      focusId: 'run-1',
      lastRun: {
        id: 'run-1',
        status: 'success',
        engineId: 'server',
        seriesKey: 'k',
        plots: [1, 2, 3],
        meta: { script_name: 'Strat', ms: 9 },
      },
      strategyReport: {
        stats: { totalPnl: 12.5, winRate: 66.6, trades: 9 },
        trades: [{ id: 1 }, { id: 2 }],
        extraDump: { nested: true, huge: [1, 2, 3] },
      },
    });
    expect(view.showStrategy).toBe(true);
    const keys = view.strategyRows.map((r) => r.key);
    expect(keys).toContain('netprofit');
    expect(keys).toContain('winrate');
    expect(keys).toContain('trades');
    expect(keys).not.toContain('extraDump');
    expect(view.strategyRows.find((r) => r.key === 'trades')?.value).toBe('9');
    expect(view.rows.find((r) => r.key === 'plots')?.value).toBe('3');
  });

  test('strategy panel lists KPI cards + denser remainder when report present', () => {
    const view = buildResultsView('strategy', {
      focusId: 'run-s',
      lastRun: {
        id: 'run-s',
        status: 'success',
        engineId: 'pyodide',
        seriesKey: 'k',
        meta: { script_name: 'S', ms: 1 },
      },
      strategyReport: {
        netprofit: 10,
        winrate: 0.5,
        trades: 4,
        profitFactor: 1.8,
        maxDD: 0.12,
        avgWin: 2.5,
        avgLoss: -1.1,
      },
    });
    expect(view.title).toBe('Strategy');
    expect(view.empty).toBe(false);
    expect(view.showStrategy).toBe(false);
    expect(view.strategyNote).toBeNull();
    const kpiKeys = view.kpiRows.map((r) => r.key);
    expect(kpiKeys).toEqual(['netprofit', 'winrate', 'trades', 'profitfactor', 'maxdd']);
    expect(view.kpiRows.find((r) => r.key === 'winrate')?.value).toBe('50%');
    const byKey = Object.fromEntries(view.rows.map((r) => [r.key, r.value]));
    expect(byKey.netprofit).toBeUndefined();
    expect(byKey.avgwin).toBe('2.5');
    expect(byKey.avgloss).toBe('-1.1');
    expect(byKey.id).toBeUndefined();
  });

  test('strategy panel without report reuses results summary + actionable note', () => {
    const view = buildResultsView('strategy', {
      focusId: 'run-2',
      lastRun: {
        id: 'run-2',
        status: 'success',
        engineId: 'server',
        seriesKey: 'ETHUSDT',
        plots: { a: 1 },
        meta: { script_name: 'Ind', ms: 3 },
      },
      strategyReport: null,
    });
    expect(view.title).toBe('Strategy');
    expect(view.showStrategy).toBe(true);
    expect(view.strategyNote).toContain(NO_STRATEGY_REPORT);
    expect(view.strategyNote).toContain(NO_STRATEGY_HINT);
    expect(view.rows.find((r) => r.key === 'id')?.value).toBe('run-2');
    expect(view.rows.find((r) => r.key === 'script')?.value).toBe('Ind');
    expect(view.strategyRows).toEqual([]);
    expect(view.kpiRows).toEqual([]);
  });

  test('non-object / hostile payloads never throw and stay idle', () => {
    expect(buildResultsView('results', null).status).toBe('idle');
    expect(buildResultsView('results', []).empty).toBe(true);
    expect(buildResultsView('strategy', 'nope').title).toBe('Strategy');
    const getter = {
      get lastRun(): Record<string, unknown> {
        throw new Error('boom');
      },
      focusId: 'x',
      strategyReport: null,
    };
    expect(() => buildResultsView('results', getter)).not.toThrow();
    expect(buildResultsView('results', getter).status).toBe('idle');
  });

  test('statusOf treats error string as error; missing lastRun is idle', () => {
    expect(statusOf(null)).toBe('idle');
    expect(statusOf({ status: 'success' })).toBe('success');
    expect(statusOf({ status: 'error' })).toBe('error');
    expect(statusOf({ error: 'x' })).toBe('error');
    expect(statusOf({ status: 'running' })).toBe('idle');
  });

  test('countPlots / countSeries / countList / formatNumber / strategyBag helpers', () => {
    expect(countPlots(null)).toBe(0);
    expect(countPlots([1, 2])).toBe(2);
    expect(countPlots({ a: 1, b: 2, c: 3 })).toBe(3);
    expect(countPlots('nope')).toBe(0);
    expect(countSeries(null)).toBe(0);
    expect(countSeries({ x: 1 })).toBe(1);
    expect(countSeries([1, 2, 3])).toBe(3);
    expect(countSeries('x')).toBe(0);
    expect(countList(['a'])).toBe(1);
    expect(countList(null)).toBe(0);
    expect(countList({ a: 1 })).toBe(0);
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(12.5)).toBe('12.5');
    expect(formatNumber(0.01234)).toContain('0.012');
    expect(strategyBag(null)).toBeNull();
    expect(strategyBag({ stats: { trades: 2 }, winRate: 1 })).toEqual({
      stats: { trades: 2 },
      winRate: 1,
      trades: 2,
    });
  });

  test('relative / absolute time helpers', () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(0, now)).toBe('');
    expect(formatRelativeTime(now - 2_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 12_000, now)).toBe('12s ago');
    expect(formatRelativeTime(now - 120_000, now)).toBe('2m ago');
    expect(formatRelativeTime(now - 7_200_000, now)).toBe('2h ago');
    expect(formatRelativeTime(now - 172_800_000, now)).toBe('2d ago');
    expect(formatAbsoluteTime(0)).toBe('');
    expect(formatAbsoluteTime(now).length).toBeGreaterThan(0);
  });

  test('pickStrategyRows / splitStrategyKpis / filterRows / buildMetaChips', () => {
    expect(pickStrategyRows(null)).toEqual([]);
    expect(pickStrategyRows('x')).toEqual([]);
    const rows = pickStrategyRows({
      trades: [{}, {}],
      foo: 1,
      avgWin: 3.25,
      netProfit: 9,
    });
    expect(rows.find((r) => r.key === 'trades')?.value).toBe('2');
    expect(rows.find((r) => r.key === 'avgwin')?.value).toBe('3.25');
    expect(rows.some((r) => r.key === 'foo')).toBe(false);
    const split = splitStrategyKpis(rows);
    expect(split.kpis.map((r) => r.key)).toContain('netprofit');
    expect(split.kpis.map((r) => r.key)).toContain('trades');
    expect(split.rest.map((r) => r.key)).toContain('avgwin');
    expect(filterRows(rows, 'AVG')).toHaveLength(1);
    expect(filterRows(rows, '')).toHaveLength(rows.length);
    expect(buildMetaChips({ plots: [1], logs: ['a'], diagnostics: [] }).map((c) => c.key)).toEqual([
      'plots',
      'series',
      'logs',
      'diags',
    ]);
  });

  test('runSummaryRows fills dashes for missing fields', () => {
    const rows = runSummaryRows({ id: 'r' });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.id).toBe('r');
    expect(byKey.script).toBe('—');
    expect(byKey.engine).toBe('—');
    expect(byKey.seriesKey).toBe('—');
    expect(byKey.ms).toBe('—');
    expect(byKey.plots).toBe('0');
  });
});

describe('results render', () => {
  test('rows escape HTML and mark error', () => {
    const html = rowsInnerHtml([
      { key: 'error', label: 'Error', value: '<script>alert(1)</script>' },
      { key: 'id', label: 'Run id', value: 'run-"1"' },
    ]);
    expect(html).toContain('data-row="error"');
    expect(html).toContain('is-error');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('run-&quot;1&quot;');
    expect(escapeHtml('<x>')).toBe('&lt;x&gt;');
  });

  test('meta chips and KPI cards escape values', () => {
    expect(metaChipsInnerHtml([{ key: 'ms', label: 'ms', value: '12' }])).toContain('data-chip="ms"');
    expect(
      kpiCardsInnerHtml([{ key: 'netprofit', label: 'Net <b>', value: '1<script>' }]),
    ).toContain('Net &lt;b&gt;');
    expect(
      kpiCardsInnerHtml([{ key: 'netprofit', label: 'Net <b>', value: '1<script>' }]),
    ).toContain('1&lt;script&gt;');
  });

  test('resultsCardHtml includes strategy snippet when shown', () => {
    const view = buildResultsView('results', {
      focusId: 'run-1',
      lastRun: {
        id: 'run-1',
        status: 'success',
        engineId: 'server',
        seriesKey: 'k',
        meta: { script_name: 'S', ms: 1 },
      },
      strategyReport: { trades: 3, winRate: 40 },
    });
    const html = resultsCardHtml(view);
    expect(html).toContain('id="results-rows"');
    expect(html).toContain('id="results-strategy"');
    expect(html).toContain('Win rate');
    expect(html).toContain('40%');
    expect(html).not.toContain('"trades":');
  });

  test('strategy empty note is in the snippet, not JSON', () => {
    const view = buildResultsView('strategy', {
      focusId: 'run-1',
      lastRun: { id: 'run-1', status: 'success', engineId: 'server', seriesKey: 'k' },
      strategyReport: null,
    });
    const html = resultsCardHtml(view);
    expect(html).toContain(NO_STRATEGY_REPORT);
    expect(html).toContain('Run id');
    expect(html).not.toContain('lastRun');
  });

  test('strategy card html includes KPI block when present', () => {
    const view = buildResultsView('strategy', {
      focusId: 'run-1',
      lastRun: { id: 'run-1', status: 'success', engineId: 'server', seriesKey: 'k' },
      strategyReport: { netProfit: 5, trades: 2, avgWin: 1 },
    });
    const html = resultsCardHtml(view);
    expect(html).toContain('id="results-kpis"');
    expect(html).toContain('data-kpi="netprofit"');
    expect(html).toContain('Avg win');
  });
});

describe('paintResults DOM hooks', () => {
  test('updates status badge, empty, rows, meta, time, and aria-live node', () => {
    const els: Record<string, FakeEl> = {
      title: fakeEl('Results'),
      status: fakeEl('Idle', { 'data-status': 'idle', class: 'results-status results-status--idle' }),
      focus: fakeEl(NO_RUN_FOCUSED),
      time: fakeEl('', { hidden: true }),
      meta: fakeEl('', { hidden: true }),
      copyId: fakeEl('Copy id', { hidden: true }),
      focusProfiler: fakeEl('Profiler', { hidden: true }),
      focusLogs: fakeEl('Logs', { hidden: true }),
      searchWrap: fakeEl('', { hidden: true }),
      card: fakeEl('', { hidden: true }),
      kpis: fakeEl('', { hidden: true }),
      rows: fakeEl(''),
      strategy: fakeEl('', { hidden: true }),
      strategyTitle: fakeEl('Strategy'),
      strategyEmpty: fakeEl(NO_STRATEGY_REPORT, { hidden: true }),
      strategyRows: fakeEl(''),
      empty: fakeEl('', { hidden: false }),
      emptyTitle: fakeEl(EMPTY_RUN_TITLE),
      emptyHint: fakeEl(EMPTY_RUN_HINT),
      live: fakeEl(''),
    };
    const dom: ResultsDom = {
      title: els.title as unknown as HTMLElement,
      status: els.status as unknown as HTMLElement,
      focus: els.focus as unknown as HTMLElement,
      time: els.time as unknown as HTMLElement,
      meta: els.meta as unknown as HTMLElement,
      copyId: els.copyId as unknown as HTMLElement,
      focusProfiler: els.focusProfiler as unknown as HTMLElement,
      focusLogs: els.focusLogs as unknown as HTMLElement,
      searchWrap: els.searchWrap as unknown as HTMLElement,
      search: null,
      card: els.card as unknown as HTMLElement,
      kpis: els.kpis as unknown as HTMLElement,
      rows: els.rows as unknown as HTMLElement,
      strategy: els.strategy as unknown as HTMLElement,
      strategyTitle: els.strategyTitle as unknown as HTMLElement,
      strategyEmpty: els.strategyEmpty as unknown as HTMLElement,
      strategyRows: els.strategyRows as unknown as HTMLElement,
      empty: els.empty as unknown as HTMLElement,
      emptyTitle: els.emptyTitle as unknown as HTMLElement,
      emptyHint: els.emptyHint as unknown as HTMLElement,
      live: els.live as unknown as HTMLElement,
    };

    const success = buildResultsView('results', {
      focusId: 'run-9',
      lastRun: {
        id: 'run-9',
        status: 'success',
        engineId: 'server',
        seriesKey: 'k',
        plots: [1],
        logs: ['a'],
        createdAt: Date.now() - 10_000,
        meta: { script_name: 'A', ms: 5 },
      },
      strategyReport: { netProfit: 2, trades: 1 },
    });
    paintResults(dom, success);
    expect(els.status.textContent).toBe('Success');
    expect(els.status.getAttribute('data-status')).toBe('success');
    expect(els.status.getAttribute('aria-label')).toBe('Status: Success');
    expect(els.status.className).toContain('results-status--success');
    expect(els.focus.textContent).toBe('Focus: run-9');
    expect(els.empty.hidden).toBe(true);
    expect(els.card.hidden).toBe(false);
    expect(els.rows.innerHTML).toContain('run-9');
    expect(els.strategy.hidden).toBe(false);
    expect(els.strategyRows.innerHTML).toContain('Net profit');
    expect(els.meta.hidden).toBe(false);
    expect(els.meta.innerHTML).toContain('data-chip="ms"');
    expect(els.copyId.hidden).toBe(false);
    expect(els.copyId.getAttribute('data-run-id')).toBe('run-9');
    expect(els.focusProfiler.hidden).toBe(false);
    expect(els.focusLogs.hidden).toBe(false);
    expect(els.searchWrap.hidden).toBe(false);
    expect(els.time.hidden).toBe(false);
    expect(els.live.textContent).toContain('Success');

    const idle = buildResultsView('results', { lastRun: null, strategyReport: null, focusId: null });
    paintResults(dom, idle);
    expect(els.status.textContent).toBe('Idle');
    expect(els.status.getAttribute('data-status')).toBe('idle');
    expect(els.empty.hidden).toBe(false);
    expect(els.card.hidden).toBe(true);
    expect(els.emptyHint.textContent).toBe(EMPTY_RUN_HINT);
    expect(els.copyId.hidden).toBe(true);
    expect(els.meta.hidden).toBe(true);

    const err = buildResultsView('strategy', {
      focusId: 'run-e',
      lastRun: { id: 'run-e', status: 'error', engineId: 'server', seriesKey: 'k', error: 'nope' },
      strategyReport: null,
    });
    paintResults(dom, err);
    expect(els.title.textContent).toBe('Strategy');
    expect(els.status.textContent).toBe('Error');
    expect(els.strategy.hidden).toBe(false);
    expect(els.strategyEmpty.hidden).toBe(false);
    expect(els.strategyEmpty.textContent).toContain(NO_STRATEGY_REPORT);
    expect(els.rows.innerHTML).toContain('nope');
  });

  test('queryResultsDom reads hook ids from a fake root', () => {
    const status = fakeEl('Idle', { id: 'results-status' });
    const root = {
      querySelector(sel: string) {
        if (sel === '#results-status') return status as unknown as HTMLElement;
        return null;
      },
    };
    const dom = queryResultsDom(root as unknown as ParentNode);
    expect(dom.status).toBe(status as unknown as HTMLElement);
    expect(dom.card).toBeNull();
    expect(dom.search).toBeNull();
  });
});

class FakeEl {
  textContent = '';
  innerHTML = '';
  className = '';
  hidden = false;
  private attrs = new Map<string, string>();
  constructor(text = '', init: Record<string, string | boolean> = {}) {
    this.textContent = text;
    if (typeof init.hidden === 'boolean') this.hidden = init.hidden;
    if (typeof init.class === 'string') this.className = init.class;
    for (const [k, v] of Object.entries(init)) {
      if (k === 'hidden' || k === 'class') continue;
      this.attrs.set(k, String(v));
    }
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

function fakeEl(text = '', init: Record<string, string | boolean> = {}): FakeEl {
  return new FakeEl(text, init);
}
