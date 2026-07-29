// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { createStore } from 'solid-js/store';
import type {
  AppState,
  Bar,
  Indicator,
  Pane,
  EditorMode,
  LogEntry,
  LogLevel,
  Drawing,
  DrawingToolId,
  PlaneTelemetry,
  ConnState,
  TransportClass,
  TelemetryState,
} from './types';
import { idlePlane, pushSample } from '../ui/telemetry';
import {
  defaultPanelChromeMap,
  type PanelChrome,
  type PanelDock,
  type PanelId,
} from '../ui/panels/types';

// Stable ID generation — uses timestamp prefix + counter to survive reloads
let idCounter = 0;
const uid = () => `id_${Date.now()}_${++idCounter}`;

/** Current AXIS storage key (was SuperChart). */
export const STORAGE_KEY = 'pynescript.axis.v1';
/** Legacy SuperChart keys — read once for migration. */
const LEGACY_STORAGE_KEYS = [
  'pynescript.superchart.v2',
  'pynescript.superchart.v1',
] as const;

export const EDITOR_DOC_KEY = 'pynescript.axis.editor.doc';
const LEGACY_EDITOR_DOC_KEYS = [
  'pynescript.superchart.editor.doc',
] as const;

const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

const DEFAULTS: AppState = {
  bars: [],
  chartDataGen: 0,
  symbol: 'BTCUSDT',
  interval: '1d',
  exchange: 'binance',
  source: 'binance-rest',
  engine: 'server',
  endpoint: 'http://162.254.38.194:5002',
  activePlugins: {
    source: 'binance-rest',
    stream: 'binance-ws',
    engine: 'server',
    storage: 'local',
  },
  pluginsConfig: {},
  scripts: [],
  panes: [
    { id: 'price', type: 'price', height: 0, order: 0, visible: true, label: 'Price' },
    { id: 'volume', type: 'volume', height: 120, order: 1, visible: true, label: 'Volume' },
  ],
  live: {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'binance-ws',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  },
  theme: 'dark',
  uiScale: 1,
  editor: { open: true, width: 460, mode: 'docked' },
  watchlist: { open: true, width: 200, symbols: [...DEFAULT_WATCHLIST], refreshSec: 15 },
  indicatorPanel: { open: false, width: 224 },
  dataViewPanel: { open: false, width: 220 },
  layerPanel: { open: false, width: 220 },
  scriptSettings: { open: false, indicatorId: null },
  editorInputValues: {},
  crosshair: { time: null, barIndex: null },
  resultsPanel: { open: false, height: 220 },
  logsPanel: { open: false, height: 160 },
  stream: { status: 'disconnected' },
  status: 'ready',
  statusMessage: 'Ready.',
  lastRunMs: null,
  lastRun: null,
  logs: [],
  drawingTool: 'cursor',
  drawings: [],
  telemetry: {
    source: idlePlane('binance-rest', 'Binance REST', 'rest'),
    stream: idlePlane('binance-ws', 'Binance WebSocket', 'ws'),
    engine: idlePlane('server', 'Server-Side', 'ws'),
    storage: idlePlane('local', 'Local', 'local'),
    runLatencySamples: [],
    lastTick: null,
    hud: { compact: false, overlay: false },
  },
  panelChrome: defaultPanelChromeMap(),
};

function readLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Prefer AXIS key; fall back to SuperChart keys and migrate. */
function loadRawState(): string | null {
  const current = readLocalStorage(STORAGE_KEY);
  if (current) return current;
  for (const legacy of LEGACY_STORAGE_KEYS) {
    const raw = readLocalStorage(legacy);
    if (raw) {
      try {
        localStorage.setItem(STORAGE_KEY, raw);
      } catch {}
      return raw;
    }
  }
  return null;
}

function migrateEditorDoc() {
  if (readLocalStorage(EDITOR_DOC_KEY)) return;
  for (const legacy of LEGACY_EDITOR_DOC_KEYS) {
    const raw = readLocalStorage(legacy);
    if (raw) {
      try {
        localStorage.setItem(EDITOR_DOC_KEY, raw);
      } catch {}
      return;
    }
  }
}

