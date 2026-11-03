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
import { TextDecoder } from 'node:util';
import {
  ColorThemeKind,
  TabInputCustom,
  TabInputText,
  Uri,
  type ExtensionContext,
  type Tab,
  type TextDocument,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  commands,
  window,
  workspace,
} from 'vscode';
import { CHART_VIEW_TYPE, parseChartDocument } from '../editors/chart-document';
import { getChartLiveDoc, mergeChartDoc, subscribeChartLiveDoc } from '../editors/chart-live-doc';
import { LAYERS_VIEW_ID } from './layers';
import { buildLayersWebviewHtml } from './layers-html';
import {
  buildLayersSnapshot,
  encodeLayersSet,
  parseLayersWebMessage,
  type LayersSnapshotInput,
} from './layers-messages';

const OPTIONAL_DOC_KEYS = [
  'panes',
  'overlays',
  'onChain',
  'onchain',
  'on-chain',
] as const;

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

function layersAssetPath(extensionUri: Uri, file: string): Uri {
  return Uri.joinPath(extensionUri, 'dist', 'webview', 'layers', file);
}

function isAxisJsonName(name: string): boolean {
  return /\.axis\.json$/i.test(name);
}

function isAxisJsonUri(uri: Uri | undefined | null): uri is Uri {
  try {
    if (!uri) return false;
    const name = uri.fsPath || uri.path || '';
    return isAxisJsonName(name);
  } catch {
    return false;
  }
}

function isChartDocument(doc: TextDocument | undefined): doc is TextDocument {
  try {
    if (!doc) return false;
    const name = doc.fileName || doc.uri?.fsPath || doc.uri?.path || '';
    return isAxisJsonName(name);
  } catch {
    return false;
  }
}

function uriFromTab(tab: Tab | undefined): Uri | null {
  try {
    const input = tab?.input;
    if (!input || typeof input !== 'object') return null;
    if (input instanceof TabInputCustom) {
      if (input.viewType === CHART_VIEW_TYPE || isAxisJsonUri(input.uri)) return input.uri;
      return null;
    }
    if (input instanceof TabInputText) {
      return isAxisJsonUri(input.uri) ? input.uri : null;
    }
    const bag = input as { uri?: Uri; viewType?: string };
    if (bag.viewType === CHART_VIEW_TYPE && bag.uri) return bag.uri;
    if (isAxisJsonUri(bag.uri)) return bag.uri;
    return null;
  } catch {
    return null;
  }
}

/**
 * Active chart tab wins; otherwise the first open `*.axis.json` / `axis.chart` tab.
 * Text documents cover a custom editor that is not the active text editor.
 */
function findOpenChartUri(): Uri | null {
  try {
    const activeTab = uriFromTab(window.tabGroups?.activeTabGroup?.activeTab);
    if (activeTab) return activeTab;
    const activeDoc = window.activeTextEditor?.document;
    if (isChartDocument(activeDoc)) return activeDoc.uri;
    const groups = window.tabGroups?.all ?? [];
    for (const group of groups) {
      for (const tab of group?.tabs ?? []) {
        const uri = uriFromTab(tab);
        if (uri) return uri;
      }
    }
    for (const editor of window.visibleTextEditors ?? []) {
      if (isChartDocument(editor?.document)) return editor.document.uri;
    }
    for (const doc of workspace.textDocuments ?? []) {
      if (isChartDocument(doc)) return doc.uri;
    }
  } catch {
    // hostile host
  }
  return null;
}

