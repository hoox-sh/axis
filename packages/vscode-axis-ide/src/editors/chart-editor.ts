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
import {
  CHART_HISTORY_SEQ,
  buildChartSession,
  resolveMockBarCount,
} from '../host/chart-session';
import {
  DEFAULT_DATAFEED_URL,
  fetchHistorical,
} from '../host/history-client';
import { logError, logProtocolReject, logWarn } from '../host/logger';
import { encode, HOST_TO_VIEW } from '../protocol';
import { getLastChartFull, notifyChart, subscribeChartNotify } from '../run/chart-bus';
import { readActivePlugins, workspaceStateFromContext } from '../plugins/active';
import {
  chartPluginsFromActive,
  subscribeActivePlugins,
  type ChartPluginIds,
} from '../plugins/events';
import type { ActivePluginsV1 } from '../plugins/types';
import {
  type AxisChartDocV1,
  CHART_VIEW_TYPE,
  parseChartDocument,
  serializeChartDocument,
} from './chart-document';
import { appendDrawingToDoc } from './chart-drawings';
import { setChartLiveDoc } from './chart-live-doc';
import { isPyodideAllowed } from '../host/pyodide-profile';
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

/** Read `axis.engine.allowPyodide` (default false; never throws). */
function readAllowPyodide(): boolean {
  try {
    return isPyodideAllowed(
      workspace.getConfiguration('axis.engine').get<boolean>('allowPyodide', false),
    );
  } catch {
    return false;
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
    allowPyodide: readAllowPyodide(),
  });
}

interface ChartHostSettings {
  useMockBars: boolean;
  historyBarsSetting?: number;
  datafeedUrl: string;
  allowRemote: boolean;
}

/** Read chart + datafeed settings (never throws). */
function readChartHostSettings(): ChartHostSettings {
  let useMockBars = false;
  let historyBarsSetting: number | undefined;
  let datafeedUrl = DEFAULT_DATAFEED_URL;
  let allowRemote = false;
  try {
    const cfg = workspace.getConfiguration('axis.chart');
    // Mock bars are opt-in; HistoryClient is the dogfood default.
    useMockBars = cfg.get<boolean>('useMockBars', false) === true;
    const hb = cfg.get<number>('historyBars');
    if (typeof hb === 'number' && Number.isFinite(hb)) historyBarsSetting = hb;
  } catch {
    useMockBars = false;
  }
  try {
    const df = workspace.getConfiguration('axis.datafeed');
    const url = df.get<string>('url');
    if (typeof url === 'string' && url.trim()) datafeedUrl = url.trim();
  } catch {
    // keep default
  }
  try {
    allowRemote =
      workspace.getConfiguration('axis.engine').get<boolean>('allowRemoteEndpoint', false) ===
      true;
  } catch {
    allowRemote = false;
  }
  return { useMockBars, historyBarsSetting, datafeedUrl, allowRemote };
}

function pluginsForContext(context: ExtensionContext): ChartPluginIds | undefined {
  try {
    return chartPluginsFromActive(readActivePlugins(workspaceStateFromContext(context)));
  } catch {
    return undefined;
  }
}

/** Read chart settings + document into a fresh session (no stale init closure). */
function sessionForDocument(document: AxisChartDocument, context: ExtensionContext) {
  const settings = readChartHostSettings();
  return buildChartSession({
    doc: document.documentData,
    useMockBars: settings.useMockBars,
    historyBarsSetting: settings.historyBarsSetting,
    plugins: pluginsForContext(context),
  });
}

/** Publish in-memory chart fields so Layers can see unsaved drawings. */
function publishLiveChartDoc(document: AxisChartDocument): void {
  const next = document.documentData;
  const live: {
    drawings?: unknown;
    scripts?: unknown;
    panes?: unknown;
    overlays?: unknown;
  } = {};
  if ('drawings' in next) live.drawings = next.drawings;
  if ('scripts' in next) live.scripts = next.scripts;
  if ('panes' in next) live.panes = next.panes;
  if ('overlays' in next) live.overlays = (next as { overlays?: unknown }).overlays;
  setChartLiveDoc(document.uri.toString(), live);
}

/** Post cached run chart.full so hide→show / late open keeps paint. */
function replayLastRunFull(webview: Webview, seriesKey: string): void {
  try {
    const last = getLastChartFull(seriesKey);
    if (!last || last.type !== 'chart.full') return;
    void webview.postMessage(encode(HOST_TO_VIEW.ChartFull, last.payload));
  } catch {
    // panel may be disposing
  }
}

/**
 * After handshake empty clear, fetch venue bars and post chart.full at history seq.
 * On failure: host.error + log — leave empty clear (do not silently mock).
 */
