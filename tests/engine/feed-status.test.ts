/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  clearFeedStatus,
  clearScriptStatus,
  setFeedStatus,
  setScriptStatus,
  store,
} from '../../src/store';

describe('redesign2 subscription status store (F-07)', () => {
  test('feed status is set, updated and cleared per series key', () => {
    const key = 'binance|spot|BTC/USDT|1m';
    setFeedStatus(key, 'datafeed-loading', { have: 2000, need: 10000 });
    expect(store.live.feeds[key]?.status).toBe('datafeed-loading');
    expect(store.live.feeds[key]?.have).toBe(2000);
    setFeedStatus(key, 'live', { message: 'streaming' });
    expect(store.live.feeds[key]?.status).toBe('live');
    clearFeedStatus(key);
    expect(store.live.feeds[key]).toBeUndefined();
  });

  test('script status is set and cleared per indicator id', () => {
    setScriptStatus('ind-1', 'calculating');
    expect(store.live.scriptStatus['ind-1']?.status).toBe('calculating');
    setScriptStatus('ind-1', 'live');
    expect(store.live.scriptStatus['ind-1']?.status).toBe('live');
    clearScriptStatus('ind-1');
    expect(store.live.scriptStatus['ind-1']).toBeUndefined();
  });
});