migrateEditorDoc();

function loadPersisted(): Partial<AppState> {
  try {
    const raw = loadRawState();
    if (raw) {
      const parsed = JSON.parse(raw);
      const source = parsed.source || DEFAULTS.source;
      const engine = parsed.engine || DEFAULTS.engine;
      const streamId =
        parsed.live?.streamId || parsed.activePlugins?.stream || DEFAULTS.live.streamId;
      return {
        ...DEFAULTS,
        ...parsed,
        live: {
          ...DEFAULTS.live,
          ...parsed.live,
          // Never hydrate "live active" as running — user must re-enable
          active: false,
          preferAfterLoad: !!parsed.live?.preferAfterLoad,
          rerunOn: parsed.live?.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
        },
        editor: { ...DEFAULTS.editor, ...parsed.editor },
        uiScale: clampUiScale(parsed.uiScale ?? DEFAULTS.uiScale),
        watchlist: {
          ...DEFAULTS.watchlist,
          ...parsed.watchlist,
          symbols: parsed.watchlist?.symbols?.length
            ? parsed.watchlist.symbols
            : DEFAULTS.watchlist.symbols,
          refreshSec: Math.min(
            120,
            Math.max(5, Number(parsed.watchlist?.refreshSec) || DEFAULTS.watchlist.refreshSec),
          ),
        },
        indicatorPanel: { ...DEFAULTS.indicatorPanel, ...parsed.indicatorPanel },
        dataViewPanel: { ...DEFAULTS.dataViewPanel, ...parsed.dataViewPanel },
        layerPanel: { ...DEFAULTS.layerPanel, ...parsed.layerPanel },
        editorInputValues:
          parsed.editorInputValues && typeof parsed.editorInputValues === 'object'
            ? parsed.editorInputValues
            : DEFAULTS.editorInputValues,
        // Ephemeral UI — never hydrate open modals / crosshair from disk
        scriptSettings: { open: false, indicatorId: null },
        crosshair: { time: null, barIndex: null },
        resultsPanel: { ...DEFAULTS.resultsPanel, ...parsed.resultsPanel },
        logsPanel: { ...DEFAULTS.logsPanel, ...parsed.logsPanel, open: false },
        activePlugins: {
          ...DEFAULTS.activePlugins,
          ...parsed.activePlugins,
          source: parsed.activePlugins?.source || source,
          engine: parsed.activePlugins?.engine || engine,
          stream: parsed.activePlugins?.stream || streamId,
          storage: parsed.activePlugins?.storage || DEFAULTS.activePlugins.storage,
        },
        pluginsConfig: parsed.pluginsConfig || DEFAULTS.pluginsConfig,
        // Do not hydrate lastRun / logs / telemetry / bars from storage
        lastRun: null,
        logs: [],
        bars: [],
        chartDataGen: 0,
        telemetry: {
          ...DEFAULTS.telemetry,
          hud: {
            ...DEFAULTS.telemetry.hud,
            ...(parsed.telemetry?.hud || {}),
          },
        },
        drawingTool: 'cursor',
        drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
        panelChrome: mergePanelChrome(parsed.panelChrome, {
          // Bridge legacy open/width into chrome on first load
          watchlist: {
            open: parsed.watchlist?.open ?? DEFAULTS.watchlist.open,
            w: parsed.watchlist?.width ?? DEFAULTS.watchlist.width,
          },
          indicators: {
            open: parsed.indicatorPanel?.open ?? DEFAULTS.indicatorPanel.open,
            w: parsed.indicatorPanel?.width ?? DEFAULTS.indicatorPanel.width,
          },
          editor: {
            open: parsed.editor?.open ?? DEFAULTS.editor.open,
            w: parsed.editor?.width ?? DEFAULTS.editor.width,
            dock: parsed.editor?.mode === 'popout' ? 'window' : 'right',
          },
          results: {
            open: parsed.resultsPanel?.open ?? DEFAULTS.resultsPanel.open,
            h: parsed.resultsPanel?.height ?? DEFAULTS.resultsPanel.height,
          },
          logs: {
            open: false,
            h: parsed.logsPanel?.height ?? DEFAULTS.logsPanel.height,
          },
          dataview: {
            open: parsed.dataViewPanel?.open ?? false,
            w: parsed.dataViewPanel?.width ?? 240,
          },
          layers: {
            open: parsed.layerPanel?.open ?? false,
            w: parsed.layerPanel?.width ?? 240,
          },
        }),
      };
    }
  } catch {}
  return {};
}

