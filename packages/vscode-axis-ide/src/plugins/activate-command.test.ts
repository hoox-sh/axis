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
import {
  createMemoryWorkspaceState,
  isActivePlugin,
  readActivePlugins,
} from './active';

const vscodeState = {
  warnings: [] as string[],
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  warnThrows: false,
};

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
  window: {
    activeColorTheme: { kind: 2 },
    createTreeView: (id: string, options?: { showCollapseAll?: boolean }) => {
      const bucket = g().__axisPluginKindTreeViews;
      if (bucket) {
        bucket.push({ id, showCollapseAll: options ? options.showCollapseAll : undefined });
      }
      return { dispose() {} };
    },
    registerWebviewViewProvider: () => ({ dispose() {} }),
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    showInformationMessage: () => undefined,
    showWarningMessage: (message: string) => {
      if (vscodeState.warnThrows) throw new Error('warn');
      vscodeState.warnings.push(message);
      return undefined;
    },
    showTextDocument: async () => ({}),
    createStatusBarItem: () => ({
      text: '',
      tooltip: '',
      show() {},
      dispose() {},
    }),
  },
  commands: {
    registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
      vscodeState.commands.set(id, cb);
      return {
        dispose() {
          vscodeState.commands.delete(id);
        },
      };
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

type CmdMod = typeof import('./activate-command');

let cmd: CmdMod;

beforeAll(async () => {
  cmd = await import('./activate-command');
});

function fakeContext() {
  const subscriptions: Array<{ dispose(): void }> = [];
  return {
    subscriptions,
    workspaceState: createMemoryWorkspaceState(),
  };
}

describe('axis.plugins.activate', () => {
  test('parseActivatePluginArg never throws', () => {
    expect(cmd.parseActivatePluginArg(undefined)).toBeNull();
    expect(cmd.parseActivatePluginArg(null)).toBeNull();
    expect(cmd.parseActivatePluginArg([])).toBeNull();
    expect(cmd.parseActivatePluginArg('x')).toBeNull();
    expect(cmd.parseActivatePluginArg({ kind: 'source' })).toBeNull();
    expect(cmd.parseActivatePluginArg({ id: 'okx-rest' })).toBeNull();
    expect(cmd.parseActivatePluginArg({ kind: 'nope', id: 'x' })).toBeNull();
    expect(cmd.parseActivatePluginArg({ kind: 'source', id: '' })).toBeNull();
    expect(cmd.parseActivatePluginArg({ kind: 'source', id: '  ' })).toBeNull();
    expect(cmd.parseActivatePluginArg({ kind: 'source', id: 'okx-rest' })).toEqual({
      kind: 'source',
      id: 'okx-rest',
    });
    expect(
      cmd.parseActivatePluginArg({ kind: '  engine  ', id: '  server  ' }),
    ).toEqual({ kind: 'engine', id: 'server' });

    const hostile = {
      get kind(): string {
        throw new Error('kind');
      },
      id: 'x',
    };
    expect(cmd.parseActivatePluginArg(hostile)).toBeNull();
    const hostileId = {
      kind: 'source',
      get id(): string {
        throw new Error('id');
      },
    };
    expect(cmd.parseActivatePluginArg(hostileId)).toBeNull();
  });

  test('runActivatePluginCommand writes then onChanged; bad arg warns', async () => {
    vscodeState.warnings = [];
    const mem = createMemoryWorkspaceState();
    let changed = 0;
    const ok = await cmd.runActivatePluginCommand(
      mem,
      { kind: 'source', id: 'okx-rest' },
      () => {
        changed += 1;
      },
    );
    expect(ok).toBe(true);
    expect(changed).toBe(1);
    expect(isActivePlugin(mem, 'source', 'okx-rest')).toBe(true);
    expect(vscodeState.warnings).toEqual([]);

    const bad = await cmd.runActivatePluginCommand(mem, { kind: 'nope', id: 'x' });
    expect(bad).toBe(false);
    expect(vscodeState.warnings[0]).toContain('Activate Plugin');
    expect(readActivePlugins(mem).source).toBe('okx-rest');

    vscodeState.warnings = [];
    const empty = await cmd.runActivatePluginCommand(mem, undefined);
    expect(empty).toBe(false);
    expect(vscodeState.warnings.length).toBe(1);
  });

  test('onChanged throw and store failure never throw', async () => {
    vscodeState.warnings = [];
    const mem = createMemoryWorkspaceState();
    await expect(
      cmd.runActivatePluginCommand(mem, { kind: 'engine', id: 'pyodide' }, () => {
        throw new Error('refresh');
      }),
    ).resolves.toBe(true);
    expect(isActivePlugin(mem, 'engine', 'pyodide')).toBe(true);

    const hostile = {
      get<T>(_key: string): T | undefined {
        return undefined;
      },
      update() {
        throw new Error('update');
      },
    };
    vscodeState.warnings = [];
    await expect(
      cmd.runActivatePluginCommand(hostile, { kind: 'source', id: 'okx-rest' }),
    ).resolves.toBe(false);
    expect(vscodeState.warnings[0]).toContain('Could not activate');

    vscodeState.warnThrows = true;
    await expect(
      cmd.runActivatePluginCommand(mem, { nope: true }),
    ).resolves.toBe(false);
    vscodeState.warnThrows = false;
  });

  test('registerActivatePluginCommand never throws and invokes handler', async () => {
    vscodeState.warnings = [];
    vscodeState.commands.clear();
    const ctx = fakeContext();
    const mem = createMemoryWorkspaceState();
    let changed = 0;
    const disp = cmd.registerActivatePluginCommand(
      ctx as never,
      mem,
      async () => {
        changed += 1;
      },
    );
    expect(ctx.subscriptions).toHaveLength(1);
    expect(cmd.ACTIVATE_PLUGIN_COMMAND).toBe('axis.plugins.activate');
    const handler = vscodeState.commands.get(cmd.ACTIVATE_PLUGIN_COMMAND);
    expect(typeof handler).toBe('function');
    if (!handler) throw new Error('expected handler');
    await handler({ kind: 'storage', id: 'git' });
    expect(isActivePlugin(mem, 'storage', 'git')).toBe(true);
    expect(changed).toBe(1);
    disp.dispose();
  });
});
