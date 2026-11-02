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
import { join } from 'node:path';

const statusBars: Array<{
  text: string;
  tooltip: string;
  show: () => void;
  dispose: () => void;
}> = [];
const registered: Array<{ command: string; cb: (...args: unknown[]) => unknown }> = [];
const treeSelections: Array<(e: { selection: unknown[] }) => void> = [];

mock.module('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
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
      createTreeView: () => ({
        dispose() {},
        onDidChangeSelection(cb: (e: { selection: unknown[] }) => void) {
          treeSelections.push(cb);
          return { dispose() {} };
        },
      }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      createStatusBarItem: () => {
        const item = {
          text: '',
          tooltip: '',
          name: '',
          command: '',
          show() {},
          dispose() {},
        };
        statusBars.push(item);
        return item;
      },
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      showErrorMessage: () => undefined,
      showWarningMessage: () => undefined,
    },
    commands: {
      registerCommand(command: string, cb: (...args: unknown[]) => unknown) {
        registered.push({ command, cb });
        return { dispose() {} };
      },
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
    },
    lm: {
      registerMcpServerDefinitionProvider: () => ({ dispose() {} }),
      registerTool: () => ({ dispose() {} }),
    },
  };
});

type WatchlistMod = typeof import('./watchlist');
let wl: WatchlistMod;

beforeAll(async () => {
  wl = await import('./watchlist');
});

function memoryHelpers(seed?: unknown): {
  helpers: WatchlistMod.WorkspaceStateHelpers;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  if (seed !== undefined) store.set(wl.WATCHLIST_STATE_KEY, seed);
  return {
    store,
    helpers: {
      get<T>(key: string) {
        return store.get(key) as T | undefined;
      },
      update(key: string, value: unknown) {
        store.set(key, value);
      },
    },
  };
}

