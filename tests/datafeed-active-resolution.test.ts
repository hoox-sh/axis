/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { getActiveSource, getActiveStream } from '../src/plugins/active';
import { ensureBuiltins } from '../src/plugins/bootstrap';
import { setStore } from '../src/store';

describe('gateway-aware active resolution', () => {
  beforeEach(() => {
    ensureBuiltins();
  });

  it('returns native source for direct gateway', () => {
    setStore('provider', { gateway: 'direct' } as never);
    setStore('activePlugins', 'source', 'binance-rest');
    const src = getActiveSource();
    expect(src.id).toBe('binance-rest');
  });

  it('returns ccxt-rest for ccxt: venue with pyne gateway', () => {
    setStore('provider', { gateway: 'pyne' } as never);
    setStore('activePlugins', 'source', 'ccxt:bybit');
    const src = getActiveSource();
    expect(src.id).toBe('ccxt-rest');
  });

  it('returns ccxt-rest for ccxt: venue with sidecar gateway', () => {
    setStore('provider', { gateway: 'sidecar' } as never);
    setStore('activePlugins', 'source', 'ccxt:bitget');
    const src = getActiveSource();
    expect(src.id).toBe('ccxt-rest');
  });

  it('returns ccxt-rest for ccxt: venue with non-direct gateway', () => {
    setStore('provider', { gateway: 'pyne' } as never);
    setStore('activePlugins', 'source', 'ccxt:mexc');
    const src = getActiveSource();
    expect(src.id).toBe('ccxt-rest');
  });

  it('does NOT swap native sources like binance-rest', () => {
    setStore('provider', { gateway: 'pyne' } as never);
    setStore('activePlugins', 'source', 'binance-rest');
    const src = getActiveSource();
    expect(src.id).toBe('binance-rest');
  });

  it('returns ccxt-ws for ccxt: venue stream with pyne gateway', () => {
    setStore('provider', { gateway: 'pyne' } as never);
    setStore('activePlugins', 'stream', 'ccxt:bybit');
    const stream = getActiveStream();
    expect(stream.id).toBe('ccxt-ws');
  });

  it('does NOT swap native streams like binance-ws', () => {
    setStore('provider', { gateway: 'pyne' } as never);
    setStore('activePlugins', 'stream', 'binance-ws');
    const stream = getActiveStream();
    expect(stream.id).toBe('binance-ws');
  });
});
