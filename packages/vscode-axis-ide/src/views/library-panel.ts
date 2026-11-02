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
  type ExtensionContext,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  commands,
  env,
  window,
  workspace,
} from 'vscode';
import {
  APPLY_BUILTIN_COMMAND,
  APPLY_BUILTIN_LOAD_FAILED_PREFIX,
  runApplyBuiltin,
} from '../host/apply-builtin';
import {
  type BuiltinCatalogEntry,
  getBuiltinById,
  loadBuiltinCatalog,
} from '../host/builtins';
import { LIBRARY_VIEW_ID } from './library';
import { libraryStudioHtml } from './library-html';
import { parseLibraryWebMessage, toLibraryHostMessage } from './library-messages';

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function createNonce(): string {
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += NONCE_ALPHABET.charAt(Math.floor(Math.random() * NONCE_ALPHABET.length));
  }
  return text;
}

function libraryAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'library', file);
}

function getLibraryHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = libraryAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS library webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
  const script = webview.asWebviewUri(libraryAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = libraryAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return libraryStudioHtml({
    cspSource: webview.cspSource,
    nonce: createNonce(),
    scriptUri: scriptStr,
    cssUri: style || scriptStr.replace(/main\.js$/, 'main.css'),
  });
}

function fallbackHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `<!DOCTYPE html><html><body><p>${message.replace(/[<>&]/g, '')}</p></body></html>`;
}

/**
 * Sidebar WebviewViewProvider for the builtin Library studio (`axis.library`).
 * Posts `library.init` (cards only — no Pine source) on `library.ready`.
 */
export class LibraryWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private scripts: BuiltinCatalogEntry[] = [];
  private catalogError = '';

  constructor(private readonly context: ExtensionContext) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'library'),
        ],
      };

      webview.onDidReceiveMessage((raw) => {
        void this.onMessage(webview, raw);
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getLibraryHtml(webview, this.context.extensionUri);
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

  private loadCatalog(): void {
    try {
      const loaded = loadBuiltinCatalog(this.context.extensionPath);
      if (!loaded.ok) {
        this.scripts = [];
        this.catalogError = loaded.error;
        return;
      }
      this.scripts = [...loaded.catalog.scripts];
      this.catalogError = '';
    } catch (e) {
      this.scripts = [];
      this.catalogError = e instanceof Error ? e.message : String(e);
    }
  }

  private postInit(webview: Webview): void {
    this.loadCatalog();
    try {
      void webview.postMessage(
        toLibraryHostMessage('library.init', this.scripts, this.catalogError),
      );
    } catch {
      // disposing
    }
  }

  /** Apply one catalog id without the QuickPick. `runApplyBuiltin` always prompts, so the UI auto-accepts this id. */
  private async applyId(id: string): Promise<void> {
    let loaded: ReturnType<typeof loadBuiltinCatalog>;
    try {
      loaded = loadBuiltinCatalog(this.context.extensionPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      void window.showErrorMessage(`${APPLY_BUILTIN_LOAD_FAILED_PREFIX} ${message}`);
      return;
    }
    if (!loaded.ok) {
      void window.showErrorMessage(`${APPLY_BUILTIN_LOAD_FAILED_PREFIX} ${loaded.error}`);
      return;
    }
    const entry = getBuiltinById(loaded.catalog.scripts, id);
    if (!entry) {
      void window.showInformationMessage(
        `AXIS: "${id}" is not in the offline catalog. Opening the builtin picker.`,
      );
      try {
        await commands.executeCommand(APPLY_BUILTIN_COMMAND);
      } catch {
        // command unwired
      }
      return;
    }
    try {
      const result = await runApplyBuiltin({
        scripts: [entry],
        ui: {
          async showQuickPick(items) {
            return items.find((item) => item.builtin.id === entry.id) ?? items[0];
          },
          async openUntitledPine(code, languageId) {
            const doc = await workspace.openTextDocument({
              content: code,
              language: languageId,
            });
            await window.showTextDocument(doc);
          },
          showErrorMessage(message) {
            void window.showErrorMessage(message);
          },
        },
      });
      if (result.status === 'applied') {
        const title = result.builtin?.title || entry.title;
        void window.showInformationMessage(`AXIS: Applied builtin "${title}".`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      void window.showErrorMessage(`AXIS: Apply builtin failed: ${message}`);
      void window.showInformationMessage(`AXIS: Could not apply "${entry.title}" directly.`);
      try {
        await commands.executeCommand(APPLY_BUILTIN_COMMAND);
      } catch {
        // command unwired
      }
    }
  }

  private async onMessage(webview: Webview, raw: unknown): Promise<void> {
    try {
      const msg = parseLibraryWebMessage(raw);
      if (!msg) return;
      if (msg.type === 'library.ready') {
        this.postInit(webview);
        return;
      }
      if (msg.type === 'library.copy') {
        try {
          await env.clipboard.writeText(msg.id);
        } catch {
          // clipboard optional — the webview already flashed "Copied"
        }
        return;
      }
      if (msg.type === 'library.apply') {
        await this.applyId(msg.id);
      }
    } catch {
      // never throw into the webview host
    }
  }
}

/** Register the Library studio on view id `axis.library` (replaces the tree view). */
export function registerLibraryStudio(context: ExtensionContext): void {
  const provider = new LibraryWebviewViewProvider(context);
  try {
    const disp = window.registerWebviewViewProvider(LIBRARY_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
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