function mergePanelChrome(
  raw: unknown,
  legacy: Partial<Record<PanelId, Partial<PanelChrome>>>,
): Record<PanelId, PanelChrome> {
  const base = defaultPanelChromeMap();
  const src =
    raw && typeof raw === 'object' ? (raw as Partial<Record<PanelId, Partial<PanelChrome>>>) : {};
  for (const id of Object.keys(base) as PanelId[]) {
    const fromDisk = src[id] || {};
    const fromLegacy = legacy[id] || {};
    base[id] = {
      ...base[id],
      ...fromLegacy,
      ...fromDisk,
      open: typeof fromDisk.open === 'boolean' ? fromDisk.open : !!fromLegacy.open || base[id].open,
      dock: (fromDisk.dock || fromLegacy.dock || base[id].dock) as PanelDock,
      x: Number(fromDisk.x ?? fromLegacy.x ?? base[id].x) || base[id].x,
      y: Number(fromDisk.y ?? fromLegacy.y ?? base[id].y) || base[id].y,
      w: Number(fromDisk.w ?? fromLegacy.w ?? base[id].w) || base[id].w,
      h: Number(fromDisk.h ?? fromLegacy.h ?? base[id].h) || base[id].h,
      z: Number(fromDisk.z ?? fromLegacy.z ?? base[id].z) || base[id].z,
    };
  }
  return base;
}

/** Keep flat source/engine/stream fields aligned with activePlugins */
export function setActivePlugin(
  kind: 'source' | 'stream' | 'engine' | 'storage',
  id: string,
) {
  setStore('activePlugins', kind, id);
  if (kind === 'source') setStore('source', id);
  if (kind === 'engine') setStore('engine', id);
  if (kind === 'stream') setStore('live', 'streamId', id);
  // Keep telemetry plane ids in sync (names/transport refined by loaders)
  if (store.telemetry?.[kind]) {
    setStore('telemetry', kind, 'id', id);
    if (kind === 'stream' && !store.live.active) {
      setStore('telemetry', 'stream', 'state', 'idle');
    }
    if (kind === 'engine') {
      // Prefer idle/open state from loaders; reset error on switch
      setStore('telemetry', 'engine', 'state', id === 'pyodide' ? 'connecting' : 'idle');
      setStore('telemetry', 'engine', 'error', null);
      setStore('telemetry', 'engine', 'detail', id === 'pyodide' ? 'select · will load ~20–30s' : undefined);
      setStore(
        'telemetry',
        'engine',
        'transport',
        id === 'pyodide' ? 'local' : id === 'server' ? 'ws' : store.telemetry.engine.transport,
      );
    }
  }
  persist();
}

export const [store, setStore] = createStore<AppState>({
  ...DEFAULTS,
  ...loadPersisted(),
});

