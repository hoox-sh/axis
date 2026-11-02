// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import { DEFAULT_ACTIVE_PLUGINS_V1 } from './types';
import {
  DEFAULT_PLUGINS_FLAGS,
  PLUGIN_KIND_ROLES,
  buildPluginCards,
  decodePluginsHostToWeb,
  decodePluginsWebToHost,
  encodePluginsInit,
  encodePluginsState,
  extraForPluginCard,
  parsePluginsFlags,
  pluginCardFromDescriptor,
} from './plugins-messages';

function hostileGet(key: string): Record<string, unknown> {
  return {
    get [key]() {
      throw new Error(`get ${key}`);
    },
  };
}

describe('plugins-messages', () => {
  test('parsePluginsFlags defaults and explicit true', () => {
    expect(parsePluginsFlags(undefined)).toEqual(DEFAULT_PLUGINS_FLAGS);
    expect(parsePluginsFlags(null)).toEqual(DEFAULT_PLUGINS_FLAGS);
    expect(parsePluginsFlags([])).toEqual(DEFAULT_PLUGINS_FLAGS);
    expect(parsePluginsFlags('nope')).toEqual(DEFAULT_PLUGINS_FLAGS);
    expect(
      parsePluginsFlags({
        allowPyodide: true,
        liveEnabled: true,
        allowUrlInstall: true,
      }),
    ).toEqual({
      allowPyodide: true,
      liveEnabled: true,
      allowUrlInstall: true,
    });
    expect(parsePluginsFlags({ allowPyodide: 1, liveEnabled: 'yes' })).toEqual(
      DEFAULT_PLUGINS_FLAGS,
    );
    expect(parsePluginsFlags(hostileGet('allowPyodide')).allowPyodide).toBe(false);
    expect(parsePluginsFlags(hostileGet('liveEnabled')).liveEnabled).toBe(false);
    expect(parsePluginsFlags(hostileGet('allowUrlInstall')).allowUrlInstall).toBe(
      false,
    );
  });

  test('extraForPluginCard roles and pyodide flagOff', () => {
    const off = DEFAULT_PLUGINS_FLAGS;
    const on = {
      allowPyodide: true,
      liveEnabled: true,
      allowUrlInstall: true,
    };
    expect(extraForPluginCard('source', 'binance-rest', off)).toEqual({
      role: PLUGIN_KIND_ROLES.source,
    });
    expect(extraForPluginCard('stream', 'binance-ws', off).liveEnabled).toBe(false);
    expect(extraForPluginCard('stream', 'binance-ws', off).live).toBe(false);
    expect(extraForPluginCard('stream', 'binance-ws', on).liveEnabled).toBe(true);
    expect(extraForPluginCard('stream', 'binance-ws', on).live).toBe(true);
    expect(extraForPluginCard('engine', 'pyodide', off).flagOff).toBe(true);
    expect(extraForPluginCard('engine', 'pyodide', on).flagOff).toBeUndefined();
    expect(extraForPluginCard('engine', 'server', off).flagOff).toBeUndefined();
    expect(extraForPluginCard('storage', 'local', off).role).toBe(
      PLUGIN_KIND_ROLES.storage,
    );
    expect(extraForPluginCard('dataset', 'defillama-tvl', off).role).toBe(
      PLUGIN_KIND_ROLES.dataset,
    );
    expect(extraForPluginCard('component', 'hyperparameter-optimisation', off).role).toBe(
      PLUGIN_KIND_ROLES.component,
    );
    expect(extraForPluginCard('nope' as never, 'x', off).role).toBe('');
    const boomFlags = {
      get liveEnabled(): boolean {
        throw new Error('live');
      },
      allowPyodide: false,
      allowUrlInstall: false,
    };
    expect(extraForPluginCard('stream', 'binance-ws', boomFlags).role).toBe('');
  });

  test('pluginCardFromDescriptor and buildPluginCards', () => {
    const flags = parsePluginsFlags({ liveEnabled: true });
    expect(pluginCardFromDescriptor(null, flags)).toBeNull();
    expect(pluginCardFromDescriptor([], flags)).toBeNull();
    expect(pluginCardFromDescriptor({ id: '', kind: 'source' }, flags)).toBeNull();
    expect(pluginCardFromDescriptor({ id: 'x', kind: 'nope' }, flags)).toBeNull();
    expect(
      pluginCardFromDescriptor(
        { id: '  binance-rest  ', kind: 'source', builtIn: true },
        flags,
      ),
    ).toEqual({
      id: 'binance-rest',
      name: 'binance-rest',
      kind: 'source',
      builtIn: true,
      extra: { role: PLUGIN_KIND_ROLES.source },
    });
    const withName = pluginCardFromDescriptor(
      {
        id: 'okx-rest',
        name: '  OKX  ',
        kind: 'source',
        description: 'REST',
      },
      flags,
    );
    expect(withName?.name).toBe('OKX');
    expect(withName?.description).toBe('REST');
    expect(withName?.builtIn).toBe(false);

    const pyodide = pluginCardFromDescriptor(
      { id: 'pyodide', name: 'Pyodide', kind: 'engine', builtIn: true },
      DEFAULT_PLUGINS_FLAGS,
    );
    expect(pyodide?.extra?.flagOff).toBe(true);

    expect(buildPluginCards(undefined, flags)).toEqual([]);
    expect(buildPluginCards({}, flags)).toEqual([]);
    expect(
      buildPluginCards(
        [{ id: 'local', name: 'Local', kind: 'storage', builtIn: true }, { id: 'bad' }],
        flags,
      ).map((c) => c.id),
    ).toEqual(['local']);

    const hostileId = {
      get id() {
        throw new Error('id');
      },
      kind: 'source',
    };
    expect(pluginCardFromDescriptor(hostileId, flags)).toBeNull();

    const iter: unknown[] = [];
    Object.defineProperty(iter, Symbol.iterator, {
      value() {
        throw new Error('iter');
      },
    });
    expect(buildPluginCards(iter, flags)).toEqual([]);
  });

  test('encodePluginsInit / encodePluginsState never throw', () => {
    const init = encodePluginsInit(
      [
        {
          id: 'binance-ws',
          name: 'Binance WS',
          kind: 'stream',
          builtIn: true,
        },
      ],
      { source: 'okx-rest', apiKey: 'secret' },
      { liveEnabled: true },
    );
    expect(init.type).toBe('plugins.init');
    if (init.type !== 'plugins.init') return;
    expect(init.plugins[0]?.extra?.liveEnabled).toBe(true);
    expect(init.active.source).toBe('okx-rest');
    expect((init.active as { apiKey?: string }).apiKey).toBeUndefined();
    expect(init.flags.liveEnabled).toBe(true);

    expect(encodePluginsInit({}, null, []).plugins).toEqual([]);
    expect(encodePluginsInit(null, [], null).active.source).toBe(
      DEFAULT_ACTIVE_PLUGINS_V1.source,
    );

    const state = encodePluginsState({ engine: 'pyne-worker' }, { allowPyodide: true });
    expect(state.type).toBe('plugins.state');
    if (state.type !== 'plugins.state') return;
    expect(state.active.engine).toBe('pyne-worker');
    expect(state.flags.allowPyodide).toBe(true);

    expect(() => encodePluginsInit(hostileGet('x'), hostileGet('y'), hostileGet('z'))).not.toThrow();
    expect(() => encodePluginsState(hostileGet('active'), hostileGet('flags'))).not.toThrow();
  });

  test('decodePluginsWebToHost rejects arrays and hostile getters', () => {
    expect(decodePluginsWebToHost(undefined)).toBeNull();
    expect(decodePluginsWebToHost(null)).toBeNull();
    expect(decodePluginsWebToHost([])).toBeNull();
    expect(decodePluginsWebToHost('x')).toBeNull();
    expect(decodePluginsWebToHost({ type: 'plugins.ready' })).toEqual({
      type: 'plugins.ready',
    });
    expect(
      decodePluginsWebToHost({ type: 'plugins.activate', kind: 'source', id: 'okx-rest' }),
    ).toEqual({ type: 'plugins.activate', kind: 'source', id: 'okx-rest' });
    expect(
      decodePluginsWebToHost({
        type: 'plugins.activate',
        kind: '  source  ',
        id: '  okx-rest  ',
      }),
    ).toEqual({ type: 'plugins.activate', kind: 'source', id: 'okx-rest' });
    expect(
      decodePluginsWebToHost({ type: 'plugins.activate', kind: 'source', id: '' }),
    ).toBeNull();
    expect(
      decodePluginsWebToHost({ type: 'plugins.activate', kind: 'nope', id: 'x' }),
    ).toBeNull();
    expect(
      decodePluginsWebToHost({ type: 'plugins.activate', kind: 1, id: 'x' }),
    ).toBeNull();
    expect(
      decodePluginsWebToHost({
        v: 1,
        type: 'plugins.activate',
        payload: { kind: 'engine', id: 'pyodide' },
        ts: 1,
      }),
    ).toEqual({ type: 'plugins.activate', kind: 'engine', id: 'pyodide' });
    expect(
      decodePluginsWebToHost({ v: 1, type: 'plugins.ready', payload: {}, ts: 1 }),
    ).toEqual({ type: 'plugins.ready' });
    expect(decodePluginsWebToHost({ type: 'plugins.init' })).toBeNull();
    expect(decodePluginsWebToHost(hostileGet('type'))).toBeNull();
    const kindBoom = {
      type: 'plugins.activate',
      get kind() {
        throw new Error('kind');
      },
      id: 'x',
    };
    expect(decodePluginsWebToHost(kindBoom)).toBeNull();
  });

  test('decodePluginsHostToWeb rejects arrays where objects expected', () => {
    expect(decodePluginsHostToWeb(undefined)).toBeNull();
    expect(decodePluginsHostToWeb([])).toBeNull();
    expect(decodePluginsHostToWeb({ type: 'nope' })).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.state',
        active: [],
        flags: {},
      }),
    ).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.state',
        active: 'x',
        flags: {},
      }),
    ).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.state',
        active: {},
        flags: [],
      }),
    ).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.state',
        active: { engine: 'server' },
        flags: { allowPyodide: true },
      }),
    ).toEqual({
      type: 'plugins.state',
      active: { ...DEFAULT_ACTIVE_PLUGINS_V1, engine: 'server' },
      flags: { allowPyodide: true, liveEnabled: false, allowUrlInstall: false },
    });

    expect(
      decodePluginsHostToWeb({
        type: 'plugins.init',
        plugins: {},
        active: {},
        flags: {},
      }),
    ).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.init',
        plugins: [],
        active: [],
        flags: {},
      }),
    ).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.init',
        plugins: [],
        active: {},
        flags: [],
      }),
    ).toBeNull();

    const decoded = decodePluginsHostToWeb({
      type: 'plugins.init',
      plugins: [
        {
          id: 'pyodide',
          name: 'Pyodide',
          kind: 'engine',
          builtIn: true,
          extra: { role: 'Pine runtime', flagOff: true, skip: { nested: true }, nan: Number.NaN },
        },
        { id: 'bad' },
        null,
        {
          id: 'binance-rest',
          kind: 'source',
          extra: { role: 'Historical OHLCV', n: 1, ok: null },
        },
      ],
      active: { source: 'binance-rest' },
      flags: { allowPyodide: false },
    });
    expect(decoded?.type).toBe('plugins.init');
    if (decoded?.type !== 'plugins.init') return;
    expect(decoded.plugins.map((p) => p.id)).toEqual(['pyodide', 'binance-rest']);
    expect(decoded.plugins[0]?.extra?.flagOff).toBe(true);
    expect(decoded.plugins[1]?.extra?.n).toBe(1);
    expect(decoded.plugins[1]?.extra?.ok).toBeNull();

    const extraBoom = {
      type: 'plugins.init',
      plugins: [
        {
          id: 'local',
          kind: 'storage',
          extra: {
            get role() {
              throw new Error('role');
            },
          },
        },
        {
          get id(): string {
            throw new Error('card id');
          },
          kind: 'source',
        },
      ],
      active: {},
      flags: {},
    };
    const withBoom = decodePluginsHostToWeb(extraBoom);
    expect(withBoom?.type).toBe('plugins.init');

    const extraKeys = {
      type: 'plugins.init',
      plugins: [
        {
          id: 'local',
          kind: 'storage',
          extra: new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('keys');
              },
              getOwnPropertyDescriptor() {
                return { enumerable: true, configurable: true };
              },
            },
          ),
        },
      ],
      active: {},
      flags: {},
    };
    expect(decodePluginsHostToWeb(extraKeys)?.type).toBe('plugins.init');

    const cardIter: unknown[] = [
      { id: 'local', kind: 'storage', builtIn: true, name: 'Local' },
    ];
    Object.defineProperty(cardIter, Symbol.iterator, {
      value() {
        throw new Error('iter');
      },
    });
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.init',
        plugins: cardIter,
        active: {},
        flags: {},
      }),
    ).toBeNull();

    expect(decodePluginsHostToWeb(hostileGet('type'))).toBeNull();
    expect(
      decodePluginsHostToWeb({
        type: 'plugins.init',
        plugins: [{ id: 'x', kind: 'source', description: 12, name: 3, builtIn: 1 }],
        active: {},
        flags: {},
      })?.type,
    ).toBe('plugins.init');
  });
});
