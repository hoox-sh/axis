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
  workspace,
} from 'vscode';
import { runActivatePluginCommand } from './activate-command';
import { readActivePlugins, type WorkspaceStateHelpers } from './active';
import { buildPluginsWebviewHtml } from './plugins-html';
import {
  buildPluginCards,
  decodePluginsWebToHost,
  encodePluginsInit,
  encodePluginsState,
  parsePluginsFlags,
  type PluginsFlags,
} from './plugins-messages';
import type { HostPluginRegistry } from './registry';

export const PLUGINS_WEBVIEW_VIEW_ID = 'axis.plugins';

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

function pluginsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'plugins', file);
}

function readBoolSetting(section: string, key: string): boolean {
  try {
    return workspace.getConfiguration(section).get(key) === true;
  } catch {
    return false;
  }
}

/** Workspace config flags for the plugins studio (never throws). */
export function readPluginsFlags(): PluginsFlags {
  return parsePluginsFlags({
    allowPyodide: readBoolSetting('axis.engine', 'allowPyodide'),
    liveEnabled: readBoolSetting('axis.live', 'enabled'),
    allowUrlInstall: readBoolSetting('axis.plugins', 'allowUrlInstall'),
  });
}

function getPluginsHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = pluginsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS plugins webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
  const script = webview.asWebviewUri(pluginsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = pluginsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildPluginsWebviewHtml({
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

/**
 * Sidebar WebviewViewProvider for the Plugins studio (`axis.plugins`).
 * Posts `plugins.init` on `plugins.ready`; `plugins.state` after activate.
 */
export class PluginsWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly registry: HostPluginRegistry,
    private readonly helpers: WorkspaceStateHelpers,
    private readonly refreshTrees?: () => void | Thenable<void>,
  ) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'plugins'),
        ],
      };

      // Register message handler BEFORE assigning html (chart-editor lesson).
      webview.onDidReceiveMessage((raw) => {
        return this.onMessage(webview, raw);
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getPluginsHtml(webview, this.context.extensionUri);
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

  /** Push `plugins.state` to the resolved webview (best-effort). */
  postState(): void {
    try {
      const webview = this.view?.webview;
      if (!webview) return;
      this.postStateTo(webview);
    } catch {
      // disposing
    }
  }

  /** Reveal the panel if resolved (best-effort). */
  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts / disposing
    }
  }

  private listCards(flags: PluginsFlags) {
    let list: unknown = [];
    try {
      list = this.registry.listAll();
    } catch {
      list = [];
    }
    return buildPluginCards(list, flags);
  }

  private postInit(webview: Webview): void {
    const flags = readPluginsFlags();
    void webview.postMessage(
      encodePluginsInit(this.listCards(flags), readActivePlugins(this.helpers), flags),
    );
  }

  private postStateTo(webview: Webview): void {
    const flags = readPluginsFlags();
    void webview.postMessage(
      encodePluginsState(readActivePlugins(this.helpers), flags),
    );
  }

  private async onMessage(webview: Webview, raw: unknown): Promise<void> {
    try {
      const msg = decodePluginsWebToHost(raw);
      if (!msg) return;
      if (msg.type === 'plugins.ready') {
        this.postInit(webview);
        return;
      }
      if (msg.type === 'plugins.activate') {
        await runActivatePluginCommand(
          this.helpers,
          { kind: msg.kind, id: msg.id },
          this.refreshTrees,
        );
        this.postStateTo(webview);
      }
    } catch {
      // never throw into the webview host
    }
  }
}

export function registerPluginsWebviewView(
  context: ExtensionContext,
  registry: HostPluginRegistry,
  helpers: WorkspaceStateHelpers,
  refreshTrees?: () => void | Thenable<void>,
): PluginsWebviewViewProvider {
  const provider = new PluginsWebviewViewProvider(
    context,
    registry,
    helpers,
    refreshTrees,
  );
  try {
    const disp = window.registerWebviewViewProvider(
      PLUGINS_WEBVIEW_VIEW_ID,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(disp);
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
