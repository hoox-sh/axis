/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @perf Long-task smoke. After the chart has scripts applied, a stretch of
 * mock live ticks must not schedule a main-thread task over 200ms.
 *
 * Not part of the default @smoke grep. Run: `bunx playwright test e2e/perf-smoke.spec.ts`
 */

import { test, expect } from '@playwright/test';
import { loadMockBars, startMockLive, stubAppNetwork } from './charts';

test.describe('live chart perf @perf', () => {
  test('no long task over 200ms while mock candles tick', async ({ page }) => {
    await page.addInitScript(() => {
      const bucket: { duration: number; start: number }[] = [];
      (window as unknown as { __axisLongTasks: typeof bucket }).__axisLongTasks = bucket;
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          bucket.push({ duration: entry.duration, start: entry.startTime });
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
      (window as unknown as { __axisLongTaskMark: number }).__axisLongTaskMark = 0;
    });

    await stubAppNetwork(page, {
      status: 'success',
      plots: Array.from({ length: 64 }, (_, i) => 30 + (i % 40)),
      series: { RSI: Array.from({ length: 64 }, (_, i) => 30 + (i % 40)) },
      events: [],
      meta: { script_name: 'RSI', script_type: 'indicator', overlay: false, ms: 4 },
    });
    await loadMockBars(page, { historyBars: 400, rollingWindowBars: 400, interval: '1m' });
    await startMockLive(page);

    await page.evaluate(() => {
      const w = window as unknown as { __axisLongTaskMark: number };
      w.__axisLongTaskMark = performance.now();
    });
    await page.waitForTimeout(8_000);
    const long = await page.evaluate(() => {
      const w = window as unknown as {
        __axisLongTasks: { duration: number; start: number }[];
        __axisLongTaskMark: number;
      };
      return w.__axisLongTasks.filter((t) => t.start >= w.__axisLongTaskMark && t.duration > 200);
    });
    expect(long, `long tasks: ${JSON.stringify(long)}`).toEqual([]);
  });
});