// Apply theme + density as soon as the store hydrates (before first paint when possible)
if (typeof document !== 'undefined') {
  try {
    document.documentElement.setAttribute('data-theme', store.theme || 'dark');
    applyUiScale(store.uiScale);
  } catch {
    /* ignore */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
export function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      // Omit bars + lastRun + logs + high-churn gens + ephemeral crosshair/modal
      const {
        bars: _b,
        lastRun: _r,
        logs: _l,
        chartDataGen: _g,
        crosshair: _c,
        scriptSettings: _ss,
        telemetry,
        ...rest
      } = store as AppState & {
        bars: unknown;
        lastRun: unknown;
        logs: unknown;
        chartDataGen?: unknown;
        crosshair?: unknown;
        scriptSettings?: unknown;
        telemetry?: AppState['telemetry'];
      };
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...rest,
          telemetry: {
            hud: telemetry?.hud || DEFAULTS.telemetry.hud,
          },
        }),
      );
    } catch {}
  }, 200);
}

const MAX_LOGS = 500;

function statusToLevel(status: AppState['status']): LogLevel {
  if (status === 'error') return 'error';
  if (status === 'ready' || status === 'connected') return 'ok';
  if (status === 'loading' || status === 'running') return 'info';
  return 'warn';
}

export function appendLog(level: LogLevel, message: string, source = 'system') {
  const entry: LogEntry = {
    id: uid(),
    ts: Date.now(),
    level,
    message,
    source,
  };
  setStore('logs', (logs) => {
    const next = [...logs, entry];
    return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
  });
}

export function clearLogs() {
  setStore('logs', []);
}

export function setLastRun(result: unknown) {
  setStore('lastRun', result as never);
  if (result && typeof result === 'object' && result !== null && 'meta' in result) {
    const ms = (result as { meta?: { ms?: number } }).meta?.ms;
    if (typeof ms === 'number') setStore('lastRunMs', ms);
  }
}

export function setStatus(status: AppState['status'], message?: string) {
  setStore('status', status);
  if (message !== undefined) {
    setStore('statusMessage', message);
    appendLog(statusToLevel(status), message, status);
  }
}

export function loadBars(bars: Bar[], symbol: string, interval: string, exchange: string) {
  setStore('bars', bars);
  setStore('chartDataGen', (g) => (typeof g === 'number' ? g + 1 : 1));
  setStore('symbol', symbol);
  setStore('interval', interval);
  setStore('exchange', exchange);
  persist();
}

export function addIndicator(
  name: string,
  code: string,
  paneId: string,
  plots: Record<string, { color: string }>,
  inputValues?: Record<string, unknown>,
) {
  const id = uid();
  setStore('scripts', (s) => [
    ...s,
    {
      id,
      name,
      code,
      paneId,
      visible: true,
      plots,
      inputValues: inputValues ? { ...inputValues } : undefined,
    },
  ]);
  persist();
  return id;
}

export function removeIndicator(id: string) {
  setStore('scripts', (s) => s.filter((ind) => ind.id !== id));
  persist();
}

export function toggleIndicator(id: string) {
  setStore('scripts', (s) => s.map((ind) => ind.id === id ? { ...ind, visible: !ind.visible } : ind));
  persist();
}

export function setIndicatorColor(id: string, plotName: string, color: string) {
  setStore('scripts', (s) => s.map((ind) =>
    ind.id === id ? { ...ind, plots: { ...ind.plots, [plotName]: { color } } } : ind
  ));
  persist();
}

export function addPane(type: Pane['type'], label?: string): string {
  const id = uid();
  const maxOrder = Math.max(...store.panes.map((p) => p.order), -1);
  setStore('panes', (p) => [...p, { id, type, height: 120, order: maxOrder + 1, visible: true, label }]);
  persist();
  return id;
}

export function removePane(id: string) {
  setStore('panes', (p) => p.filter((pane) => pane.id !== id));
  persist();
}

export function resizePane(id: string, height: number) {
  setStore('panes', (p) => p.map((pane) => pane.id === id ? { ...pane, height } : pane));
  persist();
}

export function reorderPanes(orderedIds: string[]) {
  setStore('panes', (p) =>
    p.map((pane) => ({ ...pane, order: orderedIds.indexOf(pane.id) }))
      .sort((a, b) => a.order - b.order)
  );
  persist();
}

