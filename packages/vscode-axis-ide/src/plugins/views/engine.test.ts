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

import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  BUILTIN_ENGINE_IDS,
} from '../builtins';
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
} from '../registry';
import type { HostPluginRegistry as RegistryType } from '../registry';

type CapturedTreeView = {
  id: string;
  showCollapseAll?: boolean;
};

type G = {
  __axisPluginKindTreeViews?: CapturedTreeView[];
  __axisAllowPyodide?: unknown;
  __axisEngineCfgThrow?: boolean;
};

function g(): G {
  return globalThis as G;
}

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    contextValue?: string;
    tooltip?: string;
    command?: unknown;
    constructor(label: string, collapsibleState = 0) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire(_v?: unknown) {}
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    window: {
      createTreeView(id: string, options: { showCollapseAll?: boolean }) {
        const bucket = g().__axisPluginKindTreeViews;
        if (bucket) {
          bucket.push({ id, showCollapseAll: options.showCollapseAll });
        }
        return { dispose() {} };
      },
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration(section: string) {
        if (g().__axisEngineCfgThrow === true) {
          throw new Error('cfg');
        }
        return {
          get(key: string) {
            if (section === 'axis.engine' && key === 'allowPyodide') {
              return g().__axisAllowPyodide;
            }
            return undefined;
          },
        };
      },
    },
  };
});

type EngineMod = typeof import('./engine');
let engine: EngineMod;

beforeAll(async () => {
  engine = await import('./engine');
});

beforeEach(() => {
  g().__axisPluginKindTreeViews = [];
  g().__axisAllowPyodide = false;
  g().__axisEngineCfgThrow = false;
});

afterEach(() => {
  _resetHostPluginRegistryForTests();
});

function deps(activeId = 'server'): engine.KindViewDeps {
  let current = activeId;
  return {
    isActive: (kind, id) => kind === 'engine' && id === current,
    onActivate: (_kind, id) => {
      current = id;
    },
  };
}

function fakeContext(): { subscriptions: Array<{ dispose(): void }> } {
  return { subscriptions: [] };
}

