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
import { logProtocolReject } from '../host/logger';
import type { ResultsFocusStore } from '../run/results-store';
import { buildResultsWebviewHtml, type ResultsPanelKind } from './results-html';
import { encodeResultsSet, handleResultsWebviewMessage } from './results-messages';

export const RESULTS_VIEW_ID = 'axis.results';
export const STRATEGY_VIEW_ID = 'axis.strategy';

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

function resultsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'results', file);
}

function assertResultsAssets(extensionUri: Uri): void {
  const mainJs = resultsAssetPath(extensionUri, 'main.js');
  if (!existsSync(mainJs.fsPath)) {
    throw new Error(
      `AXIS results webview assets missing at ${mainJs.fsPath}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
}

function getResultsHtml(
  webview: Webview,
  extensionUri: Uri,
  kind: ResultsPanelKind,
): string {
  assertResultsAssets(extensionUri);
  const script = webview.asWebviewUri(resultsAssetPath(extensionUri, 'main.js'));
  const styleUri = resultsAssetPath(extensionUri, 'main.css');
  const style = existsSync(styleUri.fsPath)
    ? webview.asWebviewUri(styleUri).toString()
    : '';
  return buildResultsWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: script.toString(),
    styleUri: style || script.toString().replace(/main\.js$/, 'main.css'),
    bodyClass: themeBodyClass(window.activeColorTheme.kind),
    kind,
  });
}

function postSet(webview: Webview, store: ResultsFocusStore): void {
  try {
    void webview.postMessage(encodeResultsSet(store));
  } catch {
    // disposing
  }
}

/**
 * Shared WebviewViewProvider for Results and Strategy panels.
 * Posts `results.set` on focus changes and on `results.ready`.
 */
export class ResultsWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private unsub: (() => void) | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly store: ResultsFocusStore,
    private readonly kind: ResultsPanelKind,
  ) {}

  resolveWebviewView(webviewView: WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'results'),
      ],
    };

    try {
      webview.html = getResultsHtml(webview, this.context.extensionUri, this.kind);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      webview.html = `<!DOCTYPE html><html><body><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;
      return;
    }

    // Listener before any ready reply — host may respond synchronously.
    webview.onDidReceiveMessage((raw) => {
      const handle = handleResultsWebviewMessage(raw, this.store);
      if (handle.kind === 'reject') {
        logProtocolReject(handle.error, 'results');
        return;
      }
      if (handle.kind === 'ready' || handle.kind === 'focus') {
        try {
          void webview.postMessage(handle.set);
        } catch {
          // disposing
        }
      }
    });

    this.unsub?.();
    this.unsub = this.store.subscribe((snapshot, reason) => {
      if (!this.view) return;
      // Only push when focus/lastRun changed, or explicit ready notify.
      if (reason === 'publish' && !snapshot.focusChanged) return;
      postSet(this.view.webview, this.store);
    });

    webviewView.onDidDispose(() => {
      this.unsub?.();
      this.unsub = undefined;
      if (this.view === webviewView) this.view = undefined;
    });
  }

  /** Reveal the panel if resolved (best-effort). */
  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts / disposing
    }
  }
}

export function createResultsProvider(
  context: ExtensionContext,
  store: ResultsFocusStore,
): ResultsWebviewViewProvider {
  return new ResultsWebviewViewProvider(context, store, 'results');
}

export function createStrategyProvider(
  context: ExtensionContext,
  store: ResultsFocusStore,
): ResultsWebviewViewProvider {
  return new ResultsWebviewViewProvider(context, store, 'strategy');
}
