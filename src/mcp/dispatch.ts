/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Execute an MCP app-plane capability against the live Solid store / host hooks.
 *
 * @module mcp/dispatch
 */

import {
  store,
  setStore,
  persist,
  loadEditorDoc,
  saveEditorDoc,
  addIndicator,
  removeIndicator,
  updateIndicator,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  setActiveWatchlist,
  setPanelOpen,
  setPanelDock,
  setChartGridMode,
  setChartType,
  setChartThemePreset,
  toggleTheme,
  setUiScale,
  setLive,
  setDrawingTool,
  clearDrawings,
  clearDrawingsForSymbol,
  appendLog,
  clearLogs,
  applyUiScale,
  setActivePlugin,
  setEditorOpen,
  loadChartLayout,
  saveChartLayout,
  deleteChartLayout,
  setChartOnly,
} from '../store';
import { loadSymbolData, reloadChart } from '../data/load-symbol';
import { startLive, stopLive } from '../streams/multiplex';
import { defaultStreamForSource } from '../streams/catalog';
import { runFromEditor } from '../indicators/run-target';
import { reapplyChartScripts } from '../indicators/reapply';
import { createAlert, loadAlerts } from '../alerts';
import { removeAlert, upsertAlert } from '../alerts/storage';
import type { Alert, AlertCreateInput, AlertKind } from '../alerts/types';
import { listScripts, readScript, writeScript, removeScript } from '../storage/service';
import {
  applyWorkspaceSnapshot,
  buildWorkspaceSnapshot,
  parseSnapshotJson,
} from '../storage/workspace-snapshot';
import { applyThemeToDocument } from '../theme';
import { captureScreenshot, loadScreenshotOptions } from '../chart/screenshot';
import { zoomChartBy, panChartBy, resetChartZoom } from '../chart/keymap-actions';
import { registry } from '../plugins/registry';
import { PANEL_IDS } from '../ui/panels/panel-manager';
import type { PanelDock, PanelId } from '../ui/panels/types';
import { fireShortcutById } from '../ui/shortcuts/runtime';
import type { DrawingToolId } from '../chart/drawing-types';
import { APP_CAPABILITIES, findCapability, SETTABLE_PATHS } from './catalog';
import { runPaletteCommand, listPaletteCommandIds } from './commands';
import { buildAppSnapshot } from './snapshot';
import { getByPath, McpInvokeError } from './protocol';
import type { ChartGridMode } from '../chart/layout';
import type { ChartType } from '../chart/chart-type';

export interface McpHostHooks {
  getEditorDoc: () => string;
  setEditorDoc?: (doc: string) => void;
  runEditor?: () => Promise<unknown>;
}

let hooks: McpHostHooks = { getEditorDoc: () => loadEditorDoc() };

export function setMcpHostHooks(next: Partial<McpHostHooks>): void {
  hooks = { ...hooks, ...next };
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : v == null ? fallback : String(v);
}

function fail(code: string, message: string): never {
  throw new McpInvokeError(code, message);
}

function editorDoc(): string {
  try {
    const fromHook = hooks.getEditorDoc?.();
    if (typeof fromHook === 'string' && fromHook.length) return fromHook;
  } catch {
    /* hook optional */
  }
  return loadEditorDoc();
}

