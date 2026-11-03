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

/**
 * Watchlist TreeView + quote StatusBar (PR-08b / Task 20).
 *
 * Persists symbols under workspaceState `axis.watchlist.v1`. StatusBar shows
 * `displayedLastPrice` for the selected (else first) symbol. No live watchlist
 * quote feed yet — mock/placeholder prices until soft-dep PR-09 wiring.
 *
 * package.json merge is deferred — see `watchlist-contributes.fragment.json`.
 */

import * as vscode from 'vscode';
import {
  formatQuotePrice,
  resolveDisplayedQuotePrice,
  type QuoteSnapshot,
} from '../host/quote';

export const WATCHLIST_VIEW_ID = 'axis.watchlist';
export const WATCHLIST_STATE_KEY = 'axis.watchlist.v1';

/** Keep in sync with watchlist-contributes.fragment.json (package.json merge later). */
export const WATCHLIST_COMMANDS = {
  add: 'axis.watchlist.add',
  remove: 'axis.watchlist.remove',
} as const;

/**
 * Documented mock close used when no live quote feed is attached.
 * Soft-dep PR-09 / LiveSessionBridge can replace via {@link QuoteFeed}.
 */
export const MOCK_PLACEHOLDER_CLOSE = 100;

export type WatchlistV1 = {
  /** Ordered unique symbols (normalized upper-case). */
  symbols: string[];
  /** Selected symbol for StatusBar; null → first symbol. */
  selected: string | null;
};

export const EMPTY_WATCHLIST_V1: WatchlistV1 = {
  symbols: [],
  selected: null,
};

/**
 * Minimal Memento surface so unit tests inject a Map without loading `vscode`.
 * Extension wiring binds `context.workspaceState` (get/update).
 */
export type WorkspaceStateHelpers = {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void | Promise<void>;
};

export type WatchlistTreeNode = {
  id: string;
  label: string;
  kind: 'empty' | 'symbol';
  symbol?: string;
  description?: string;
};

/** Optional quote source — default is a deterministic mock placeholder. */
export type QuoteFeed = {
  getQuote(symbol: string): QuoteSnapshot | undefined;
};

/** Default feed: finite barClose placeholder, no live tick (stream closed). */
export function createMockQuoteFeed(
  close: number = MOCK_PLACEHOLDER_CLOSE,
): QuoteFeed {
  return {
    getQuote(symbol: string): QuoteSnapshot | undefined {
      const sym = String(symbol || '').trim();
      if (!sym) return undefined;
      return {
        tickPrice: NaN,
        barClose: close,
        streamState: 'closed',
      };
    },
  };
}

/** Normalize user input → upper-case ticker; empty string if unusable. */
export function normalizeWatchlistSymbol(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Parse unknown workspaceState value into a clean WatchlistV1 (never throws). */
export function parseWatchlistV1(raw: unknown): WatchlistV1 {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ...EMPTY_WATCHLIST_V1, symbols: [] };
    }
    const bag = raw as Record<string, unknown>;
    const symbols: string[] = [];
    const seen = new Set<string>();
    const list = Array.isArray(bag.symbols) ? bag.symbols : [];
    for (const row of list) {
      const sym = normalizeWatchlistSymbol(row);
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);
      symbols.push(sym);
    }
    const selectedRaw = normalizeWatchlistSymbol(bag.selected);
    const selected =
      selectedRaw && seen.has(selectedRaw) ? selectedRaw : null;
    return { symbols, selected };
  } catch {
    return { ...EMPTY_WATCHLIST_V1, symbols: [] };
  }
}

/** Read `axis.watchlist.v1` via helpers (never throws; empty on failure). */
export function readWatchlistV1(helpers: WorkspaceStateHelpers): WatchlistV1 {
  try {
    const raw = helpers.get<unknown>(WATCHLIST_STATE_KEY);
    return parseWatchlistV1(raw);
  } catch {
    return { ...EMPTY_WATCHLIST_V1, symbols: [] };
  }
}

