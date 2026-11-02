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
import {
  ACTIVE_PLUGINS_WORKSPACE_STATE_KEY,
  DEFAULT_ACTIVE_PLUGINS_V1,
  createMemoryWorkspaceState,
  isActivePlugin,
  parseActivePluginsV1,
  readActivePlugins,
  workspaceStateFromContext,
  writeActivePlugin,
} from './active';
import { PLUGIN_KINDS } from './types';

const DEFAULTS = {
  source: 'binance-rest',
  stream: 'binance-ws',
  engine: 'server',
  storage: 'local',
};

describe('axis.plugins.active.v1 persist', () => {
  test('key, defaults, empty parse', () => {
    expect(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY).toBe('axis.plugins.active.v1');
    expect(DEFAULT_ACTIVE_PLUGINS_V1).toEqual(DEFAULTS);
    expect(parseActivePluginsV1(undefined)).toEqual(DEFAULTS);
    expect(parseActivePluginsV1(null)).toEqual(DEFAULTS);
    expect(parseActivePluginsV1([])).toEqual(DEFAULTS);
    expect(parseActivePluginsV1('nope')).toEqual(DEFAULTS);
    expect(parseActivePluginsV1(1)).toEqual(DEFAULTS);
    expect(readActivePlugins(createMemoryWorkspaceState())).toEqual(DEFAULTS);
  });

  test('read/write/isActive round-trip and empty id ignored', async () => {
    const mem = createMemoryWorkspaceState();
    expect(isActivePlugin(mem, 'source', 'binance-rest')).toBe(true);
    expect(isActivePlugin(mem, 'source', 'okx-rest')).toBe(false);
    expect(isActivePlugin(mem, 'dataset', 'defillama-tvl')).toBe(false);

    expect(await writeActivePlugin(mem, 'source', 'okx-rest')).toBe(true);
    expect(readActivePlugins(mem)).toEqual({
      ...DEFAULTS,
      source: 'okx-rest',
    });
    expect(isActivePlugin(mem, 'source', 'okx-rest')).toBe(true);
    expect(isActivePlugin(mem, 'source', '  okx-rest  ')).toBe(true);
    expect(isActivePlugin(mem, 'stream', 'binance-ws')).toBe(true);

    const before = readActivePlugins(mem);
    expect(await writeActivePlugin(mem, 'source', '')).toBe(false);
    expect(await writeActivePlugin(mem, 'source', '   ')).toBe(false);
    expect(readActivePlugins(mem)).toEqual(before);

    expect(await writeActivePlugin(mem, 'dataset', 'defillama-tvl')).toBe(true);
    expect(readActivePlugins(mem).dataset).toBe('defillama-tvl');
    expect(readActivePlugins(mem).component).toBeUndefined();
    expect(await writeActivePlugin(mem, 'component', 'example-slot')).toBe(true);
    expect(isActivePlugin(mem, 'component', 'example-slot')).toBe(true);
  });

  test('unknown kinds ignored; stored unknown keys dropped', async () => {
    const mem = createMemoryWorkspaceState();
    expect(
      await writeActivePlugin(
        mem,
        'not-a-kind' as never,
        'x',
      ),
    ).toBe(false);
    expect(isActivePlugin(mem, 'not-a-kind' as never, 'x')).toBe(false);
    expect(isActivePlugin(mem, 'source', '')).toBe(false);

    expect(
      parseActivePluginsV1({
        source: 'kraken-rest',
        foo: 'bar',
        stream: '',
        engine: '  pyodide  ',
        storage: 12,
        dataset: null,
      }),
    ).toEqual({
      ...DEFAULTS,
      source: 'kraken-rest',
      engine: 'pyodide',
    });
  });

  test('strips secrets from blob', () => {
    const parsed = parseActivePluginsV1({
      source: 'ccxt-rest',
      apiKey: 'pn_should_not_persist',
      token: 'secret-token',
      password: 'x',
      config: { secret: 'nested', engine: 'server' },
      engine: 'pyne-worker',
    });
    expect(parsed.source).toBe('ccxt-rest');
    expect(parsed.engine).toBe('pyne-worker');
    expect(JSON.stringify(parsed)).not.toContain('pn_should_not_persist');
    expect(JSON.stringify(parsed)).not.toContain('secret-token');
    expect(JSON.stringify(parsed)).not.toContain('password');
  });

  test('write persists stripped blob without secret fields', async () => {
    const mem = createMemoryWorkspaceState();
    mem.map.set(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY, {
      source: 'okx-rest',
      apiKey: 'leak-me',
      token: 't',
    });
    expect(await writeActivePlugin(mem, 'stream', 'okx-ws')).toBe(true);
    const stored = mem.map.get(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY);
    expect(JSON.stringify(stored)).not.toContain('leak-me');
    expect(readActivePlugins(mem)).toEqual({
      ...DEFAULTS,
      source: 'okx-rest',
      stream: 'okx-ws',
    });
  });

  test('hostile getters do not throw on parse/read/write/isActive', async () => {
    const hostileGet: {
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
    expect(readActivePlugins(hostileGet)).toEqual(DEFAULTS);
    expect(await writeActivePlugin(hostileGet, 'source', 'okx-rest')).toBe(
      false,
    );
    expect(isActivePlugin(hostileGet, 'source', 'binance-rest')).toBe(true);

    const badRow = {
      get source(): string {
        throw new Error('source');
      },
      stream: 'okx-ws',
    };
    expect(parseActivePluginsV1(badRow)).toEqual({
      ...DEFAULTS,
      stream: 'okx-ws',
    });

    const keysThrow = {};
    Object.defineProperty(keysThrow, 'source', {
      enumerable: true,
      get() {
        throw new Error('enum');
      },
    });
    expect(parseActivePluginsV1(keysThrow)).toEqual(DEFAULTS);

    const nestedThrow = {
      source: 'okx-rest',
      extra: {
        get apiKey(): string {
          throw new Error('nested');
        },
      },
    };
    expect(parseActivePluginsV1(nestedThrow).source).toBe('okx-rest');
    expect(
      parseActivePluginsV1({
        source: 'okx-rest',
        meta: { note: 'keep' },
      }).source,
    ).toBe('okx-rest');

    const ownKeysThrow = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('ownKeys');
        },
        get() {
          throw new Error('get');
        },
      },
    );
    expect(parseActivePluginsV1(ownKeysThrow)).toEqual(DEFAULTS);

    const mem = createMemoryWorkspaceState();
    expect(await writeActivePlugin(mem, 'source', 1 as never)).toBe(false);
    expect(isActivePlugin(mem, 'source', 1 as never)).toBe(false);
  });

  test('memory workspaceState update(undefined) deletes', () => {
    const mem = createMemoryWorkspaceState([['k', 1]]);
    expect(mem.get('k')).toBe(1);
    mem.update('k', undefined);
    expect(mem.get('k')).toBeUndefined();
  });

  test('workspaceStateFromContext never throws on hostile get', () => {
    const helpers = workspaceStateFromContext({
      workspaceState: {
        get() {
          throw new Error('ws-get');
        },
        update() {},
      },
    });
    expect(helpers.get('x')).toBeUndefined();
    expect(readActivePlugins(helpers)).toEqual(DEFAULTS);

    const mem = createMemoryWorkspaceState();
    const bound = workspaceStateFromContext({ workspaceState: mem });
    bound.update(ACTIVE_PLUGINS_WORKSPACE_STATE_KEY, { source: 'mexc-rest' });
    expect(readActivePlugins(bound).source).toBe('mexc-rest');
  });

  test('PLUGIN_KINDS still covers every active map key', () => {
    expect(PLUGIN_KINDS).toEqual([
      'source',
      'stream',
      'engine',
      'storage',
      'dataset',
      'component',
    ]);
  });
});