/**
 * Append or update the latest bar (live klines update the open bar in place).
 * Does not persist every tick — bars stay in memory only.
 */
export function appendBar(bar: Bar) {
  setStore('bars', (b) => {
    if (b.length && b[b.length - 1].time === bar.time) {
      const next = b.slice();
      next[next.length - 1] = bar;
      return next;
    }
    // Cap history growth during long live sessions
    const next = b.length > 5000 ? b.slice(b.length - 4000) : b.slice();
    next.push(bar);
    return next;
  });
  setStore('live', 'lastBarTime', bar.time);
  setStore('live', 'needsRerun', true);
}

export function setLive(active: boolean) {
  setStore('live', 'active', active);
  persist();
}

/* ── Telemetry helpers (ephemeral Connection HUD) ───────────────── */

export type TelemetryPlane = keyof Pick<TelemetryState, 'source' | 'stream' | 'engine' | 'storage'>;

export function setTelemetryPlane(
  plane: TelemetryPlane,
  patch: Partial<PlaneTelemetry> & { id?: string; name?: string; transport?: TransportClass },
) {
  const cur = store.telemetry?.[plane] || idlePlane(patch.id || '', patch.name || plane);
  setStore('telemetry', plane, {
    ...cur,
    ...patch,
    id: patch.id ?? cur.id,
    name: patch.name ?? cur.name,
    transport: patch.transport ?? cur.transport,
  });
}

export function setTelemetryState(plane: TelemetryPlane, state: ConnState, extra?: Partial<PlaneTelemetry>) {
  setTelemetryPlane(plane, { state, ...extra, lastEventAt: extra?.lastEventAt ?? Date.now() });
}

export function recordRunLatency(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  setStore('telemetry', 'runLatencySamples', (s) => pushSample(s || [], ms));
  setTelemetryPlane('engine', { latencyMs: ms, lastEventAt: Date.now() });
  setStore('lastRunMs', ms);
}

export function noteTick(price: number, time: number) {
  const prev = store.telemetry?.lastTick?.price;
  let dir: 'up' | 'down' | 'flat' = 'flat';
  if (prev != null) {
    if (price > prev) dir = 'up';
    else if (price < prev) dir = 'down';
  }
  setStore('telemetry', 'lastTick', { time, price, dir, at: Date.now() });
  setTelemetryPlane('stream', { lastEventAt: Date.now() });
}

export function toggleTheme() {
  const next = store.theme === 'dark' ? 'light' : 'dark';
  setStore('theme', next);
  document.documentElement.setAttribute('data-theme', next);
  persist();
}

/** UI chrome scale bounds (percent of default density). */
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.3;
export const UI_SCALE_STEP = 0.05;

export function clampUiScale(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  // Snap to step for stable storage / slider
  const stepped = Math.round(n / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(stepped * 100) / 100));
}

/** Write CSS custom properties used by chrome density. */
export function applyUiScale(scale?: number) {
  const s = clampUiScale(scale ?? store.uiScale ?? 1);
  if (typeof document === 'undefined') return s;
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s));
  root.setAttribute('data-ui-scale', s.toFixed(2));
  // Base 13px · rem/em chrome tracks this; chart canvas stays independent
  root.style.fontSize = `${(13 * s).toFixed(3)}px`;
  return s;
}

/** Persist + apply UI scale (live preview friendly). */
export function setUiScale(raw: number) {
  const s = clampUiScale(raw);
  setStore('uiScale', s);
  applyUiScale(s);
  persist();
}

/* ── Layout helpers ─────────────────────────────────────────────── */

export function setEditorWidth(width: number) {
  const w = Math.min(Math.max(width, 280), Math.floor(window.innerWidth * 0.8));
  setStore('editor', 'width', w);
  persist();
}

export function setWatchlistWidth(width: number) {
  const w = Math.min(Math.max(width, 140), 360);
  setStore('watchlist', 'width', w);
  persist();
}