/**
 * Write watchlist to `axis.watchlist.v1`.
 * Never throws — returns false on store failure.
 */
export async function writeWatchlistV1(
  helpers: WorkspaceStateHelpers,
  state: WatchlistV1,
): Promise<boolean> {
  try {
    const clean = parseWatchlistV1(state);
    await Promise.resolve(helpers.update(WATCHLIST_STATE_KEY, clean));
    return true;
  } catch {
    return false;
  }
}

/** Selected symbol, else first, else null. */
export function resolveWatchlistFocus(state: WatchlistV1): string | null {
  if (state.selected && state.symbols.includes(state.selected)) {
    return state.selected;
  }
  return state.symbols.length > 0 ? state.symbols[0]! : null;
}

/** Pure add — returns new state (deduped, normalized). */
export function addWatchlistSymbol(state: WatchlistV1, raw: unknown): WatchlistV1 {
  const sym = normalizeWatchlistSymbol(raw);
  if (!sym) return parseWatchlistV1(state);
  const base = parseWatchlistV1(state);
  if (base.symbols.includes(sym)) {
    return { ...base, selected: sym };
  }
  return { symbols: [...base.symbols, sym], selected: sym };
}

/** Pure remove — returns new state. */
export function removeWatchlistSymbol(state: WatchlistV1, raw: unknown): WatchlistV1 {
  const sym = normalizeWatchlistSymbol(raw);
  const base = parseWatchlistV1(state);
  if (!sym) return base;
  const symbols = base.symbols.filter((s) => s !== sym);
  const selected =
    base.selected && symbols.includes(base.selected)
      ? base.selected
      : symbols.length > 0
        ? symbols[0]!
        : null;
  return { symbols, selected };
}

/** Pure select — no-op when symbol missing. */
export function selectWatchlistSymbol(state: WatchlistV1, raw: unknown): WatchlistV1 {
  const sym = normalizeWatchlistSymbol(raw);
  const base = parseWatchlistV1(state);
  if (!sym || !base.symbols.includes(sym)) return base;
  return { ...base, selected: sym };
}

export type QuoteStatusLabel = {
  text: string;
  tooltip: string;
};

/**
 * Build StatusBar text/tooltip for the focused watchlist symbol.
 * Uses {@link resolveDisplayedQuotePrice}; documents mock when feed is placeholder.
 */
export function formatWatchlistQuoteStatus(opts: {
  symbol: string | null;
  quote?: QuoteSnapshot | null;
  mock?: boolean;
}): QuoteStatusLabel {
  try {
    if (!opts.symbol) {
      return {
        text: '$(tag) AXIS Watchlist',
        tooltip: 'AXIS watchlist empty — add a symbol',
      };
    }
    const quote =
      opts.quote ??
      ({
        tickPrice: NaN,
        barClose: MOCK_PLACEHOLDER_CLOSE,
        streamState: 'closed',
      } satisfies QuoteSnapshot);
    const price = resolveDisplayedQuotePrice(quote);
    const priceText = formatQuotePrice(price);
    const mock = opts.mock === true || opts.quote == null;
    return {
      text: `$(pulse) ${opts.symbol} ${priceText}`,
      tooltip: mock
        ? `${opts.symbol} last ${priceText} (mock placeholder — no live watchlist quote feed yet)`
        : `${opts.symbol} last ${priceText}`,
    };
  } catch {
    return {
      text: '$(tag) AXIS Watchlist',
      tooltip: 'AXIS watchlist',
    };
  }
}

function quoteDescription(symbol: string, feed?: QuoteFeed): string | undefined {
  try {
    const quotes = feed ?? createMockQuoteFeed();
    const quote = quotes.getQuote(symbol);
    if (!quote) return undefined;
    return formatQuotePrice(resolveDisplayedQuotePrice(quote));
  } catch {
    return undefined;
  }
}

