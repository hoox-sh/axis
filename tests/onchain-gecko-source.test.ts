/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure unit tests for GeckoTerminal DEX source symbol parsing + registration.
 * Network fetch tests belong with the geckoterminal client module.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  parseGeckoPoolSymbol,
  normalizeGeckoNetwork,
  geckoTerminalOhlcv,
  listSources,
  getSource,
  ensureSourcesRegistered,
  _resetSourceRegistrationFlag,
  sourcePageLimit,
} from '../src/sources/catalog';
import { defaultStreamForSource } from '../src/streams/catalog';
import { registry } from '../src/plugins/registry';
import { _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetBootstrapFlag();
  ensureSourcesRegistered();
});

describe('normalizeGeckoNetwork', () => {
  it('aliases common chain names to GeckoTerminal slugs', () => {
    expect(normalizeGeckoNetwork('ethereum')).toBe('eth');
    expect(normalizeGeckoNetwork('ETH')).toBe('eth');
    expect(normalizeGeckoNetwork('polygon')).toBe('polygon_pos');
    expect(normalizeGeckoNetwork('bsc')).toBe('bsc');
    expect(normalizeGeckoNetwork('base')).toBe('base');
  });
});

describe('parseGeckoPoolSymbol', () => {
  const addr = '0xa43fe16908251ee70ef74718545e4fe6c5ccec9f';

  it('parses network:address', () => {
    expect(parseGeckoPoolSymbol(`eth:${addr}`)).toEqual({
      network: 'eth',
      poolAddress: addr,
    });
  });

  it('aliases ethereum: and strips trailing label', () => {
    expect(parseGeckoPoolSymbol(`ethereum:${addr} Uniswap WETH/USDC`)).toEqual({
      network: 'eth',
      poolAddress: addr,
    });
  });

  it('parses network/address', () => {
    expect(parseGeckoPoolSymbol(`base/${addr}`)).toEqual({
      network: 'base',
      poolAddress: addr,
    });
  });

  it('uses default network for bare 0x address', () => {
    expect(parseGeckoPoolSymbol(addr, 'base')).toEqual({
      network: 'base',
      poolAddress: addr,
    });
    expect(parseGeckoPoolSymbol(addr)).toEqual({
      network: 'eth',
      poolAddress: addr,
    });
  });

  it('rejects empty / unparseable symbols', () => {
    expect(() => parseGeckoPoolSymbol('')).toThrow(/required/i);
    expect(() => parseGeckoPoolSymbol('BTCUSDT')).toThrow(/cannot parse/i);
  });
});

describe('geckoterminal-ohlcv registration', () => {
  it('is a built-in source with proxy capability', () => {
    expect(geckoTerminalOhlcv.id).toBe('geckoterminal-ohlcv');
    expect(geckoTerminalOhlcv.kind).toBe('source');
    expect(geckoTerminalOhlcv.builtIn).toBe(true);
    expect(geckoTerminalOhlcv.capabilities?.needsNetwork).toBe(true);
    expect(geckoTerminalOhlcv.capabilities?.needsProxy).toBe(true);
    expect(listSources().map((s) => s.id)).toContain('geckoterminal-ohlcv');
    expect(getSource('geckoterminal-ohlcv')?.name).toBe('GeckoTerminal DEX');
  });

  it('pairs with mock-poll (no live DEX stream yet)', () => {
    expect(defaultStreamForSource('geckoterminal-ohlcv')).toBe('mock-poll');
  });

  it('page limit matches Gecko-style max candles', () => {
    expect(sourcePageLimit('geckoterminal-ohlcv')).toBe(1000);
  });
});
