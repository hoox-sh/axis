/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { applyPrecomputedChart } from '../../src/indicators/apply-live';
import type { RunResult } from '../../src/indicators/runner';

describe('applyPrecomputedChart', () => {
  test('returns the result in this task (no thenable) when there is no chart', () => {
    const result: RunResult = {
      status: 'success',
      plots: [1],
      series: { a: [1] },
      events: [],
      meta: { sessionVia: 'stream-delta' },
    };
    const out = applyPrecomputedChart(
      'indicator("x")',
      undefined,
      result,
      [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
      { silent: true, liveTick: true },
    );
    expect(out && typeof (out as { then?: unknown }).then).not.toBe('function');
    expect(out.status).toBe('success');
  });

  test('an error result is not painted', () => {
    const out = applyPrecomputedChart(
      'indicator("x")',
      'ind-1',
      { status: 'error', plots: [], series: {}, events: [], meta: { error: 'boom' } },
      [],
      { silent: true, liveTick: true },
    );
    expect(out.status).toBe('error');
  });
});
