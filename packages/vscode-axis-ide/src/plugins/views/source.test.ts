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

import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
} from '../registry';
import { BUILTIN_SOURCE_IDS } from '../builtins';
import type { PluginKind } from '../types';

const treeViews: Array<{
  id: string;
  showCollapseAll?: boolean;
}> = [];

class DefaultTreeItem {
  label: string;
  collapsibleState: number;
  id?: string;
  description?: string;
  contextValue?: string;
  tooltip?: string;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
  constructor(label: string, collapsibleState = 0) {
    if (label === '__boom__') throw new Error('TreeItem boom');
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class DefaultEventEmitter {
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

class DefaultUri {
  fsPath: string;
  constructor(fsPath: string) {
    this.fsPath = fsPath;
  }
  static file(p: string) {
    return new DefaultUri(p);
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
    return new DefaultUri([root, ...parts].filter(Boolean).join('/'));
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

const vscodeApi = {
  TreeItem: DefaultTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: DefaultEventEmitter,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ColorThemeKind,
  Uri: DefaultUri,
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  window: {
    activeColorTheme: { kind: ColorThemeKind.Dark },
    createTreeView: (id: string, opts?: { showCollapseAll?: boolean }) => {
      treeViews.push({
        id,
        showCollapseAll: opts ? opts.showCollapseAll : undefined,
      });
      const bucket = (globalThis as { __axisPluginKindTreeViews?: Array<{ id: string }> })
        .__axisPluginKindTreeViews;
      if (bucket) bucket.push({ id, showCollapseAll: opts?.showCollapseAll });
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
      const gg = globalThis as {
        __axisEngineCfgThrow?: boolean;
        __axisAllowPyodide?: unknown;
        __axisLiveEnabled?: unknown;
        __axisAllowUrlInstall?: unknown;
      };
      if (gg.__axisEngineCfgThrow === true) throw new Error('cfg');
      return {
        get(key: string, def?: unknown) {
          if (section === 'axis.engine' && key === 'allowPyodide') {
            return gg.__axisAllowPyodide;
          }
          if (section === 'axis.live' && key === 'enabled') return gg.__axisLiveEnabled;
          if (section === 'axis.plugins' && key === 'allowUrlInstall') {
            return gg.__axisAllowUrlInstall;
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

mock.module('vscode', () => ({
  QuickPickItemKind: { Separator: -1, Default: 0 },
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  get TreeItem() {
    return vscodeApi.TreeItem;
  },
  get TreeItemCollapsibleState() {
    return vscodeApi.TreeItemCollapsibleState;
  },
  get EventEmitter() {
    return vscodeApi.EventEmitter;
  },
  get StatusBarAlignment() {
    return vscodeApi.StatusBarAlignment;
  },
  get ColorThemeKind() {
    return vscodeApi.ColorThemeKind;
  },
  get Uri() {
    return vscodeApi.Uri;
  },
  get window() {
    return vscodeApi.window;
  },
  get commands() {
    return vscodeApi.commands;
  },
  get workspace() {
    return vscodeApi.workspace;
  },
  get lm() {
    return vscodeApi.lm;
  },
}));

type SourceMod = typeof import('./source');
let source: SourceMod;

beforeAll(async () => {
  source = await import('./source');
});

afterEach(() => {
  _resetHostPluginRegistryForTests();
  treeViews.length = 0;
});

function stubDeps(activeId?: string): SourceMod['KindViewDeps'] & {
  activations: Array<{ kind: PluginKind; id: string }>;
} {
  const activations: Array<{ kind: PluginKind; id: string }> = [];
  let current = activeId;
  return {
    activations,
    isActive(_kind: PluginKind, id: string) {
      return current !== undefined && id === current;
    },
    onActivate(kind: PluginKind, id: string) {
      activations.push({ kind, id });
      current = id;
    },
  };
}

function fakeContext(): {
  subscriptions: Array<{ dispose(): void }>;
} {
  return { subscriptions: [] };
}

describe('axis.plugins.source TreeView', () => {
  test('view id is axis.plugins.source', () => {
    expect(source.SOURCE_PLUGINS_VIEW_ID).toBe('axis.plugins.source');
  });

  test('lists builtin source ids from the registry', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new source.SourcePluginsTreeProvider(reg, stubDeps());
    const children = provider.getChildren();
    const ids = children.map((n) => n.pluginId);
    expect(ids).toEqual([...BUILTIN_SOURCE_IDS]);
    expect(ids).toContain('binance-rest');
    expect(ids).not.toContain('binance-ws');
    const first = children[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected source child');
    expect(provider.getChildren(first)).toEqual([]);
  });

  test('active builtin gets .active contextValue and ● description', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new source.SourcePluginsTreeProvider(
      reg,
      stubDeps('binance-rest'),
    );
    const rows = provider.getChildren();
    const binance = rows.find((n) => n.pluginId === 'binance-rest');
    const okx = rows.find((n) => n.pluginId === 'okx-rest');
    expect(binance).toBeDefined();
    expect(okx).toBeDefined();
    if (!binance || !okx) throw new Error('expected builtins');
    const activeItem = provider.getTreeItem(binance);
    expect(activeItem.label).toBe('Binance REST');
    expect(activeItem.description).toBe('● binance-rest');
    expect(activeItem.contextValue).toBe('axis.plugins.source.builtin.active');
    expect(activeItem.tooltip).toBe('Historical OHLCV');
    expect(activeItem.collapsibleState).toBe(0);
    const cmd = activeItem.command;
    expect(cmd).toBeDefined();
    if (!cmd) throw new Error('expected command');
    expect(cmd.command).toBe('axis.plugins.activate');
    expect(cmd.arguments).toEqual([{ kind: 'source', id: 'binance-rest' }]);
    const idle = provider.getTreeItem(okx);
    expect(idle.contextValue).toBe('axis.plugins.source.builtin');
    expect(idle.description).toBe('okx-rest');
  });

  test('dynamic plugins are labeled (dynamic) and keep description tooltip', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    reg.register({
      id: 'coingecko',
      name: 'CoinGecko',
      kind: 'source',
      builtIn: false,
      description: 'Demo OHLCV',
    });
    const provider = new source.SourcePluginsTreeProvider(
      reg,
      stubDeps('coingecko'),
    );
    const node = provider.getChildren().find((n) => n.pluginId === 'coingecko');
    expect(node).toBeDefined();
    if (!node) throw new Error('expected dynamic source');
    expect(node.builtIn).toBe(false);
    const item = provider.getTreeItem(node);
    expect(item.label).toBe('CoinGecko');
    expect(item.description).toBe('● coingecko (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.source.dynamic.active');
    expect(item.tooltip).toBe('Historical OHLCV\nDemo OHLCV');
    const idle = new source.SourcePluginsTreeProvider(reg, stubDeps());
    const idleNode = idle.getChildren().find((n) => n.pluginId === 'coingecko');
    expect(idleNode).toBeDefined();
    if (!idleNode) throw new Error('expected idle dynamic');
    const idleItem = idle.getTreeItem(idleNode);
    expect(idleItem.contextValue).toBe('axis.plugins.source.dynamic');
    expect(idleItem.description).toBe('coingecko (dynamic)');
  });

  test('registerSourcePluginsView creates the tree view and pushes it', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const ctx = fakeContext();
    const deps = stubDeps('binance-rest');
    const provider = source.registerSourcePluginsView(
      ctx as never,
      reg,
      deps,
    );
    expect(treeViews.some((v) => v.id === 'axis.plugins.source')).toBe(true);
    const created = treeViews.find((v) => v.id === 'axis.plugins.source');
    expect(created).toBeDefined();
    if (!created) throw new Error('expected createTreeView');
    expect(created.showCollapseAll).toBe(false);
    expect(ctx.subscriptions.length).toBe(1);
    expect(provider.getChildren().length).toBe(BUILTIN_SOURCE_IDS.length);
    deps.onActivate('source', 'okx-rest');
    expect(deps.activations).toEqual([{ kind: 'source', id: 'okx-rest' }]);
    const extra = { called: false };
    const chained = stubDeps();
    chained.refresh = () => {
      extra.called = true;
    };
    treeViews.length = 0;
    source.registerSourcePluginsView(ctx as never, reg, chained);
    const refresh = chained.refresh;
    expect(typeof refresh).toBe('function');
    if (typeof refresh !== 'function') throw new Error('expected refresh');
    refresh();
    expect(extra.called).toBe(true);
  });

  test('getChildren is empty-safe', () => {
    const emptyReg = {
      has() {
        return true;
      },
      register() {},
      list() {
        return [];
      },
    } as unknown as HostPluginRegistry;
    const provider = new source.SourcePluginsTreeProvider(
      emptyReg,
      stubDeps(),
    );
    expect(provider.getChildren()).toEqual([]);
    expect(
      provider.getChildren({
        id: 'x',
        label: 'x',
        pluginId: 'x',
        builtIn: true,
      }),
    ).toEqual([]);

    const throwing = {
      list() {
        throw new Error('list boom');
      },
      has() {
        return true;
      },
      register() {},
    } as unknown as HostPluginRegistry;
    const empty = new source.SourcePluginsTreeProvider(throwing, stubDeps());
    expect(empty.getChildren()).toEqual([]);

    const messy = {
      has() {
        return true;
      },
      register() {},
      list() {
        return [
          null,
          { id: '', name: 'Empty', kind: 'source' },
          { id: 'ok', name: '  ', kind: 'source', builtIn: true },
          {
            id: 'dyn',
            name: 'Dyn',
            kind: 'source',
            builtIn: false,
            description: '  ',
          },
          {
            id: 'full',
            name: 'Full',
            kind: 'source',
            builtIn: false,
            description: 'Nice',
          },
        ];
      },
    } as unknown as HostPluginRegistry;
    const messyProvider = new source.SourcePluginsTreeProvider(
      messy,
      stubDeps(),
    );
    const rows = messyProvider.getChildren();
    expect(rows.map((n) => n.pluginId)).toEqual(['ok', 'dyn', 'full']);
    const ok = rows[0];
    expect(ok).toBeDefined();
    if (!ok) throw new Error('expected ok');
    expect(ok.label).toBe('ok');
    const full = rows[2];
    expect(full).toBeDefined();
    if (!full) throw new Error('expected full');
    expect(full.pluginDescription).toBe('Nice');
    expect(messyProvider.getTreeItem(full).tooltip).toBe(
      'Historical OHLCV\nNice',
    );

    const notArray = {
      has() {
        return true;
      },
      register() {},
      list() {
        return undefined;
      },
    } as unknown as HostPluginRegistry;
    expect(
      new source.SourcePluginsTreeProvider(notArray, stubDeps()).getChildren(),
    ).toEqual([]);
  });

  test('never-throw around hostile deps, vscode fallbacks, and register failures', () => {
    const origCreate = vscodeApi.window.createTreeView;
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const hostile: SourceMod['KindViewDeps'] = {
      isActive() {
        throw new Error('isActive boom');
      },
      onActivate() {
        throw new Error('onActivate boom');
      },
      refresh() {
        throw new Error('refresh boom');
      },
    };
    const provider = new source.SourcePluginsTreeProvider(reg, hostile);
    const first = provider.getChildren()[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected child');
    const item = provider.getTreeItem(first);
    expect(item.contextValue).toBe('axis.plugins.source.builtin');
    expect(() => provider.refresh()).not.toThrow();

    const malformed = provider.getTreeItem({
      id: undefined as unknown as string,
      label: undefined as unknown as string,
      pluginId: undefined as unknown as string,
      builtIn: false,
    });
    expect(malformed.command).toBeDefined();
    if (!malformed.command) throw new Error('expected command');
    expect(malformed.command.title).toBe('Activate');
    expect(malformed.command.arguments).toEqual([{ kind: 'source', id: '' }]);

    const boomItem = provider.getTreeItem({
      id: 'boom',
      label: '__boom__',
      pluginId: 'boom',
      builtIn: true,
    });
    expect(boomItem.label).toBe('__boom__');
    expect(boomItem.collapsibleState).toBe(0);

    {
      const fallbackProvider = new source.SourcePluginsTreeProvider(
        reg,
        stubDeps(),
      );
      let saw = 0;
      const sub = fallbackProvider.onDidChangeTreeData(() => {
        saw += 1;
        throw new Error('listener boom');
      });
      expect(() => fallbackProvider.refresh()).not.toThrow();
      expect(saw).toBe(1);
      sub.dispose();
      expect(() => fallbackProvider.refresh()).not.toThrow();
      expect(saw).toBe(1);
    }

    const hostileNode = new Proxy(
      {},
      {
        get() {
          throw new Error('getter boom');
        },
      },
    ) as source.SourcePluginTreeNode;
    const recovered = provider.getTreeItem(hostileNode);
    expect(recovered.label).toBe('');

    const ctorBoom = {
      has() {
        throw new Error('has boom');
      },
      register() {
        throw new Error('register boom');
      },
      list() {
        return [];
      },
    } as unknown as HostPluginRegistry;
    expect(() => new source.SourcePluginsTreeProvider(ctorBoom, stubDeps())).not.toThrow();

    vscodeApi.window.createTreeView = () => {
      throw new Error('create boom');
    };
    try {
      const p = source.registerSourcePluginsView(
        { subscriptions: [] } as never,
        reg,
        stubDeps(),
      );
      expect(p).toBeInstanceOf(source.SourcePluginsTreeProvider);
    } finally {
      vscodeApi.window.createTreeView = origCreate;
    }

    const noPush = {
      subscriptions: {
        push() {
          throw new Error('push boom');
        },
      },
    };
    expect(() =>
      source.registerSourcePluginsView(noPush as never, reg, stubDeps()),
    ).not.toThrow();

    const noSubs = {} as never;
    expect(() =>
      source.registerSourcePluginsView(noSubs, reg, stubDeps()),
    ).not.toThrow();

    const wrapped = stubDeps();
    wrapped.onActivate = () => {
      throw new Error('activate boom');
    };
    wrapped.refresh = () => {
      throw new Error('prior refresh boom');
    };
    source.registerSourcePluginsView(
      fakeContext() as never,
      reg,
      wrapped,
    );
    expect(() => wrapped.onActivate('source', 'okx-rest')).not.toThrow();
    const refresh = wrapped.refresh;
    if (typeof refresh !== 'function') throw new Error('expected refresh');
    expect(() => refresh()).not.toThrow();
  });

  test('contributes fragment documents source and stream views', () => {
    const fragPath = join(
      import.meta.dir,
      'source-stream-contributes.fragment.json',
    );
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      activationEvents: string[];
      contributes: { views: { axis: Array<{ id: string; name: string }> } };
    };
    expect(frag.activationEvents).toContain('onView:axis.plugins.source');
    expect(frag.activationEvents).toContain('onView:axis.plugins.stream');
    const ids = frag.contributes.views.axis.map((v) => v.id);
    expect(ids).toEqual(['axis.plugins.source', 'axis.plugins.stream']);
  });
});
