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
import { buildWorkersWebviewHtml } from './workers-html';
import {
  encodeWorkersInit,
  encodeWorkersState,
  parseWorkersStudioMessage,
} from './workers-studio-model';
import {
  WORKERS_VIEW_ID,
  formatWorkerProbeDescription,
  getLastWorkersSnapshot,
  listWorkerCatalog,
  probeAllWorkers,
  probeWorker,
  type WorkerId,
  type WorkerProbeResult,
  type WorkersOverviewSnapshot,
} from './workers';

export const WORKERS_STUDIO_VIEW_ID = WORKERS_VIEW_ID;

const PROBE_TIMEOUT_MS = 4000;

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

function workersAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'workers', file);
}

function getWorkersHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = workersAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS workers webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
  const script = webview.asWebviewUri(workersAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = workersAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildWorkersWebviewHtml({
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

/** Drop response bodies before they reach the webview model. */
function presentResult(result: WorkerProbeResult): WorkerProbeResult {
  const badge = formatWorkerProbeDescription(result) ?? '';
  let detail = '';
  if (result.status === 'down' || result.status === 'degraded') {
    const err = String(result.error ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const leak =
      /token|secret|password|authorization|bearer/i.test(err) ||
      err.startsWith('{') ||
      err.startsWith('[');
    detail = !err || leak || err.length > 160 ? badge || result.status : err.slice(0, 80);
  }
  return { ...result, detail, error: detail || null };
}

function presentSnapshot(
  snap: WorkersOverviewSnapshot | null,
): WorkersOverviewSnapshot | null {
  if (!snap) return null;
  try {
    return { ...snap, results: snap.results.map((row) => presentResult(row)) };
  } catch {
    return null;
  }
}

/**
 * Sidebar WebviewViewProvider for Workers (`axis.workers`).
 * Posts `workers.init` / `workers.state`. Probe calls never throw.
 */
export class WorkersStudioWebviewProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private cache: WorkersOverviewSnapshot | null = null;
  private seq = 0;

  constructor(private readonly context: ExtensionContext) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'workers'),
        ],
      };

      webview.onDidReceiveMessage((raw) => {
        return this.onMessage(webview, raw);
      });

      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });

      try {
        webview.html = getWorkersHtml(webview, this.context.extensionUri);
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

  /** Push a probe snapshot into the resolved webview (palette command wiring). */
  postSnapshot(snap: WorkersOverviewSnapshot | null): void {
    try {
      this.cache = snap;
      const webview = this.view?.webview;
      if (!webview) return;
      this.post(webview, 'workers.state');
    } catch {
      // disposing
    }
  }

  reveal(): void {
    try {
      this.view?.show?.(true);
    } catch {
      // older hosts / disposing
    }
  }

  private currentSnapshot(): WorkersOverviewSnapshot | null {
    if (this.cache) return this.cache;
    try {
      return getLastWorkersSnapshot();
    } catch {
      return null;
    }
  }

  private post(webview: Webview, kind: 'workers.init' | 'workers.state'): void {
    try {
      let catalog: unknown = [];
      try {
        catalog = listWorkerCatalog();
      } catch {
        catalog = [];
      }
      const snap = presentSnapshot(this.currentSnapshot());
      const msg =
        kind === 'workers.init'
          ? encodeWorkersInit(catalog, snap)
          : encodeWorkersState(catalog, snap);
      void webview.postMessage(msg);
    } catch {
      // disposing
    }
  }

  private mergeResult(result: WorkerProbeResult): void {
    const prev = this.currentSnapshot();
    const map = new Map<string, WorkerProbeResult>();
    if (prev) {
      for (const row of prev.results) map.set(row.id, row);
    }
    map.set(result.id, result);
    let catalog: readonly { id: WorkerId }[] = [];
    try {
      catalog = listWorkerCatalog();
    } catch {
      catalog = [];
    }
    const results: WorkerProbeResult[] = [];
    for (const entry of catalog) {
      const hit = map.get(entry.id);
      if (hit) results.push(hit);
    }
    if (!catalog.some((entry) => entry.id === result.id)) results.push(result);
    this.cache = {
      results,
      healthy: results.filter((row) => row.status === 'healthy').length,
      degraded: results.filter((row) => row.status === 'degraded').length,
      down: results.filter((row) => row.status === 'down').length,
      unknown: results.filter(
        (row) =>
          row.status === 'unknown' ||
          row.status === 'idle' ||
          row.status === 'skipped',
      ).length,
      checkedAt: Date.now(),
    };
  }

  private async probeAll(webview: Webview): Promise<void> {
    const seq = ++this.seq;
    try {
      const snap = await probeAllWorkers({ timeoutMs: PROBE_TIMEOUT_MS });
      if (seq !== this.seq) return;
      this.cache = snap;
      this.post(webview, 'workers.state');
    } catch {
      if (seq !== this.seq) return;
      this.post(webview, 'workers.state');
    }
  }

  private async probeOne(webview: Webview, id: string): Promise<void> {
    const seq = ++this.seq;
    try {
      const result = await probeWorker(id as WorkerId, { timeoutMs: PROBE_TIMEOUT_MS });
      if (seq !== this.seq) return;
      this.mergeResult(result);
      this.post(webview, 'workers.state');
    } catch {
      if (seq !== this.seq) return;
      this.post(webview, 'workers.state');
    }
  }

  private async onMessage(webview: Webview, raw: unknown): Promise<void> {
    try {
      const msg = parseWorkersStudioMessage(raw);
      if (!msg) return;
      if (msg.type === 'workers.ready') {
        this.post(webview, 'workers.init');
        return;
      }
      if (msg.type === 'workers.probeAll') {
        await this.probeAll(webview);
        return;
      }
      if (msg.type === 'workers.probe') {
        await this.probeOne(webview, msg.id);
      }
    } catch {
      // never throw into the webview host
    }
  }
}

export function registerWorkersStudio(
  context: ExtensionContext,
): WorkersStudioWebviewProvider {
  const provider = new WorkersStudioWebviewProvider(context);
  try {
    const disp = window.registerWebviewViewProvider(WORKERS_STUDIO_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    context.subscriptions.push(disp);
  } catch {
    // uncontributed view id / test host
  }
  return provider;
}
