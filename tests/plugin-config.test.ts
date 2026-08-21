/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, afterEach } from 'bun:test';
import {
  effectiveConfig,
  fetchGatewayExchanges,
  hasConfigFields,
  writePluginField,
  _resetGatewayExchangeCache,
} from '../src/ui/plugin-config';
import { store, setStore } from '../src/store';
import type { ConfigSchema } from '../src/plugins/types';

afterEach(() => {
  _resetGatewayExchangeCache();
  globalThis.fetch = origFetch;
});

const origFetch = globalThis.fetch;

describe('hasConfigFields', () => {
  it('false for undefined / empty schema', () => {
    expect(hasConfigFields(undefined)).toBe(false);
    expect(hasConfigFields({})).toBe(false);
  });

  it('true when at least one field is declared', () => {
    const schema: ConfigSchema = { exchange: { type: 'string', default: '' } };
    expect(hasConfigFields(schema)).toBe(true);
  });
});

describe('effectiveConfig', () => {
  it('merges schema defaults under stored overrides', () => {
    const schema: ConfigSchema = {
      exchange: { type: 'string', default: '' },
      gateway: { type: 'select', default: 'auto', options: ['auto', 'pyne'] },
    };
    expect(effectiveConfig(schema, {})).toEqual({ exchange: '', gateway: 'auto' });
    expect(effectiveConfig(schema, { exchange: 'bybit' })).toEqual({
      exchange: 'bybit',
      gateway: 'auto',
    });
  });

  it('passes through stored keys without a schema entry', () => {
    expect(effectiveConfig({ a: { type: 'string', default: 'x' } }, { b: 1 })).toEqual({
      a: 'x',
      b: 1,
    });
  });
});

describe('writePluginField', () => {
  const restore = () => setStore('pluginsConfig', {});
  const bag = () =>
    (store.pluginsConfig as Record<string, Record<string, unknown>>)['source:ccxt-rest'];

  it('creates a missing bag without throwing (solid deep-path trap)', () => {
    restore();
    expect(() => writePluginField('source:ccxt-rest', 'exchange', 'okx')).not.toThrow();
    expect(bag()).toEqual({ exchange: 'okx' });
  });

  it('deep-merges into an existing bag and overwrites fields', () => {
    restore();
    writePluginField('source:ccxt-rest', 'gateway', 'pyne');
    writePluginField('source:ccxt-rest', 'exchange', 'kraken');
    expect(bag()).toEqual({ gateway: 'pyne', exchange: 'kraken' });
  });
});

describe('fetchGatewayExchanges', () => {
  it('prefers the full ccxt_exchanges list over native adapters', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'ok',
            exchanges: ['binance', 'okx'],
            ccxt_exchanges: ['alpaca', 'binance', 'kraken', 'mexc'],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;
    const list = await fetchGatewayExchanges('pyne', true);
    expect(list).toEqual(['alpaca', 'binance', 'kraken', 'mexc']);
  });

  it('falls back to exchanges when ccxt is disabled upstream', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', exchanges: ['binance', 'okx', ''] }), {
          status: 200,
        }),
      )) as typeof fetch;
    const list = await fetchGatewayExchanges('pyne', true);
    expect(list).toEqual(['binance', 'okx']);
  });

  it('caches and returns [] on failure without cache', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('nope', { status: 500 }))) as typeof fetch;
    expect(await fetchGatewayExchanges('pyne', true)).toEqual([]);
  });
});
