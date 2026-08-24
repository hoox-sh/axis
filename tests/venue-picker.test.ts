/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  applyVenueToken,
  exchangeIdFromToken,
  listVenueOptions,
  parseVenueToken,
  venueTokenFromState,
} from '../src/data/venue-picker';
import { buildProviderSession, venueFromPluginId } from '../src/data/provider';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { registry } from '../src/plugins/registry';
import { getActiveSource } from '../src/plugins/active';
import { setActivePlugin, store } from '../src/store';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  setActivePlugin('source', 'binance-rest');
});

describe('venue tokens', () => {
  it('maps native source ids through', () => {
    expect(venueTokenFromState('bybit-rest', 'bitget')).toBe('bybit-rest');
    expect(parseVenueToken('okx-rest')).toEqual({ sourceId: 'okx-rest' });
  });

  it('pins CCXT long-tail and uses catch-all for unknown ids', () => {
    expect(venueTokenFromState('ccxt-rest', 'bitget')).toBe('ccxt:bitget');
    expect(venueTokenFromState('ccxt-rest', 'phemex')).toBe('ccxt:phemex');
    expect(venueTokenFromState('ccxt-rest', '')).toBe('ccxt:');
    expect(exchangeIdFromToken('ccxt:kucoin')).toBe('kucoin');
    expect(parseVenueToken('ccxt:')).toEqual({ sourceId: 'ccxt-rest', exchange: '' });
  });

  it('lists native + pinned CCXT + other', () => {
    const opts = listVenueOptions();
    expect(opts.some((o) => o.value === 'binance-rest' && o.group === 'native')).toBe(true);
    expect(opts.some((o) => o.value === 'mexc-rest' && o.group === 'native')).toBe(true);
    expect(opts.some((o) => o.value === 'ccxt:mexc')).toBe(false);
    expect(opts.some((o) => o.value === 'ccxt:bitget' && o.group === 'ccxt')).toBe(true);
    expect(opts.some((o) => o.value === 'ccxt:')).toBe(true);
    expect(opts.some((o) => o.value === 'mock-walk')).toBe(true);
    expect(opts.some((o) => o.value === 'ccxt-rest')).toBe(false);
  });
});

describe('applyVenueToken', () => {
  it('MEXC writes native REST + WS pair', () => {
    applyVenueToken('mexc-rest');
    expect(store.source).toBe('mexc-rest');
    expect(store.live.streamId).toBe('mexc-ws');
    expect(store.provider.venue).toBe('mexc');
    expect(store.provider.id).toBe('mexc');
    expect(store.exchange).toBe('mexc');
  });

  it('Bybit writes native REST + WS pair', () => {
    applyVenueToken('bybit-rest');
    expect(store.source).toBe('bybit-rest');
    expect(store.live.streamId).toBe('bybit-ws');
    expect(store.provider.venue).toBe('bybit');
    expect(store.provider.id).toBe('bybit');
    expect(store.exchange).toBe('bybit');
  });

  it('Bitget (CCXT) writes ccxt-rest/ws bags and provider.id ccxt:bitget', () => {
    applyVenueToken('ccxt:bitget');
    expect(store.source).toBe('ccxt-rest');
    expect(store.live.streamId).toBe('ccxt-ws');
    const bags = store.pluginsConfig as Record<string, Record<string, unknown>>;
    expect(bags['source:ccxt-rest']?.exchange).toBe('bitget');
    expect(bags['stream:ccxt-ws']?.exchange).toBe('bitget');
    expect(store.provider.id).toBe('ccxt:bitget');
    expect(store.provider.venue).toBe('generic');
    expect(store.exchange).toBe('bitget');
  });
});

describe('provider ccxt identity', () => {
  it('does not treat ccxt:bybit as native Bybit', () => {
    expect(venueFromPluginId('ccxt:bybit')).toBe('generic');
    expect(venueFromPluginId('ccxt-rest')).toBe('generic');
  });

  it('buildProviderSession stamps ccxt:<exchange> id', () => {
    const s = buildProviderSession('ccxt-rest', 'ccxt-ws', { ccxtExchange: 'bybit' });
    expect(s.id).toBe('ccxt:bybit');
    expect(s.venue).toBe('generic');
    expect(s.sourceId).toBe('ccxt-rest');
  });

  it('resolves stuffed ccxt:bybit activePlugins to ccxt-rest even on direct gateway', () => {
    setActivePlugin('source', 'binance-rest');
    store.provider.gateway = 'direct';
    store.activePlugins.source = 'ccxt:bybit';
    store.source = 'ccxt:bybit';
    expect(getActiveSource().id).toBe('ccxt-rest');
  });
});
