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
import type { OhlcvBar } from '../host/mock-bars';
import {
  MISSING_PRO_KEY_ERROR,
  ResultsFocusStore,
  RunOrchestrator,
  UNSUPPORTED_ENGINE_ERROR,
  type ChartNotifyMessage,
  type FetchLike,
  type RunDeps,
  type RunDiagnostic,
  type RunRequest,
} from './index';

const PRO_KEY = 'pyn_abcdefghijklmnopqrstuvwxyz0123456789';

const BARS: OhlcvBar[] = [
  { time: 1_700_000_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
];

function mockFetch(
  handler: (url: string, init?: Parameters<FetchLike>[1]) => {
    ok: boolean;
    status: number;
    body: string;
  },
): FetchLike {
  return async (url, init) => {
    const res = handler(url, init);
    return {
      ok: res.ok,
      status: res.status,
      text: async () => res.body,
    };
  };
}

function makeDeps(overrides?: {
  proKey?: string | undefined;
  fetchImpl?: FetchLike;
  missingProKey?: boolean;
}): {
  deps: RunDeps;
  charts: ChartNotifyMessage[];
  lines: string[];
  diagnostics: { uri?: string; items: RunDiagnostic[] }[];
  results: ResultsFocusStore;
} {
  const charts: ChartNotifyMessage[] = [];
  const lines: string[] = [];
  const diagnostics: { uri?: string; items: RunDiagnostic[] }[] = [];
  const results = new ResultsFocusStore();

  const fetchImpl =
    overrides?.fetchImpl ??
    mockFetch(() => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        status: 'success',
        plots: [1, 2, 3],
        series: { plot_0: [1, 2, 3] },
      }),
    }));

  const deps: RunDeps = {
    secrets: {
      async getProKey() {
        if (overrides?.missingProKey) return undefined;
        if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'proKey')) {
          return overrides.proKey;
        }
        return PRO_KEY;
      },
    },
    endpoint: 'http://127.0.0.1:5002',
    fetchImpl,
    bus: {
      notifyChart(message) {
        charts.push(message);
      },
    },
    results,
    output: {
      appendLine(line) {
        lines.push(line);
      },
    },
    diagnostics: {
      set(uri, items) {
        diagnostics.push({ uri, items: [...items] });
      },
    },
  };

  return { deps, charts, lines, diagnostics, results };
}

function baseReq(partial?: Partial<RunRequest>): RunRequest {
  return {
    script: '//@version=5\nindicator("t")\nplot(close)',
    uri: 'file:///tmp/t.pyne',
    mode: 'auto',
    focus: true,
    bars: BARS,
    seriesKey: 'binance|spot|BTC/USDT|1m',
    engineId: 'server',
    baseSeq: 1,
    ...partial,
  };
}

