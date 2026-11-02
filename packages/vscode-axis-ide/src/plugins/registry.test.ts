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

import { afterEach, describe, expect, test } from 'bun:test';
import {
  BUILTIN_ENGINE_IDS,
  BUILTIN_SOURCE_IDS,
  builtinIdsForKind,
} from './builtins';
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
  getHostPluginRegistry,
} from './registry';
import { PLUGINS_GLOBAL_STATE_KEY, pluginKey } from './types';
import {
  createMemoryGlobalState,
  parsePluginsV1,
  readPluginsV1,
  sanitizeInstalledPluginMeta,
  writePluginsV1,
} from './persist';
import { pluginsKindChildren, pluginsRootChildren } from './tree-model';

afterEach(() => {
  _resetHostPluginRegistryForTests();
});

describe('host plugin registry builtins', () => {
  test('lists builtin engine and source ids from catalogs', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    expect(reg.listBuiltinIds('engine')).toEqual([...BUILTIN_ENGINE_IDS]);
    expect(reg.listBuiltinIds('source')).toEqual([...BUILTIN_SOURCE_IDS]);
    expect(builtinIdsForKind('engine')).toEqual([...BUILTIN_ENGINE_IDS]);
    expect(builtinIdsForKind('source')).toEqual([...BUILTIN_SOURCE_IDS]);
    expect(reg.get('engine', 'server')?.builtIn).toBe(true);
    expect(reg.get('source', 'binance-rest')?.kind).toBe('source');
  });

  test('getHostPluginRegistry is idempotent and covers all kinds', () => {
    const a = getHostPluginRegistry();
    const b = getHostPluginRegistry();
    expect(a).toBe(b);
    expect(a.listBuiltinIds('stream').length).toBeGreaterThan(0);
    expect(a.listBuiltinIds('storage')).toEqual(['local', 'cloud', 'git']);
    expect(a.listBuiltinIds('dataset')).toEqual(['defillama-tvl']);
    expect(a.listBuiltinIds('component')).toEqual([
      'hyperparameter-optimisation',
    ]);
    expect(a.listAll().length).toBe(
      BUILTIN_ENGINE_IDS.length +
        BUILTIN_SOURCE_IDS.length +
        builtinIdsForKind('stream').length +
        builtinIdsForKind('storage').length +
        builtinIdsForKind('dataset').length +
        builtinIdsForKind('component').length,
    );
  });

  test('pluginKey and register ignore invalid kind/id', () => {
    expect(pluginKey('engine', 'server')).toBe('engine:server');
    const reg = new HostPluginRegistry();
    reg.register({
      id: '',
      name: 'x',
      kind: 'engine',
    });
    expect(reg.list('engine')).toEqual([]);
    reg.register({
      id: 'dyn',
      name: 'Dyn',
      kind: 'source',
      builtIn: false,
    });
    expect(reg.has('source', 'dyn')).toBe(true);
    reg.clear();
    expect(reg.listAll()).toEqual([]);
  });
});

describe('axis.plugins.v1 persist (metadata only)', () => {
  test('strips secrets and round-trips metadata', async () => {
    const mem = createMemoryGlobalState();
    expect(PLUGINS_GLOBAL_STATE_KEY).toBe('axis.plugins.v1');
    expect(readPluginsV1(mem)).toEqual([]);

    const dirty = {
      url: 'https://example.com/p.js',
      id: 'coingecko',
      name: 'CoinGecko',
      kind: 'source',
      description: 'demo',
      apiKey: 'pn_should_not_persist',
      token: 'secret-token',
      config: { password: 'x', baseUrl: 'https://api.example' },
    };
    const clean = sanitizeInstalledPluginMeta(dirty);
    expect(clean).toEqual({
      url: 'https://example.com/p.js',
      id: 'coingecko',
      name: 'CoinGecko',
      kind: 'source',
      description: 'demo',
    });
    expect(clean && 'apiKey' in clean).toBe(false);

    const ok = await writePluginsV1(mem, [
      dirty as unknown as {
        url: string;
        id: string;
        name: string;
        kind: string;
      },
    ]);
    expect(ok).toBe(true);
    const stored = mem.map.get(PLUGINS_GLOBAL_STATE_KEY);
    expect(JSON.stringify(stored)).not.toContain('pn_should_not_persist');
    expect(JSON.stringify(stored)).not.toContain('secret-token');
    expect(readPluginsV1(mem)).toEqual([
      {
        url: 'https://example.com/p.js',
        id: 'coingecko',
        name: 'CoinGecko',
        kind: 'source',
        description: 'demo',
      },
    ]);
  });

  test('parsePluginsV1 tolerates garbage', () => {
    expect(parsePluginsV1(null)).toEqual([]);
    expect(parsePluginsV1({})).toEqual([]);
    expect(parsePluginsV1([null, 1, { id: 'x' }])).toEqual([]);
    expect(
      sanitizeInstalledPluginMeta({
        url: 'https://a',
        id: 'x',
        kind: 'not-a-real-kind',
        name: 'X',
      })?.kind,
    ).toBe('not-a-real-kind');
    expect(
      sanitizeInstalledPluginMeta({
        url: 'https://a',
        id: 'anon',
        kind: 'engine',
        name: '   ',
      }),
    ).toEqual({
      url: 'https://a',
      id: 'anon',
      name: 'anon',
      kind: 'engine',
      description: undefined,
    });
  });

  test('hostile getters do not throw on read/write/sanitize/parse', async () => {
    const hostile: {
      get<T>(key: string): T | undefined;
      update(key: string, value: unknown): void;
    } = {
      get() {
        throw new Error('boom-get');
      },
      update() {
        throw new Error('boom-update');
      },
    };
    expect(readPluginsV1(hostile)).toEqual([]);
    expect(await writePluginsV1(hostile, [])).toBe(false);

    const badRow = {
      get url(): string {
        throw new Error('url');
      },
      id: 'x',
      kind: 'source',
    };
    expect(sanitizeInstalledPluginMeta(badRow)).toBeNull();

    const badList: unknown[] = [];
    Object.defineProperty(badList, 0, {
      enumerable: true,
      get() {
        throw new Error('iter');
      },
    });
    Object.defineProperty(badList, 'length', { value: 1 });
    expect(parsePluginsV1(badList)).toEqual([]);
  });
});

describe('builtinIdsForKind', () => {
  test('returns [] for impossible kind (default branch)', () => {
    expect(builtinIdsForKind('nope' as never)).toEqual([]);
  });
});

describe('plugins tree helpers', () => {
  test('root lists all kinds; engines/sources include builtins', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const roots = pluginsRootChildren(reg);
    expect(roots.map((n) => n.kind)).toEqual([
      'source',
      'stream',
      'engine',
      'storage',
      'dataset',
      'component',
    ]);
    const engines = pluginsKindChildren('engine', reg);
    expect(engines.map((n) => n.label)).toEqual([...BUILTIN_ENGINE_IDS]);
    const sources = pluginsKindChildren('source', reg);
    expect(sources.map((n) => n.label)).toEqual([...BUILTIN_SOURCE_IDS]);
  });
});