describe('watchlist persist + CRUD', () => {
  test('parseWatchlistV1 normalizes, dedupes, and drops bad selected', () => {
    expect(wl.parseWatchlistV1(null)).toEqual({ symbols: [], selected: null });
    expect(
      wl.parseWatchlistV1({
        symbols: [' btcusdt ', 'ETHUSDT', 'BTCUSDT', '', 12],
        selected: 'SOLUSDT',
      }),
    ).toEqual({ symbols: ['BTCUSDT', 'ETHUSDT'], selected: null });
    expect(
      wl.parseWatchlistV1({
        symbols: ['ethusdt', 'BTCUSDT'],
        selected: 'ethusdt',
      }),
    ).toEqual({ symbols: ['ETHUSDT', 'BTCUSDT'], selected: 'ETHUSDT' });
  });

  test('add/remove/select + resolveWatchlistFocus', () => {
    let state = wl.EMPTY_WATCHLIST_V1;
    state = wl.addWatchlistSymbol(state, 'btcusdt');
    expect(state).toEqual({ symbols: ['BTCUSDT'], selected: 'BTCUSDT' });
    state = wl.addWatchlistSymbol(state, 'ETHUSDT');
    expect(state.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(wl.resolveWatchlistFocus(state)).toBe('ETHUSDT');
    state = wl.selectWatchlistSymbol(state, 'BTCUSDT');
    expect(wl.resolveWatchlistFocus(state)).toBe('BTCUSDT');
    state = wl.removeWatchlistSymbol(state, 'BTCUSDT');
    expect(state).toEqual({ symbols: ['ETHUSDT'], selected: 'ETHUSDT' });
    state = wl.removeWatchlistSymbol(state, 'ETHUSDT');
    expect(state).toEqual({ symbols: [], selected: null });
    expect(wl.resolveWatchlistFocus(state)).toBeNull();
  });

  test('read/write workspaceState axis.watchlist.v1', async () => {
    const { helpers, store } = memoryHelpers();
    expect(wl.readWatchlistV1(helpers).symbols).toEqual([]);
    const ok = await wl.writeWatchlistV1(helpers, {
      symbols: ['BTCUSDT'],
      selected: 'BTCUSDT',
    });
    expect(ok).toBe(true);
    expect(store.get(wl.WATCHLIST_STATE_KEY)).toEqual({
      symbols: ['BTCUSDT'],
      selected: 'BTCUSDT',
    });
    expect(wl.readWatchlistV1(helpers).symbols).toEqual(['BTCUSDT']);
  });
});

describe('watchlist tree + status label', () => {
  test('empty root placeholder; symbols as leaves', () => {
    expect(wl.watchlistRootChildren(wl.EMPTY_WATCHLIST_V1).map((n) => n.label)).toEqual([
      'No symbols yet',
    ]);
    const provider = new wl.WatchlistTreeProvider({
      symbols: ['BTCUSDT', 'ETHUSDT'],
      selected: 'ETHUSDT',
    });
    const roots = provider.getChildren();
    expect(roots.map((n) => n.label)).toEqual(['BTCUSDT', 'ETHUSDT']);
    expect(roots.map((n) => n.kind)).toEqual(['symbol', 'symbol']);
    const item = provider.getTreeItem(roots[0]!);
    expect(item.contextValue).toBe('axis.watchlist.symbol');
  });

  test('formatWatchlistQuoteStatus uses displayedLastPrice semantics', () => {
    const empty = wl.formatWatchlistQuoteStatus({ symbol: null });
    expect(empty.text).toMatch(/Watchlist/);

    const mockLabel = wl.formatWatchlistQuoteStatus({
      symbol: 'BTCUSDT',
      quote: null,
      mock: true,
    });
    expect(mockLabel.text).toContain('BTCUSDT');
    expect(mockLabel.text).toContain('100.00');
    expect(mockLabel.tooltip).toMatch(/mock/i);

    const liveOpen = wl.formatWatchlistQuoteStatus({
      symbol: 'ETHUSDT',
      quote: { tickPrice: 110, barClose: 100, streamState: 'open' },
      mock: false,
    });
    expect(liveOpen.text).toContain('110.00');

    const connecting = wl.formatWatchlistQuoteStatus({
      symbol: 'ETHUSDT',
      quote: { tickPrice: 110, barClose: 100, streamState: 'connecting' },
      mock: false,
    });
    expect(connecting.text).toContain('100.00');
  });

  test('createMockQuoteFeed returns closed-stream placeholder', () => {
    const feed = wl.createMockQuoteFeed(42);
    const q = feed.getQuote('BTCUSDT');
    expect(q?.barClose).toBe(42);
    expect(q?.streamState).toBe('closed');
  });
});

describe('registerWatchlist + fragment', () => {
  test('registerWatchlist wires commands and status bar', async () => {
    registered.length = 0;
    statusBars.length = 0;
    const store = new Map<string, unknown>();
    const context = {
      workspaceState: {
        get<T>(key: string) {
          return store.get(key) as T | undefined;
        },
        update(key: string, value: unknown) {
          store.set(key, value);
          return Promise.resolve();
        },
      },
      subscriptions: [] as { dispose(): void }[],
    };

    let input: string | undefined = 'btcusdt';
    const result = wl.registerWatchlist(context as never, {
      ui: {
        showInputBox: async () => input,
        showQuickPick: async (items) => items[0],
        showErrorMessage: () => {},
      },
    });

    expect(result.provider.getChildren().map((n) => n.label)).toEqual(['No symbols yet']);
    expect(registered.map((r) => r.command).sort()).toEqual([
      wl.WATCHLIST_COMMANDS.add,
      wl.WATCHLIST_COMMANDS.remove,
    ]);
    expect(statusBars.length).toBe(1);
    expect(statusBars[0]?.text).toMatch(/Watchlist/);

    const add = registered.find((r) => r.command === wl.WATCHLIST_COMMANDS.add);
    expect(add).toBeDefined();
    await add!.cb();
    expect(result.provider.getState().symbols).toEqual(['BTCUSDT']);
    expect(store.get(wl.WATCHLIST_STATE_KEY)).toEqual({
      symbols: ['BTCUSDT'],
      selected: 'BTCUSDT',
    });
    expect(statusBars[0]?.text).toContain('BTCUSDT');
    expect(statusBars[0]?.tooltip).toMatch(/mock/i);

    input = 'ethusdt';
    await add!.cb();
    expect(result.provider.getState().symbols).toEqual(['BTCUSDT', 'ETHUSDT']);

    const remove = registered.find((r) => r.command === wl.WATCHLIST_COMMANDS.remove);
    await remove!.cb({
      id: 'watchlist.symbol.BTCUSDT',
      label: 'BTCUSDT',
      kind: 'symbol',
      symbol: 'BTCUSDT',
    });
    expect(result.provider.getState().symbols).toEqual(['ETHUSDT']);

    result.setQuoteFeed({
      getQuote: () => ({ tickPrice: 2500, barClose: 2400, streamState: 'open' }),
    });
    result.refreshStatusBar();
    expect(statusBars[0]?.text).toContain('2500.00');
    expect(statusBars[0]?.tooltip).not.toMatch(/mock/i);
  });

  test('fragment contributes axis.watchlist view + add/remove commands', () => {
    const fragPath = join(import.meta.dir, 'watchlist-contributes.fragment.json');
    const frag = JSON.parse(readFileSync(fragPath, 'utf8')) as {
      activationEvents?: string[];
      contributes?: {
        views?: { axis?: Array<{ id: string; name: string }> };
        commands?: Array<{ command: string }>;
      };
      notes?: { electron?: string };
    };
    const viewIds = (frag.contributes?.views?.axis ?? []).map((v) => v.id);
    expect(viewIds).toContain('axis.watchlist');
    const cmds = (frag.contributes?.commands ?? []).map((c) => c.command);
    expect(cmds).toContain('axis.watchlist.add');
    expect(cmds).toContain('axis.watchlist.remove');
    expect(frag.activationEvents ?? []).toContain('onView:axis.watchlist');
    expect(frag.notes?.electron ?? '').toMatch(/FORBIDDEN_VIEWS/);
  });

  test('view id constants', () => {
    expect(wl.WATCHLIST_VIEW_ID).toBe('axis.watchlist');
    expect(wl.WATCHLIST_STATE_KEY).toBe('axis.watchlist.v1');
  });
});
