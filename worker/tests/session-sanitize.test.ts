/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  sanitizeStreamInterval,
  sanitizeStreamSymbol,
  withoutClient,
} from '../src/durable-objects/session';

describe('SessionDO stream sanitize', () => {
  it('accepts normal CEX symbols', () => {
    expect(sanitizeStreamSymbol('btcusdt')).toBe('BTCUSDT');
    expect(sanitizeStreamSymbol('ETHUSDT')).toBe('ETHUSDT');
  });

  it('rejects path injection and empty', () => {
    expect(sanitizeStreamSymbol('../evil')).toBeNull();
    expect(sanitizeStreamSymbol('BTC/USDT')).toBeNull();
    expect(sanitizeStreamSymbol('')).toBeNull();
    expect(sanitizeStreamSymbol('x'.repeat(40))).toBeNull();
  });

  it('allowlists kline intervals', () => {
    expect(sanitizeStreamInterval('1m')).toBe('1m');
    expect(sanitizeStreamInterval('1d')).toBe('1d');
    expect(sanitizeStreamInterval('1M')).toBe('1M');
    expect(sanitizeStreamInterval('1m/../x')).toBeNull();
    expect(sanitizeStreamInterval('99m')).toBeNull();
  });
});

describe('SessionDO withoutClient', () => {
  it('removes only the matching socket and reports emptiness via length', () => {
    const a = {} as WebSocket;
    const b = {} as WebSocket;
    const next = withoutClient([a, b], a);
    expect(next).toEqual([b]);
    expect(withoutClient(next, b)).toEqual([]);
    expect(withoutClient([a], b)).toEqual([a]);
  });
});
