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
import {
  addAlert,
  ALERTS_VIEW_ID,
  readAlertsV1,
  registerAlertsView,
  removeAlert,
  sanitizeAlertEntry,
  writeAlertsV1,
  type AlertEntry,
  type WorkspaceStateHelpers,
} from './alerts';
import { buildAlertsWebviewHtml } from './alerts-html';
import {
  ALERTS_REMOVED,
  ALERTS_TITLE_REQUIRED,
  buildAlertsSnapshot,
  parseAlertsStudioMessage,
} from './alerts-studio-model';

export const ALERTS_STUDIO_VIEW_ID = ALERTS_VIEW_ID;

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

function alertsAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'alerts', file);
}

function getAlertsHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = alertsAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS alerts webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview:alerts`,
    );
  }
  const script = webview.asWebviewUri(alertsAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = alertsAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildAlertsWebviewHtml({
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

/** Flip `enabled` on one stored row. Unknown ids are a no-op. Never throws. */
async function toggleAlertEnabled(
  state: WorkspaceStateHelpers,
  id: string,
): Promise<boolean> {
  try {
    const list = readAlertsV1(state);
    let found = false;
    const next: AlertEntry[] = [];
    for (const entry of list) {
      if (entry.id !== id) {
        next.push(entry);
        continue;
      }
      found = true;
      const flipped = sanitizeAlertEntry({
        id: entry.id,
        title: entry.title,
        condition: entry.condition,
        enabled: !entry.enabled,
      });
      next.push(flipped ?? entry);
    }
    if (!found) return false;
    return writeAlertsV1(state, next);
  } catch {
    return false;
  }
}

/**
 * Sidebar WebviewViewProvider for Alerts (`axis.alerts`).
 * Commands stay on `registerAlertsView`; this provider only owns the webview.
 */
export class AlertsStudioWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;

  constructor(
    private readonly context: ExtensionContext,
    private readonly state: WorkspaceStateHelpers,
  ) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'alerts'),
        ],
      };

      let messageSub: { dispose(): void } | undefined;
      try {
        messageSub = webview.onDidReceiveMessage((raw) => {
          void this.onMessage(webview, raw);
        });
      } catch {
        messageSub = undefined;
      }

      webviewView.onDidDispose(() => {
        try {
          messageSub?.dispose();
        } catch {
          // already disposed
        }
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getAlertsHtml(webview, this.context.extensionUri);
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

  /** Push `alerts.set` when the view is resolved (best-effort). */
  postSnapshot(): void {
    try {
      const webview = this.view?.webview;
      if (!webview) return;
      this.postSnapshotTo(webview);
    } catch {
      // disposing
    }
  }

  private postSnapshotTo(webview: Webview): void {
    try {
      void webview.postMessage({
        type: 'alerts.set',
        payload: buildAlertsSnapshot(readAlertsV1(this.state)),
      });
    } catch {
      // disposing
    }
  }

  private postFlash(webview: Webview, text: string): void {
    try {
      void webview.postMessage({ type: 'alerts.flash', text });
    } catch {
      // disposing
    }
  }

  private async onMessage(webview: Webview, raw: unknown): Promise<void> {
    try {
      const msg = parseAlertsStudioMessage(raw);
      if (!msg) return;
      if (msg.type === 'alerts.ready') {
        this.postSnapshotTo(webview);
        return;
      }
      if (msg.type === 'alerts.add') {
        if (!msg.title) {
          this.postFlash(webview, ALERTS_TITLE_REQUIRED);
          return;
        }
        const created = await addAlert(this.state, {
          title: msg.title,
          ...(msg.condition ? { condition: msg.condition } : {}),
        });
        if (!created) return;
        this.postSnapshotTo(webview);
        return;
      }
      if (msg.type === 'alerts.toggle') {
        await toggleAlertEnabled(this.state, msg.id);
        this.postSnapshotTo(webview);
        return;
      }
      if (msg.type === 'alerts.remove') {
        const ok = await removeAlert(this.state, msg.id);
        this.postSnapshotTo(webview);
        if (ok) this.postFlash(webview, ALERTS_REMOVED);
      }
    } catch {
      // never throw into the webview host
    }
  }
}

/**
 * WebviewView for `axis.alerts` plus the existing add/remove commands.
 * Does not register those commands again and does not create a TreeView.
 */
export function registerAlertsStudio(
  context: ExtensionContext,
): AlertsStudioWebviewViewProvider {
  const registered = registerAlertsView(context, { tree: false });
  const provider = new AlertsStudioWebviewViewProvider(context, registered.state);
  const tree = registered.provider;
  const previous = tree.refresh.bind(tree);
  (tree as { refresh: () => void }).refresh = () => {
    try {
      previous();
    } catch {
      // tree emitter is best-effort
    }
    provider.postSnapshot();
  };
  try {
    context.subscriptions.push(
      window.registerWebviewViewProvider(ALERTS_STUDIO_VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
