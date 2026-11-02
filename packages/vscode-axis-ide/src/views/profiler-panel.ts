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
  ProfilerStore,
  attachProfiler,
  encodeProfilerSet,
} from '../run/profiler-store';
import type { ResultsFocusStore } from '../run/results-store';
import { buildProfilerWebviewHtml } from './profiler-html';

export const PROFILER_VIEW_ID = 'axis.profiler';

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

function profilerAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'profiler', file);
}

function assertProfilerAssets(extensionUri: Uri): void {
  const mainJs = profilerAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS profiler webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
}

function getProfilerHtml(webview: Webview, extensionUri: Uri): string {
  assertProfilerAssets(extensionUri);
  const script = webview.asWebviewUri(profilerAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = profilerAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildProfilerWebviewHtml({
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

function isProfilerReady(raw: unknown): boolean {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const type = (raw as { type?: unknown }).type;
    return type === 'profiler.ready' || type === 'results.ready';
  } catch {
    return false;
  }
}

function postSet(webview: Webview, profiler: ProfilerStore): void {
  try {
    void webview.postMessage(encodeProfilerSet(profiler.getSnapshot()));
  } catch {
    // disposing
  }
}

/**
 * Panel WebviewViewProvider for last-run Profiler (`axis.profiler`).
 * Subscribes to ResultsFocusStore via {@link attachProfiler}; posts `profiler.set`.
 */
export class ProfilerWebviewViewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private unsub: (() => void) | undefined;
  private readonly detachResults: () => void;
  readonly profiler: ProfilerStore;

  constructor(
    private readonly context: ExtensionContext,
    private readonly results: ResultsFocusStore,
    profiler?: ProfilerStore,
  ) {
    this.profiler = profiler ?? new ProfilerStore();
    this.detachResults = attachProfiler(this.results, this.profiler);
  }

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'profiler'),
        ],
      };

      webview.onDidReceiveMessage((raw) => {
        if (!isProfilerReady(raw)) return;
        postSet(webview, this.profiler);
      });

      this.unsub?.();
      this.unsub = this.profiler.subscribe(() => {
        if (!this.view) return;
        postSet(this.view.webview, this.profiler);
      });

      webviewView.onDidDispose(() => {
        this.unsub?.();
        this.unsub = undefined;
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getProfilerHtml(webview, this.context.extensionUri);
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

  /** Reveal the panel if resolved (best-effort). */
  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts / disposing
    }
  }

  /** Test helper — drop Results subscription. */
  dispose(): void {
    try {
      this.unsub?.();
    } catch {
      // ignore
    }
    this.unsub = undefined;
    try {
      this.detachResults();
    } catch {
      // ignore
    }
  }
}

export function createProfilerProvider(
  context: ExtensionContext,
  store: ResultsFocusStore,
  profiler?: ProfilerStore,
): ProfilerWebviewViewProvider {
  return new ProfilerWebviewViewProvider(context, store, profiler);
}