describe('engine plugins TreeView', () => {
  test('view id and activate command constants', () => {
    expect(engine.ENGINE_PLUGINS_VIEW_ID).toBe('axis.plugins.engine');
    expect(engine.PLUGIN_KIND_VIEW_IDS.engine).toBe('axis.plugins.engine');
    expect(engine.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
  });

  test('lists builtin engine ids from registry', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new engine.EnginePluginsTreeProvider(reg, deps());
    const rows = provider.getChildren();
    expect(rows.map((n) => n.pluginId)).toEqual([...BUILTIN_ENGINE_IDS]);
    expect(reg.listBuiltinIds('engine')).toEqual([...BUILTIN_ENGINE_IDS]);
    const server = rows[0];
    expect(server).toBeTruthy();
    if (!server) throw new Error('expected server');
    const item = provider.getTreeItem(server);
    expect(item.label).toBe('Server (pyne Pro)');
    expect(item.description).toBe('● server');
    expect(item.contextValue).toBe('axis.plugins.engine.active');
    expect(String(item.tooltip).startsWith('Pine runtime')).toBe(true);
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate',
      arguments: [{ kind: 'engine', id: 'server' }],
    });
    expect(provider.getChildren(server)).toEqual([]);
  });

  test('pyodide flag-off description stays listed and activatable', () => {
    g().__axisAllowPyodide = false;
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new engine.EnginePluginsTreeProvider(reg, deps('server'));
    const pyodide = provider
      .getChildren()
      .find((n) => n.pluginId === 'pyodide');
    expect(pyodide).toBeTruthy();
    if (!pyodide) throw new Error('expected pyodide');
    const item = provider.getTreeItem(pyodide);
    expect(item.description).toBe('pyodide flag off');
    expect(item.contextValue).toBe('axis.plugins.engine.builtin');
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate',
      arguments: [{ kind: 'engine', id: 'pyodide' }],
    });
  });

  test('pyodide flag on drops flag-off text; active marker prefixes description', () => {
    g().__axisAllowPyodide = true;
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new engine.EnginePluginsTreeProvider(reg, deps('pyodide'));
    const pyodide = provider
      .getChildren()
      .find((n) => n.pluginId === 'pyodide');
    if (!pyodide) throw new Error('expected pyodide');
    const item = provider.getTreeItem(pyodide);
    expect(item.description).toBe('● pyodide');
    expect(String(item.description).includes('flag off')).toBe(false);
    expect(item.contextValue.endsWith('.active')).toBe(true);
  });

  test('dynamic row gets (dynamic) description and contextValue', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    reg.register({
      id: 'custom-engine',
      name: 'Custom',
      kind: 'engine',
      builtIn: false,
    });
    const provider = new engine.EnginePluginsTreeProvider(reg, deps());
    const row = provider
      .getChildren()
      .find((n) => n.pluginId === 'custom-engine');
    if (!row) throw new Error('expected custom-engine');
    const item = provider.getTreeItem(row);
    expect(item.label).toBe('Custom');
    expect(item.description).toBe('custom-engine (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.engine.dynamic');
    expect(item.tooltip).toBe('Pine runtime');
  });

  test('register createTreeView id and ensureBuiltins', () => {
    const reg = new HostPluginRegistry();
    const ctx = fakeContext();
    const provider = engine.registerEnginePluginsView(
      ctx as never,
      reg,
      deps(),
    );
    const captured = g().__axisPluginKindTreeViews;
    expect(captured).toBeTruthy();
    if (!captured) throw new Error('expected captures');
    expect(captured.some((v) => v.id === 'axis.plugins.engine')).toBe(true);
    const match = captured.find((v) => v.id === 'axis.plugins.engine');
    expect(match).toBeTruthy();
    if (!match) throw new Error('expected engine tree view');
    expect(match.showCollapseAll).toBe(false);
    expect(ctx.subscriptions.length).toBe(1);
    expect(reg.listBuiltinIds('engine')).toEqual([...BUILTIN_ENGINE_IDS]);
    expect(provider.getChildren().length).toBe(BUILTIN_ENGINE_IDS.length);
  });

  test('getChildren never throws on hostile registry', () => {
    const hostile = {
      list() {
        throw new Error('list');
      },
      has() {
        throw new Error('has');
      },
      register() {
        throw new Error('register');
      },
    } as unknown as RegistryType;
    expect(() => {
      const provider = new engine.EnginePluginsTreeProvider(hostile, deps());
      expect(provider.getChildren()).toEqual([]);
      expect(engine.engineRootChildren(hostile)).toEqual([]);
    }).not.toThrow();
    const ctx = fakeContext();
    expect(() => {
      engine.registerEnginePluginsView(ctx as never, hostile, deps());
    }).not.toThrow();
  });

  test('skips invalid list rows and non-array list', () => {
    const partial = {
      has: () => true,
      register() {},
      list: () =>
        [
          null,
          { id: '' },
          { id: '  ' },
          { id: 'ok', name: '  ' },
          { id: 'd', name: 'D', description: 7, builtIn: false },
        ] as never,
    } as unknown as RegistryType;
    const rows = engine.engineRootChildren(partial);
    expect(rows.map((n) => n.pluginId)).toEqual(['ok', 'd']);
    const ok = rows[0];
    const dyn = rows[1];
    if (!ok || !dyn) throw new Error('expected rows');
    expect(ok.name).toBe('ok');
    expect(dyn.pluginDescription).toBe('7');
    const emptyList = {
      has: () => true,
      register() {},
      list: () => ({}) as never,
    } as unknown as RegistryType;
    expect(engine.engineRootChildren(emptyList)).toEqual([]);
  });

  test('isActive throw and allowPyodide config throw are never-throw', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new engine.EnginePluginsTreeProvider(reg, {
      isActive: () => {
        throw new Error('active');
      },
      onActivate: () => {
        throw new Error('act');
      },
    });
    const server = provider.getChildren()[0];
    if (!server) throw new Error('expected server');
    expect(() => provider.getTreeItem(server)).not.toThrow();
    expect(provider.getTreeItem(server).description).toBe('server');
    expect(() => provider.activate('pyne-worker')).not.toThrow();

    g().__axisEngineCfgThrow = true;
    expect(engine.readAllowPyodide()).toBe(false);
    g().__axisEngineCfgThrow = false;
    g().__axisAllowPyodide = true;
    expect(engine.readAllowPyodide()).toBe(true);
    g().__axisAllowPyodide = undefined;
    expect(engine.readAllowPyodide()).toBe(false);
  });

  test('activate refreshes EventEmitter for sync/async/reject', async () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    let current = 'server';
    const provider = new engine.EnginePluginsTreeProvider(reg, {
      isActive: (_k, id) => id === current,
      onActivate: (_k, id) => {
        current = id;
      },
    });
    let fires = 0;
    const sub = provider.onDidChangeTreeData(() => {
      fires += 1;
    });
    provider.refresh();
    expect(fires).toBe(1);
    provider.activate('pyne-worker');
    expect(current).toBe('pyne-worker');
    const pyne = provider
      .getChildren()
      .find((n) => n.pluginId === 'pyne-worker');
    if (!pyne) throw new Error('expected pyne-worker');
    expect(provider.getTreeItem(pyne).description).toBe('● pyne-worker');
    if (sub && typeof sub.dispose === 'function') sub.dispose();
    const after = fires;
    provider.refresh();
    expect(fires).toBe(after);

    const asyncProv = new engine.EnginePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: async () => {},
    });
    await Promise.resolve(asyncProv.activate('server'));

    const rejectProv = new engine.EnginePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: () => Promise.reject(new Error('nope')),
    });
    await Promise.resolve(rejectProv.activate('server'));

    const primitiveProv = new engine.EnginePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: () => 1 as unknown as undefined,
    });
    primitiveProv.activate('server');
  });
});