/** Root children for the TreeView (empty placeholder or symbol rows). */
export function watchlistRootChildren(
  state: WatchlistV1,
  feed?: QuoteFeed,
): WatchlistTreeNode[] {
  const clean = parseWatchlistV1(state);
  if (clean.symbols.length === 0) {
    return [{ id: 'watchlist.empty', label: 'Add a symbol', kind: 'empty' }];
  }
  return clean.symbols.map((symbol) => {
    const description = quoteDescription(symbol, feed);
    return {
      id: `watchlist.symbol.${symbol}`,
      label: symbol,
      kind: 'symbol' as const,
      symbol,
      ...(description ? { description } : {}),
    };
  });
}

/** Defensive ThemeIcon — Bun vscode mocks may omit the constructor. */
function tryThemeIcon(id: string): vscode.ThemeIcon | undefined {
  try {
    const Ctor = (
      vscode as { ThemeIcon?: new (iconId: string) => vscode.ThemeIcon }
    ).ThemeIcon;
    if (typeof Ctor === 'function') return new Ctor(id);
  } catch {
    /* mock without ThemeIcon */
  }
  return undefined;
}

/** Untrusted markdown tooltip (no theme icons). */
function tryMarkdownTooltip(lines: readonly string[]): vscode.MarkdownString | string {
  const value = lines.filter((line) => line.length > 0).join('\n');
  try {
    const Ctor = (
      vscode as { MarkdownString?: new (value?: string) => vscode.MarkdownString }
    ).MarkdownString;
    if (typeof Ctor === 'function') {
      const md = new Ctor(value);
      try {
        md.supportThemeIcons = false;
      } catch {
        /* mock */
      }
      try {
        md.isTrusted = false;
      } catch {
        /* mock */
      }
      return md;
    }
  } catch {
    /* mock without MarkdownString */
  }
  return value;
}

/**
 * Tree change emitter that works under Bun unit mocks (some files mock `vscode`
 * without `EventEmitter` — last mock.module wins globally).
 */
function createTreeChangeEmitter<T>(): {
  event: vscode.Event<T>;
  fire(data: T): void;
} {
  const Emitter = (
    vscode as { EventEmitter?: new () => { event: vscode.Event<T>; fire(data: T): void } }
  ).EventEmitter;
  if (typeof Emitter === 'function') {
    return new Emitter();
  }
  const listeners = new Set<(data: T) => void>();
  return {
    event: ((listener: (data: T) => void) => {
      listeners.add(listener);
      return {
        dispose() {
          listeners.delete(listener);
        },
      };
    }) as vscode.Event<T>,
    fire(data: T) {
      for (const listener of listeners) listener(data);
    },
  };
}

/** MVP Watchlist TreeDataProvider — symbols from workspaceState. */
export class WatchlistTreeProvider implements vscode.TreeDataProvider<WatchlistTreeNode> {
  private readonly _onDidChangeTreeData = createTreeChangeEmitter<
    WatchlistTreeNode | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: WatchlistV1;
  private feed: QuoteFeed;

  constructor(initial?: WatchlistV1, feed?: QuoteFeed) {
    this.state = parseWatchlistV1(initial ?? EMPTY_WATCHLIST_V1);
    this.feed = feed ?? createMockQuoteFeed();
  }

  getState(): WatchlistV1 {
    return parseWatchlistV1(this.state);
  }

  setState(next: WatchlistV1): void {
    this.state = parseWatchlistV1(next);
    this._onDidChangeTreeData.fire(undefined);
  }