function textOfOpenDocument(uri: Uri): string | null {
  try {
    const key = uri.toString();
    for (const doc of workspace.textDocuments ?? []) {
      try {
        if (doc.uri.toString() !== key) continue;
        return doc.getText();
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function readChartText(uri: Uri): Promise<string | null> {
  const open = textOfOpenDocument(uri);
  if (open != null) return open;
  try {
    const bytes = await workspace.fs.readFile(uri);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function hasOwnKey(obj: Record<string, unknown>, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(obj, key);
  } catch {
    return false;
  }
}

/**
 * Scripts and drawings come from `parseChartDocument`.
 * Panes, overlays, and on-chain are copied only when the file has that key —
 * the parser injects a default price pane, which is not a layer row.
 */
function inputFromChartText(text: string): LayersSnapshotInput {
  let parsed: ReturnType<typeof parseChartDocument>;
  try {
    parsed = parseChartDocument(text);
  } catch {
    return { chartOpen: true };
  }
  if (!parsed.ok) return { chartOpen: true };
  let raw: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      raw = value as Record<string, unknown>;
    }
  } catch {
    raw = null;
  }
  const doc: Record<string, unknown> = {
    drawings: parsed.doc.drawings,
  };
  if (raw && hasOwnKey(raw, 'scripts')) {
    doc.scripts = parsed.doc.scripts;
  } else if (raw && hasOwnKey(raw, 'scriptIds')) {
    doc.scriptIds = raw.scriptIds;
  } else {
    doc.scripts = parsed.doc.scripts;
  }
  if (raw) {
    for (const key of OPTIONAL_DOC_KEYS) {
      if (hasOwnKey(raw, key)) doc[key] = raw[key];
    }
  }
  return { chartOpen: true, doc };
}

function asDocRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readLayersInput(): Promise<LayersSnapshotInput> {
  try {
    const uri = findOpenChartUri();
    if (!uri) return { chartOpen: false };
    const live = getChartLiveDoc(uri.toString());
    const text = await readChartText(uri);
    if (text == null) {
      if (!live) return { chartOpen: true };
      const doc = mergeChartDoc(null, live);
      return doc ? { chartOpen: true, doc } : { chartOpen: true };
    }
    const parsed = inputFromChartText(text);
    if (!live) return parsed;
    const doc = mergeChartDoc(asDocRecord(parsed.doc), live);
    if (!doc) return parsed;
    return { chartOpen: true, doc };
  } catch {
    return { chartOpen: false };
  }
}

function getLayersHtml(webview: Webview, extensionUri: Uri): string {
  const mainJs = layersAssetPath(extensionUri, 'main.js');
  let jsPath = '';
  try {
    jsPath = mainJs.fsPath;
  } catch {
    jsPath = '';
  }
  const hasJs = Boolean(jsPath) && existsSync(jsPath);
  if (!hasJs) {
    throw new Error(
      `AXIS layers webview assets missing at ${jsPath || 'unknown'}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
  const script = webview.asWebviewUri(layersAssetPath(extensionUri, 'main.js'));
  const scriptStr = script.toString();
  const styleUri = layersAssetPath(extensionUri, 'main.css');
  let style = '';
  try {
    if (existsSync(styleUri.fsPath)) {
      style = webview.asWebviewUri(styleUri).toString();
    }
  } catch {
    style = '';
  }
  return buildLayersWebviewHtml({
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
 * Sidebar WebviewView for Layers (`axis.layers`).
 * Posts `layers.set` on ready and when the active editor or an open chart changes.
 */
export class LayersStudioProvider implements WebviewViewProvider {
  private view: WebviewView | undefined;
  private epoch = 0;

  constructor(private readonly context: ExtensionContext) {}

  resolveWebviewView(webviewView: WebviewView): void {
    try {
      this.view = webviewView;
      const { webview } = webviewView;
      webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'layers'),
        ],
      };
      webview.onDidReceiveMessage((raw) => {
        this.onMessage(raw);
      });
      webviewView.onDidDispose(() => {
        if (this.view === webviewView) this.view = undefined;
      });
      try {
        webview.html = getLayersHtml(webview, this.context.extensionUri);
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

  /** Push a fresh snapshot if the view is resolved. */
  refresh(): void {
    void this.refreshSoon();
  }

  private onMessage(raw: unknown): void {
    try {
      const msg = parseLayersWebMessage(raw);
      if (!msg) return;
      if (msg.type === 'layers.ready') {
        this.refresh();
        return;
      }
      try {
        void commands.executeCommand('axis.openChart');
      } catch {
        // command missing in this host
      }
    } catch {
      // never throw into the webview host
    }
  }

  private async refreshSoon(): Promise<void> {
    const token = ++this.epoch;
    let input: LayersSnapshotInput = { chartOpen: false };
    try {
      input = await readLayersInput();
    } catch {
      input = { chartOpen: false };
    }
    if (token !== this.epoch) return;
    this.postSnapshot(input);
  }

  private postSnapshot(input: LayersSnapshotInput): void {
    try {
      const webview = this.view?.webview;
      if (!webview) return;
      void webview.postMessage(encodeLayersSet(buildLayersSnapshot(input)));
    } catch {
      // disposing
    }
  }
}

function subscribe(context: ExtensionContext, provider: LayersStudioProvider): void {
  const bump = (): void => {
    try {
      provider.refresh();
    } catch {
      // never throw from a host event
    }
  };
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(() => bump()),
    window.onDidChangeVisibleTextEditors(() => bump()),
    workspace.onDidOpenTextDocument(() => bump()),
    workspace.onDidCloseTextDocument(() => bump()),
    workspace.onDidChangeTextDocument((event) => {
      try {
        if (isChartDocument(event.document)) bump();
      } catch {
        // ignore
      }
    }),
    { dispose: subscribeChartLiveDoc(() => bump()) },
  );
  try {
    context.subscriptions.push(window.tabGroups.onDidChangeTabs(() => bump()));
  } catch {
    // tab API unavailable
  }
}

/**
 * Register the Layers WebviewView (`axis.layers`) instead of the Layers tree.
 * Retains the webview while the view is hidden. Never throws.
 */
export function registerLayersStudio(context: ExtensionContext): LayersStudioProvider | undefined {
  try {
    const provider = new LayersStudioProvider(context);
    const disp = window.registerWebviewViewProvider(LAYERS_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
    context.subscriptions.push(disp);
    subscribe(context, provider);
    return provider;
  } catch {
    return undefined;
  }
}