export function setIndicatorWidth(width: number) {
  const w = Math.min(Math.max(width, 160), 400);
  setStore('indicatorPanel', 'width', w);
  persist();
}

export function setEditorMode(mode: EditorMode) {
  setStore('editor', 'mode', mode);
  if (mode === 'popout') {
    setStore('editor', 'open', false);
    ensurePanelChrome();
    setStore('panelChrome', 'editor', 'open', false);
    setStore('panelChrome', 'editor', 'dock', 'window');
  } else {
    ensurePanelChrome();
    setStore('panelChrome', 'editor', 'dock', 'right');
  }
  persist();
}

export function setIndicatorPanelOpen(open: boolean) {
  setPanelOpen('indicators', open);
}

export function toggleIndicatorPanel() {
  setPanelOpen('indicators', !isPanelOpen('indicators'));
}

export function setDataViewPanelOpen(open: boolean) {
  setPanelOpen('dataview', open);
}

export function toggleDataViewPanel() {
  setPanelOpen('dataview', !isPanelOpen('dataview'));
}

export function setLayerPanelOpen(open: boolean) {
  setPanelOpen('layers', open);
}

export function toggleLayerPanel() {
  setPanelOpen('layers', !isPanelOpen('layers'));
}

/* ── Panel chrome (dock / float / window) ───────────────────────── */

export function getPanelChrome(id: PanelId): PanelChrome {
  return store.panelChrome?.[id] || defaultPanelChromeMap()[id];
}

export function isPanelOpen(id: PanelId): boolean {
  const chromeOpen = !!store.panelChrome?.[id]?.open;
  switch (id) {
    case 'watchlist':
      return !!store.watchlist.open || chromeOpen;
    case 'editor':
      return (!!store.editor.open && store.editor.mode !== 'popout') || chromeOpen;
    case 'indicators':
      return !!store.indicatorPanel.open || chromeOpen;
    case 'results':
      return !!store.resultsPanel.open || chromeOpen;
    case 'logs':
      return !!store.logsPanel.open || chromeOpen;
    case 'dataview':
      return !!store.dataViewPanel.open || chromeOpen;
    case 'layers':
      return !!store.layerPanel.open || chromeOpen;
    default:
      return chromeOpen;
  }
}

function syncLegacyOpen(id: PanelId, open: boolean) {
  if (id === 'watchlist') setStore('watchlist', 'open', open);
  else if (id === 'editor') setStore('editor', 'open', open);
  else if (id === 'indicators') setStore('indicatorPanel', 'open', open);
  else if (id === 'results') setStore('resultsPanel', 'open', open);
  else if (id === 'logs') setStore('logsPanel', 'open', open);
  else if (id === 'dataview') setStore('dataViewPanel', 'open', open);
  else if (id === 'layers') setStore('layerPanel', 'open', open);
}

export function setPanelOpen(id: PanelId, open: boolean) {
  ensurePanelChrome();
  setStore('panelChrome', id, 'open', open);
  syncLegacyOpen(id, open);
  persist();
}

export function setPanelDock(id: PanelId, dock: PanelDock) {
  ensurePanelChrome();
  setStore('panelChrome', id, 'dock', dock);
  if (dock === 'window' && id === 'editor') {
    setStore('editor', 'mode', 'popout');
  } else if (id === 'editor' && dock !== 'window') {
    setStore('editor', 'mode', 'docked');
  }
  if (dock === 'float' || dock === 'window') {
    bumpPanelZ(id);
  }
  persist();
}

