/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Background-tab gap repair: trailing-gap detection + DSM catch-up wiring.
 *
 * Regression: hidden tabs pause rAF and throttle timers, so live aggregation
 * dropped closed slots and the chart showed gaps until manual Reload. DSM must
 * auto-identify and fix them; the chart must always deliver correct data.
 */
import '../tests/setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  detectTrailingGap,
  repairChartGapsAfterBackground,
  startBackgroundCatchup,
  _resetBackgroundCatchupForTests,
  _resetBackgroundCatchupListenersForTests,
  _setBackgroundCatchupLastRepairForTests,
} from '../src/data/background-catchup';
import { _resetMultiplexForTests, _getPendingLiveBarCountForTests } from '../src/streams/multiplex';

function bar(time: number, close = 100): any {
  return { time, open: 99, high: 101, low: 98, close, volume: 10 };
}

beforeEach(() => {
  _resetBackgroundCatchupForTests();
  _resetBackgroundCatchupListenersForTests();
  _resetMultiplexForTests();
});

afterEach(() => {
  _resetBackgroundCatchupListenersForTests();
  _resetMultiplexForTests();
});

describe('detectTrailingGap', () => {
  it('fresh tail is not stale (live forming candle tolerance)', () => {
    const now = 1_700_000_000;
    const bars = [bar(now - 120), bar(now - 60), bar(now - 10)];
    const gap = detectTrailingGap(bars, '1m', now);
    expect(gap.stale).toBe(false);
    expect(gap.missingBars).toBe(0);
  });

  it('stale tail after hidden tab reports missing bars', () => {
    const now = 1_700_000_000;
    // newest is 10 minutes old on a 1m chart → 10 missed slots
    const bars = [bar(now - 780), bar(now - 720), bar(now - 600)];
    const gap = detectTrailingGap(bars, '1m', now);
    expect(gap.stale).toBe(true);
    expect(gap.newestSec).toBe(now - 600);
    expect(gap.gapFromSec).toBe(now - 600 + 60);
    expect(gap.missingBars).toBeGreaterThanOrEqual(9);
  });

  it('internal hole is stale even when the tail looks fresh', () => {
    const now = 1_700_000_000;
    // missing now-120 slot between two bars, tail fresh
    const bars = [bar(now - 300), bar(now - 240), bar(now - 60), bar(now - 10)];
    const gap = detectTrailingGap(bars, '1m', now);
    expect(gap.stale).toBe(true);
    expect(gap.fillableGaps).toBeGreaterThanOrEqual(1);
  });

  it('empty series never claims staleness (nothing to repair)', () => {
    const gap = detectTrailingGap([], '1m', 1_700_000_000);
    expect(gap.stale).toBe(false);
    expect(gap.newestSec).toBeNull();
  });
});

describe('repairChartGapsAfterBackground guards', () => {
  it('throttled repair skips without work', async () => {
    _setBackgroundCatchupLastRepairForTests(Date.now());
    const ok = await repairChartGapsAfterBackground('visible');
    expect(ok).toBe(false);
  });

  it('startBackgroundCatchup is idempotent and stoppable', () => {
    const stop1 = startBackgroundCatchup();
    const stop2 = startBackgroundCatchup();
    expect(typeof stop1).toBe('function');
    expect(stop1).toBe(stop2);
    stop1();
  });
});

describe('multiplex live queue (background-tab regression)', () => {
  it('queue starts empty after reset', () => {
    expect(_getPendingLiveBarCountForTests()).toBe(0);
  });

  it('hidden tab keeps every closed slot (no rAF single-slot loss)', async () => {
    const { loadBars, store } = await import('../src/store');
    const {
      startLive,
      stopLive,
      _getPendingLiveBarCountForTests: pendingCount,
    } = await import('../src/streams/multiplex');
    const { registerDynamicStream, unregisterDynamicStream } = await import(
      '../src/streams/catalog'
    );
    const base = 1_700_000_000;
    loadBars(
      [bar(base - 120), bar(base - 60)],
      'BTCUSDT',
      '1m',
      'mock',
    );

    // Simulate a hidden tab: rAF never fires (browser pauses it).
    const prevRaf = (globalThis as any).requestAnimationFrame;
    const prevCancel = (globalThis as any).cancelAnimationFrame;
    (globalThis as any).requestAnimationFrame = () => 1;
    (globalThis as any).cancelAnimationFrame = () => {};
    let docPatched = false;
    let prevVis: unknown;
    try {
      const doc = (globalThis as any).document;
      if (doc) {
        prevVis = (doc as any).visibilityState;
        try {
          Object.defineProperty(doc, 'visibilityState', {
            value: 'hidden',
            configurable: true,
          });
          docPatched = true;
        } catch {
          /* stub forbids redefine — hidden timer path still covered below */
        }
      }

      let emit: ((b: any) => void) | null = null;
      registerDynamicStream({
        id: 'test-hidden-queue',
        name: 'Test Hidden Queue',
        kind: 'stream',
        builtIn: false,
        description: 'test',
        capabilities: {},
        configSchema: {},
        start: ({ onBar, onStatus }: any) => {
          emit = onBar;
          try {
            onStatus?.({ state: 'open' });
          } catch {}
          return () => {};
        },
      } as any);

      try {
        startLive('test-hidden-queue', 'BTCUSDT', '1m');
        expect(emit).not.toBeNull();
        // Three ticks arrive while the tab is hidden — distinct closed slots.
        emit!({ ...bar(base), closed: true });
        emit!({ ...bar(base + 60), closed: true });
        emit!({ ...bar(base + 120), closed: false });
        // Queue holds all three until the fallback timer flushes.
        expect(pendingCount()).toBe(3);
        await new Promise((r) => setTimeout(r, 50));
        const times = store.bars.map((b: any) => b.time);
        expect(times).toContain(base);
        expect(times).toContain(base + 60);
        expect(times).toContain(base + 120);
        // Order preserved — aggregation never reorders closed slots.
        expect(times.slice(-3)).toEqual([base, base + 60, base + 120]);
      } finally {
        try {
          stopLive();
        } catch {}
        try {
          unregisterDynamicStream('test-hidden-queue');
        } catch {}
      }
    } finally {
      if (prevRaf === undefined) delete (globalThis as any).requestAnimationFrame;
      else (globalThis as any).requestAnimationFrame = prevRaf;
      if (prevCancel === undefined) delete (globalThis as any).cancelAnimationFrame;
      else (globalThis as any).cancelAnimationFrame = prevCancel;
      if (docPatched) {
        try {
          Object.defineProperty((globalThis as any).document, 'visibilityState', {
            value: prevVis ?? 'visible',
            configurable: true,
          });
        } catch {}
      }
    }
  });
});
