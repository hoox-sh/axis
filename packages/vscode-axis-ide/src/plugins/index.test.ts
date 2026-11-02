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
import { createMemoryGlobalState } from './persist';
import {
  HostPluginRegistry,
  getHostPluginRegistry,
} from './registry';
import { PLUGIN_KINDS } from './types';

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

type IndexMod = typeof import('./index');

let idx: IndexMod | undefined;
let loadError: unknown;

beforeAll(async () => {
  try {
    idx = await import('./index');
  } catch (err) {
    loadError = err;
  }
});

describe('plugins index exports', () => {
  test('registry helpers remain exported', async () => {
    if (!idx) {
      if (!viewModulesExist()) {
        expect(typeof getHostPluginRegistry).toBe('function');
        expect(new HostPluginRegistry()).toBeInstanceOf(HostPluginRegistry);
        expect(PLUGIN_KINDS.length).toBe(6);
        expect(createMemoryGlobalState).toBeDefined();
        return;
      }
      throw loadError instanceof Error
        ? loadError
        : new Error('plugins index failed to load');
    }
    expect(typeof idx.getHostPluginRegistry).toBe('function');
    expect(typeof idx.HostPluginRegistry).toBe('function');
    expect(typeof idx.ensureBuiltinsRegistered).toBe('function');
    expect(typeof idx.readPluginsV1).toBe('function');
    expect(typeof idx.parsePluginsV1).toBe('function');
    expect(typeof idx.readActivePlugins).toBe('function');
    expect(typeof idx.writeActivePlugin).toBe('function');
    expect(typeof idx.isActivePlugin).toBe('function');
    expect(idx.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    expect(idx.PLUGIN_KIND_VIEW_IDS.source).toBe('axis.plugins.source');
    expect(typeof idx.registerPluginKindViews).toBe('function');
    expect(typeof idx.registerActivatePluginCommand).toBe('function');
    expect(typeof idx.registerPluginsTreeView).toBe('function');
  });

  test('registerPluginsAndWorkers does not createTreeView axis.plugins', async () => {
    if (!idx) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('plugins index failed to load');
    }
    treeViews.length = 0;
    const result = idx.registerPluginsAndWorkers(
      {
        subscriptions: [],
        workspaceState: idx.createMemoryWorkspaceState(),
      } as never,
      idx.createMemoryGlobalState(),
    );
    expect(result.registry).toBeInstanceOf(idx.HostPluginRegistry);
    expect(result.pluginsProvider).toBeInstanceOf(idx.PluginsTreeProvider);
    expect(treeViews.some((v) => v.id === 'axis.plugins')).toBe(false);
    expect(treeViews.some((v) => v.id === 'axis.workers')).toBe(true);
    expect(treeViews.some((v) => v.id === 'axis.plugins.source')).toBe(true);
  });

  test('activate onChanged refreshAll hits provider.refresh', async () => {
    if (!idx) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('plugins index failed to load');
    }
    const source = await import('./views/source');
    const cmd = await import('./activate-command');
    let hits = 0;
    const proto = source.SourcePluginsTreeProvider.prototype;
    const orig = proto.refresh;
    proto.refresh = function (this: unknown) {
      hits += 1;
      orig.call(this);
    };
    try {
      const mem = idx.createMemoryWorkspaceState();
      const refreshAll = idx.registerPluginKindViews(
        { subscriptions: [] } as never,
        new idx.HostPluginRegistry(),
        mem,
      );
      hits = 0;
      const ok = await cmd.runActivatePluginCommand(
        mem,
        { kind: 'source', id: 'okx-rest' },
        refreshAll,
      );
      expect(ok).toBe(true);
      expect(hits).toBeGreaterThan(0);
    } finally {
      proto.refresh = orig;
    }
  });
});