export function setPanelGeometry(
  id: PanelId,
  geo: Partial<Pick<PanelChrome, 'x' | 'y' | 'w' | 'h'>>,
) {
  ensurePanelChrome();
  const cur = getPanelChrome(id);
  if (geo.x != null) setStore('panelChrome', id, 'x', Math.round(geo.x));
  if (geo.y != null) setStore('panelChrome', id, 'y', Math.round(geo.y));
  if (geo.w != null) {
    setStore('panelChrome', id, 'w', Math.round(geo.w));
    if (id === 'watchlist') setStore('watchlist', 'width', Math.round(geo.w));
    if (id === 'indicators') setStore('indicatorPanel', 'width', Math.round(geo.w));
    if (id === 'editor') setStore('editor', 'width', Math.round(geo.w));
    if (id === 'dataview') setStore('dataViewPanel', 'width', Math.round(geo.w));
    if (id === 'layers') setStore('layerPanel', 'width', Math.round(geo.w));
  }
  if (geo.h != null) {
    setStore('panelChrome', id, 'h', Math.round(geo.h));
    if (id === 'results') setStore('resultsPanel', 'height', Math.round(geo.h));
    if (id === 'logs') setStore('logsPanel', 'height', Math.round(geo.h));
  }
  void cur;
  persist();
}

export function bumpPanelZ(id: PanelId) {
  ensurePanelChrome();
  const maxZ = Math.max(
    20,
    ...Object.values(store.panelChrome || {}).map((p) => Number(p?.z) || 20),
  );
  setStore('panelChrome', id, 'z', maxZ + 1);
}

function ensurePanelChrome() {
  if (!store.panelChrome || !store.panelChrome.watchlist) {
    setStore('panelChrome', defaultPanelChromeMap());
  }
}

export function setWatchlistOpen(open: boolean) {
  setPanelOpen('watchlist', open);
}

export function setEditorOpen(open: boolean) {
  setPanelOpen('editor', open);
}

export function openScriptSettings(indicatorId: string | null = null) {
  setStore('scriptSettings', { open: true, indicatorId });
}

export function closeScriptSettings() {
  setStore('scriptSettings', { open: false, indicatorId: null });
}

/** Ephemeral — do not persist every crosshair move. */
export function setCrosshair(time: number | null, barIndex: number | null = null) {
  setStore('crosshair', { time, barIndex });
}

export function setEditorInputValues(values: Record<string, unknown>) {
  setStore('editorInputValues', values);
  persist();
}

export function setIndicatorInputValues(id: string, values: Record<string, unknown>) {
  setStore('scripts', (s) =>
    s.map((ind) => (ind.id === id ? { ...ind, inputValues: { ...values } } : ind)),
  );
  persist();
}

export function setPaneVisible(id: string, visible: boolean) {
  setStore('panes', (p) => p.map((pane) => (pane.id === id ? { ...pane, visible } : pane)));
  persist();
}

export function addWatchlistSymbol(symbol: string) {
  const sym = symbol.toUpperCase().trim();
  if (!sym || store.watchlist.symbols.includes(sym)) return;
  setStore('watchlist', 'symbols', (s) => [...s, sym]);
  persist();
}

export function removeWatchlistSymbol(symbol: string) {
  setStore('watchlist', 'symbols', (s) => s.filter((x) => x !== symbol));
  persist();
}

/** Watchlist live-quote poll interval (seconds), clamped 5–120. */
export function setWatchlistRefreshSec(sec: number) {
  const n = Math.min(120, Math.max(5, Math.round(Number(sec) || 15)));
  setStore('watchlist', 'refreshSec', n);
  persist();
}

export function saveEditorDoc(doc: string) {
  try {
    localStorage.setItem(EDITOR_DOC_KEY, doc);
  } catch {
    /* ignore */
  }
}

export function loadEditorDoc(): string {
  try { return localStorage.getItem(EDITOR_DOC_KEY) || ''; } catch { return ''; }
}

export function setDrawingTool(tool: DrawingToolId) {
  setStore('drawingTool', tool);
  // tool choice is session-ish; still persist so toolbar restores
  persist();
}

export function setDrawings(drawings: Drawing[]) {
  setStore('drawings', drawings);
  persist();
}

export function clearDrawings() {
  setStore('drawings', []);
  persist();
}

/** Sync store from layer after delete-selected (layer owns selection). */
export function deleteSelectedDrawing(current: Drawing[]) {
  setStore('drawings', current);
  persist();
}
