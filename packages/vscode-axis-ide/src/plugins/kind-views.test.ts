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

import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryWorkspaceState, isActivePlugin } from './active';
import { PLUGIN_KIND_VIEW_IDS } from './kind-tree-model';
import { HostPluginRegistry } from './registry';

const VIEW_FILES = [
  'source',
  'stream',
  'engine',
  'storage',
  'dataset',
  'component',
] as const;

function viewModulesExist(): boolean {
  return VIEW_FILES.every((name) =>
    existsSync(join(import.meta.dir, 'views', `${name}.ts`)),
  );
}

const treeViews: Array<{ id: string }> = [];

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

type G = {
  __axisPluginKindTreeViews?: Array<{ id: string; showCollapseAll?: boolean }>;
  __axisAllowPyodide?: unknown;
  __axisEngineCfgThrow?: boolean;
};

function g(): G {
  return globalThis as G;
}

const vscodeApi = {
  TreeItem: DefaultTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: DefaultEventEmitter,
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: {
    createTreeView: (id: string, options?: { showCollapseAll?: boolean }) => {
      treeViews.push({ id });
      const bucket = g().__axisPluginKindTreeViews;
      if (bucket) {
        bucket.push({ id, showCollapseAll: options ? options.showCollapseAll : undefined });
      }
      return { dispose() {} };
    },
    showWarningMessage: (_message: string) => undefined,
    showTextDocument: async () => ({}),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      show() {},
      dispose() {},
    }),
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
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
          return def;
        },
      };
    },
    openTextDocument: async () => ({ getText: () => '' }),
  },
  lm: {
    registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
    registerTool: () => ({ dispose() {} }),
  },
};

mock.module('vscode', () => ({
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

type KindViewsMod = typeof import('./kind-views');

let kindViews: KindViewsMod | undefined;
let loadError: unknown;

beforeAll(async () => {
  try {
    kindViews = await import('./kind-views');
  } catch (err) {
    loadError = err;
  }
});

describe('registerPluginKindViews', () => {
  test('binds active.ts deps and registers six kind views', async () => {
    if (!kindViews) {
      if (!viewModulesExist()) {
        expect(viewModulesExist()).toBe(false);
        return;
      }
      throw loadError instanceof Error
        ? loadError
        : new Error('kind-views failed to load');
    }
    treeViews.length = 0;
    const mem = createMemoryWorkspaceState();
    const registry = new HostPluginRegistry();
    const ctx = { subscriptions: [] as Array<{ dispose(): void }> };
    const refreshAll = kindViews.registerPluginKindViews(
      ctx as never,
      registry,
      mem,
    );
    expect(typeof refreshAll).toBe('function');
    expect(treeViews.map((v) => v.id).sort()).toEqual(
      Object.values(PLUGIN_KIND_VIEW_IDS).slice().sort(),
    );
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(6);
    expect(() => refreshAll()).not.toThrow();

    const deps = kindViews.bindKindViewDeps(mem);
    expect(deps.isActive('source', 'binance-rest')).toBe(true);
    await deps.onActivate('source', 'okx-rest');
    expect(isActivePlugin(mem, 'source', 'okx-rest')).toBe(true);
  });

  test('safeCallKindViewRegistrar swallows registrar throws', async () => {
    if (!kindViews) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('kind-views failed to load');
    }
    expect(() =>
      kindViews.safeCallKindViewRegistrar(
        () => {
          throw new Error('view');
        },
        { subscriptions: [] } as never,
        new HostPluginRegistry(),
        kindViews.bindKindViewDeps(createMemoryWorkspaceState()),
      ),
    ).not.toThrow();
    expect(
      kindViews.safeCallKindViewRegistrar(
        () => {
          throw new Error('view');
        },
        { subscriptions: [] } as never,
        new HostPluginRegistry(),
        kindViews.bindKindViewDeps(createMemoryWorkspaceState()),
      ),
    ).toBeUndefined();
  });

  test('callKindViewRefresh guards missing and throwing refresh', () => {
    if (!kindViews) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('kind-views failed to load');
    }
    expect(() => kindViews.callKindViewRefresh(undefined)).not.toThrow();
    expect(() => kindViews.callKindViewRefresh(null)).not.toThrow();
    expect(() => kindViews.callKindViewRefresh('nope')).not.toThrow();
    expect(() => kindViews.callKindViewRefresh({})).not.toThrow();
    expect(() =>
      kindViews.callKindViewRefresh({
        refresh() {
          throw new Error('refresh');
        },
      }),
    ).not.toThrow();
    let n = 0;
    kindViews.callKindViewRefresh({
      refresh() {
        n += 1;
      },
    });
    expect(n).toBe(1);
  });

  test('refreshAll invokes provider.refresh after register', async () => {
    if (!kindViews) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('kind-views failed to load');
    }
    const source = await import('./views/source');
    let hits = 0;
    const proto = source.SourcePluginsTreeProvider.prototype;
    const orig = proto.refresh;
    proto.refresh = function (this: unknown) {
      hits += 1;
      orig.call(this);
    };
    try {
      const refreshAll = kindViews.registerPluginKindViews(
        { subscriptions: [] } as never,
        new HostPluginRegistry(),
        createMemoryWorkspaceState(),
      );
      hits = 0;
      expect(() => refreshAll()).not.toThrow();
      expect(hits).toBeGreaterThan(0);
    } finally {
      proto.refresh = orig;
    }
  });
});
