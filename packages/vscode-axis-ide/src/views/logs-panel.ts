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
  Position,
  Range,
  Selection,
  TextEditorRevealType,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  window,
} from 'vscode';
import { attachLogsStore, encodeLogsSet, parseLogsWebMessage } from './logs-messages';
import { buildLogsWebviewHtml } from './logs-html';

export const LOGS_VIEW_ID = 'axis.logs';

/** PYNE contributes `pinescript`. `pine` / `pyne` are accepted aliases. */
const PINE_LANGUAGE_IDS = new Set(['pinescript', 'pine', 'pyne']);

const NO_EDITOR = 'No active Pine script editor to reveal that line.';

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

function logsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'logs', file);
}

function assertLogsAssets(extensionUri: Uri): void {
  const mainJs = logsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  if (!jsPath || !existsSync(jsPath)) {
    throw new Error(
      `AXIS logs webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview:logs`,
    );
  }
}

function getLogsHtml(webview: Webview, extensionUri: Uri): string {
  assertLogsAssets(extensionUri);
  const script = webview.asWebviewUri(logsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = logsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildLogsWebviewHtml({
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

function revealLogLine(line: number): void {
  try {
    if (!Number.isInteger(line) || line < 1) return;
    const editor = window.activeTextEditor;
    const lang = editor?.document.languageId ?? '';
    if (!editor || !PINE_LANGUAGE_IDS.has(lang) || editor.document.lineCount < 1) {
      void window.showInformationMessage(NO_EDITOR);
      return;
    }
    const index = Math.min(line, editor.document.lineCount) - 1;
    const pos = new Position(index, 0);
    editor.selection = new Selection(pos, pos);
    editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenter);
  } catch {
    try {
      void window.showInformationMessage(NO_EDITOR);
    } catch {
      // host unavailable
    }
  }
}

/**
 * Panel WebviewViewProvider for script logs (`axis.logs`).
 * Subscribes to ResultsFocusStore the same way as `attachProfiler`.
 */
export class LogsWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private record: unknown = null;
  private readonly detachResults: () => void;

  constructor(
    private readonly context: ExtensionContext,
    resultsStore: unknown,
  ) {
    this.detachResults = attachLogsStore(resultsStore, (record) => {
      this.record = record;
      this.post();
    });
  }

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'logs')],
      };

      webview.onDidReceiveMessage((raw) => {
        this.onMessage(raw);
      });

      webviewView.onDidChangeVisibility(() => {
        try {
          if (webviewView.visible) this.post();
        } catch {
          // disposing
        }
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getLogsHtml(webview, this.context.extensionUri);
      } catch (err) {
        try {
          webview.html = fallbackHtml(err);
        } catch {
          // html setter unavailable
        }
      }
      this.post();
    } catch {
      // never throw from resolve
    }
  }

  /** Test / host helper — drop the results subscription. */
  dispose(): void {
    try {
      this.detachResults();
    } catch {
      // ignore
    }
    this.view = undefined;
  }

  private post(): void {
    try {
      const webview = this.view?.webview;
      if (!webview) return;
      void webview.postMessage(encodeLogsSet(this.record));
    } catch {
      // disposing
    }
  }

  private onMessage(raw: unknown): void {
    try {
      const msg = parseLogsWebMessage(raw);
      if (!msg || msg.type === 'logs.filter') return;
      if (msg.type === 'logs.ready') {
        this.post();
        return;
      }
      revealLogLine(msg.line);
    } catch {
      // never throw into the webview host
    }
  }
}

/**
 * Register the Logs WebviewView (`axis.logs`).
 * `retainContextWhenHidden` is false. Never throws.
 */
export function registerLogsPanel(
  context: ExtensionContext,
  resultsStore: unknown,
): LogsWebviewViewProvider | undefined {
  try {
    const provider = new LogsWebviewViewProvider(context, resultsStore);
    context.subscriptions.push(
      window.registerWebviewViewProvider(LOGS_VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: false },
      }),
      { dispose: () => provider.dispose() },
    );
    return provider;
  } catch {
    return undefined;
  }
}