  setQuoteFeed(feed: QuoteFeed): void {
    this.feed = feed;
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: WatchlistTreeNode): vscode.TreeItem {
    // Defensive: Bun mock.module is global — last vscode mock may omit CollapsibleState.
    const collapsible = (
      vscode as {
        TreeItemCollapsibleState?: { None?: number };
      }
    ).TreeItemCollapsibleState;
    const none =
      collapsible && typeof collapsible.None === 'number' ? collapsible.None : 0;
    const item = new vscode.TreeItem(element.label, none);
    item.id = element.id;
    item.description = element.description;
    if (element.kind === 'symbol' && element.symbol) {
      item.contextValue = 'axis.watchlist.symbol';
      const icon = tryThemeIcon('symbol-numeric');
      if (icon) item.iconPath = icon;
      item.tooltip = tryMarkdownTooltip([
        'kind: watchlist',
        `id: ${element.id}`,
        element.description ? `quote: ${element.description}` : '',
      ]);
    } else {
      item.contextValue = 'axis.watchlist.empty';
      item.tooltip = tryMarkdownTooltip(['kind: watchlist', `id: ${element.id}`]);
    }
    return item;
  }

  getChildren(element?: WatchlistTreeNode): WatchlistTreeNode[] {
    if (element) return [];
    return watchlistRootChildren(this.state, this.feed);
  }
}

export type WatchlistUi = {
  showInputBox(options: {
    prompt?: string;
    placeHolder?: string;
    value?: string;
  }): Promise<string | undefined>;
  showQuickPick(
    items: string[],
    options: { placeHolder?: string },
  ): Promise<string | undefined>;
  showErrorMessage(message: string): void;
};

function defaultUi(): WatchlistUi {
  return {
    async showInputBox(options) {
      return windowSafeShowInputBox(options);
    },
    async showQuickPick(items, options) {
      return windowSafeShowQuickPick(items, options);
    },
    showErrorMessage(message: string) {
      try {
        void vscode.window.showErrorMessage(message);
      } catch {
        /* ignore */
      }
    },
  };
}

async function windowSafeShowInputBox(options: {
  prompt?: string;
  placeHolder?: string;
  value?: string;
}): Promise<string | undefined> {
  try {
    return await vscode.window.showInputBox({
      prompt: options.prompt,
      placeHolder: options.placeHolder,
      value: options.value,
      ignoreFocusOut: true,
    });
  } catch {
    return undefined;
  }
}

async function windowSafeShowQuickPick(
  items: string[],
  options: { placeHolder?: string },
): Promise<string | undefined> {
  try {
    return await vscode.window.showQuickPick(items, {
      placeHolder: options.placeHolder,
      ignoreFocusOut: true,
    });
  } catch {
    return undefined;
  }
}

export type RegisterWatchlistResult = {
  provider: WatchlistTreeProvider;
  /** Apply a StatusBar refresh from current state + feed. */
  refreshStatusBar: () => void;
  /** Replace quote feed (tests / live wiring). */
  setQuoteFeed: (feed: QuoteFeed) => void;
};

/**
 * Register Watchlist commands, quote StatusBarItem, and (by default) the TreeView.
 * Pass `{ tree: false }` when `registerWatchlistStudio` owns view id `axis.watchlist`.
 * Omitted `tree` stays true so existing callers keep `createTreeView`.
 */
