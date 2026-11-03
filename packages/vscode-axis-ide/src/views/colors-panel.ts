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
  Range,
  Selection,
  TextEditorRevealType,
  Uri,
  env,
  window,
  workspace,
  type ExtensionContext,
  type TextDocument,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
} from 'vscode';
import { getColorsHtml } from './colors-html';
import {
  colorsSetMessage,
  isColorsReady,
  isColorsRefresh,
  isPineEditorLanguage,
  parseColorsCopy,
  parseColorsReveal,
  pineSourceLabel,
  scanColors,
} from './colors-messages';

export const COLORS_VIEW_ID = 'axis.colors';

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function createNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += NONCE_ALPHABET.charAt(Math.floor(Math.random() * NONCE_ALPHABET.length));
  }
  return text;
}

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

function colorsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'colors', file);
}

function getColorsWebviewHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = colorsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS colors webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
  const script = webview.asWebviewUri(colorsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = colorsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return getColorsHtml({
    cspSource: webview.cspSource,
    nonce: createNonce(),
    scriptUri: scriptStr,
    styleUri: style || scriptStr.replace(/main\.js$/, 'main.css'),
    bodyClass: currentThemeBodyClass(),
  });
}

function fallbackHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!DOCTYPE html><html><body><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;
}

/**
 * Bottom-panel Colors view (`axis.colors`).
 * Scans the active Pine editor and posts local `colors.set`.
 */
export class ColorsPanelProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;

  constructor(private readonly context: ExtensionContext) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'colors')],
      };

      webview.onDidReceiveMessage((raw) => {
        try {
          if (isColorsReady(raw) || isColorsRefresh(raw)) {
            this.refresh();
            return;
          }
          const copy = parseColorsCopy(raw);
          if (copy) {
            void this.copyText(copy.text);
            return;
          }
          const reveal = parseColorsReveal(raw);
          if (!reveal) return;
          this.revealLine(reveal.line);
        } catch {
          // untrusted message / disposing
        }
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getColorsWebviewHtml(webview, this.context.extensionUri);
      } catch (e) {
        try {
          webview.html = fallbackHtml(e);
        } catch {
          // html setter unavailable
        }
      }

      this.refresh();
    } catch {
      // never throw from resolve
    }
  }

  /** Rescan the active Pine editor, or clear the list when it is not Pine. */
  refresh(): void {
    const view = this.view;
    if (!view) return;
    try {
      const editor = window.activeTextEditor;
      const pine =
        editor && isPineEditorLanguage(editor.document.languageId) ? editor : undefined;
      const source = pine ? pine.document.getText() : '';
      const sourceLabel = pine
        ? pineSourceLabel(pine.document.fileName || pine.document.uri.fsPath)
        : 'No Pine editor';
      void view.webview.postMessage(colorsSetMessage(scanColors(source), sourceLabel));
    } catch {
      // disposing or unreadable document
    }
  }

  /** Document edits refresh only the active Pine editor. */
  refreshIfDocument(document: TextDocument): void {
    try {
      const editor = window.activeTextEditor;
      if (!editor || editor.document !== document) return;
      if (!isPineEditorLanguage(editor.document.languageId)) return;
      this.refresh();
    } catch {
      // editor host unavailable
    }
  }

  private revealLine(line: number): void {
    const editor = window.activeTextEditor;
    if (!editor || !isPineEditorLanguage(editor.document.languageId)) return;
    const last = Math.max(0, editor.document.lineCount - 1);
    const index = Math.min(Math.max(0, line - 1), last);
    const textLine = editor.document.lineAt(index);
    const range = new Range(textLine.range.start, textLine.range.end);
    editor.selection = new Selection(range.start, range.end);
    editor.revealRange(range, TextEditorRevealType.InCenter);
  }

  private async copyText(text: string): Promise<void> {
    try {
      await env.clipboard.writeText(text);
    } catch {
      try {
        void window.showWarningMessage('AXIS: Could not copy the color.');
      } catch {
        // window unavailable
      }
    }
  }
}

/** Register `axis.colors` in the panel container. `retainContextWhenHidden` is false. */
export function registerColorsPanel(context: ExtensionContext): ColorsPanelProvider {
  const provider = new ColorsPanelProvider(context);
  try {
    context.subscriptions.push(
      window.registerWebviewViewProvider(COLORS_VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: false },
      }),
      window.onDidChangeActiveTextEditor(() => {
        provider.refresh();
      }),
      workspace.onDidChangeTextDocument((event) => {
        provider.refreshIfDocument(event.document);
      }),
    );
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
