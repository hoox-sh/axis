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
  type CancellationToken,
  CancellationError,
  ColorThemeKind,
  type CustomDocument,
  type CustomDocumentBackup,
  type CustomDocumentBackupContext,
  type CustomDocumentContentChangeEvent,
  type CustomDocumentOpenContext,
  type CustomEditorProvider,
  type ExtensionContext,
  type Uri,
  type Webview,
  type WebviewPanel,
  EventEmitter,
  Uri as UriClass,
  window,
  workspace,
} from 'vscode';
import { buildChartSession } from '../host/chart-session';
import { logProtocolReject, logWarn } from '../host/logger';
import { encode, HOST_TO_VIEW } from '../protocol';
import {
  type AxisChartDocV1,
  CHART_VIEW_TYPE,
  parseChartDocument,
  serializeChartDocument,
} from './chart-document';
import { buildChartWebviewHtml } from './chart-html';
import { handleChartWebviewMessage } from './chart-messages';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function bytesToString(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function stringToBytes(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function throwIfCancelled(cancellation: CancellationToken): void {
  if (cancellation.isCancellationRequested) {
    throw new CancellationError();
  }
}

/** Editable chart workspace document (`*.axis.json`). */
export class AxisChartDocument implements CustomDocument {
  private readonly _onDidDispose = new EventEmitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChange =
    new EventEmitter<CustomDocumentContentChangeEvent<AxisChartDocument>>();
  /** Content-change dirty (no undo stack yet — KD-4 early path). */
  readonly onDidChange = this._onDidChange.event;

  /** Fired after revert/reload without marking dirty — webviews should refresh. */
  private readonly _onDidRefresh = new EventEmitter<AxisChartDocument>();
  readonly onDidRefresh = this._onDidRefresh.event;

  private _doc: AxisChartDocV1;
  private _disposed = false;

  private constructor(
    readonly uri: Uri,
    doc: AxisChartDocV1,
  ) {
    this._doc = doc;
  }

  /**
   * Open from disk or backup. Empty file → default chart doc.
   * Invalid JSON / non-object root → throws (never silently overwrite on Save).
   */
  static async create(
    uri: Uri,
    backupId: string | undefined,
  ): Promise<AxisChartDocument> {
    let bytes: Uint8Array;
    try {
      if (backupId) {
        bytes = await workspace.fs.readFile(UriClass.parse(backupId));
      } else {
        try {
          bytes = await workspace.fs.readFile(uri);
        } catch {
          // New / missing file — empty chart workspace.
          bytes = stringToBytes('');
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`AXIS chart: failed to read document: ${message}`);
    }

    const parsed = parseChartDocument(bytesToString(bytes));
    if (!parsed.ok) {
      throw new Error(
        `AXIS chart: invalid document at ${uri.toString()}: ${parsed.error}`,
      );
    }
    return new AxisChartDocument(uri, parsed.doc);
  }

  get documentData(): AxisChartDocV1 {
    return this._doc;
  }

  /** Replace document content and mark dirty via content-change event. */
  update(doc: AxisChartDocV1): void {
    if (this._disposed) return;
    this._doc = doc;
    this._onDidChange.fire({ document: this });
  }

  async save(cancellation: CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
  }

  async saveAs(target: Uri, cancellation: CancellationToken): Promise<void> {
    if (this._disposed) {
      throw new Error('AXIS chart: cannot save a disposed document');
    }
    throwIfCancelled(cancellation);
    const bytes = stringToBytes(serializeChartDocument(this._doc));
    throwIfCancelled(cancellation);
    await workspace.fs.writeFile(target, bytes);
    throwIfCancelled(cancellation);
  }

  /**
   * Reload from disk. Does **not** fire content-change (would re-dirty).
   * Fires `onDidRefresh` so open webviews can re-init.
   */
  async revert(cancellation: CancellationToken): Promise<void> {
    if (this._disposed) return;
    throwIfCancelled(cancellation);
    let bytes: Uint8Array;
    try {
      bytes = await workspace.fs.readFile(this.uri);
    } catch {
      bytes = stringToBytes('');
    }
    throwIfCancelled(cancellation);
    if (this._disposed) return;
    const parsed = parseChartDocument(bytesToString(bytes));
    if (!parsed.ok) {
      throw new Error(`AXIS chart: revert failed: ${parsed.error}`);
    }
    this._doc = parsed.doc;
    // Do not fire _onDidChange — that marks dirty again after a clean revert.
    this._onDidRefresh.fire(this);
  }

  async backup(
    destination: Uri,
    cancellation: CancellationToken,
  ): Promise<CustomDocumentBackup> {
    throwIfCancelled(cancellation);
    await this.saveAs(destination, cancellation);
    throwIfCancelled(cancellation);
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await workspace.fs.delete(destination);
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
    this._onDidChange.dispose();
    this._onDidRefresh.dispose();
  }
}

function chartAssetPath(extensionUri: Uri, file: string): Uri {
  return UriClass.joinPath(extensionUri, 'dist', 'webview', 'chart', file);
}

function assertChartAssets(extensionUri: Uri): void {
  const mainJs = chartAssetPath(extensionUri, 'main.js');
  if (!existsSync(mainJs.fsPath)) {
    throw new Error(
      `AXIS chart webview assets missing at ${mainJs.fsPath}. Run: bun run --cwd packages/vscode-axis-ide compile:webview`,
    );
  }
}

function getChartHtml(webview: Webview, extensionUri: Uri): string {
  assertChartAssets(extensionUri);
  const script = webview.asWebviewUri(chartAssetPath(extensionUri, 'main.js'));
  const style = webview.asWebviewUri(chartAssetPath(extensionUri, 'main.css'));
  return buildChartWebviewHtml({
    cspSource: webview.cspSource,
    scriptUri: script.toString(),
    styleUri: style.toString(),
    bodyClass: themeBodyClass(window.activeColorTheme.kind),
  });
}

/** Read chart settings + document into a fresh session (no stale init closure). */
function sessionForDocument(document: AxisChartDocument) {
  const cfg = workspace.getConfiguration('axis.chart');
  let useMockBars = true;
  let historyBarsSetting: number | undefined;
  try {
    useMockBars = cfg.get<boolean>('useMockBars', true) !== false;
    const hb = cfg.get<number>('historyBars');
    if (typeof hb === 'number' && Number.isFinite(hb)) historyBarsSetting = hb;
  } catch {
    useMockBars = true;
  }
  return buildChartSession({
    doc: document.documentData,
    useMockBars,
    historyBarsSetting,
  });
}

function postHandshake(
  webview: Webview,
  session: ReturnType<typeof sessionForDocument>,
): void {
  try {
    void webview.postMessage(encode(HOST_TO_VIEW.ChartInit, session.init));
    if (session.full) {
      void webview.postMessage(encode(HOST_TO_VIEW.ChartFull, session.full));
    }
  } catch {
    // panel may be disposing
  }
}

class AxisChartEditorProvider implements CustomEditorProvider<AxisChartDocument> {
  private readonly _onDidChangeCustomDocument = new EventEmitter<
    CustomDocumentContentChangeEvent<AxisChartDocument>
  >();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  /** Open webview panels per document — refresh on revert without re-dirty. */
  private readonly panels = new WeakMap<AxisChartDocument, Set<WebviewPanel>>();

  constructor(private readonly context: ExtensionContext) {}

  private trackPanel(document: AxisChartDocument, panel: WebviewPanel): void {
    let set = this.panels.get(document);
    if (!set) {
      set = new Set();
      this.panels.set(document, set);
    }
    set.add(panel);
  }

  private untrackPanel(document: AxisChartDocument, panel: WebviewPanel): void {
    const set = this.panels.get(document);
    if (!set) return;
    set.delete(panel);
  }

  private refreshPanels(document: AxisChartDocument): void {
    const set = this.panels.get(document);
    if (!set) return;
    const session = sessionForDocument(document);
    for (const panel of set) {
      postHandshake(panel.webview, session);
    }
  }

  async openCustomDocument(
    uri: Uri,
    openContext: CustomDocumentOpenContext,
    _token: CancellationToken,
  ): Promise<AxisChartDocument> {
    const document = await AxisChartDocument.create(uri, openContext.backupId);
    const changeSub = document.onDidChange((e) => {
      this._onDidChangeCustomDocument.fire(e);
    });
    const refreshSub = document.onDidRefresh((doc) => {
      this.refreshPanels(doc);
    });
    document.onDidDispose(() => {
      changeSub.dispose();
      refreshSub.dispose();
    });
    return document;
  }

  async resolveCustomEditor(
    document: AxisChartDocument,
    webviewPanel: WebviewPanel,
    _token: CancellationToken,
  ): Promise<void> {
    let disposed = false;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        UriClass.joinPath(this.context.extensionUri, 'dist', 'webview', 'chart'),
        UriClass.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    // Register message handler BEFORE assigning html — webview posts ready synchronously.
    // Rebuild session on every ready (hide→show re-posts; must not close over resolve-time snapshot).
    const msgSub = webviewPanel.webview.onDidReceiveMessage((raw) => {
      if (disposed) return;
      const result = handleChartWebviewMessage(raw, () => {
        const session = sessionForDocument(document);
        return { init: session.init, full: session.full };
      });
      if (disposed) return;
      if (result.kind === 'reject') {
        let typeHint: string | undefined;
        try {
          if (
            raw !== null &&
            typeof raw === 'object' &&
            !Array.isArray(raw) &&
            typeof (raw as { type?: unknown }).type === 'string'
          ) {
            typeHint = (raw as { type: string }).type;
          }
        } catch {
          typeHint = undefined;
        }
        logProtocolReject(result.error, typeHint);
        return;
      }
      if (result.kind === 'init') {
        if (disposed) return;
        try {
          void webviewPanel.webview.postMessage(result.envelope);
          if (result.full && !disposed) {
            void webviewPanel.webview.postMessage(result.full);
          }
        } catch {
          // panel may be disposing
        }
      }
    });

    this.trackPanel(document, webviewPanel);

    try {
      webviewPanel.webview.html = getChartHtml(
        webviewPanel.webview,
        this.context.extensionUri,
      );
    } catch (e) {
      disposed = true;
      msgSub.dispose();
      this.untrackPanel(document, webviewPanel);
      const message = e instanceof Error ? e.message : String(e);
      logWarn(message);
      void window.showErrorMessage(message);
      throw e;
    }

    webviewPanel.onDidDispose(() => {
      disposed = true;
      msgSub.dispose();
      this.untrackPanel(document, webviewPanel);
    });
  }

  saveCustomDocument(
    document: AxisChartDocument,
    cancellation: CancellationToken,
  ): Thenable<void> {
    return document.save(cancellation);
  }

  saveCustomDocumentAs(
    document: AxisChartDocument,
    destination: Uri,
    cancellation: CancellationToken,
  ): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  revertCustomDocument(
    document: AxisChartDocument,
    cancellation: CancellationToken,
  ): Thenable<void> {
    return document.revert(cancellation);
  }

  backupCustomDocument(
    document: AxisChartDocument,
    context: CustomDocumentBackupContext,
    cancellation: CancellationToken,
  ): Thenable<CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }
}

/** Register `axis.chart` CustomEditorProvider (editable, not Readonly). */
export function registerChartEditorProvider(
  context: ExtensionContext,
): { dispose(): void } {
  const provider = new AxisChartEditorProvider(context);
  return window.registerCustomEditorProvider(CHART_VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: false },
    supportsMultipleEditorsPerDocument: true,
  });
}
