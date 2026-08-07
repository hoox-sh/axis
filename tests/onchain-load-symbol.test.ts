/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Case preservation for on-chain / DEX symbols in load-symbol.
 * GeckoTerminal + colon/slash pool ids must not be uppercased (Solana base58).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  normalizeLoadSymbol,
  loadSymbolData,
  _resetLoadGeneration,
} from '../src/data/load-symbol';
import {
  _resetSourceRegistrationFlag,
  registerDynamicSource,
} from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetOnchainDatasetRegistrationFlag } from '../src/onchain/catalog';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { setStore, store, clearLogs } from '../src/store';
import { makeBars } from './fixtures/bars';
import type { SourcePlugin } from '../src/plugins/types';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetOnchainDatasetRegistrationFlag();
  _resetBootstrapFlag();
  _resetLoadGeneration();
  ensureBuiltins();
  clearLogs();
  setStore('bars', []);
  setStore('source', 'mock-walk');
  setStore('historyBars', 100);
  setStore('status', 'idle');
  setStore('statusMessage', '');
  // Avoid auto-starting live after history load (preferAfterLoad defaults true)
  setStore('live', 'preferAfterLoad', false);
  setStore('live', 'active', false);
});

describe('normalizeLoadSymbol', () => {
  it('uppercases plain CEX tickers', () => {
    expect(normalizeLoadSymbol('btcusdt')).toBe('BTCUSDT');
    expect(normalizeLoadSymbol('ethusdt', 'binance-rest')).toBe('ETHUSDT');
    expect(normalizeLoadSymbol('  solusdt  ', 'okx-rest')).toBe('SOLUSDT');
  });

  it('preserves mixed case for geckoterminal-ohlcv source id', () => {
    const ethMixed = 'eth:0xAbCdEf0123456789AbCdEf0123456789aBcDeF01';
    expect(normalizeLoadSymbol(ethMixed, 'geckoterminal-ohlcv')).toBe(ethMixed);

    // Solana pool addresses are base58 — case is significant
    const sol = 'solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    expect(normalizeLoadSymbol(sol, 'geckoterminal-ohlcv')).toBe(sol);

    // Bare mixed-case pool (no separator) still preserved when source is gecko
    const bare = 'So11111111111111111111111111111111111111112';
    expect(normalizeLoadSymbol(bare, 'geckoterminal-ohlcv')).toBe(bare);
  });

  it('preserves case when symbol contains : or / (even without gecko source)', () => {
    const colon = 'base:0xAbCdef1234567890AbCdef1234567890aBcdef12';
    expect(normalizeLoadSymbol(colon, 'binance-rest')).toBe(colon);

    const slash = 'polygon_pos/0xDeAdBeef00000000000000000000000000000000';
    expect(normalizeLoadSymbol(slash)).toBe(slash);
  });

  it('trims whitespace without altering case for DEX ids', () => {
    expect(normalizeLoadSymbol('  eth:0xAbC  ', 'geckoterminal-ohlcv')).toBe(
      'eth:0xAbC',
    );
  });

  it('returns empty string for blank input', () => {
    expect(normalizeLoadSymbol('')).toBe('');
    expect(normalizeLoadSymbol('   ')).toBe('');
  });
});

describe('loadSymbolData gecko symbol path', () => {
  it('passes mixed-case geckoterminal symbol into fetchHistorical', async () => {
    const mixed = 'solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    let seenSymbol: string | undefined;

    // Override gecko source fetch so we never hit network
    registerDynamicSource({
      id: 'geckoterminal-ohlcv',
      name: 'GeckoTerminal DEX',
      kind: 'source',
      builtIn: true,
      async fetchHistorical({ symbol }) {
        seenSymbol = symbol;
        return makeBars(5);
      },
    } as SourcePlugin);

    const ok = await loadSymbolData(mixed, '1h', 'geckoterminal-ohlcv');
    expect(ok).toBe(true);
    expect(seenSymbol).toBe(mixed);
    expect(store.symbol).toBe(mixed);
  });

  it('uppercases CEX symbols on mock-walk', async () => {
    const ok = await loadSymbolData('ethusdt', '1h', 'mock-walk');
    expect(ok).toBe(true);
    expect(store.symbol).toBe('ETHUSDT');
  });
});