export function registerWatchlist(
  context: vscode.ExtensionContext,
  opts?: {
    ui?: WatchlistUi;
    quoteFeed?: QuoteFeed;
    /** When false, skip `createTreeView` for `axis.watchlist`. Default true. */
    tree?: boolean;
    /** Palette add/remove/select. Studio uses this to repaint. */
    onPersisted?: (state: WatchlistV1) => void;
  },
): RegisterWatchlistResult {
  const helpers: WorkspaceStateHelpers = {
    get: <T>(key: string) => context.workspaceState.get<T>(key),
    update: (key, value) => context.workspaceState.update(key, value),
  };
  const ui = opts?.ui ?? defaultUi();
  let quoteFeed: QuoteFeed = opts?.quoteFeed ?? createMockQuoteFeed();
  let usingMockFeed = opts?.quoteFeed == null;

  const initial = readWatchlistV1(helpers);
  const provider = new WatchlistTreeProvider(initial, quoteFeed);
  /** Only assigned when `opts.tree !== false` (default). Studio wiring passes false. */
  let view: vscode.TreeView<WatchlistTreeNode> | undefined;

  // StatusBarAlignment may be absent when another Bun test's vscode mock wins.
  const alignLeft =
    (vscode as { StatusBarAlignment?: { Left?: number } }).StatusBarAlignment
      ?.Left ?? 1;
  const statusBar = vscode.window.createStatusBarItem(
    'axis.watchlist.quote',
    alignLeft,
    98,
  );
  statusBar.name = 'AXIS Watchlist Quote';
  statusBar.command = WATCHLIST_COMMANDS.add;

  const refreshStatusBar = (): void => {
    try {
      const state = provider.getState();
      const symbol = resolveWatchlistFocus(state);
      const quote = symbol ? quoteFeed.getQuote(symbol) : undefined;
      const label = formatWatchlistQuoteStatus({
        symbol,
        quote: quote ?? null,
        mock: usingMockFeed || quote == null,
      });
      statusBar.text = label.text;
      statusBar.tooltip = label.tooltip;
      statusBar.show();
    } catch {
      statusBar.text = '$(tag) AXIS Watchlist';
      statusBar.tooltip = 'AXIS watchlist';
      statusBar.show();
    }
  };

  const persist = async (next: WatchlistV1): Promise<void> => {
    provider.setState(next);
    await writeWatchlistV1(helpers, next);
    refreshStatusBar();
    try {
      opts?.onPersisted?.(next);
    } catch {
      /* studio refresh is best-effort */
    }
  };

  if (opts?.tree !== false) {
    view = vscode.window.createTreeView(WATCHLIST_VIEW_ID, {
      treeDataProvider: provider,
      showCollapseAll: false,
    });
    view.onDidChangeSelection((e) => {
      try {
        const node = e.selection[0];
        if (!node || node.kind !== 'symbol' || !node.symbol) return;
        const next = selectWatchlistSymbol(provider.getState(), node.symbol);
        void persist(next);
      } catch {
        /* ignore selection failures */
      }
    });
  }

  const addCmd = vscode.commands.registerCommand(
    WATCHLIST_COMMANDS.add,
    async () => {
      try {
        const raw = await ui.showInputBox({
          prompt: 'Add symbol to AXIS watchlist',
          placeHolder: 'BTCUSDT',
        });
        if (raw == null) return;
        const sym = normalizeWatchlistSymbol(raw);
        if (!sym) {
          ui.showErrorMessage('AXIS: Symbol cannot be empty.');
          return;
        }
        await persist(addWatchlistSymbol(provider.getState(), sym));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ui.showErrorMessage(`AXIS: Watchlist add failed: ${message}`);
      }
    },
  );

  const removeCmd = vscode.commands.registerCommand(
    WATCHLIST_COMMANDS.remove,
    async (node?: WatchlistTreeNode) => {
      try {
        let sym =
          node && node.kind === 'symbol' ? normalizeWatchlistSymbol(node.symbol) : '';
        if (!sym) {
          const state = provider.getState();
          if (state.symbols.length === 0) return;
          const focus = resolveWatchlistFocus(state);
          if (focus && state.symbols.length === 1) {
            sym = focus;
          } else {
            const picked = await ui.showQuickPick(state.symbols, {
              placeHolder: 'Remove symbol from AXIS watchlist',
            });
            sym = normalizeWatchlistSymbol(picked);
          }
        }
        if (!sym) return;
        await persist(removeWatchlistSymbol(provider.getState(), sym));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ui.showErrorMessage(`AXIS: Watchlist remove failed: ${message}`);
      }
    },
  );

  if (view) context.subscriptions.push(view, statusBar, addCmd, removeCmd);
  else context.subscriptions.push(statusBar, addCmd, removeCmd);
  refreshStatusBar();

  return {
    provider,
    refreshStatusBar,
    setQuoteFeed(feed: QuoteFeed) {
      quoteFeed = feed;
      usingMockFeed = false;
      provider.setQuoteFeed(feed);
      refreshStatusBar();
    },
  };
}
