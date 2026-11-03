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
 * Scripts studio WebviewView (`axis.indicators`).
 *
 * Last run: `ResultsFocusStore.subscribe` exists (`src/run/results-store.ts`).
 * Pass the store as the optional focus argument — this panel subscribes and
 * does not poll. `pushScriptsRunCard` / `notifyScriptsStudio` remain for a
 * host that has not passed the store.
 *
 * Apply uses `runApplyBuiltin` with a one-row catalog so the posted id is
 * opened as untitled pinescript. `axis.applyBuiltin` itself is a QuickPick
 * and cannot target an id; this panel does not call that command.
 */

import { existsSync } from 'node:fs';
import {
  ColorThemeKind,
  type ExtensionContext,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  Uri,
  commands,
  window,
  workspace,
} from 'vscode';
import {
  APPLY_BUILTIN_LOAD_FAILED_PREFIX,
  type ApplyBuiltinUi,
  runApplyBuiltin,
} from '../host/apply-builtin';
import { getBuiltinById, loadBuiltinCatalog } from '../host/builtins';
import { PINE_LANGUAGE_ID } from '../host/open-chart';
import { buildScriptsWebviewHtml } from './scripts-html';
import {
  SCRIPTS_OPEN_CHART_COMMAND,
  SCRIPTS_RUN_COMMAND,
  buildScriptsSnapshot,
  encodeScriptsNotice,
  encodeScriptsSet,
  parseScriptsWebMessage,
  type ScriptSuggestion,
} from './scripts-messages';

export const SCRIPTS_VIEW_ID = 'axis.indicators';

/**
 * Structural lookalike of `ResultsFocusStore`.
 * Real store: `subscribe(listener)`, `getLastRun()`, snapshot `{ lastRun }`.
 */
export type ResultsFocusLike = {
  subscribe?: (
    listener: (snapshot: unknown, reason?: unknown) => void,
  ) => () => void;
  getLastRun?: () => unknown;
};

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

function scriptsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'scripts', file);
}

