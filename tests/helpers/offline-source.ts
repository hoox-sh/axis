/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Test-only historical source. Not registered by the app.
 * Use this when a unit test needs bars without a network venue.
 */

import { registry } from '../../src/plugins/registry';
import type { SourcePlugin } from '../../src/plugins/types';
import type { Bar } from '../../src/store/types';

export const TEST_OFFLINE_SOURCE_ID = 'test-offline';

function stepSec(interval: string): number {
  const m = /^(\d+)([smhdw])$/.exec(String(interval || '').trim());
  if (!m) return 3600;
  const n = parseInt(m[1] || '1', 10);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (mult[m[2] || ''] || 3600);
}

export const testOfflineSource: SourcePlugin = {
  id: TEST_OFFLINE_SOURCE_ID,
  name: 'Test Offline',
  kind: 'source',
  builtIn: false,
  description: 'Unit-test bars. Not a product source.',
  capabilities: { offline: true, transport: 'local' },
  async fetchHistorical({ interval, config, endTime }) {
    const limit = Math.max(1, Math.min(5000, Number(config?.['limit']) || 32));
    const step = stepSec(String(interval || '1h'));
    const end =
      typeof endTime === 'number' && Number.isFinite(endTime) && endTime > 0
        ? Math.floor(endTime)
        : Math.floor(Date.now() / 1000);
    const out: Bar[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      const close = 100 + (limit - i) * 0.1;
      out.push({
        time: end - i * step,
        open: close,
        high: close + 1,
        low: Math.max(0.01, close - 1),
        close,
        volume: 10,
      });
    }
    return out;
  },
};

/** Register the test source if a previous reset cleared it. */
export function registerTestOfflineSource(): void {
  if (!registry.getSource(TEST_OFFLINE_SOURCE_ID)) {
    registry.registerSource(testOfflineSource);
  }
}
