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
 * Bottom-panel Symbols webview (`axis.symbols`).
 * Inserts at the active text editor cursor. Copy uses the host clipboard.
 * "Inserted" / "Copied" are announced by the webview, not the host.
 */

import { existsSync } from 'node:fs';
import {
  type ExtensionContext,
  type Position,
  type TextEditor,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  env,
  window,
} from 'vscode';
import { buildSymbolsWebviewHtml } from './symbols-html';
import { encodeSymbolsSet, listSymbols, parseSymbolsWebMessage } from './symbols-messages';

export const SYMBOLS_VIEW_ID = 'axis.symbols';

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NO_EDITOR = 'AXIS: Open an editor to insert a symbol.';
const INSERT_FAILED = 'AXIS: Could not insert the symbol.';
const COPY_FAILED = 'AXIS: Could not copy the symbol.';

function createNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += NONCE_ALPHABET.charAt(Math.floor(Math.random() * NONCE_ALPHABET.length));
  }
  return text;
}

function symbolsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'symbols', file);
}

function getSymbolsHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = symbolsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS symbols webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview:symbols`,
    );
  }
  const script = webview.asWebviewUri(symbolsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = symbolsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildSymbolsWebviewHtml({
    cspSource: webview.cspSource,
    nonce: createNonce(),
    scriptUri: scriptStr,
    styleUri: style || scriptStr.replace(/main\.js$/, 'main.css'),
  });
}

function fallbackHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : 'AXIS symbols webview failed to load.';
  return `<!DOCTYPE html><html lang="en"><body><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;
}

function warn(message: string): void {
  try {
    void window.showWarningMessage(message);
  } catch {
    // window unavailable
  }
}

function insertPositions(editor: TextEditor): Position[] {
  const selections = editor.selections?.length ? editor.selections : [editor.selection];
  const seen = new Set<string>();
  const positions: Position[] = [];
  for (const selection of selections) {
    const at = selection?.active;
    if (!at) continue;
    const key = `${at.line}:${at.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push(at);
  }
  return positions;
}

async function insertSymbolText(text: string): Promise<void> {
  let editor: TextEditor | undefined;
  try {
    editor = window.activeTextEditor;
  } catch {
    editor = undefined;
  }
  if (!editor) {
    warn(NO_EDITOR);
    return;
  }
  try {
    const positions = insertPositions(editor);
    if (positions.length === 0) {
      warn(INSERT_FAILED);
      return;
    }
    const ok = await editor.edit((builder) => {
      for (const at of positions) builder.insert(at, text);
    });
    if (!ok) warn(INSERT_FAILED);
  } catch {
    warn(INSERT_FAILED);
  }
}

async function copySymbolText(text: string): Promise<void> {
  try {
    await env.clipboard.writeText(text);
  } catch {
    warn(COPY_FAILED);
  }
}

/**
 * WebviewViewProvider for the Symbols panel (`axis.symbols`).
 * Posts the full catalog on resolve (`symbols.set`).
 */
export class SymbolsPanelProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private readonly context: ExtensionContext) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'symbols')],
      };

      webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      });

      webviewView.onDidDispose(() => {
        this.clearTimers();
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getSymbolsHtml(webview, this.context.extensionUri);
      } catch (error) {
        try {
          webview.html = fallbackHtml(error);
        } catch {
          // html setter unavailable
        }
        return;
      }
      this.scheduleCatalog();
    } catch {
      // never throw from resolve
    }
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** Post now and twice more so a late webview script still receives the catalog. */
  private scheduleCatalog(): void {
    this.clearTimers();
    this.postCatalog();
    for (const delay of [0, 50, 200]) {
      const timer = setTimeout(() => this.postCatalog(), delay);
      this.timers.push(timer);
    }
  }

  private postCatalog(): void {
    const webview = this.view?.webview;
    if (!webview) return;
    try {
      void webview.postMessage(encodeSymbolsSet(listSymbols(), '', ''));
    } catch {
      // disposing
    }
  }

  private async onMessage(raw: unknown): Promise<void> {
    const msg = parseSymbolsWebMessage(raw);
    if (!msg) return;
    if (msg.type === 'symbols.copy') {
      await copySymbolText(msg.text);
      return;
    }
    await insertSymbolText(msg.text);
  }
}

/** Register the Symbols bottom-panel view (`axis.symbols`). */
export function registerSymbolsPanel(context: ExtensionContext): void {
  const provider = new SymbolsPanelProvider(context);
  try {
    const disp = window.registerWebviewViewProvider(SYMBOLS_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: false },
    });
    try {
      context.subscriptions.push(disp);
    } catch {
      // subscriptions unavailable
    }
  } catch {
    // uncontributed view id / test host
  }
}