function assertScriptsAssets(extensionUri: Uri): void {
  const mainJs = scriptsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS scripts webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview:scripts`,
    );
  }
}

function getScriptsHtml(webview: Webview, extensionUri: Uri): string {
  assertScriptsAssets(extensionUri);
  const script = webview.asWebviewUri(scriptsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = scriptsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildScriptsWebviewHtml({
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

function loadSuggestions(extensionPath: string): ScriptSuggestion[] {
  try {
    const loaded = loadBuiltinCatalog(extensionPath);
    if (!loaded.ok) return [];
    return buildScriptsSnapshot({ suggestions: loaded.catalog.scripts }).suggestions;
  } catch {
    return [];
  }
}

async function executeNamed(command: string): Promise<boolean> {
  try {
    await commands.executeCommand(command);
    return true;
  } catch {
    return false;
  }
}

/** Apply one builtin id via `runApplyBuiltin` (source stays in the host). */
async function applyBuiltinById(extensionPath: string, id: string): Promise<boolean> {
  try {
    const loaded = loadBuiltinCatalog(extensionPath);
    if (!loaded.ok) {
      void window.showErrorMessage(`${APPLY_BUILTIN_LOAD_FAILED_PREFIX}${loaded.error}`);
      return false;
    }
    const entry = getBuiltinById(loaded.catalog.scripts, id);
    if (!entry) {
      void window.showErrorMessage(`AXIS: Builtin not found: ${id}`);
      return false;
    }
    const ui: ApplyBuiltinUi = {
      async showQuickPick(items) {
        return items.find((item) => item.builtin.id === id) ?? items[0];
      },
      async openUntitledPine(code, languageId) {
        const doc = await workspace.openTextDocument({
          content: code,
          language: languageId,
        });
        await window.showTextDocument(doc, { preview: false });
      },
      showErrorMessage(message) {
        void window.showErrorMessage(message);
      },
    };
    const result = await runApplyBuiltin({
      scripts: [entry],
      ui,
      languageId: PINE_LANGUAGE_ID,
    });
    return result.status === 'applied';
  } catch {
    return false;
  }
}

/**
 * Sidebar WebviewViewProvider for Scripts (`axis.indicators`).
 * Suggestions are titles only — Pine `code` is never posted.
 */
export class ScriptsStudioProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private detachFocus: (() => void) | undefined;
  private lastRunRaw: unknown = null;
  private readonly suggestions: ScriptSuggestion[];

  constructor(
    private readonly context: ExtensionContext,
    focus?: ResultsFocusLike,
  ) {
    this.suggestions = loadSuggestions(context.extensionPath);
    this.attachFocus(focus);
  }

  private attachFocus(focus: ResultsFocusLike | undefined): void {
    if (!focus) return;
    try {
      const initial = focus.getLastRun?.();
      if (initial != null) this.lastRunRaw = initial;
    } catch {
      // hostile store
    }
    if (typeof focus.subscribe !== 'function') return;
    try {
      this.detachFocus = focus.subscribe((snapshot) => {
        this.lastRunRaw = snapshot ?? null;
        this.postSet();
      });
    } catch {
      this.detachFocus = undefined;
    }
  }

  /** Replace the last-run record (manual push or store snapshot). */
  applyLastRun(summary: unknown): void {
    this.lastRunRaw = summary ?? null;
    this.postSet();
  }

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'scripts'),
        ],
      };

      webview.onDidReceiveMessage((raw) => {
        void this.onMessage(raw);
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getScriptsHtml(webview, this.context.extensionUri);
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

  private post(message: unknown): void {
    try {
      void this.view?.webview.postMessage(message);
    } catch {
      // disposing
    }
  }

  private postSet(): void {
    this.post(
      encodeScriptsSet({
        lastRun: this.lastRunRaw,
        suggestions: this.suggestions,
      }),
    );
  }

  private postNotice(text: string): void {
    this.post(encodeScriptsNotice(text));
  }

  private async onMessage(raw: unknown): Promise<void> {
    const msg = parseScriptsWebMessage(raw);
    if (!msg) return;
    if (msg.type === 'scripts.ready') {
      this.postSet();
      return;
    }
    if (msg.type === 'scripts.run') {
      const ok = await executeNamed(SCRIPTS_RUN_COMMAND);
      if (ok) this.postNotice('Run started');
      return;
    }
    if (msg.type === 'scripts.openChart') {
      await executeNamed(SCRIPTS_OPEN_CHART_COMMAND);
      return;
    }
    if (msg.type === 'scripts.apply') {
      const applied = await applyBuiltinById(this.context.extensionPath, msg.id);
      if (applied) this.postNotice('Applied');
    }
  }

  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts
    }
  }

  dispose(): void {
    try {
      this.detachFocus?.();
    } catch {
      // ignore
    }
    this.detachFocus = undefined;
    this.view = undefined;
  }
}

let studio: ScriptsStudioProvider | undefined;

/**
 * Register the Scripts WebviewView (`axis.indicators`).
 * Optional `focus` is a `ResultsFocusStore` (subscribe + getLastRun).
 */
export function registerScriptsStudio(
  context: ExtensionContext,
  focus?: ResultsFocusLike,
): ScriptsStudioProvider {
  const provider = new ScriptsStudioProvider(context, focus);
  studio = provider;
  try {
    context.subscriptions.push(
      window.registerWebviewViewProvider(SCRIPTS_VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  } catch {
    // uncontributed view id / test host
  }
  try {
    context.subscriptions.push({ dispose: () => provider.dispose() });
  } catch {
    // subscriptions missing
  }
  return provider;
}

/** Push a last-run summary when activate did not pass the results store. */
export function pushScriptsRunCard(summary: unknown): void {
  try {
    studio?.applyLastRun(summary);
  } catch {
    // ignore
  }
}

/** Alias of {@link pushScriptsRunCard} for wiring notes. */
export function notifyScriptsStudio(summary: unknown): void {
  pushScriptsRunCard(summary);
}