function writeEditorDoc(doc: string): void {
  saveEditorDoc(doc);
  hooks.setEditorDoc?.(doc);
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<{ mimeType: string; data: string }> {
  const url = canvas.toDataURL('image/png');
  const data = url.split(',')[1] || '';
  return { mimeType: 'image/png', data };
}

function isPanelId(v: string): v is PanelId {
  return (PANEL_IDS as readonly string[]).includes(v);
}

function startLiveNow(): void {
  const streamId = store.live?.streamId || defaultStreamForSource(store.source);
  startLive(streamId, store.symbol, store.interval);
}

export async function invokeCapability(capability: string, payload: unknown = {}): Promise<unknown> {
  const spec = findCapability(capability);
  if (!spec && capability !== 'app.capabilities') {
    fail('UNKNOWN_CAPABILITY', `Unknown capability: ${capability}`);
  }
  const p = rec(payload);

  switch (capability) {
    case 'app.capabilities':
      return {
        capabilities: APP_CAPABILITIES,
        commands: listPaletteCommandIds(),
      };
    case 'app.snapshot':
      return buildAppSnapshot({ includeBars: p.includeBars === true });
    case 'app.get': {
      const snap = buildAppSnapshot({ includeBars: p.includeBars === true });
      const path = str(p.path);
      return path ? getByPath(snap, path) : snap;
    }
    case 'app.set': {
      const path = str(p.path);
      if (!SETTABLE_PATHS.has(path)) fail('PATH_DENIED', `Path not allowlisted: ${path}`);
      return applySettable(path, p.value);
    }
    case 'app.command': {
      const id = str(p.id);
      if (!id) fail('NO_ID', 'command id required');
      const ok = await runPaletteCommand(id);
      if (!ok) fail('UNKNOWN_COMMAND', `No palette command: ${id}`);
      return { ok: true, id };
    }
    case 'app.shortcut': {
      const id = str(p.id);
      if (!id) fail('NO_ID', 'shortcut id required');
      const ok = fireShortcutById(id);
      if (!ok) fail('UNKNOWN_SHORTCUT', `No shortcut action: ${id}`);
      return { ok: true, id };
    }
    case 'app.event': {
      const name = str(p.name);
      if (!name.startsWith('axis-')) fail('EVENT_DENIED', 'event name must start with axis-');
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(name, { detail: p.detail }));
      }
      return { ok: true, name };
    }

    case 'chart.get': {
      const snap = buildAppSnapshot();
      return {
        symbol: store.symbol,
        interval: store.interval,
        exchange: store.exchange,
        source: store.source,
        chartType: store.chartType,
        layout: store.chartLayout,
        live: store.live,
        bars: snap.bars,
      };
    }
    case 'chart.set': {
      if (p.symbol) setStore('symbol', str(p.symbol).toUpperCase());
      if (p.interval) setStore('interval', str(p.interval));
      if (p.exchange) setStore('exchange', str(p.exchange));
      if (p.source) setStore('source', str(p.source));
      if (p.chartType) setChartType(str(p.chartType) as ChartType);
      persist();
      return { symbol: store.symbol, interval: store.interval, chartType: store.chartType };
    }
    case 'chart.load': {
      const symbol = str(p.symbol || store.symbol).toUpperCase();
      const interval = str(p.interval || store.interval);
      const source = str(p.source || store.source);
      if (p.symbol) setStore('symbol', symbol);
      if (p.interval) setStore('interval', interval);
      persist();
      const ok = await loadSymbolData(symbol, interval, source);
      return { ok, symbol: store.symbol, interval: store.interval, bars: store.bars.length };
    }
    case 'chart.reload': {
      const ok = await reloadChart();
      return { ok, bars: store.bars.length };
    }
    case 'chart.live': {
      const on = p.active === undefined ? !store.live.active : Boolean(p.active);
      if (on) startLiveNow();
      else stopLive();
      setLive(on);
      return { active: store.live.active };
    }
    case 'chart.layout': {
      const op = str(p.op || (p.mode ? 'grid' : 'get'));
      if (op === 'get') return store.chartLayout;
      if (op === 'grid' || p.mode) {
        setChartGridMode(str(p.mode) as ChartGridMode);
        return store.chartLayout;
      }
      if (op === 'save') return saveChartLayout(str(p.name || 'Untitled'));
      if (op === 'load') return { ok: loadChartLayout(str(p.id)) };
      if (op === 'delete') {
        deleteChartLayout(str(p.id));
        return { ok: true };
      }
      fail('BAD_OP', `Unknown layout op: ${op}`);
      break;
    }
    case 'chart.theme': {
      if (p.presetId) setChartThemePreset(str(p.presetId));
      return { presetId: store.chartTheme?.presetId };
    }
    case 'chart.type': {
      if (p.type) setChartType(str(p.type) as ChartType);
      return { chartType: store.chartType };
    }
    case 'chart.screenshot': {
      const opts = { ...loadScreenshotOptions() };
      if (p.scope === 'price' || p.scope === 'panes' || p.scope === 'workspace') opts.scope = p.scope;
      if (p.scale === 1 || p.scale === 2) opts.scale = p.scale;
      const canvas = await captureScreenshot(opts);
      return canvasPng(canvas);
    }
    case 'chart.zoom': {
      const op = str(p.op || 'in');
      if (op === 'in') zoomChartBy(typeof p.delta === 'number' ? p.delta : 0.2);
      else if (op === 'out') zoomChartBy(typeof p.delta === 'number' ? p.delta : -0.2);
      else if (op === 'reset') resetChartZoom();
      else if (op === 'pan') panChartBy(typeof p.bars === 'number' ? p.bars : 1);
      else fail('BAD_OP', `Unknown zoom op: ${op}`);
      return { ok: true, op };
    }

    case 'editor.get':
      return { doc: editorDoc(), open: store.editor.open, mode: store.editor.mode };
    case 'editor.set': {
      const doc = str(p.doc);
      writeEditorDoc(doc);
      if (p.open !== false) setEditorOpen(true);
      return { chars: doc.length };
    }
    case 'editor.run': {
      const doc = str(p.doc) || editorDoc();
      if (!doc.trim()) fail('EMPTY', 'editor document is empty');
      if (hooks.runEditor && !p.doc) {
        const result = await hooks.runEditor();
        return { ok: true, result: result ?? store.lastRun };
      }
      const result = await runFromEditor(doc, {
        mode: 'auto',
        inputs: store.editorInputValues || {},
      });
      return { ok: true, result };
    }
    case 'editor.diagnostics':
      return {
        preEval: store.preEval,
        profilerEnabled: store.profilerEnabled,
        inlineDebugEnabled: store.inlineDebugEnabled,
      };

    case 'indicators.list':
      return (store.scripts || []).map((s) => ({
        id: s.id,
        name: s.name,
        visible: s.visible,
        paneId: s.paneId,
        codeChars: s.code?.length ?? 0,
      }));
    case 'indicators.add': {
      const code = str(p.code);
      const name = str(p.name || 'Script');
      if (!code.trim()) fail('EMPTY', 'code required');
      const id = addIndicator(name, code, str(p.paneId || 'price') || 'price', {});
      return { id };
    }
    case 'indicators.remove': {
      const id = str(p.id);
      if (!id) fail('NO_ID', 'id required');
      removeIndicator(id);
      return { ok: true, id };
    }
    case 'indicators.update': {
      const id = str(p.id);
      if (!id) fail('NO_ID', 'id required');
      const patch: Parameters<typeof updateIndicator>[1] = {};
      if (p.name !== undefined) patch.name = str(p.name);
      if (p.visible !== undefined) patch.visible = Boolean(p.visible);
      if (p.code !== undefined) patch.code = str(p.code);
      if (p.inputValues !== undefined) patch.inputValues = rec(p.inputValues);
      updateIndicator(id, patch);
      return { ok: true, id };
    }
    case 'indicators.run': {
      await reapplyChartScripts();
      return { ok: true, count: store.scripts.filter((s) => s.visible).length };
    }

    case 'alerts.list':
      return loadAlerts();
    case 'alerts.create': {
      const input: AlertCreateInput = {
        name: str(p.name || 'Alert'),
        symbol: str(p.symbol || store.symbol),
        kind: (str(p.kind || 'price_cross') as AlertKind) || 'price_cross',
        params: rec(p.params),
      };
      if (p.interval) input.interval = str(p.interval);
      if (p.webhookUrl) input.webhookUrl = str(p.webhookUrl);
      if (typeof p.enabled === 'boolean') input.enabled = p.enabled;
      return createAlert(input);
    }
    case 'alerts.update': {
      const id = str(p.id);
      const existing = loadAlerts().find((a) => a.id === id);
      if (!existing) fail('NOT_FOUND', `alert ${id}`);
      const next: Alert = { ...existing, ...rec(p.patch), id };
      upsertAlert(next);
      return next;
    }
    case 'alerts.remove': {
      const id = str(p.id);
      return { ok: removeAlert(id), id };
    }

    case 'watchlist.get':
      return {
        activeId: store.watchlist.activeId,
        symbols: [...store.watchlist.symbols],
        lists: store.watchlist.lists,
      };
    case 'watchlist.add': {
      const symbol = str(p.symbol).toUpperCase();
      if (!symbol) fail('NO_SYMBOL', 'symbol required');
      addWatchlistSymbol(symbol);
      return { symbols: [...store.watchlist.symbols] };
    }
    case 'watchlist.remove': {
      removeWatchlistSymbol(str(p.symbol).toUpperCase());
      return { symbols: [...store.watchlist.symbols] };
    }
    case 'watchlist.lists': {
      const op = str(p.op);
      if (op === 'create') return { id: createWatchlist(str(p.name), Array.isArray(p.symbols) ? (p.symbols as string[]) : undefined) };
      if (op === 'rename') {
        renameWatchlist(str(p.id), str(p.name));
        return { ok: true };
      }
      if (op === 'delete') return { ok: deleteWatchlist(str(p.id)) };
      if (op === 'select') {
        setActiveWatchlist(str(p.id));
        return { activeId: store.watchlist.activeId };
      }
      return { lists: store.watchlist.lists, activeId: store.watchlist.activeId };
    }

    case 'library.list':
      return await listScripts(str(p.prefix) || undefined);
    case 'library.read':
      return await readScript(str(p.id));
    case 'library.write': {
      const doc = await writeScript({
        id: str(p.id) || `s_${Date.now().toString(36)}`,
        name: str(p.name || 'Untitled'),
        content: str(p.content),
        description: p.description != null ? str(p.description) : undefined,
      });
      return doc;
    }
    case 'library.remove': {
      await removeScript(str(p.id));
      return { ok: true };
    }

    case 'results.get':
      return {
        lastRun: store.lastRun,
        resultsFocusId: store.resultsFocusId,
        newestRunId: store.newestRunId,
        strategyUi: store.strategyUi,
      };
    case 'logs.get':
      return store.logs.slice(-(typeof p.limit === 'number' ? p.limit : 50));
    case 'logs.append': {
      appendLog(
        (str(p.level || 'info') as 'info' | 'ok' | 'warn' | 'error') || 'info',
        str(p.message),
        str(p.source || 'mcp'),
      );
      return { ok: true };
    }
    case 'logs.clear': {
      clearLogs();
      return { ok: true };
    }

    case 'panels.get': {
      const out: Record<string, unknown> = {};
      for (const id of PANEL_IDS) {
        out[id] = { open: store.panelChrome?.[id]?.open, dock: store.panelChrome?.[id]?.dock };
      }
      return out;
    }
    case 'panels.set': {
      const id = str(p.id);
      if (!isPanelId(id)) fail('BAD_PANEL', `Unknown panel: ${id}`);
      if (typeof p.open === 'boolean') setPanelOpen(id, p.open);
      if (p.dock) setPanelDock(id, str(p.dock) as PanelDock);
      if (p.chartOnly === true || p.chartOnly === false) setChartOnly(Boolean(p.chartOnly));
      return { id, open: store.panelChrome?.[id]?.open, dock: store.panelChrome?.[id]?.dock };
    }

    case 'plugins.list':
      return {
        registry: registry.summary(),
        active: store.activePlugins,
        source: store.source,
        engine: store.engine,
        stream: store.live?.streamId,
      };
    case 'plugins.activate': {
      const kind = str(p.kind);
      const id = str(p.id);
      if (!id) fail('NO_ID', 'plugin id required');
      if (kind !== 'source' && kind !== 'stream' && kind !== 'engine' && kind !== 'storage') {
        fail('BAD_KIND', 'kind must be source|stream|engine|storage');
      }
      setActivePlugin(kind, id);
      return { active: store.activePlugins };
    }

    case 'theme.get':
      return { theme: store.theme, chartPreset: store.chartTheme?.presetId, uiScale: store.uiScale };
    case 'theme.set': {
      if (p.theme === 'dark' || p.theme === 'light') {
        setStore('theme', p.theme);
        applyThemeToDocument(store.chartTheme);
      } else if (p.toggle) toggleTheme();
      if (p.presetId) setChartThemePreset(str(p.presetId));
      if (typeof p.uiScale === 'number') setUiScale(p.uiScale);
      persist();
      return { theme: store.theme, chartPreset: store.chartTheme?.presetId, uiScale: store.uiScale };
    }

    case 'workspace.export':
      return buildWorkspaceSnapshot(store, { includeBars: p.includeBars === true });
    case 'workspace.import': {
      const raw = typeof p.json === 'string' ? p.json : JSON.stringify(p.snapshot ?? p);
      const snap = parseSnapshotJson(raw);
      applyWorkspaceSnapshot(snap, {
        assign(fields) {
          if (fields.symbol) setStore('symbol', fields.symbol);
          if (fields.interval) setStore('interval', fields.interval);
          if (fields.exchange) setStore('exchange', fields.exchange);
          if (fields.chartType) setChartType(fields.chartType);
          if (fields.chartLayout) setStore('chartLayout', fields.chartLayout);
          if (fields.panes) setStore('panes', fields.panes);
          if (fields.drawings) setStore('drawings', fields.drawings);
          if (fields.theme === 'dark' || fields.theme === 'light') setStore('theme', fields.theme);
          if (typeof fields.uiScale === 'number') setUiScale(fields.uiScale);
        },
        applyTheme: () => applyThemeToDocument(store.chartTheme),
        applyUiScale: (n) => applyUiScale(n),
      });
      persist();
      return { ok: true, symbol: store.symbol, interval: store.interval };
    }

    case 'drawings.list':
      return store.drawings;
    case 'drawings.clear': {
      if (p.symbol) clearDrawingsForSymbol(str(p.symbol));
      else clearDrawings();
      return { count: store.drawings.length };
    }
    case 'drawings.tool': {
      setDrawingTool(str(p.tool) as DrawingToolId);
      return { tool: store.drawingTool };
    }

    case 'status.get':
      return {
        status: store.status,
        statusMessage: store.statusMessage,
        telemetry: store.telemetry,
      };

    default:
      fail('UNKNOWN_CAPABILITY', `Unknown capability: ${capability}`);
  }
  return null;
}

