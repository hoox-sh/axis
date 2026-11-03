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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuiltinCatalogEntry } from './builtins';
import { BUILTIN_CATALOG_RELATIVE } from './builtins';

const registered: Array<{ command: string; cb: (...args: unknown[]) => unknown }> = [];
const opened: Array<{ content: string; language: string }> = [];
let quickPickResult: unknown = undefined;
const errors: string[] = [];

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    description?: string;
    contextValue?: string;
    tooltip?: string;
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
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ColorThemeKind,
    Uri,
    LanguageModelTextPart,
    LanguageModelToolResult,
    MarkdownString,
    McpStdioServerDefinition,
    commands: {
      registerCommand(command: string, cb: (...args: unknown[]) => unknown) {
        registered.push({ command, cb });
        return { dispose() {} };
      },
    },
    window: {
      activeColorTheme: { kind: ColorThemeKind.Dark },
      showQuickPick: async (items: unknown[]) => {
        if (typeof quickPickResult === 'function') {
          return (quickPickResult as (items: unknown[]) => unknown)(items);
        }
        return quickPickResult;
      },
      showTextDocument: async () => ({}),
      showErrorMessage: (m: string) => {
        errors.push(m);
      },
      showWarningMessage: () => undefined,
      registerWebviewViewProvider: () => ({ dispose() {} }),
      createTreeView: () => ({
        dispose() {},
        onDidChangeSelection: () => ({ dispose() {} }),
      }),
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        name: '',
        command: '',
        show() {},
        dispose() {},
      }),
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
            if (section === 'axis.engine' && key === 'allowPyodide') return gg.__axisAllowPyodide;
            if (section === 'axis.live' && key === 'enabled') return gg.__axisLiveEnabled;
            if (section === 'axis.plugins' && key === 'allowUrlInstall') {
              return gg.__axisAllowUrlInstall;
            }
            return def;
          },
        };
      },
      openTextDocument: async (opts: { content: string; language: string }) => {
        opened.push(opts);
        return { languageId: opts.language, getText: () => opts.content };
      },
    },
    lm: {
      registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
      registerTool: () => ({ dispose() {} }),
    },
  };
});

type ApplyMod = typeof import('./apply-builtin');
let apply: ApplyMod;

beforeAll(async () => {
  apply = await import('./apply-builtin');
});

const PKG_ROOT = resolve(import.meta.dir, '../..');
const CATALOG_FILE = resolve(PKG_ROOT, BUILTIN_CATALOG_RELATIVE);

function entry(over: Partial<BuiltinCatalogEntry> = {}): BuiltinCatalogEntry {
  return {
    id: 'sma',
    title: 'AXIS SMA',
    shorttitle: 'SMA',
    description: 'Simple moving average',
    category: 'moving-average',
    categoryLabel: 'Moving averages',
    kind: 'indicator',
    overlay: true,
    covers: 'SMA',
    tags: ['sma'],
    code: '//@version=6\nindicator("AXIS SMA")\nplot(close)\n',
    ...over,
  };
}

describe('builtinQuickPickItems', () => {
  test('label/description carry title + category · id', () => {
    const items = apply.builtinQuickPickItems([entry()]);
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('AXIS SMA');
    expect(items[0]?.description).toBe('Moving averages · sma');
    expect(items[0]?.detail).toBe('Simple moving average');
    expect(items[0]?.builtin.id).toBe('sma');
  });
});

describe('runApplyBuiltin', () => {
  test('empty catalog errors and returns empty', async () => {
    const errs: string[] = [];
    const result = await apply.runApplyBuiltin({
      scripts: [],
      ui: {
        showQuickPick: async () => undefined,
        openUntitledPine: async () => {},
        showErrorMessage: (m) => {
          errs.push(m);
        },
      },
    });
    expect(result.status).toBe('empty');
    expect(errs[0]).toBe(apply.APPLY_BUILTIN_EMPTY_MESSAGE);
  });

  test('cancel returns cancelled', async () => {
    const result = await apply.runApplyBuiltin({
      scripts: [entry()],
      ui: {
        showQuickPick: async () => undefined,
        openUntitledPine: async () => {},
        showErrorMessage: () => {},
      },
    });
    expect(result.status).toBe('cancelled');
  });

  test('selection opens untitled pinescript with source', async () => {
    const openedLocal: Array<{ code: string; languageId: string }> = [];
    const sma = entry();
    const result = await apply.runApplyBuiltin({
      scripts: [sma],
      ui: {
        showQuickPick: async (items) => items[0],
        openUntitledPine: async (code, languageId) => {
          openedLocal.push({ code, languageId });
        },
        showErrorMessage: () => {},
      },
    });
    expect(result.status).toBe('applied');
    expect(result.builtin?.id).toBe('sma');
    expect(openedLocal).toEqual([{ code: sma.code, languageId: 'pinescript' }]);
  });

  test('open failure returns error', async () => {
    const errs: string[] = [];
    const result = await apply.runApplyBuiltin({
      scripts: [entry()],
      ui: {
        showQuickPick: async (items) => items[0],
        openUntitledPine: async () => {
          throw new Error('boom');
        },
        showErrorMessage: (m) => {
          errs.push(m);
        },
      },
    });
    expect(result.status).toBe('error');
    expect(errs[0]).toContain('boom');
  });
});

describe('registerApplyBuiltin', () => {
  test('registers axis.applyBuiltin and applies from VSIX JSON', async () => {
    registered.length = 0;
    opened.length = 0;
    errors.length = 0;

    const catalogText = readFileSync(CATALOG_FILE, 'utf8');
    const subscriptions: Array<{ dispose(): void }> = [];
    const context = {
      extensionPath: PKG_ROOT,
      subscriptions,
    };

    apply.registerApplyBuiltin(context as never, {
      readFile: (path) => {
        expect(String(path).replace(/\\/g, '/')).toContain('media/builtins/catalog.json');
        return catalogText;
      },
    });

    expect(registered).toHaveLength(1);
    expect(registered[0]?.command).toBe(apply.APPLY_BUILTIN_COMMAND);
    expect(subscriptions).toHaveLength(1);

    quickPickResult = (items: Array<{ builtin: BuiltinCatalogEntry }>) => {
      const rsi = items.find((i) => i.builtin.id === 'rsi');
      expect(rsi).toBeTruthy();
      return rsi;
    };

    const result = (await registered[0]?.cb()) as apply.ApplyBuiltinResult;
    expect(result.status).toBe('applied');
    expect(result.builtin?.id).toBe('rsi');
    expect(opened.length).toBe(1);
    expect(opened[0]?.language).toBe('pinescript');
    expect(opened[0]?.content.includes('//@version=6')).toBe(true);
  });

  test('load failure surfaces error message', async () => {
    registered.length = 0;
    errors.length = 0;
    const subscriptions: Array<{ dispose(): void }> = [];
    apply.registerApplyBuiltin(
      { extensionPath: '/missing', subscriptions } as never,
      {
        readFile: () => {
          throw new Error('missing catalog');
        },
      },
    );
    const result = (await registered[0]?.cb()) as apply.ApplyBuiltinResult;
    expect(result.status).toBe('error');
    expect(errors[0]).toContain(apply.APPLY_BUILTIN_LOAD_FAILED_PREFIX);
    expect(errors[0]).toContain('missing catalog');
  });
});
