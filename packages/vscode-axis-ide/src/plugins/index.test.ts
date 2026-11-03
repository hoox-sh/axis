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
  __axisLiveEnabled?: unknown;
  __axisAllowUrlInstall?: unknown;
  __axisWebviewRegistrations?: Array<{
    id: string;
    options?: { webviewOptions?: { retainContextWhenHidden?: boolean } };
  }>;
  __axisCommandHandlers?: Map<string, (...args: unknown[]) => unknown>;
};

class ThemeIcon {
  id: string;
  constructor(id: string) {
    this.id = id;
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
    return this.fsPath;
  }
}

function g(): G {
  return globalThis as G;
}

const vscodeApi = {
  TreeItem: DefaultTreeItem,
  ThemeIcon,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: DefaultEventEmitter,
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  Uri: DefaultUri,
  window: {
    activeColorTheme: { kind: 2 },
    createTreeView: (id: string, options?: { showCollapseAll?: boolean }) => {
      treeViews.push({ id });
      const bucket = g().__axisPluginKindTreeViews;
      if (bucket) {
        bucket.push({ id, showCollapseAll: options ? options.showCollapseAll : undefined });
      }
      return { dispose() {} };
    },
    registerWebviewViewProvider: (
      id: string,
      _provider: unknown,
      options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
    ) => {
      const bucket = g().__axisWebviewRegistrations;
      if (bucket) bucket.push({ id, options });
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
    registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
      const bucket = g().__axisCommandHandlers;
      if (bucket) bucket.set(id, fn);
      return { dispose() {} };
    },
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
          if (section === 'axis.live' && key === 'enabled') {
            return g().__axisLiveEnabled;
          }
          if (section === 'axis.plugins' && key === 'allowUrlInstall') {
            return g().__axisAllowUrlInstall;
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
  QuickPickItemKind: { Separator: -1, Default: 0 },
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  get TreeItem() {
    return vscodeApi.TreeItem;
  },
  get ThemeIcon() {
    return vscodeApi.ThemeIcon;
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
    expect(typeof idx.subscribeActivePlugins).toBe('function');
    expect(typeof idx.notifyActivePlugins).toBe('function');
    expect(typeof idx.chartPluginsFromActive).toBe('function');
    expect(typeof idx.isActivePlugin).toBe('function');
    expect(idx.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    expect(idx.PLUGIN_KIND_VIEW_IDS.source).toBe('axis.plugins.source');
    expect(idx.PLUGINS_WEBVIEW_VIEW_ID).toBe('axis.plugins');
    expect(typeof idx.registerPluginKindViews).toBe('function');
    expect(typeof idx.registerActivatePluginCommand).toBe('function');
    expect(typeof idx.registerPluginsTreeView).toBe('function');
    expect(typeof idx.registerPluginsWebviewView).toBe('function');
  });

  test('registerPluginsAndWorkers does not createTreeView axis.plugins', async () => {
    if (!idx) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('plugins index failed to load');
    }
    treeViews.length = 0;
    g().__axisWebviewRegistrations = [];
    g().__axisCommandHandlers = new Map();
    const result = idx.registerPluginsAndWorkers(
      {
        subscriptions: [],
        workspaceState: idx.createMemoryWorkspaceState(),
        extensionUri: new DefaultUri('/tmp/axis-ide'),
      } as never,
      idx.createMemoryGlobalState(),
    );
    expect(result.registry).toBeInstanceOf(idx.HostPluginRegistry);
    expect(result.pluginsProvider).toBeInstanceOf(idx.PluginsTreeProvider);
    expect(result.pluginsWebview).toBeInstanceOf(idx.PluginsWebviewViewProvider);
    expect(treeViews.some((v) => v.id === 'axis.plugins')).toBe(false);
    expect(treeViews.some((v) => v.id === 'axis.workers')).toBe(false);
    expect(
      g().__axisWebviewRegistrations?.some((v) => v.id === 'axis.workers'),
    ).toBe(true);
    expect(treeViews.some((v) => v.id === 'axis.plugins.source')).toBe(false);
    expect(
      g().__axisWebviewRegistrations?.some((v) => v.id === 'axis.plugins'),
    ).toBe(true);
    expect(
      g().__axisWebviewRegistrations?.find((v) => v.id === 'axis.plugins')
        ?.options?.webviewOptions?.retainContextWhenHidden,
    ).toBe(true);
    const activate = g().__axisCommandHandlers?.get('axis.plugins.activate');
    expect(typeof activate).toBe('function');
    await activate?.({ kind: 'source', id: 'okx-rest' });
    expect(g().__axisCommandHandlers?.has('axis.workers.probeAll')).toBe(true);
  });

  test('activate onChanged refreshAll is never-throw without kind trees', async () => {
    if (!idx) {
      if (!viewModulesExist()) return;
      throw loadError instanceof Error
        ? loadError
        : new Error('plugins index failed to load');
    }
    const cmd = await import('./activate-command');
    const mem = idx.createMemoryWorkspaceState();
    const refreshAll = idx.registerPluginKindViews(
      { subscriptions: [] } as never,
      new idx.HostPluginRegistry(),
      mem,
    );
    const ok = await cmd.runActivatePluginCommand(
      mem,
      { kind: 'source', id: 'okx-rest' },
      refreshAll,
    );
    expect(ok).toBe(true);
  });
});
