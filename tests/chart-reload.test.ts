/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Reload policy: one entry point, latest-wins coalescing.
 *
 * Invariant: a burst of triggers (visibilitychange + focus, two topbar edits)
 * runs at most one reload at a time and exactly one more for the newest
 * reason — never a queue of stale refetches.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  _chartReloadCountForTests,
  _lastChartReloadReasonForTests,
  _resetChartReloadForTests,
  _setChartReloadRunnerForTests,
  requestChartReload,
  type ChartReloadReason,
} from '../src/chart/reload';

/** A runner whose promises settle only when the test says so. */
function deferredRunner() {
  const calls: Array<{ reason: ChartReloadReason; resolve: (ok: boolean) => void }> = [];
  _setChartReloadRunnerForTests(
    (reason) =>
      new Promise<boolean>((resolve) => {
        calls.push({ reason, resolve });
      }),
  );
  return calls;
}

beforeEach(() => {
  _resetChartReloadForTests();
});

afterEach(() => {
  _setChartReloadRunnerForTests(null);
});

describe('requestChartReload', () => {
  it('runs the reload with the requested reason', async () => {
    const calls = deferredRunner();
    const pending = requestChartReload('manual');
    expect(calls.map((c) => c.reason)).toEqual(['manual']);
    calls[0]?.resolve(true);
    await expect(pending).resolves.toBe(true);
    expect(_chartReloadCountForTests()).toBe(1);
    expect(_lastChartReloadReasonForTests()).toBe('manual');
  });

  it('coalesces a burst into one running reload plus the newest queued one', async () => {
    const calls = deferredRunner();
    const first = requestChartReload('wake');
    const second = requestChartReload('topbar:data');
    const third = requestChartReload('rolling-window');
    // Only one reload runs while the first is in flight.
    expect(calls.map((c) => c.reason)).toEqual(['wake']);
    // All three callers share the in-flight promise.
    expect(second).toBe(first);
    expect(third).toBe(first);

    calls[0]?.resolve(true);
    await first;
    // The queued reason runs once, with the newest reason.
    expect(calls.map((c) => c.reason)).toEqual(['wake', 'rolling-window']);
    calls[1]?.resolve(true);
    // Let the chained request settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(_chartReloadCountForTests()).toBe(2);
  });

  it('returns false when the runner throws', async () => {
    _setChartReloadRunnerForTests(async () => {
      throw new Error('venue down');
    });
    await expect(requestChartReload('topbar:data')).resolves.toBe(false);
  });
});
