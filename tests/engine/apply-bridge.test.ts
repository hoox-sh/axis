/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  applyStreamDelta,
  applyStreamPayload,
  streamFullToPrecomputed,
} from '../../src/engine/apply-bridge';

describe('redesign2 apply bridge (F-16)', () => {
  test('converts a full payload to a runner-ready result', () => {
    const result = streamFullToPrecomputed(
      {
        plots: [[1], [2]],
        series: { a: [1, 2] },
        bar_times: [100, 200],
        count: 2,
        plot_meta: { a: { kind: 'line' } },
      },
      'stream-full',
    );
    expect(result.status).toBe('success');
    expect(result.meta?.sessionVia).toBe('stream-full');
    expect(result.meta?.executionContext).toBe('snapshot');
    expect(result.meta?.count).toBe(2);
    expect((result as unknown as { bar_times: number[] }).bar_times).toEqual([100, 200]);
  });

  test('defaults missing plots/series/events to empty', () => {
    const result = streamFullToPrecomputed({ count: 0 }, 'stream-delta');
    expect(result.plots).toEqual([]);
    expect(result.series).toEqual({});
    expect(result.events).toEqual([]);
    expect(result.meta?.executionContext).toBe('append');
  });

  test('carries a forming-tip executionContext on stream-delta', () => {
    const result = streamFullToPrecomputed(
      { count: 1, series: { a: [1] }, executionContext: 'tip' },
      'stream-delta',
    );
    expect(result.meta?.executionContext).toBe('tip');
  });

  test('applyStreamPayload forwards precomputed + bars + liveTick without re-running', async () => {
    const seen: Array<{ script: string; id: string | undefined; opts: Record<string, unknown> }> = [];
    await applyStreamPayload(
      {
        script: 'indicator("x")',
        indicatorId: 'ind-1',
        full: { series: { a: [1] }, bar_times: [100], count: 1 },
        via: 'stream-delta',
        bars: [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      },
      {
        runAndApply: (async (script, id, opts) => {
          seen.push({ script, id, opts });
          return { status: 'success', plots: [], series: {}, events: [], meta: {} };
        }) as never,
      },
    );
    expect(seen.length).toBe(1);
    const call = seen[0]!;
    expect(call.script).toBe('indicator("x")');
    expect(call.id).toBe('ind-1');
    expect(call.opts.liveTick).toBe(true);
    expect(call.opts.silent).toBe(true);
    expect(call.opts.openResults).toBe(false);
    expect(Array.isArray(call.opts.bars)).toBe(true);
    const pre = call.opts.precomputedResult as { meta?: { sessionVia?: string } };
    expect(pre.meta?.sessionVia).toBe('stream-delta');
  });

  test('a stream snapshot is a full apply, not a live tip', async () => {
    const seen: Array<{ opts: Record<string, unknown> }> = [];
    await applyStreamPayload(
      {
        script: 'indicator("x")',
        indicatorId: 'ind-1',
        full: { series: { a: [1, 2] }, count: 2 },
        via: 'stream-full',
        bars: [
          { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
          { time: 160, open: 2, high: 2, low: 2, close: 2, volume: 2 },
        ],
      },
      {
        runAndApply: (async (_script, _id, opts) => {
          seen.push({ opts });
          return { status: 'success', plots: [], series: {}, events: [], meta: {} };
        }) as never,
      },
    );
    expect(seen[0]?.opts.liveTick).toBe(false);
  });

  test('carries the last run input descriptors into the stream payload', async () => {
    // The socket payload carries the values, not the run's metadata. Without
    // the descriptors a live apply empties the script's input list (the
    // Results panel and the Script Settings modal read them from the run).
    const { setStore, store } = await import('../../src/store');
    setStore('runResults', 'ind-2', {
      status: 'success',
      plots: [],
      series: {},
      events: [],
      meta: { inputs: [{ title: 'EMA Length', value: 50 }] },
    } as never);
    try {
      const seen: Array<{ opts: Record<string, unknown> }> = [];
      await applyStreamPayload(
        {
          script: 'indicator("x")',
          indicatorId: 'ind-2',
          full: { series: { a: [1] }, bar_times: [100], count: 1 },
          via: 'stream-delta',
          bars: [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
        },
        {
          runAndApply: (async (_script, _id, opts) => {
            seen.push({ opts });
            return { status: 'success', plots: [], series: {}, events: [], meta: {} };
          }) as never,
        },
      );
      const pre = seen[0]!.opts.precomputedResult as { meta?: { inputs?: unknown[] } };
      expect(pre.meta?.inputs).toEqual([{ title: 'EMA Length', value: 50 }]);
    } finally {
      setStore('runResults', 'ind-2', null as never);
    }
  });

  test('applyStreamDelta is synchronous and does not wrap in a Promise', () => {
    const bars = [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const seen: string[] = [];
    const out = applyStreamDelta(
      {
        script: 'indicator("x")',
        indicatorId: 'ind-1',
        full: { series: { a: [1] }, bar_times: [100], count: 1 },
        via: 'stream-delta',
        bars,
      },
      {
        applyChart: (script, id, result, appliedBars) => {
          seen.push(script);
          expect(id).toBe('ind-1');
          expect(appliedBars).toBe(bars);
          expect(result.meta?.sessionVia).toBe('stream-delta');
          return result;
        },
      },
    );
    expect(seen).toEqual(['indicator("x")']);
    expect(out && typeof (out as { then?: unknown }).then).not.toBe('function');
    expect(out.status).toBe('success');
  });
});