async function paintHistoryAfterHandshake(
  webview: Webview,
  document: AxisChartDocument,
  seriesKey: string,
  signal: AbortSignal,
  isDisposed: () => boolean,
): Promise<void> {
  const settings = readChartHostSettings();
  if (settings.useMockBars) return;
  const doc = document.documentData;
  const limit = resolveMockBarCount(doc.historyBars, settings.historyBarsSetting);
  const history = await fetchHistorical({
    exchange: doc.exchange || 'binance',
    symbol: doc.symbol,
    timeframe: doc.interval || '1m',
    limit,
    baseUrl: settings.datafeedUrl,
    allowRemote: settings.allowRemote,
    signal,
  });
  if (isDisposed() || signal.aborted) return;
  if (!history.ok) {
    const message = history.error;
    logError(message);
    try {
      void webview.postMessage(
        encode(HOST_TO_VIEW.HostError, { code: 'HISTORY_FETCH', message }),
      );
    } catch {
      // disposing
    }
    return;
  }
  try {
    void webview.postMessage(
      encode(HOST_TO_VIEW.ChartFull, {
        bars: history.bars,
        seq: CHART_HISTORY_SEQ,
      }),
    );
    // Replay run paint only after history so a lower history seq cannot clobber it.
    if (!isDisposed()) replayLastRunFull(webview, seriesKey);
  } catch {
    // panel may be disposing
  }
}

