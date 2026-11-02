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
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
} from '../registry';
import { BUILTIN_STREAM_IDS } from '../builtins';
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

const vscodeApi: {
  TreeItem: unknown;
  TreeItemCollapsibleState: unknown;
  EventEmitter: unknown;
  window: {
    createTreeView: (
      id: string,
      opts?: { showCollapseAll?: boolean },
    ) => { dispose(): void };
  };
  commands: { registerCommand: () => { dispose(): void } };
} = {
  TreeItem: DefaultTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: DefaultEventEmitter,
  window: {
    createTreeView: (id: string, opts?: { showCollapseAll?: boolean }) => {
      treeViews.push({
        id,
        showCollapseAll: opts ? opts.showCollapseAll : undefined,
      });
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
  },
};

mock.module('vscode', () => ({
  get TreeItem() {
    return vscodeApi.TreeItem;
  },
  get TreeItemCollapsibleState() {
    return vscodeApi.TreeItemCollapsibleState;
  },
  get EventEmitter() {
    return vscodeApi.EventEmitter;
  },
  get window() {
    return vscodeApi.window;
  },
  get commands() {
    return vscodeApi.commands;
  },
}));

type StreamMod = typeof import('./stream');
let stream: StreamMod;

beforeAll(async () => {
  stream = await import('./stream');
});

afterEach(() => {
  _resetHostPluginRegistryForTests();
  treeViews.length = 0;
});

function stubDeps(activeId?: string): StreamMod['KindViewDeps'] & {
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

describe('axis.plugins.stream TreeView', () => {
  test('view id is axis.plugins.stream', () => {
    expect(stream.STREAM_PLUGINS_VIEW_ID).toBe('axis.plugins.stream');
  });

  test('lists builtin stream ids from the registry', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new stream.StreamPluginsTreeProvider(reg, stubDeps());
    const children = provider.getChildren();
    const ids = children.map((n) => n.pluginId);
    expect(ids).toEqual([...BUILTIN_STREAM_IDS]);
    expect(ids).toContain('binance-ws');
    expect(ids).not.toContain('binance-rest');
    const first = children[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected stream child');
    expect(provider.getChildren(first)).toEqual([]);
  });

  test('active builtin gets .active contextValue and ● description', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const provider = new stream.StreamPluginsTreeProvider(
      reg,
      stubDeps('binance-ws'),
    );
    const rows = provider.getChildren();
    const binance = rows.find((n) => n.pluginId === 'binance-ws');
    const okx = rows.find((n) => n.pluginId === 'okx-ws');
    expect(binance).toBeDefined();
    expect(okx).toBeDefined();
    if (!binance || !okx) throw new Error('expected builtins');
    const activeItem = provider.getTreeItem(binance);
    expect(activeItem.label).toBe('Binance WS');
    expect(activeItem.description).toBe('● binance-ws');
    expect(activeItem.contextValue).toBe('axis.plugins.stream.builtin.active');
    expect(activeItem.tooltip).toBe('Live bars');
    expect(activeItem.collapsibleState).toBe(0);
    const cmd = activeItem.command;
    expect(cmd).toBeDefined();
    if (!cmd) throw new Error('expected command');
    expect(cmd.command).toBe('axis.plugins.activate');
    expect(cmd.arguments).toEqual([{ kind: 'stream', id: 'binance-ws' }]);
    const idle = provider.getTreeItem(okx);
    expect(idle.contextValue).toBe('axis.plugins.stream.builtin');
    expect(idle.description).toBe('okx-ws');
  });

  test('dynamic plugins are labeled (dynamic) and keep description tooltip', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    reg.register({
      id: 'cf-do',
      name: 'CF Durable Object',
      kind: 'stream',
      builtIn: false,
      description: 'Demo multiplex',
    });
    const provider = new stream.StreamPluginsTreeProvider(
      reg,
      stubDeps('cf-do'),
    );
    const node = provider.getChildren().find((n) => n.pluginId === 'cf-do');
    expect(node).toBeDefined();
    if (!node) throw new Error('expected dynamic stream');
    expect(node.builtIn).toBe(false);
    const item = provider.getTreeItem(node);
    expect(item.label).toBe('CF Durable Object');
    expect(item.description).toBe('● cf-do (dynamic)');
    expect(item.contextValue).toBe('axis.plugins.stream.dynamic.active');
    expect(item.tooltip).toBe('Live bars\nDemo multiplex');
    const idle = new stream.StreamPluginsTreeProvider(reg, stubDeps());
    const idleNode = idle.getChildren().find((n) => n.pluginId === 'cf-do');
    expect(idleNode).toBeDefined();
    if (!idleNode) throw new Error('expected idle dynamic');
    const idleItem = idle.getTreeItem(idleNode);
    expect(idleItem.contextValue).toBe('axis.plugins.stream.dynamic');
    expect(idleItem.description).toBe('cf-do (dynamic)');
  });

  test('registerStreamPluginsView creates the tree view and pushes it', () => {
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const ctx = fakeContext();
    const deps = stubDeps('binance-ws');
    const provider = stream.registerStreamPluginsView(
      ctx as never,
      reg,
      deps,
    );
    expect(treeViews.some((v) => v.id === 'axis.plugins.stream')).toBe(true);
    const created = treeViews.find((v) => v.id === 'axis.plugins.stream');
    expect(created).toBeDefined();
    if (!created) throw new Error('expected createTreeView');
    expect(created.showCollapseAll).toBe(false);
    expect(ctx.subscriptions.length).toBe(1);
    expect(provider.getChildren().length).toBe(BUILTIN_STREAM_IDS.length);
    deps.onActivate('stream', 'okx-ws');
    expect(deps.activations).toEqual([{ kind: 'stream', id: 'okx-ws' }]);
    const extra = { called: false };
    const chained = stubDeps();
    chained.refresh = () => {
      extra.called = true;
    };
    treeViews.length = 0;
    stream.registerStreamPluginsView(ctx as never, reg, chained);
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
    const provider = new stream.StreamPluginsTreeProvider(
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
    const empty = new stream.StreamPluginsTreeProvider(throwing, stubDeps());
    expect(empty.getChildren()).toEqual([]);

    const messy = {
      has() {
        return true;
      },
      register() {},
      list() {
        return [
          null,
          { id: '', name: 'Empty', kind: 'stream' },
          { id: 'ok', name: '  ', kind: 'stream', builtIn: true },
          {
            id: 'dyn',
            name: 'Dyn',
            kind: 'stream',
            builtIn: false,
            description: '  ',
          },
          {
            id: 'full',
            name: 'Full',
            kind: 'stream',
            builtIn: false,
            description: 'Nice',
          },
        ];
      },
    } as unknown as HostPluginRegistry;
    const messyProvider = new stream.StreamPluginsTreeProvider(
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
    expect(messyProvider.getTreeItem(full).tooltip).toBe('Live bars\nNice');

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
      new stream.StreamPluginsTreeProvider(notArray, stubDeps()).getChildren(),
    ).toEqual([]);
  });

  test('never-throw around hostile deps, vscode fallbacks, and register failures', () => {
    const origCreate = vscodeApi.window.createTreeView;
    const reg = ensureBuiltinsRegistered(new HostPluginRegistry());
    const hostile: StreamMod['KindViewDeps'] = {
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
    const provider = new stream.StreamPluginsTreeProvider(reg, hostile);
    const first = provider.getChildren()[0];
    expect(first).toBeDefined();
    if (!first) throw new Error('expected child');
    const item = provider.getTreeItem(first);
    expect(item.contextValue).toBe('axis.plugins.stream.builtin');
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
    expect(malformed.command.arguments).toEqual([{ kind: 'stream', id: '' }]);

    const boomItem = provider.getTreeItem({
      id: 'boom',
      label: '__boom__',
      pluginId: 'boom',
      builtIn: true,
    });
    expect(boomItem.label).toBe('__boom__');
    expect(boomItem.collapsibleState).toBe(0);

    {
      const fallbackProvider = new stream.StreamPluginsTreeProvider(
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
    ) as stream.StreamPluginTreeNode;
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
    expect(() => new stream.StreamPluginsTreeProvider(ctorBoom, stubDeps())).not.toThrow();

    vscodeApi.window.createTreeView = () => {
      throw new Error('create boom');
    };
    try {
      const p = stream.registerStreamPluginsView(
        { subscriptions: [] } as never,
        reg,
        stubDeps(),
      );
      expect(p).toBeInstanceOf(stream.StreamPluginsTreeProvider);
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
      stream.registerStreamPluginsView(noPush as never, reg, stubDeps()),
    ).not.toThrow();

    const noSubs = {} as never;
    expect(() =>
      stream.registerStreamPluginsView(noSubs, reg, stubDeps()),
    ).not.toThrow();

    const wrapped = stubDeps();
    wrapped.onActivate = () => {
      throw new Error('activate boom');
    };
    wrapped.refresh = () => {
      throw new Error('prior refresh boom');
    };
    stream.registerStreamPluginsView(
      fakeContext() as never,
      reg,
      wrapped,
    );
    expect(() => wrapped.onActivate('stream', 'okx-ws')).not.toThrow();
    const refresh = wrapped.refresh;
    if (typeof refresh !== 'function') throw new Error('expected refresh');
    expect(() => refresh()).not.toThrow();
  });
});
