/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Provider lock: venue resolution, source↔stream pairing, persist omits secrets.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  buildProviderSession,
  defaultStreamForSource,
  formatProviderLabel,
  hydrateProviderSession,
  isSourceStreamPaired,
  persistProviderSession,
  resolveProviderVenue,
  venueFromPluginId,
} from '../src/data/provider';
import { barsCacheKey } from '../src/data/bars-cache';
import { foldVenueCandle } from '../src/streams/catalog';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { registry } from '../src/plugins/registry';
import { setActivePlugin, store, flushPersist, parsePersistedState, STORAGE_KEY } from '../src/store';
import { getActiveProvider } from '../src/plugins/active';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  setActivePlugin('source', 'binance-rest');
  setActivePlugin('stream', 'binance-ws');
});

describe('venueFromPluginId', () => {
  it('maps first-party plugins', () => {
    expect(venueFromPluginId('binance-rest')).toBe('binance');
    expect(venueFromPluginId('okx-ws')).toBe('okx');
    expect(venueFromPluginId('kraken-rest')).toBe('kraken');
    expect(venueFromPluginId('mexc-ws')).toBe('mexc');
    expect(venueFromPluginId('geckoterminal-ohlcv')).toBe('gecko');
    expect(venueFromPluginId('csv-upload')).toBe('upload');
  });
});

describe('resolveProviderVenue / pairing', () => {
  it('source wins over a mismatched stream', () => {
    expect(resolveProviderVenue('okx-rest', 'binance-ws')).toBe('okx');
  });

  it('pairs first-party sources', () => {
    expect(defaultStreamForSource('okx-rest')).toBe('okx-ws');
    expect(defaultStreamForSource('kraken-rest')).toBe('kraken-ws');
    expect(defaultStreamForSource('mexc-rest')).toBe('mexc-ws');
    expect(defaultStreamForSource('geckoterminal-ohlcv')).toBe('mock-poll');
    expect(isSourceStreamPaired('binance-rest', 'binance-ws')).toBe(true);
    expect(isSourceStreamPaired('binance-rest', 'okx-ws')).toBe(false);
  });

  it('data-manager uses underlying cache source', () => {
    expect(defaultStreamForSource('data-manager', 'okx-rest')).toBe('okx-ws');
    expect(resolveProviderVenue('data-manager', 'binance-ws', { underlyingSourceId: 'bybit-rest' })).toBe(
      'bybit',
    );
  });
});

describe('session hydrate / persist', () => {
  it('drops unknown fields and never stores a secret', () => {
    const s = hydrateProviderSession(
      {
        sourceId: 'okx-rest',
        streamId: 'okx-ws',
        authMode: 'authenticated',
        secret: 'should-not-exist',
        apiKey: 'nope',
        credentialId: 'cred-1',
      },
      'okx-rest',
      'okx-ws',
    );
    expect(s.venue).toBe('okx');
    expect(s.authMode).toBe('authenticated');
    expect(s.credentialId).toBe('cred-1');
    const dumped = persistProviderSession(s);
    expect(dumped.secret).toBeUndefined();
    expect(dumped.apiKey).toBeUndefined();
    expect(dumped.credentialId).toBe('cred-1');
    expect(JSON.stringify(dumped)).not.toMatch(/should-not-exist|nope/);
  });

  it('formats HUD label', () => {
    expect(
      formatProviderLabel({ venue: 'binance', market: 'spot', authMode: 'public' }),
    ).toBe('Binance spot · public');
    expect(
      formatProviderLabel({ venue: 'okx', market: 'spot', authMode: 'authenticated' }),
    ).toBe('OKX spot · key');
  });
});

describe('setActivePlugin pairing', () => {
  it('re-pairs stream when source changes', () => {
    setActivePlugin('source', 'okx-rest');
    expect(store.source).toBe('okx-rest');
    expect(store.live.streamId).toBe('okx-ws');
    expect(store.activePlugins.stream).toBe('okx-ws');
    expect(store.provider.venue).toBe('okx');
    expect(store.exchange).toBe('okx');
    expect(getActiveProvider().streamId).toBe('okx-ws');
  });

  it('allows an explicit mismatched stream (HUD can Fix)', () => {
    setActivePlugin('source', 'binance-rest');
    setActivePlugin('stream', 'okx-ws');
    expect(store.live.streamId).toBe('okx-ws');
    expect(store.provider.sourceId).toBe('binance-rest');
    expect(store.provider.streamId).toBe('okx-ws');
    expect(isSourceStreamPaired(store.source, store.live.streamId)).toBe(false);
  });

  it('persist payload has provider without secrets', () => {
    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY) || '{}';
    expect(raw).toMatch(/"provider"/);
    const parsed = parsePersistedState(raw);
    expect(parsed?.provider?.venue).toBeTruthy();
    const p = parsed?.provider as Record<string, unknown> | undefined;
    expect(p?.apiKey).toBeUndefined();
    expect(p?.secret).toBeUndefined();
    expect(p?.passphrase).toBeUndefined();
  });
});

describe('barsCacheKey provider lock', () => {
  it('keeps legacy 3-part keys for public spot', () => {
    expect(barsCacheKey('binance-rest', 'BTCUSDT', '1h')).toBe('binance-rest|BTCUSDT|1h');
    expect(
      barsCacheKey('binance-rest', 'BTCUSDT', '1h', { market: 'spot', authMode: 'public' }),
    ).toBe('binance-rest|BTCUSDT|1h');
  });

  it('separates authenticated candles', () => {
    expect(
      barsCacheKey('binance-rest', 'BTCUSDT', '1h', { authMode: 'authenticated' }),
    ).toBe('binance-rest|BTCUSDT|1h|spot|authenticated');
  });
});

describe('foldVenueCandle', () => {
  it('uses exchange start, not wall clock', () => {
    const a = foldVenueCandle(null, 1_700_000_040, {
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    }, 60);
    expect(a.time).toBe(1_700_000_040);
    expect(a.close).toBe(1.5);
    const b = foldVenueCandle(a, 1_700_000_050, {
      open: 1.5,
      high: 3,
      low: 0.4,
      close: 2,
      volume: 4,
    }, 60);
    expect(b.time).toBe(1_700_000_040);
    expect(b.open).toBe(1);
    expect(b.high).toBe(3);
    expect(b.low).toBe(0.4);
    expect(b.close).toBe(2);
    expect(b.volume).toBe(14);
  });
});