function postHandshake(
  webview: Webview,
  session: ReturnType<typeof sessionForDocument>,
  opts?: {
    document?: AxisChartDocument;
    signal?: AbortSignal;
    isDisposed?: () => boolean;
  },
): void {
  try {
    if (opts?.document) publishLiveChartDoc(opts.document);
    void webview.postMessage(encode(HOST_TO_VIEW.ChartInit, session.init));
    if (session.full) {
      void webview.postMessage(encode(HOST_TO_VIEW.ChartFull, session.full));
    }
    if (session.useMockBars) {
      replayLastRunFull(webview, session.seriesKey);
      return;
    }
    // Mock off: clear already posted; fetch history then replay run (if any).
    if (opts?.document && opts.signal && opts.isDisposed) {
      void paintHistoryAfterHandshake(
        webview,
        opts.document,
        session.seriesKey,
        opts.signal,
        opts.isDisposed,
      );
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
  /** Strong refs + seriesKey so run-bus can filter which panels receive paint. */
  private readonly openPanels = new Map<
    WebviewPanel,
    {
      seriesKey: string;
      historyAbort?: AbortController;
      document?: AxisChartDocument;
    }
  >();
  private readonly busSub: { dispose(): void };
  private readonly pluginsSub: { dispose(): void };
  private lastSourceId = '';
  private readonly onRequestReload: (() => void) | undefined;

  constructor(
    private readonly context: ExtensionContext,
    opts?: ChartEditorProviderOptions,
  ) {
    this.onRequestReload = opts?.onRequestReload;
    this.busSub = subscribeChartNotify((message) => {
      for (const [panel, meta] of [...this.openPanels]) {
        try {
          // Filter by seriesKey when present so one run does not overwrite another chart.
          if (
            message.seriesKey &&
            meta.seriesKey &&
            message.seriesKey !== meta.seriesKey
          ) {
            continue;
          }
          if (message.type === 'chart.full') {
            void panel.webview.postMessage(
              encode(HOST_TO_VIEW.ChartFull, message.payload),
            );
          } else if (message.type === 'chart.delta') {
            void panel.webview.postMessage(
              encode(HOST_TO_VIEW.ChartDelta, message.payload),
            );
          } else if (message.type === 'host.run.status') {
            void panel.webview.postMessage(
              encode(HOST_TO_VIEW.HostRunStatus, message.payload),
            );
          }
        } catch {
          // panel may be disposing
        }
      }
    });
    try {
      this.lastSourceId = pluginsForContext(context)?.source ?? '';
    } catch {
      this.lastSourceId = '';
    }
    this.pluginsSub = subscribeActivePlugins((active) => {
      this.onActivePluginsChanged(active);
    });
  }

  private onActivePluginsChanged(active: ActivePluginsV1): void {
    const plugins = chartPluginsFromActive(active);
    const sourceChanged = this.lastSourceId !== (plugins.source ?? '');
    this.lastSourceId = plugins.source ?? '';
    const keys = new Set<string>();
    for (const meta of this.openPanels.values()) {
      if (meta.seriesKey) keys.add(meta.seriesKey);
    }
    const payload = { epoch: 0, state: 'plugins', plugins };
    if (keys.size === 0) {
      try {
        notifyChart({ type: 'host.run.status', payload });
      } catch {
        // bus never-throw
      }
    } else {
      for (const seriesKey of keys) {
        try {
          notifyChart({ type: 'host.run.status', payload, seriesKey });
        } catch {
          // bus never-throw
        }
      }
    }
    // Source change rebuilds handshake (init clears then full) so the new source paints.
    // Stream change is HUD-only; live bridge already reads active stream from settings.
    if (sourceChanged) this.rebuildOpenCharts();
  }

  private rebuildOpenCharts(): void {
    for (const [panel, meta] of [...this.openPanels]) {
      const document = meta.document;
      if (!document) continue;
      const session = sessionForDocument(document, this.context);
      const signal = this.beginHistoryFetch(panel, session.seriesKey);
      postHandshake(panel.webview, session, {
        document,
        signal,
        isDisposed: () => !this.openPanels.has(panel),
      });
    }
  }

  dispose(): void {
    this.busSub.dispose();
    this.pluginsSub.dispose();
    for (const meta of this.openPanels.values()) {
      try {
        meta.historyAbort?.abort();
      } catch {
        // ignore
      }
    }
    this.openPanels.clear();
  }

  private beginHistoryFetch(panel: WebviewPanel, seriesKey?: string): AbortSignal {
    const prev = this.openPanels.get(panel);
    try {
      prev?.historyAbort?.abort();
    } catch {
      // ignore
    }
    const ac = new AbortController();
    this.openPanels.set(panel, {
      seriesKey: seriesKey ?? prev?.seriesKey ?? '',
      historyAbort: ac,
      document: prev?.document,
    });
    return ac.signal;
  }

  private trackPanel(
    document: AxisChartDocument,
    panel: WebviewPanel,
    seriesKey: string,
  ): void {
    let set = this.panels.get(document);
    if (!set) {
      set = new Set();
      this.panels.set(document, set);
    }
    set.add(panel);
    const prev = this.openPanels.get(panel);
    this.openPanels.set(panel, {
      seriesKey,
      historyAbort: prev?.historyAbort,
      document,
    });
  }

  private untrackPanel(document: AxisChartDocument, panel: WebviewPanel): void {
    const set = this.panels.get(document);
    if (set) set.delete(panel);
    const meta = this.openPanels.get(panel);
    try {
      meta?.historyAbort?.abort();
    } catch {
      // ignore
    }
    this.openPanels.delete(panel);
  }

  private refreshPanels(document: AxisChartDocument): void {
    const set = this.panels.get(document);
    if (!set) return;
    const session = sessionForDocument(document, this.context);
    for (const panel of set) {
      const signal = this.beginHistoryFetch(panel, session.seriesKey);
      postHandshake(panel.webview, session, {
        document,
        signal,
        isDisposed: () => !this.openPanels.has(panel),
      });
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
      let session = sessionForDocument(document, this.context);
      const result = handleChartWebviewMessage(raw, () => {
        session = sessionForDocument(document, this.context);
        // Keep bus filter in sync when handshake rebuilds the seriesKey.
        const prev = this.openPanels.get(webviewPanel);
        this.openPanels.set(webviewPanel, {
          seriesKey: session.seriesKey,
          historyAbort: prev?.historyAbort,
          document,
        });
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
      if (result.kind === 'setTool') {
        // MVP: webview owns tool chrome; host ack is a no-op (TreeView tools later).
        return;
      }
      if (result.kind === 'requestReload') {
        try {
          this.onRequestReload?.();
        } catch {
          // resume stub must not tear down the editor
        }
        return;
      }
      if (result.kind === 'commit') {
        if (disposed) return;
        try {
          const next = appendDrawingToDoc(document.documentData, result.drawing);
          document.update(next);
          publishLiveChartDoc(document);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logError(`drawing.commit failed: ${message}`);
        }
        return;
      }
      if (result.kind === 'init') {
        if (disposed) return;
        try {
          publishLiveChartDoc(document);
          void webviewPanel.webview.postMessage(result.envelope);
          if (result.full && !disposed) {
            void webviewPanel.webview.postMessage(result.full);
          }
          if (disposed) return;
          const key =
            this.openPanels.get(webviewPanel)?.seriesKey ?? session.seriesKey;
          if (session.useMockBars) {
            replayLastRunFull(webviewPanel.webview, key);
          } else {
            const signal = this.beginHistoryFetch(webviewPanel, key);
            void paintHistoryAfterHandshake(
              webviewPanel.webview,
              document,
              key,
              signal,
              () => disposed || !this.openPanels.has(webviewPanel),
            );
          }
        } catch {
          // panel may be disposing
        }
      }
    });

    const sessionKey = sessionForDocument(document, this.context).seriesKey;
    this.trackPanel(document, webviewPanel, sessionKey);

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
export type ChartEditorProviderOptions = {
  /** Host handler for webview `chart.requestReload` (live resume / remint). */
  onRequestReload?: () => void;
};

export function registerChartEditorProvider(
  context: ExtensionContext,
  opts?: ChartEditorProviderOptions,
): { dispose(): void } {
  const provider = new AxisChartEditorProvider(context, opts);
  const registration = window.registerCustomEditorProvider(CHART_VIEW_TYPE, provider, {
    webviewOptions: { retainContextWhenHidden: false },
    supportsMultipleEditorsPerDocument: true,
  });
  return {
    dispose() {
      registration.dispose();
      provider.dispose();
    },
  };
}