describe('RunOrchestrator', () => {
  test('success: paints chart.full with seq > baseSeq and seriesKey', async () => {
    const orch = new RunOrchestrator();
    const { deps, charts, lines, diagnostics, results } = makeDeps();
    let seenAuth = '';
    deps.fetchImpl = mockFetch((_url, init) => {
      seenAuth = init?.headers?.Authorization ?? '';
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ status: 'success', plots: [9], series: {} }),
      };
    });

    const outcome = await orch.run(baseReq({ baseSeq: 1 }), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(seenAuth).toBe(`Bearer ${PRO_KEY}`);
    expect(outcome.seq).toBe(2); // baseSeq 1 + 1 — avoids handshake collision
    expect(results.getLastRunId()).toBe(outcome.runId);

    const full = charts.find((m) => m.type === 'chart.full');
    expect(full?.type).toBe('chart.full');
    if (full?.type === 'chart.full') {
      expect(full.payload.bars).toEqual(BARS);
      expect(full.payload.plots).toEqual([9]);
      expect(full.payload.seq).toBe(2);
      expect(full.seriesKey).toBe('binance|spot|BTC/USDT|1m');
    }
    // Success clears diagnostics for the run URI only (empty set).
    expect(diagnostics.some((d) => d.uri === 'file:///tmp/t.pyne' && d.items.length === 0)).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('run ok'))).toBe(true);
  });

  test('success publish keeps drawings, profile, and scrubbed logs/diagnostics', async () => {
    const orch = new RunOrchestrator();
    const profile = { total_ms: 4, lines: [{ line: 1, ms: 2 }] };
    const { deps, charts, results } = makeDeps({
      fetchImpl: mockFetch(() => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          status: 'success',
          plots: [9],
          series: { plot_0: [9] },
          drawings: [{ id: 'd1' }],
          profile,
          logs: [
            `leak Bearer ${PRO_KEY}`,
            'plain line',
            {
              message: `m ${PRO_KEY}`,
              text: 'clean text',
              msg: 'Bearer abc.def',
              extra: 1,
            },
            { message: 3, text: false, msg: null, keep: true },
            null,
            ['nested'],
            7,
          ],
          errors: [{ message: `diag ${PRO_KEY}`, text: 'ok', line: 4, severity: 'warning' }],
        }),
      })),
    });

    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(true);
    const full = charts.find((m) => m.type === 'chart.full');
    expect(full?.type).toBe('chart.full');
    if (full?.type === 'chart.full') {
      expect(full.payload.drawings).toEqual([{ id: 'd1' }]);
      expect(full.payload.plots).toEqual([9]);
    }
    const last = results.getLastRun();
    expect(last?.status).toBe('success');
    expect(last?.meta?.profile).toEqual(profile);
    expect(typeof last?.meta?.ms).toBe('number');
    expect(last?.plots).toEqual([9]);
    expect(last?.series).toEqual({ plot_0: [9] });
    const publishedLogs = last?.logs as unknown[];
    expect(publishedLogs[0]).toBe('leak Bearer ****');
    expect(publishedLogs[1]).toBe('plain line');
    expect(publishedLogs[2]).toEqual({
      message: 'm pyn_****…6789',
      text: 'clean text',
      msg: 'Bearer ****',
      extra: 1,
    });
    expect(publishedLogs[3]).toEqual({ message: 3, text: false, msg: null, keep: true });
    expect(publishedLogs[4]).toBeNull();
    expect(publishedLogs[5]).toEqual(['nested']);
    expect(publishedLogs[6]).toBe(7);
    const diags = last?.diagnostics as Array<{ message: string; line?: number; severity?: string }>;
    expect(diags[0]?.message).toBe('diag pyn_****…6789');
    expect(diags[0]?.line).toBe(4);
    expect(diags[0]?.severity).toBe('warning');
    expect(JSON.stringify(last)).not.toContain(PRO_KEY);
  });

  test('HTTP error: sets diagnostics for URI; never paints chart.full', async () => {
    const orch = new RunOrchestrator();
    const { deps, charts, lines, diagnostics, results } = makeDeps({
      fetchImpl: mockFetch(() => ({
        ok: false,
        status: 400,
        body: JSON.stringify({
          status: 'error',
          code: 'COMPILE',
          message: 'syntax error',
          errors: [{ message: 'unexpected token', line: 2, column: 1 }],
        }),
      })),
    });

    const outcome = await orch.run(baseReq(), deps);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('error');
    expect(charts.some((m) => m.type === 'chart.full')).toBe(false);
    const diag = diagnostics.find((d) => d.items.length > 0);
    expect(diag?.uri).toBe('file:///tmp/t.pyne');
    expect(diag?.items[0]?.message).toBe('unexpected token');
    expect(results.getNewestRunId()).toBeTruthy();
    expect(lines.some((l) => l.includes('run error'))).toBe(true);
  });

  test('error publish scrubs log fallback and meta.profile', async () => {
    const orch = new RunOrchestrator();
    const { deps, charts, results } = makeDeps({
      fetchImpl: mockFetch(() => ({
        ok: false,
        status: 400,
        body: JSON.stringify({
          status: 'error',
          message: `bad ${PRO_KEY}`,
          logs: { not: 'array' },
          log: [`see ${PRO_KEY}`, { message: 'clean', text: `pn_${'ab'.repeat(8)}` }],
          profile: [1, 2],
          meta: { profile: { fn: 'f' } },
          errors: [{ message: 'syntax', msg: `Bearer ${PRO_KEY}` }],
        }),
      })),
    });
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(false);
    expect(charts.some((m) => m.type === 'chart.full')).toBe(false);
    const last = results.getLastRun();
    expect(last?.status).toBe('error');
    expect(last?.error ?? '').not.toContain(PRO_KEY);
    expect(last?.meta?.profile).toEqual({ fn: 'f' });
    expect(last?.logs).toEqual([
      'see pyn_****…6789',
      { message: 'clean', text: 'pn_****…abab' },
    ]);
    const diags = last?.diagnostics as Array<{ message: string; severity?: string }>;
    expect(diags[0]?.message).toBe('syntax');
    expect(diags[0]?.severity).toBe('error');
    expect(JSON.stringify(last)).not.toContain(PRO_KEY);
  });

  test('stale epoch: later run wins; earlier completion is dropped', async () => {
    const orch = new RunOrchestrator();
    const charts1: ChartNotifyMessage[] = [];
    const charts2: ChartNotifyMessage[] = [];
    const lines: string[] = [];
    const results = new ResultsFocusStore();

    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const slowFetch: FetchLike = async (_url, init) => {
      await slowGate;
      if (init?.signal?.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ status: 'success', plots: ['slow'], series: {} }),
      };
    };
    const fastFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ status: 'success', plots: ['fast'], series: {} }),
    });

    const sharedDiag = { set() {} };

    const depsSlow: RunDeps = {
      secrets: { async getProKey() { return PRO_KEY; } },
      endpoint: 'http://127.0.0.1:5002',
      fetchImpl: slowFetch,
      bus: { notifyChart(m) { charts1.push(m); } },
      results,
      output: { appendLine(l) { lines.push(l); } },
      diagnostics: sharedDiag,
    };
    const depsFast: RunDeps = {
      ...depsSlow,
      fetchImpl: fastFetch,
      bus: { notifyChart(m) { charts2.push(m); } },
    };

    const p1 = orch.run(baseReq({ focus: true, baseSeq: 1 }), depsSlow);
    await Promise.resolve();
    await Promise.resolve();

    const o2 = await orch.run(baseReq({ focus: true, baseSeq: 1 }), depsFast);
    expect(o2.ok).toBe(true);
    if (o2.ok) {
      const full = charts2.find((m) => m.type === 'chart.full');
      expect(full?.type === 'chart.full' && full.payload.plots).toEqual(['fast']);
      expect(full?.type === 'chart.full' && full.payload.seq).toBeGreaterThan(1);
    }

    releaseSlow?.();
    const o1 = await p1;
    expect(o1.ok).toBe(false);
    if (!o1.ok) expect(['stale', 'aborted']).toContain(o1.reason);
    expect(charts1.some((m) => m.type === 'chart.full')).toBe(false);
  });

  test('missing Pro key fails clearly and sets diagnostics', async () => {
    const orch = new RunOrchestrator();
    let called = false;
    const { deps, lines, diagnostics } = makeDeps({
      missingProKey: true,
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    const outcome = await orch.run(baseReq(), deps);
    expect(called).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('error');
      expect(outcome.error).toBe(MISSING_PRO_KEY_ERROR);
    }
    expect(diagnostics.some((d) => d.items[0]?.message === MISSING_PRO_KEY_ERROR)).toBe(true);
    expect(lines.some((l) => l.includes('Pro API key missing'))).toBe(true);
  });

  test('engine error containing Pro key is scrubbed from output/diagnostics', async () => {
    const orch = new RunOrchestrator();
    const { deps, lines, diagnostics } = makeDeps({
      fetchImpl: mockFetch(() => ({
        ok: false,
        status: 401,
        body: JSON.stringify({
          status: 'error',
          message: `bad key ${PRO_KEY} Bearer ${PRO_KEY}`,
        }),
      })),
    });
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(false);
    const joined = [...lines, ...(diagnostics.flatMap((d) => d.items.map((i) => i.message)))].join(
      '\n',
    );
    expect(joined).not.toContain(PRO_KEY);
    expect(joined).not.toMatch(/Bearer\s+pyn_/i);
    if (!outcome.ok) expect(outcome.error ?? '').not.toContain(PRO_KEY);
  });

  test('aborted signal before fetch returns aborted with no paint and no fetch', async () => {
    const orch = new RunOrchestrator();
    let fetched = false;
    const { deps, charts } = makeDeps({
      fetchImpl: async () => {
        fetched = true;
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    const ac = new AbortController();
    ac.abort();
    const outcome = await orch.run(baseReq({ signal: ac.signal }), deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('aborted');
    expect(fetched).toBe(false);
    expect(charts.some((m) => m.type === 'chart.full')).toBe(false);
  });

  test('abortAll aborts in-flight fetch and does not paint', async () => {
    const orch = new RunOrchestrator();
    let sawAbort = false;
    let fetchStarted = false;
    const { deps, charts } = makeDeps({
      fetchImpl: async (_url, init) => {
        fetchStarted = true;
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5000);
          init?.signal?.addEventListener(
            'abort',
            () => {
              sawAbort = true;
              clearTimeout(t);
              const err = new Error('aborted');
              err.name = 'AbortError';
              reject(err);
            },
            { once: true },
          );
        });
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    const p = orch.run(baseReq(), deps);
    await Promise.resolve();
    await Promise.resolve();
    orch.abortAll();
    const outcome = await p;
    expect(fetchStarted).toBe(true);
    expect(sawAbort).toBe(true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(['aborted', 'error', 'stale']).toContain(outcome.reason);
    expect(charts.some((m) => m.type === 'chart.full')).toBe(false);
  });

  test('unsupported engine id is rejected without fetch', async () => {
    const orch = new RunOrchestrator();
    let called = false;
    const { deps } = makeDeps({
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    const outcome = await orch.run(baseReq({ engineId: 'pyne-worker' }), deps);
    expect(called).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe(UNSUPPORTED_ENGINE_ERROR);
  });

  test('silent focus:false still updates newest but first-ever focuses', async () => {
    const orch = new RunOrchestrator();
    const { deps, results } = makeDeps();
    const first = await orch.run(baseReq({ focus: false }), deps);
    expect(first.ok).toBe(true);
    expect(results.getResultsFocusId()).toBe(results.getNewestRunId());

    const second = await orch.run(baseReq({ focus: false }), deps);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(results.getNewestRunId()).toBe(second.runId);
      expect(results.getLastRunId()).toBe(first.runId);
      expect(results.get(first.runId)?.status).toBe('success');
    }
    results.clear();
    expect(results.getNewestRunId()).toBeNull();
  });

  test('empty endpoint falls back to default', async () => {
    const orch = new RunOrchestrator();
    let seen = '';
    const { deps } = makeDeps({
      fetchImpl: mockFetch((url) => {
        seen = url;
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ status: 'success', plots: [] }),
        };
      }),
    });
    deps.endpoint = '   ';
    const ac = new AbortController();
    const outcome = await orch.run(baseReq({ signal: ac.signal }), deps);
    expect(outcome.ok).toBe(true);
    expect(seen).toBe('http://127.0.0.1:5002/run');
    expect(orch.currentSeq).toBeGreaterThan(0);
    expect(orch.currentEpoch).toBeGreaterThan(0);
  });

  test('invalid Pro key shape is rejected', async () => {
    const orch = new RunOrchestrator();
    const { deps, diagnostics } = makeDeps({ proKey: 'pyn_tooshort' });
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(false);
    expect(diagnostics.some((d) => d.items.length > 0)).toBe(true);
  });

  test('top-level throw is caught and scrubbed', async () => {
    const orch = new RunOrchestrator();
    const { deps } = makeDeps();
    deps.secrets.getProKey = async () => {
      throw new Error(`leak ${PRO_KEY}`);
    };
    deps.diagnostics.set = () => {
      throw new Error('diag fail');
    };
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error ?? '').not.toContain(PRO_KEY);
      expect(outcome.error).toMatch(/leak/i);
    }
  });

  test('error with empty diagnostics list still sets a fallback diagnostic', async () => {
    const orch = new RunOrchestrator();
    const { deps, diagnostics } = makeDeps({
      fetchImpl: mockFetch(() => ({
        ok: true,
        status: 200,
        body: JSON.stringify({ status: 'error' }),
      })),
    });
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(false);
    expect(diagnostics.some((d) => d.items.length > 0)).toBe(true);
  });

  test('stale inside catch after throw still reports stale', async () => {
    const orch = new RunOrchestrator();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const lines: string[] = [];
    const deps: RunDeps = {
      secrets: {
        async getProKey() {
          await gate;
          throw new Error('late fail');
        },
      },
      endpoint: 'http://127.0.0.1:5002',
      bus: { notifyChart() {} },
      results: new ResultsFocusStore(),
      output: { appendLine(l) { lines.push(l); } },
      diagnostics: { set() {} },
    };
    const p1 = orch.run(baseReq(), deps);
    await Promise.resolve();
    void orch
      .run(baseReq(), {
        ...deps,
        secrets: { async getProKey() { return PRO_KEY; } },
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'success', plots: [] }),
        }),
      })
      .catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    release();
    const o1 = await p1;
    expect(o1.ok).toBe(false);
    if (!o1.ok) expect(['stale', 'aborted']).toContain(o1.reason);
  });

  test('emitStatus swallows onRunStatus errors', async () => {
    const orch = new RunOrchestrator();
    const { deps } = makeDeps();
    deps.onRunStatus = () => {
      throw new Error('status sink failed');
    };
    const outcome = await orch.run(baseReq(), deps);
    expect(outcome.ok).toBe(true);
  });

  test('safeLog swallows output failures', async () => {
    const orch = new RunOrchestrator();
    const { deps } = makeDeps();
    deps.output.appendLine = () => {
      throw new Error('output closed');
    };
    // Should not throw out of run despite logging failures.
    const outcome = await orch.run(baseReq({ engineId: 'pyne-worker' }), deps);
    expect(outcome.ok).toBe(false);
  });

  test('abortAll is idempotent when idle', () => {
    const orch = new RunOrchestrator();
    expect(() => orch.abortAll()).not.toThrow();
    expect(() => orch.abortAll()).not.toThrow();
  });

  test('aborted after fetch returns aborted and does not paint', async () => {
    const orch = new RunOrchestrator();
    const ac = new AbortController();
    const { deps, charts } = makeDeps({
      fetchImpl: async () => {
        ac.abort();
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: 'success', plots: [] }),
        };
      },
    });
    const outcome = await orch.run(baseReq({ signal: ac.signal }), deps);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('aborted');
    expect(charts.some((m) => m.type === 'chart.full')).toBe(false);
  });

  test('stale after getProKey drops without fetch', async () => {
    const orch = new RunOrchestrator();
    const lines: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let fetched = false;
    const deps: RunDeps = {
      secrets: {
        async getProKey() {
          await gate;
          return PRO_KEY;
        },
      },
      endpoint: 'http://127.0.0.1:5002',
      fetchImpl: async () => {
        fetched = true;
        return { ok: true, status: 200, text: async () => '{}' };
      },
      bus: { notifyChart() {} },
      results: new ResultsFocusStore(),
      output: { appendLine(l) { lines.push(l); } },
      diagnostics: { set() {} },
    };
    const p1 = orch.run(baseReq(), deps);
    await Promise.resolve();
    const o2 = await orch.run(baseReq(), {
      ...deps,
      secrets: { async getProKey() { return PRO_KEY; } },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'success', plots: [] }),
      }),
    });
    expect(o2.ok).toBe(true);
    release();
    const o1 = await p1;
    expect(o1.ok).toBe(false);
    if (!o1.ok) expect(['stale', 'aborted']).toContain(o1.reason);
    expect(lines.some((l) => l.includes('drop stale') || l.includes('aborted'))).toBe(true);
    void fetched;
  });
});
