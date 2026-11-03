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
 * Sidebar WebviewView for `axis.watchlist`.
 *
 * Does not register `axis.watchlist.add` / `axis.watchlist.remove` — those stay
 * on `registerWatchlist`. Does not create the TreeView. Wiring must call
 * `registerWatchlist(context, { tree: false })` for commands + status bar and
 * `registerWatchlistStudio(context)` for this view. See
 * `watchlist-studio-contributes.fragment.json`.
 */

import { existsSync } from 'node:fs';
import {
  ColorThemeKind,
  type ExtensionContext,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  Uri,
  window,
} from 'vscode';
import {
  WATCHLIST_VIEW_ID,
  addWatchlistSymbol,
  createMockQuoteFeed,
  readWatchlistV1,
  removeWatchlistSymbol,
  selectWatchlistSymbol,
  writeWatchlistV1,
  type QuoteFeed,
  type WatchlistV1,
  type WorkspaceStateHelpers,
} from './watchlist';
import { buildWatchlistWebviewHtml } from './watchlist-html';
import {
  buildWatchlistSnapshot,
  encodeWatchlistStudioSnapshot,
  parseWatchlistStudioMessage,
  type WatchlistQuoteSource,
} from './watchlist-studio-model';

function themeBodyClass(kind: ColorThemeKind): string {
  switch (kind) {
    case ColorThemeKind.Light:
      return 'vscode-light';
    case ColorThemeKind.HighContrast:
      return 'vscode-high-contrast';
    case ColorThemeKind.HighContrastLight:
      return 'vscode-high-contrast-light';
    default:
      return 'vscode-dark';
  }
}

function currentThemeBodyClass(): string {
  try {
    return themeBodyClass(window.activeColorTheme.kind);
  } catch {
    return 'vscode-dark';
  }
}

function watchlistAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'watchlist', file);
}

function getWatchlistHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = watchlistAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS watchlist webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview:watchlist`,
    );
  }
  const script = webview.asWebviewUri(watchlistAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = watchlistAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildWatchlistWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: scriptStr,
    styleUri: style || scriptStr.replace(/main\.js$/, 'main.css'),
    bodyClass: currentThemeBodyClass(),
  });
}

function fallbackHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!DOCTYPE html><html><body><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;
}

export type WatchlistStudioOptions = {
  /** Live feed. Omit for the mock placeholder (badge "placeholder", close 100). */
  quoteFeed?: QuoteFeed;
  /**
   * Force the placeholder badge. Default true when `quoteFeed` is omitted,
   * false when a feed is passed.
   */
  mock?: boolean;
  /**
   * After a successful `axis.watchlist.v1` write.
   * `registerWatchlist` returns `refreshStatusBar`, which reads provider state
   * — not workspaceState. Wiring should `provider.setState(state)` then
   * `refreshStatusBar()`. This module does not export a new watchlist.ts API.
   */
  onPersisted?: (state: WatchlistV1) => void;
};

/**
 * WebviewViewProvider for the Watchlist studio (`axis.watchlist`).
 * Mutates via `addWatchlistSymbol` / `removeWatchlistSymbol` /
 * `selectWatchlistSymbol` + `writeWatchlistV1`. Does not register commands.
 */
export class WatchlistStudioProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private feed: QuoteFeed;
  private mock: boolean;
  private readonly helpers: WorkspaceStateHelpers;
  private readonly onPersisted?: (state: WatchlistV1) => void;

  constructor(
    private readonly context: ExtensionContext,
    opts?: WatchlistStudioOptions,
  ) {
    this.feed = opts?.quoteFeed ?? createMockQuoteFeed();
    this.mock = opts?.mock ?? opts?.quoteFeed == null;
    this.onPersisted = opts?.onPersisted;
    this.helpers = {
      get: <T>(key: string) => this.context.workspaceState.get<T>(key),
      update: (key, value) => this.context.workspaceState.update(key, value),
    };
  }

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'watchlist'),
        ],
      };

      webview.onDidReceiveMessage((raw) => {
        return this.onMessage(webview, raw);
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getWatchlistHtml(webview, this.context.extensionUri);
      } catch (e) {
        try {
          webview.html = fallbackHtml(e);
        } catch {
          // html setter unavailable
        }
      }
    } catch {
      // never throw from resolve
    }
  }

  /** Replace the quote feed. `mock` defaults to false (a real feed was attached). */
  setQuoteFeed(feed: QuoteFeed, mock = false): void {
    this.feed = feed;
    this.mock = mock;
    this.postToResolved();
  }

  /** Re-read workspaceState and post a snapshot (palette add/remove catch-up). */
  postSnapshot(): void {
    this.postToResolved();
  }

  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts / disposing
    }
  }

  private quoteSource(): WatchlistQuoteSource {
    if (this.mock) return { mock: true };
    const feed = this.feed;
    return {
      mock: false,
      getQuote: (symbol) => {
        try {
          return feed.getQuote(symbol);
        } catch {
          return null;
        }
      },
    };
  }

  private postSnapshotTo(webview: Webview, state?: WatchlistV1): void {
    try {
      const current = state ?? readWatchlistV1(this.helpers);
      const snapshot = buildWatchlistSnapshot(current, this.quoteSource());
      void webview.postMessage(encodeWatchlistStudioSnapshot(snapshot));
    } catch {
      // disposing
    }
  }

  private postToResolved(): void {
    try {
      const webview = this.view?.webview;
      if (!webview) return;
      this.postSnapshotTo(webview);
    } catch {
      // disposing
    }
  }

  private async onMessage(webview: Webview, raw: unknown): Promise<void> {
    try {
      const msg = parseWatchlistStudioMessage(raw);
      if (!msg.ok) return;
      if (msg.type === 'ready') {
        this.postSnapshotTo(webview);
        return;
      }
      const current = readWatchlistV1(this.helpers);
      let next = current;
      if (msg.type === 'add') next = addWatchlistSymbol(current, msg.symbol);
      else if (msg.type === 'remove') next = removeWatchlistSymbol(current, msg.symbol);
      else next = selectWatchlistSymbol(current, msg.symbol);
      const wrote = await writeWatchlistV1(this.helpers, next);
      if (wrote) {
        try {
          this.onPersisted?.(next);
        } catch {
          // status bar hook is best-effort
        }
        this.postSnapshotTo(webview, next);
        return;
      }
      this.postSnapshotTo(webview, readWatchlistV1(this.helpers));
    } catch {
      // never throw into the webview host
    }
  }
}

/**
 * Register the Watchlist studio WebviewView (`axis.watchlist`).
 * Does not register add/remove commands and does not create a TreeView.
 */
export function registerWatchlistStudio(
  context: ExtensionContext,
  opts?: WatchlistStudioOptions,
): WatchlistStudioProvider {
  const provider = new WatchlistStudioProvider(context, opts);
  try {
    const disp = window.registerWebviewViewProvider(WATCHLIST_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    context.subscriptions.push(disp);
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
