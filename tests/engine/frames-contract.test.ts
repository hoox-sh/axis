/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  classifySeqGap,
  isAuthFrame,
  isCloseFrame,
  isDeltaFrame,
  isFullFrame,
  isPingFrame,
  isRepairFrame,
  isResumeFrame,
  isSubscribeFrame,
  isUnsubscribeFrame,
  validateRedesign2Frame,
} from '../../src/engine/frames';

const META = { exchange: 'binance', market: 'spot', symbol: 'BTC/USDT', interval: '1m' };

describe('redesign2 frame contract (F-01)', () => {
  test('accepts a valid subscribe frame', () => {
    const frame = {
      type: 'subscribe',
      id: 'sub-1',
      payload: { kind: 'script', meta: META, script: 'indicator("x")' },
    };
    expect(isSubscribeFrame(frame)).toBe(true);
    expect(validateRedesign2Frame(frame)).toBe(true);
  });

  test('rejects subscribe with bad kind or meta', () => {
    expect(isSubscribeFrame({ type: 'subscribe', id: 's', payload: { kind: 'nope', meta: META } })).toBe(false);
    expect(isSubscribeFrame({ type: 'subscribe', id: 's', payload: { kind: 'series' } })).toBe(false);
    expect(isSubscribeFrame({ type: 'subscribe', payload: { kind: 'series', meta: META } })).toBe(false);
  });

  test('accepts resume / repair / unsubscribe / auth / ping', () => {
    expect(isResumeFrame({ type: 'resume', id: 's', payload: { count: 100, last_time: 123 } })).toBe(true);
    expect(isResumeFrame({ type: 'resume', id: 's', payload: { count: 100 } })).toBe(false);
    expect(isRepairFrame({ type: 'repair', id: 's', payload: { from_time: 123 } })).toBe(true);
    expect(isRepairFrame({ type: 'repair', id: 's', payload: {} })).toBe(false);
    expect(isUnsubscribeFrame({ type: 'unsubscribe', id: 's' })).toBe(true);
    expect(isAuthFrame({ type: 'auth', payload: { token: 'k' } })).toBe(true);
    expect(isAuthFrame({ type: 'auth', payload: {} })).toBe(false);
    expect(isPingFrame({ type: 'ping' })).toBe(true);
  });

  test('full requires sessionId, seq, seriesKey, count and closed_upto', () => {
    const base = {
      type: 'full',
      sessionId: 's1',
      seq: 7,
      payload: { seriesKey: 'binance|spot|BTC/USDT|1m', count: 100, closed_upto: 120 },
    };
    expect(isFullFrame(base)).toBe(true);
    expect(isFullFrame({ ...base, seq: undefined })).toBe(false);
    expect(isFullFrame({ ...base, sessionId: '' })).toBe(false);
  });

  test('delta requires the positional merge block plus seq', () => {
    const base = {
      type: 'delta',
      sessionId: 's1',
      seq: 8,
      payload: { base_index: 99, count: 100, tail_len: 1, closed_upto: 120 },
    };
    expect(isDeltaFrame(base)).toBe(true);
    expect(isDeltaFrame({ ...base, payload: { base_index: 99, count: 100 } })).toBe(false);
  });

  test('close requires sessionId, seq, index, time and ohlcv', () => {
    const base = {
      type: 'close',
      sessionId: 's1',
      seq: 9,
      payload: { index: 99, time: 123, ohlcv: { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 } },
    };
    expect(isCloseFrame(base)).toBe(true);
    expect(isCloseFrame({ ...base, seq: undefined })).toBe(false);
  });

  test('classifySeqGap detects continuous, gap, duplicate and rewind', () => {
    expect(classifySeqGap(7, 8)).toEqual({ kind: 'continuous' });
    expect(classifySeqGap(7, 10)).toEqual({ kind: 'gap', missing: 2 });
    expect(classifySeqGap(7, 7)).toEqual({ kind: 'duplicate' });
    expect(classifySeqGap(7, 5)).toEqual({ kind: 'rewind' });
  });

  test('validateRedesign2Frame covers the whole contract', () => {
    expect(validateRedesign2Frame({ type: 'close', sessionId: 's', seq: 1, payload: { index: 0, time: 1, ohlcv: {} } })).toBe(true);
    expect(validateRedesign2Frame({ type: 'subscribe', id: 's', payload: { kind: 'series', meta: META } })).toBe(true);
    expect(validateRedesign2Frame({ type: 'bogus' })).toBe(false);
    expect(validateRedesign2Frame(null)).toBe(false);
  });
});
