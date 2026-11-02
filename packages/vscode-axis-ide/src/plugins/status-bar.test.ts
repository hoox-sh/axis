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
  createMemoryWorkspaceState,
  readActivePlugins,
} from './active';
import {
  HostPluginRegistry,
  _resetHostPluginRegistryForTests,
  ensureBuiltinsRegistered,
} from './registry';
import { DEFAULT_ACTIVE_PLUGINS_V1 } from './types';

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
  isTrusted?: boolean | { enabledCommands: readonly string[] };
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

type StatusBarMock = {
  id?: unknown;
  alignment?: unknown;
  priority?: unknown;
  text: string;
  tooltip: unknown;
  name?: string;
  command?: unknown;
  shown: boolean;
  disposed: boolean;
  show(): void;
  dispose(): void;
};

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
  __axisQuickPickImpl?: (items: unknown[], options?: unknown) => Promise<unknown>;
  __axisQuickPickCalls?: Array<{ items: unknown[]; options?: unknown }>;
  __axisExecuted?: string[];
  __axisStatusBarItems?: StatusBarMock[];
  __axisShowView?: ((id: string) => Promise<unknown>) | undefined;
  __axisShowViewThrow?: boolean;
  __axisFocusThrow?: boolean;
};

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

const QuickPickItemKind = { Separator: -1, Default: 0 };

const vscodeApi = {
  TreeItem: DefaultTreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  EventEmitter: DefaultEventEmitter,
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  Uri: DefaultUri,
  QuickPickItemKind,
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
    showQuickPick: async (items: unknown[], options?: unknown) => {
      const calls = g().__axisQuickPickCalls;
      if (calls) calls.push({ items, options });
      const impl = g().__axisQuickPickImpl;
      if (impl) return impl(items, options);
      return undefined;
    },
    showView: async (id: string) => {
      if (g().__axisShowViewThrow) throw new Error('showView');
      const impl = g().__axisShowView;
      if (impl) return impl(id);
      g().__axisExecuted?.push(`showView:${id}`);
      return undefined;
    },
    createStatusBarItem: (id?: unknown, alignment?: unknown, priority?: unknown) => {
      const item: StatusBarMock = {
        id,
        alignment,
        priority,
        text: '',
        tooltip: '',
        name: '',
        command: undefined,
        shown: false,
        disposed: false,
        show() {
          item.shown = true;
        },
        dispose() {
          item.disposed = true;
        },
      };
      const bucket = g().__axisStatusBarItems;
      if (bucket) bucket.push(item);
      return item;
    },
  },
  commands: {
    registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
      const bucket = g().__axisCommandHandlers;
      if (bucket) bucket.set(id, fn);
      return { dispose() {} };
    },
    executeCommand: async (id: string, ..._args: unknown[]) => {
      g().__axisExecuted?.push(id);
      if (id === 'axis.plugins.focus' && g().__axisFocusThrow) {
        throw new Error('command not found');
      }
      return undefined;
    },
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
  LanguageModelTextPart,
  LanguageModelToolResult,
  MarkdownString,
  McpStdioServerDefinition,
  QuickPickItemKind,
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
  get QuickPickItemKind() {
    return vscodeApi.QuickPickItemKind;
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

type BarMod = typeof import('./status-bar');

let bar: BarMod;
let loadError: unknown;

beforeAll(async () => {
  try {
    bar = await import('./status-bar');
  } catch (err) {
    loadError = err;
    throw err;
  }
});

function lastItem(): StatusBarMock | undefined {
  const items = g().__axisStatusBarItems;
  return items?.[items.length - 1];
}

function fakeContext() {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    workspaceState: createMemoryWorkspaceState(),
    extensionUri: new DefaultUri('/tmp/axis-ide'),
  };
}

