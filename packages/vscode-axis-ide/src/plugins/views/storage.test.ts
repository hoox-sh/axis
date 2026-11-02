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
import { BUILTIN_STORAGE_IDS } from '../builtins';
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
  class LanguageModelTextPart {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  }
  class LanguageModelToolResult {
    content: unknown[];
    constructor(content: unknown[]) {
      this.content = content;
    }
  }
  class MarkdownString {
    value: string;
    constructor(value = '') {
      this.value = value;
    }
  }
  class McpStdioServerDefinition {
    label: string;
    command: string;
    args: string[];
    env: Record<string, string | number | null>;
    constructor(
      label: string,
      command: string,
      args: string[] = [],
      env: Record<string, string | number | null> = {},
    ) {
      this.label = label;
      this.command = command;
      this.args = args;
      this.env = env;
    }
  }
  class Uri {
    fsPath: string;
    constructor(fsPath: string) {
      this.fsPath = fsPath;
    }
    static file(p: string) {
      return new Uri(p);
    }
    static joinPath(base: { fsPath?: string }, ...parts: string[]) {
      const root = base?.fsPath ?? '';
      if (root === '/throw-fs') {
        return {
          get fsPath(): string {
            throw new Error('fsPath');
          },
        };
      }
      return new Uri([root, ...parts].filter(Boolean).join('/'));
    }
    toString() {
      return `file://${this.fsPath}`;
    }
  }
  const ColorThemeKind = {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  };
  return {
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ColorThemeKind,
    Uri,
    LanguageModelTextPart,
    LanguageModelToolResult,
    MarkdownString,
    McpStdioServerDefinition,
    window: {
      activeColorTheme: { kind: ColorThemeKind.Dark },
      createTreeView(id: string, options?: { showCollapseAll?: boolean }) {
        const bucket = g().__axisPluginKindTreeViews;
        if (bucket) {
          bucket.push({ id, showCollapseAll: options?.showCollapseAll });
        }
        return { dispose() {} };
      },
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showWarningMessage: () => undefined,
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        show() {},
        dispose() {},
      }),
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration(section?: string) {
        if (g().__axisEngineCfgThrow === true) {
          throw new Error('cfg');
        }
        return {
          get(key: string, def?: unknown) {
            if (section === 'axis.engine' && key === 'allowPyodide') {
              return g().__axisAllowPyodide;
            }
            if (section === 'axis.live' && key === 'enabled') {
              return (globalThis as { __axisLiveEnabled?: unknown }).__axisLiveEnabled;
            }
            if (section === 'axis.plugins' && key === 'allowUrlInstall') {
              return (globalThis as { __axisAllowUrlInstall?: unknown }).__axisAllowUrlInstall;
            }
            return def;
          },
        };
      },
    },
    lm: {
      registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
      registerTool: () => ({ dispose() {} }),
    },
  };
});

type StorageMod = typeof import('./storage');
let storage: StorageMod;

beforeAll(async () => {
  storage = await import('./storage');
});

beforeEach(() => {
  g().__axisPluginKindTreeViews = [];
  g().__axisAllowPyodide = false;
  g().__axisEngineCfgThrow = false;
});

afterEach(() => {
  _resetHostPluginRegistryForTests();
});

function deps(activeId = 'local'): storage.KindViewDeps {
  let current = activeId;
  return {
    isActive: (kind, id) => kind === 'storage' && id === current,
    onActivate: (_kind, id) => {
      current = id;
    },
  };
}

function fakeContext(): { subscriptions: Array<{ dispose(): void }> } {
  return { subscriptions: [] };
}

