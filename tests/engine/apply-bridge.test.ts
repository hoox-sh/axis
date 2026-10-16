/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
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
    expect(result.meta?.count).toBe(2);
    expect((result as unknown as { bar_times: number[] }).bar_times).toEqual([100, 200]);
  });

  test('defaults missing plots/series/events to empty', () => {
    const result = streamFullToPrecomputed({ count: 0 }, 'stream-delta');
    expect(result.plots).toEqual([]);
    expect(result.series).toEqual({});
    expect(result.events).toEqual([]);
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
});