function menuIds(items: Array<{ id?: string; kind?: number }>): string[] {
  return items
    .filter((i) => i.kind !== QuickPickItemKind.Separator)
    .map((i) => i.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

afterEach(() => {
  try {
    bar?._resetPluginsStatusBarForTests();
  } catch {
    // ignore
  }
  _resetHostPluginRegistryForTests();
  g().__axisQuickPickImpl = undefined;
  g().__axisQuickPickCalls = [];
  g().__axisExecuted = [];
  g().__axisStatusBarItems = [];
  g().__axisCommandHandlers = new Map();
  g().__axisLiveEnabled = undefined;
  g().__axisShowView = undefined;
  g().__axisShowViewThrow = false;
  g().__axisFocusThrow = false;
  g().__axisEngineCfgThrow = false;
});

describe('plugins status bar helpers', () => {
  test('format status text uses compact source · engine ids', () => {
    expect(bar.compactPluginId('binance-rest')).toBe('binance');
    expect(bar.compactPluginId('server')).toBe('server');
    expect(bar.compactPluginId('')).toBe('—');
    expect(bar.compactPluginId(undefined)).toBe('—');
    expect(bar.formatPluginsStatusText(DEFAULT_ACTIVE_PLUGINS_V1)).toBe(
      '$(plug) binance·server',
    );
    expect(
      bar.formatPluginsStatusText({ source: 'okx-rest', engine: 'pyne-worker' }),
    ).toBe('$(plug) okx·pyne');
    const hostile = {
      get source(): string {
        throw new Error('source');
      },
      engine: 'server',
    };
    expect(bar.formatPluginsStatusText(hostile)).toBe('$(plug) —·server');
  });

  test('markdown tooltip lists active ids and never embeds secrets', () => {
    const md = bar.formatPluginsStatusMarkdown(DEFAULT_ACTIVE_PLUGINS_V1);
    expect(md).toContain('binance-rest');
    expect(md).toContain('binance-ws');
    expect(md).toContain('server');
    expect(md).toContain('local');
    expect(md).toContain('AXIS Plugins');
    expect(md.toLowerCase()).not.toContain('secret');
    expect(md.toLowerCase()).not.toContain('apikey');
    expect(md.toLowerCase()).not.toContain('token');
    expect(md.toLowerCase()).not.toContain('password');

    const sneaky = {
      source: 'okx-rest',
      stream: 'okx-ws',
      engine: 'server',
      storage: 'local',
      apiKey: 'pn_secret_value_here',
      token: 'Bearer abc',
      password: 'hunter2',
      secret: 'shh',
    };
    const hidden = bar.formatPluginsStatusMarkdown(sneaky);
    expect(hidden).toContain('okx-rest');
    expect(hidden).not.toContain('pn_secret_value_here');
    expect(hidden).not.toContain('Bearer abc');
    expect(hidden).not.toContain('hunter2');
    expect(hidden).not.toContain('shh');
    expect(hidden.toLowerCase()).not.toContain('apikey');
  });

  test('menu item ids cover plugin and chart actions', () => {
    const items = bar.buildPluginsStatusMenuItems({ liveEnabled: true });
    const ids = menuIds(items);
    expect(ids).toEqual([
      bar.PLUGINS_STATUS_MENU_IDS.openPlugins,
      bar.PLUGINS_STATUS_MENU_IDS.switchSource,
      bar.PLUGINS_STATUS_MENU_IDS.switchStream,
      bar.PLUGINS_STATUS_MENU_IDS.switchEngine,
      bar.PLUGINS_STATUS_MENU_IDS.switchStorage,
      bar.PLUGINS_STATUS_MENU_IDS.openChart,
      bar.PLUGINS_STATUS_MENU_IDS.runScript,
      bar.PLUGINS_STATUS_MENU_IDS.liveStart,
      bar.PLUGINS_STATUS_MENU_IDS.liveStop,
      bar.PLUGINS_STATUS_MENU_IDS.probeWorkers,
      bar.PLUGINS_STATUS_MENU_IDS.setWorkerKey,
      bar.PLUGINS_STATUS_MENU_IDS.setProKey,
      bar.PLUGINS_STATUS_MENU_IDS.showRunOutput,
    ]);
    expect(ids).toContain('openPlugins');
    expect(ids).toContain('switchSource');
    expect(ids).toContain('openChart');
    expect(ids).toContain('runScript');
    expect(ids).toContain('setWorkerKey');
    expect(ids).toContain('setProKey');
    expect(items.some((i) => i.kind === QuickPickItemKind.Separator)).toBe(true);
  });
});

describe('registerPluginsStatusBar', () => {
  test('creates Left/98 item with plug text, trusted-false tooltip, statusMenu command', () => {
    if (!bar) throw loadError instanceof Error ? loadError : new Error('load');
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    const ctx = fakeContext();
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    const result = bar.registerPluginsStatusBar(ctx as never, mem, registry);
    const item = result.item as StatusBarMock | undefined;
    expect(item).toBeDefined();
    expect(item?.id).toBe(bar.PLUGINS_STATUS_BAR_ID);
    expect(item?.alignment).toBe(1);
    expect(item?.priority).toBe(98);
    expect(item?.name).toBe('AXIS Plugins');
    expect(item?.command).toBe(bar.PLUGINS_STATUS_MENU_COMMAND);
    expect(item?.text).toBe('$(plug) binance·server');
    expect(item?.shown).toBe(true);
    expect(item?.tooltip).toBeInstanceOf(MarkdownString);
    const tip = item?.tooltip as MarkdownString;
    expect(tip.isTrusted).toBe(false);
    expect(tip.value).toContain('binance-rest');
    expect(tip.value).toContain('binance-ws');
    expect(tip.value).not.toMatch(/apiKey|password|token|secret/i);
    expect(g().__axisCommandHandlers?.has(bar.PLUGINS_STATUS_MENU_COMMAND)).toBe(
      true,
    );
  });

  test('refresh after activate updates compact text', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    const item = lastItem();
    expect(item?.text).toBe('$(plug) binance·server');
    const { runActivatePluginCommand } = await import('./activate-command');
    const ok = await runActivatePluginCommand(
      mem,
      { kind: 'source', id: 'okx-rest' },
      () => bar.refreshPluginsStatusBar(),
    );
    expect(ok).toBe(true);
    expect(item?.text).toBe('$(plug) okx·server');
    expect((item?.tooltip as MarkdownString).value).toContain('okx-rest');
  });

  test('switching source from the menu writes active', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    g().__axisQuickPickCalls = [];
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    expect(readActivePlugins(mem).source).toBe('binance-rest');

    g().__axisQuickPickImpl = async (items: unknown[]) => {
      const rows = items as Array<{ id?: string }>;
      const switchSrc = rows.find((r) => r.id === 'switchSource');
      if (switchSrc) return switchSrc;
      return rows.find((r) => r.id === 'okx-rest');
    };
    const handler = g().__axisCommandHandlers?.get(bar.PLUGINS_STATUS_MENU_COMMAND);
    expect(typeof handler).toBe('function');
    await handler?.();
    expect(readActivePlugins(mem).source).toBe('okx-rest');
    expect(lastItem()?.text).toBe('$(plug) okx·server');
    expect(g().__axisQuickPickCalls?.length).toBe(2);
    const mainOpts = g().__axisQuickPickCalls?.[0]?.options as {
      canPickMany?: boolean;
    };
    expect(mainOpts?.canPickMany).toBe(false);
  });

  test('never-throw on hostile QuickPick', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    const handler = g().__axisCommandHandlers?.get(bar.PLUGINS_STATUS_MENU_COMMAND);

    g().__axisQuickPickImpl = async () => {
      throw new Error('hostile pick');
    };
    await expect(handler?.()).resolves.toBeUndefined();

    g().__axisQuickPickImpl = async () => ({
      get id(): string {
        throw new Error('id');
      },
      get label(): string {
        throw new Error('label');
      },
      get kind(): number {
        throw new Error('kind');
      },
    });
    await expect(handler?.()).resolves.toBeUndefined();

    g().__axisQuickPickImpl = async () => 'not-an-item';
    await expect(handler?.()).resolves.toBeUndefined();

    g().__axisQuickPickImpl = async () => undefined;
    await expect(handler?.()).resolves.toBeUndefined();
  });

  test('Open Plugins view uses showView when available', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    g().__axisExecuted = [];
    g().__axisQuickPickCalls = [];
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    g().__axisQuickPickImpl = async (items: unknown[]) => {
      const rows = items as Array<{ id?: string }>;
      return rows.find((r) => r.id === 'openPlugins');
    };
    const handler = g().__axisCommandHandlers?.get(bar.PLUGINS_STATUS_MENU_COMMAND);
    await handler?.();
    expect(g().__axisExecuted).toContain('workbench.view.extension.axis');
    expect(g().__axisExecuted).toContain('showView:axis.plugins');
  });

  test('Open Plugins view falls back to focus when showView throws', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    g().__axisExecuted = [];
    g().__axisShowViewThrow = true;
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    g().__axisQuickPickImpl = async (items: unknown[]) => {
      const rows = items as Array<{ id?: string }>;
      return rows.find((r) => r.id === 'openPlugins');
    };
    const handler = g().__axisCommandHandlers?.get(bar.PLUGINS_STATUS_MENU_COMMAND);
    await handler?.();
    expect(g().__axisExecuted).toContain('workbench.view.extension.axis');
    expect(g().__axisExecuted).toContain('axis.plugins.focus');
  });

  test('menu actions execute matching commands', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    g().__axisExecuted = [];
    const mem = createMemoryWorkspaceState();
    const registry = ensureBuiltinsRegistered(new HostPluginRegistry());
    bar.registerPluginsStatusBar(fakeContext() as never, mem, registry);
    const handler = g().__axisCommandHandlers?.get(bar.PLUGINS_STATUS_MENU_COMMAND);
    const cases: Array<[string, string]> = [
      ['openChart', 'axis.openChart'],
      ['runScript', 'axis.runScript'],
      ['liveStart', 'axis.liveStart'],
      ['liveStop', 'axis.liveStop'],
      ['probeWorkers', 'axis.workers.probeAll'],
      ['setWorkerKey', 'axis.secrets.setWorkerKey'],
      ['setProKey', 'axis.secrets.setProKey'],
      ['showRunOutput', 'axis.showRunOutput'],
    ];
    for (const [id, command] of cases) {
      g().__axisExecuted = [];
      g().__axisQuickPickImpl = async (items: unknown[]) => {
        const rows = items as Array<{ id?: string }>;
        return rows.find((r) => r.id === id);
      };
      await handler?.();
      expect(g().__axisExecuted).toContain(command);
    }
  });
});