describe('storage plugins TreeView', () => {
  test('view id and activate command constants', () => {
    expect(storage.STORAGE_PLUGINS_VIEW_ID).toBe('axis.plugins.storage');
    expect(storage.PLUGIN_KIND_VIEW_IDS.storage).toBe('axis.plugins.storage');
    expect(storage.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
  });

  test('lists builtin storage ids from registry', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new storage.StoragePluginsTreeProvider(reg, deps());
    const rows = provider.getChildren();
    expect(rows.map((n) => n.pluginId)).toEqual([...BUILTIN_STORAGE_IDS]);
    expect(reg.listBuiltinIds('storage')).toEqual([...BUILTIN_STORAGE_IDS]);
    const local = rows[0];
    expect(local).toBeTruthy();
    if (!local) throw new Error('expected local');
    const item = provider.getTreeItem(local);
    expect(item.label).toBe('Local');
    expect(item.description).toBe('● local');
    expect(item.contextValue).toBe('axis.plugins.storage.active');
    expect(String(item.tooltip).startsWith('Script library backend')).toBe(
      true,
    );
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate',
      arguments: [{ kind: 'storage', id: 'local' }],
    });
    expect(provider.getChildren(local)).toEqual([]);
  });

  test('inactive builtin contextValue and cloud/git rows', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new storage.StoragePluginsTreeProvider(reg, deps('local'));
    const cloud = provider.getChildren().find((n) => n.pluginId === 'cloud');
    if (!cloud) throw new Error('expected cloud');
    const item = provider.getTreeItem(cloud);
    expect(item.label).toBe('Cloud (Worker scripts)');
    expect(item.description).toBe('cloud');
    expect(item.contextValue).toBe('axis.plugins.storage.builtin');
    expect(item.command).toEqual({
      command: 'axis.plugins.activate',
      title: 'Activate',
      arguments: [{ kind: 'storage', id: 'cloud' }],
    });
  });

  test('active marker prefixes description; dynamic suffix', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    reg.register({
      id: 's3',
      name: 'S3',
      kind: 'storage',
      builtIn: false,
      description: 'Remote bucket',
    });
    const provider = new storage.StoragePluginsTreeProvider(reg, deps('s3'));
    const row = provider.getChildren().find((n) => n.pluginId === 's3');
    if (!row) throw new Error('expected s3');
    const item = provider.getTreeItem(row);
    expect(item.description).toBe('● s3 (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.storage.active');
    expect(item.contextValue.endsWith('.active')).toBe(true);
    expect(String(item.tooltip)).toContain('Script library backend');
    expect(String(item.tooltip)).toContain('Remote bucket');
  });

  test('register createTreeView id and ensureBuiltins', () => {
    const reg = new HostPluginRegistry();
    const ctx = fakeContext();
    const provider = storage.registerStoragePluginsView(
      ctx as never,
      reg,
      deps(),
    );
    const captured = g().__axisPluginKindTreeViews;
    expect(captured).toBeTruthy();
    if (!captured) throw new Error('expected captures');
    expect(captured.some((v) => v.id === 'axis.plugins.storage')).toBe(true);
    const match = captured.find((v) => v.id === 'axis.plugins.storage');
    expect(match).toBeTruthy();
    if (!match) throw new Error('expected storage tree view');
    expect(match.showCollapseAll).toBe(false);
    expect(ctx.subscriptions.length).toBe(1);
    expect(reg.listBuiltinIds('storage')).toEqual([...BUILTIN_STORAGE_IDS]);
    expect(provider.getChildren().length).toBe(BUILTIN_STORAGE_IDS.length);
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
      const provider = new storage.StoragePluginsTreeProvider(hostile, deps());
      expect(provider.getChildren()).toEqual([]);
      expect(storage.storageRootChildren(hostile)).toEqual([]);
    }).not.toThrow();
    const ctx = fakeContext();
    expect(() => {
      storage.registerStoragePluginsView(ctx as never, hostile, deps());
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
          { id: 'ok', name: '  ' },
          { id: 'd', name: 'D', description: 7, builtIn: false },
        ] as never,
    } as unknown as RegistryType;
    const rows = storage.storageRootChildren(partial);
    expect(rows.map((n) => n.pluginId)).toEqual(['ok', 'd']);
    const emptyList = {
      has: () => true,
      register() {},
      list: () => ({}) as never,
    } as unknown as RegistryType;
    expect(storage.storageRootChildren(emptyList)).toEqual([]);
  });

  test('isActive throw is never-throw; activate is persist-id only', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new storage.StoragePluginsTreeProvider(reg, {
      isActive: () => {
        throw new Error('active');
      },
      onActivate: () => {
        throw new Error('act');
      },
    });
    const local = provider.getChildren()[0];
    if (!local) throw new Error('expected local');
    expect(() => provider.getTreeItem(local)).not.toThrow();
    expect(provider.getTreeItem(local).description).toBe('local');
    expect(() => provider.activate('git')).not.toThrow();
  });

  test('activate refreshes EventEmitter for sync/async/reject', async () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    let current = 'local';
    const provider = new storage.StoragePluginsTreeProvider(reg, {
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
    provider.activate('git');
    expect(current).toBe('git');
    const git = provider.getChildren().find((n) => n.pluginId === 'git');
    if (!git) throw new Error('expected git');
    expect(provider.getTreeItem(git).description).toBe('● git');
    if (sub && typeof sub.dispose === 'function') sub.dispose();
    const after = fires;
    provider.refresh();
    expect(fires).toBe(after);

    const asyncProv = new storage.StoragePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: async () => {},
    });
    await Promise.resolve(asyncProv.activate('local'));

    const rejectProv = new storage.StoragePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: () => Promise.reject(new Error('nope')),
    });
    await Promise.resolve(rejectProv.activate('cloud'));

    const primitiveProv = new storage.StoragePluginsTreeProvider(reg, {
      isActive: () => false,
      onActivate: () => 1 as unknown as undefined,
    });
    primitiveProv.activate('local');
  });
});