function applySettable(path: string, value: unknown): unknown {
  switch (path) {
    case 'symbol':
      setStore('symbol', str(value).toUpperCase());
      break;
    case 'interval':
      setStore('interval', str(value));
      break;
    case 'source':
      setStore('source', str(value));
      break;
    case 'engine':
      setStore('engine', str(value));
      break;
    case 'exchange':
      setStore('exchange', str(value));
      break;
    case 'theme':
      if (value === 'dark' || value === 'light') setStore('theme', value);
      applyThemeToDocument(store.chartTheme);
      break;
    case 'chartType':
      setChartType(str(value) as ChartType);
      break;
    case 'uiScale':
      setUiScale(Number(value));
      break;
    case 'live.active':
      if (value) startLiveNow();
      else stopLive();
      setLive(Boolean(value));
      break;
    case 'live.preferAfterLoad':
      setStore('live', 'preferAfterLoad', Boolean(value));
      break;
    case 'editor.doc':
      writeEditorDoc(str(value));
      break;
    case 'editor.open':
      setEditorOpen(Boolean(value));
      break;
    case 'watchlist.open':
      setStore('watchlist', 'open', Boolean(value));
      break;
    default:
      fail('PATH_DENIED', path);
  }
  persist();
  return getByPath(buildAppSnapshot(), path);
}