describe('contributes fragment + index wiring', () => {
  test('fragment declares statusMenu command', () => {
    const fragPath = join(import.meta.dir, 'status-bar-contributes.fragment.json');
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      activationEvents: string[];
      contributes: {
        commands: Array<{ command: string }>;
        menus: { commandPalette: Array<{ command: string }> };
      };
    };
    expect(frag.activationEvents).toContain('onCommand:axis.plugins.statusMenu');
    expect(frag.contributes.commands.map((c) => c.command)).toContain(
      'axis.plugins.statusMenu',
    );
    expect(
      frag.contributes.menus.commandPalette.map((e) => e.command),
    ).toContain('axis.plugins.statusMenu');
  });

  test('index re-exports command id and registerPluginsAndWorkers wires the bar', async () => {
    g().__axisStatusBarItems = [];
    g().__axisCommandHandlers = new Map();
    g().__axisWebviewRegistrations = [];
    const idx = await import('./index');
    expect(idx.PLUGINS_STATUS_MENU_COMMAND).toBe('axis.plugins.statusMenu');
    expect(typeof idx.registerPluginsStatusBar).toBe('function');
    expect(typeof idx.refreshPluginsStatusBar).toBe('function');
    const result = idx.registerPluginsAndWorkers(
      {
        subscriptions: [],
        workspaceState: idx.createMemoryWorkspaceState(),
        extensionUri: new DefaultUri('/tmp/axis-ide'),
      } as never,
      idx.createMemoryGlobalState(),
    );
    expect(result.registry).toBeInstanceOf(idx.HostPluginRegistry);
    expect(g().__axisCommandHandlers?.has('axis.plugins.statusMenu')).toBe(true);
    const item = lastItem();
    expect(item?.id).toBe('axis.ide.plugins');
    expect(item?.priority).toBe(98);
    expect(item?.text.startsWith('$(plug)')).toBe(true);
  });
});
