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

/**
 * AXIS Solid store — createStore hydration, persistence, and mutation helpers.
 *
 * ## Lifecycle
 * 1. `DEFAULTS` seed the shape; `loadPersisted()` merges localStorage
 *    (`STORAGE_KEY`), migrating SuperChart keys once.
 * 2. Ephemeral fields are forced off on hydrate (live, logs, bars, lastRun,
 *    selection, open modals).
 * 3. `persist()` debounces a write that **omits** bars, lastRun, logs,
 *    crosshair, scriptSettings, selectedDrawingId, and full telemetry
 *    (only `telemetry.hud` is kept).
 *
 * ## Data flow
 * - Chart / loaders call `loadBars` / `appendBar` / `setStatus` / telemetry helpers.
 * - UI panels use layout helpers (`setPanelOpen`, chrome, widths) and drawing
 *   helpers; panel open state is dual-written to legacy flat flags + `panelChrome`.
 * - Editor document body lives under `EDITOR_DOC_KEY` (separate from app JSON).
 *
 * Types: {@link ./types.ts}. Panel chrome shapes: `ui/panels/types`.
 */

import { createStore, unwrap } from 'solid-js/store';
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
import { normalizeUserDrawings } from '../chart/drawings/normalize';
import {
  DEFAULT_CHART_TYPE,
  normalizeChartType,
  type ChartType,
} from '../chart/chart-type';

// Stable ID generation — uses timestamp prefix + counter to survive reloads
let idCounter = 0;
const uid = () => `id_${Date.now()}_${++idCounter}`;

/** Current AXIS app-state localStorage key (migrated from SuperChart). */
export const STORAGE_KEY = 'pynescript.axis.v1';
/** Legacy SuperChart keys — read once for migration. */
const LEGACY_STORAGE_KEYS = [
  'pynescript.superchart.v2',
  'pynescript.superchart.v1',
] as const;

/** localStorage key for the docked/popout editor document body. */
export const EDITOR_DOC_KEY = 'pynescript.axis.editor.doc';
const LEGACY_EDITOR_DOC_KEYS = [
  'pynescript.superchart.editor.doc',
] as const;

const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

const DEFAULTS: AppState = {
  bars: [],
  chartDataGen: 0,
  chartType: DEFAULT_CHART_TYPE,
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
  profilerEnabled: false,
  stream: { status: 'disconnected' },
  status: 'ready',
  statusMessage: 'Ready.',
  lastRunMs: null,
  lastRun: null,
  logs: [],
  // Drawing integration — mirrored to DrawingLayer via manager-access / toolbar
  drawingTool: 'cursor',
  drawings: [],
  drawingPrefs: {
    color: '#939fff',
    width: 1.5,
    lineStyle: 'solid',
    fillOpacity: 0.15,
  },
  drawingUi: {
    magnet: 'off',
    stayInMode: false,
    lastToolByGroup: {},
    hideDrawings: false,
    lockAll: false,
  },
  // Ephemeral selection — reset on hydrate
  selectedDrawingId: null,
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
        chartType: normalizeChartType(parsed.chartType),
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
        profilerEnabled: !!parsed.profilerEnabled,
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
        // Drawing tool always starts as cursor; list normalized for dual legacy/style fields
        drawingTool: 'cursor',
        drawings: normalizeUserDrawings(parsed.drawings) as Drawing[],

        drawingPrefs: {
          ...DEFAULTS.drawingPrefs,
          ...(parsed.drawingPrefs && typeof parsed.drawingPrefs === 'object'
            ? parsed.drawingPrefs
            : {}),
        },
        drawingUi: {
          ...DEFAULTS.drawingUi,
          ...(parsed.drawingUi && typeof parsed.drawingUi === 'object' ? parsed.drawingUi : {}),
          lastToolByGroup:
            parsed.drawingUi?.lastToolByGroup &&
            typeof parsed.drawingUi.lastToolByGroup === 'object'
              ? { ...parsed.drawingUi.lastToolByGroup }
              : { ...DEFAULTS.drawingUi.lastToolByGroup },
        },
        // Ephemeral selection — never hydrate from disk
        selectedDrawingId: null,
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

/**
 * Select an active plugin and keep flat legacy fields + telemetry plane ids aligned.
 * Persists immediately. Engine switch resets engine telemetry (pyodide shows “connecting”).
 */
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

/**
 * Reactive app state + setter. Hydrated once at module load from localStorage.
 * Prefer domain helpers below for multi-field updates that must persist correctly.
 */
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

/**
 * Debounced (~200ms) write of durable state to `STORAGE_KEY`.
 * Omits bars, lastRun, logs, chartDataGen, crosshair, scriptSettings,
 * selectedDrawingId, and full telemetry (keeps only `telemetry.hud`).
 *
 * Uses {@link unwrap} so nested Solid store proxies serialize fully
 * (plain destructure can drop nested updates under some paths).
 */
export function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersist();
  }, 200);
}

/** Immediate localStorage write (used after Settings save and tests). */
export function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    const plain = unwrap(store) as AppState;
    const {
      bars: _b,
      lastRun: _r,
      logs: _l,
      chartDataGen: _g,
      crosshair: _c,
      scriptSettings: _ss,
      selectedDrawingId: _sel,
      telemetry,
      ...rest
    } = plain;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...rest,
        telemetry: {
          hud: telemetry?.hud || DEFAULTS.telemetry.hud,
        },
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

const MAX_LOGS = 500;

function statusToLevel(status: AppState['status']): LogLevel {
  if (status === 'error') return 'error';
  if (status === 'ready' || status === 'connected') return 'ok';
  if (status === 'loading' || status === 'running') return 'info';
  return 'warn';
}

/** Append a system log entry (ring buffer, max 500). Not persisted. */
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

/** Clear in-memory system logs. */
export function clearLogs() {
  setStore('logs', []);
}

/**
 * Store last indicator/strategy run payload for Results / Data View.
 * Also updates `lastRunMs` from `result.meta.ms` when present.
 */
export function setLastRun(result: unknown) {
  setStore('lastRun', result as never);
  if (result && typeof result === 'object' && result !== null && 'meta' in result) {
    const ms = (result as { meta?: { ms?: number } }).meta?.ms;
    if (typeof ms === 'number') setStore('lastRunMs', ms);
  }
}

/**
 * Set high-level status + optional message (also appends a log when message given).
 */
export function setStatus(status: AppState['status'], message?: string) {
  setStore('status', status);
  if (message !== undefined) {
    setStore('statusMessage', message);
    appendLog(statusToLevel(status), message, status);
  }
}

/** Persist main price pane chart style (candles, bars, line, Heikin-Ashi, …). */
export function setChartType(type: ChartType | string) {
  setStore('chartType', normalizeChartType(type));
  persist();
}

/**
 * Replace chart history (full load). Bumps `chartDataGen` so ChartHost rebinds series data.
 * Persists symbol/interval/exchange; bars themselves are not written to localStorage.
 */
export function loadBars(bars: Bar[], symbol: string, interval: string, exchange: string) {
  setStore('bars', bars);
  setStore('chartDataGen', (g) => (typeof g === 'number' ? g + 1 : 1));
  setStore('symbol', symbol);
  setStore('interval', interval);
  setStore('exchange', exchange);
  persist();
}

/** Register an applied script on the chart; returns new indicator id. */
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

/** Remove an applied indicator from the store (caller should clear chart overlays). */
export function removeIndicator(id: string) {
  setStore('scripts', (s) => s.filter((ind) => ind.id !== id));
  persist();
}

/** Toggle indicator visibility (plot paint gated by ChartHost / runner). */
export function toggleIndicator(id: string) {
  setStore('scripts', (s) => s.map((ind) => ind.id === id ? { ...ind, visible: !ind.visible } : ind));
  persist();
}

/** Override a single plot series color for an applied indicator. */
export function setIndicatorColor(id: string, plotName: string, color: string) {
  setStore('scripts', (s) => s.map((ind) =>
    ind.id === id ? { ...ind, plots: { ...ind.plots, [plotName]: { color } } } : ind
  ));
  persist();
}

/** Append a chart pane and return its id. */
export function addPane(type: Pane['type'], label?: string): string {
  const id = uid();
  const maxOrder = Math.max(...store.panes.map((p) => p.order), -1);
  setStore('panes', (p) => [...p, { id, type, height: 120, order: maxOrder + 1, visible: true, label }]);
  persist();
  return id;
}

/** Drop a pane descriptor (caller destroys chart pane if needed). */
export function removePane(id: string) {
  setStore('panes', (p) => p.filter((pane) => pane.id !== id));
  persist();
}

/** Set pane height in CSS px. */
export function resizePane(id: string, height: number) {
  setStore('panes', (p) => p.map((pane) => pane.id === id ? { ...pane, height } : pane));
  persist();
}

/** Reorder panes by id list (sets `order` then sorts). */
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

/** Enable/disable live streaming preference (stream start/stop is elsewhere). */
export function setLive(active: boolean) {
  setStore('live', 'active', active);
  persist();
}

/* ── Telemetry helpers (ephemeral Connection HUD) ───────────────── */

/** Telemetry plane keys under `store.telemetry`. */
export type TelemetryPlane = keyof Pick<TelemetryState, 'source' | 'stream' | 'engine' | 'storage'>;

/** Merge a partial update into one telemetry plane (ephemeral). */
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

/** Set connection state on a plane; stamps `lastEventAt` unless overridden. */
export function setTelemetryState(plane: TelemetryPlane, state: ConnState, extra?: Partial<PlaneTelemetry>) {
  setTelemetryPlane(plane, { state, ...extra, lastEventAt: extra?.lastEventAt ?? Date.now() });
}

/** Push a run-duration sample and mirror latency onto the engine plane. */
export function recordRunLatency(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return;
  setStore('telemetry', 'runLatencySamples', (s) => pushSample(s || [], ms));
  setTelemetryPlane('engine', { latencyMs: ms, lastEventAt: Date.now() });
  setStore('lastRunMs', ms);
}

/** Record last live tick price/time and bump stream `lastEventAt`. */
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

/** Flip dark/light theme and update `data-theme` on `<html>`. */
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

/** Clamp/snap UI scale into [UI_SCALE_MIN, UI_SCALE_MAX] at UI_SCALE_STEP. */
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

/** Clamp and persist docked editor width (px). */
export function setEditorWidth(width: number) {
  const w = Math.min(Math.max(width, 280), Math.floor(window.innerWidth * 0.8));
  setStore('editor', 'width', w);
  persist();
}

/** Clamp and persist watchlist width (px). */
export function setWatchlistWidth(width: number) {
  const w = Math.min(Math.max(width, 140), 360);
  setStore('watchlist', 'width', w);
  persist();
}

/** Clamp and persist indicator panel width (px). */
export function setIndicatorWidth(width: number) {
  const w = Math.min(Math.max(width, 160), 400);
  setStore('indicatorPanel', 'width', w);
  persist();
}

/**
 * Docked vs popout editor mode. Popout closes docked chrome and sets
 * `panelChrome.editor.dock = 'window'`; docked restores dock=right.
 */
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

/** Open/close indicators panel (panelChrome + legacy flag). */
export function setIndicatorPanelOpen(open: boolean) {
  setPanelOpen('indicators', open);
}

/** Toggle indicators panel visibility. */
export function toggleIndicatorPanel() {
  setPanelOpen('indicators', !isPanelOpen('indicators'));
}

/** Open/close Data Window panel. */
export function setDataViewPanelOpen(open: boolean) {
  setPanelOpen('dataview', open);
}

/** Toggle Data Window panel visibility. */
export function toggleDataViewPanel() {
  setPanelOpen('dataview', !isPanelOpen('dataview'));
}

/** Open/close Layers panel. */
export function setLayerPanelOpen(open: boolean) {
  setPanelOpen('layers', open);
}

/** Toggle Layers panel visibility. */
export function toggleLayerPanel() {
  setPanelOpen('layers', !isPanelOpen('layers'));
}

/** Open/close Pine Logs panel (script `log.*` output — not system telemetry). */
export function setPineLogsPanelOpen(open: boolean) {
  setPanelOpen('pinelogs', open);
}

/** Toggle Pine Logs panel visibility. */
export function togglePineLogsPanel() {
  setPanelOpen('pinelogs', !isPanelOpen('pinelogs'));
}

/** Enable/disable editor profiler mode (persisted). */
export function setProfilerEnabled(on: boolean) {
  setStore('profilerEnabled', !!on);
  persist();
}

/** Toggle editor profiler mode. */
export function toggleProfilerEnabled() {
  setStore('profilerEnabled', !store.profilerEnabled);
  persist();
}

/* ── Panel chrome (dock / float / window) ───────────────────────── */

/** Read panel chrome (dock/geometry); falls back to defaults if missing. */
export function getPanelChrome(id: PanelId): PanelChrome {
  return store.panelChrome?.[id] || defaultPanelChromeMap()[id];
}

/**
 * Whether a panel should render. ORs `panelChrome[id].open` with the
 * legacy flat open flag (and for editor, ignores open when mode is popout).
 */
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
    case 'pinelogs':
      // Chrome-only (no legacy flat flag)
      return chromeOpen;
    case 'dataview':
      return !!store.dataViewPanel.open || chromeOpen;
    case 'layers':
      return !!store.layerPanel.open || chromeOpen;
    default: {
      // Exhaustiveness guard for future PanelId values
      const _exhaustive: never = id;
      void _exhaustive;
      return chromeOpen;
    }
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

/** Open/close a panel; dual-writes panelChrome and legacy flat flags. */
export function setPanelOpen(id: PanelId, open: boolean) {
  ensurePanelChrome();
  setStore('panelChrome', id, 'open', open);
  syncLegacyOpen(id, open);
  persist();
}

/**
 * Change panel dock target. Editor `window` sets popout mode; other docks
 * set docked. Float/window bump z-index for stacking.
 */
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

/**
 * Update float geometry and mirror width/height into legacy layout fields
 * (watchlist/editor widths, results/logs heights, etc.).
 */
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

/** Bring a floating panel above peers by incrementing its z. */
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

/** Open/close watchlist panel. */
export function setWatchlistOpen(open: boolean) {
  setPanelOpen('watchlist', open);
}

/** Open/close docked editor panel. */
export function setEditorOpen(open: boolean) {
  setPanelOpen('editor', open);
}

/**
 * Open Script Settings modal.
 * @param indicatorId applied indicator id, or `null` for the editor document.
 */
export function openScriptSettings(indicatorId: string | null = null) {
  setStore('scriptSettings', { open: true, indicatorId });
}

/** Close Script Settings modal (ephemeral — not persisted). */
export function closeScriptSettings() {
  setStore('scriptSettings', { open: false, indicatorId: null });
}

/** Ephemeral — do not persist every crosshair move. */
export function setCrosshair(time: number | null, barIndex: number | null = null) {
  setStore('crosshair', { time, barIndex });
}

/** Persist input overrides for the docked editor document (not yet applied). */
export function setEditorInputValues(values: Record<string, unknown>) {
  setStore('editorInputValues', values);
  persist();
}

/** Persist input overrides on an applied indicator. */
export function setIndicatorInputValues(id: string, values: Record<string, unknown>) {
  setStore('scripts', (s) =>
    s.map((ind) => (ind.id === id ? { ...ind, inputValues: { ...values } } : ind)),
  );
  persist();
}

/** Show/hide a chart pane (store only; ChartHost/manager apply visibility). */
export function setPaneVisible(id: string, visible: boolean) {
  setStore('panes', (p) => p.map((pane) => (pane.id === id ? { ...pane, visible } : pane)));
  persist();
}

/** Append a unique uppercase symbol to the watchlist. */
export function addWatchlistSymbol(symbol: string) {
  const sym = symbol.toUpperCase().trim();
  if (!sym || store.watchlist.symbols.includes(sym)) return;
  setStore('watchlist', 'symbols', (s) => [...s, sym]);
  persist();
}

/** Remove a symbol from the watchlist. */
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

/** Persist editor document body under `EDITOR_DOC_KEY` (separate from app JSON). */
export function saveEditorDoc(doc: string) {
  try {
    localStorage.setItem(EDITOR_DOC_KEY, doc);
  } catch {
    /* ignore */
  }
}

/** Load editor document body from localStorage (empty string if missing). */
export function loadEditorDoc(): string {
  try { return localStorage.getItem(EDITOR_DOC_KEY) || ''; } catch { return ''; }
}

/**
 * Set the active drawing tool (cursor or place tool).
 * Persisted so the toolbar restores; layer may call this after place when stay-in-mode is off.
 */
export function setDrawingTool(tool: DrawingToolId) {
  setStore('drawingTool', tool);
  // tool choice is session-ish; still persist so toolbar restores
  persist();
}

/**
 * Replace the full user-drawing list (layer `onChange`, imports, clear paths).
 * Persisted. Does not touch Pine script drawings.
 */
export function setDrawings(drawings: Drawing[]) {
  setStore('drawings', drawings);
  persist();
}

/** Empty user drawings and persist (toolbar clear-all after confirm + layer.clearAll). */
export function clearDrawings() {
  setStore('drawings', []);
  persist();
}

/**
 * Sync store drawings from the layer after a layer-owned delete path.
 * Selection is cleared on the layer side; this only writes the remaining list.
 */
export function deleteSelectedDrawing(current: Drawing[]) {
  setStore('drawings', current);
  persist();
}

/**
 * Selection for the style bar / hit-test. Ephemeral — not persisted.
 * Wired from layer `onSelectionChange`.
 */
export function setSelectedDrawingId(id: string | null) {
  setStore('selectedDrawingId', id);
}

/**
 * Merge default stroke/fill prefs for new placements (and toolbar when no selection).
 */
export function setDrawingPrefs(patch: Partial<AppState['drawingPrefs']>) {
  setStore('drawingPrefs', { ...store.drawingPrefs, ...patch });
  persist();
}

/**
 * Merge toolbar interaction prefs (magnet, stay-in-mode, lock-all, hide, lastToolByGroup).
 * `lastToolByGroup` is deep-merged so one group update does not wipe others.
 */
export function setDrawingUi(patch: Partial<AppState['drawingUi']>) {
  const next = { ...store.drawingUi, ...patch };
  if (patch.lastToolByGroup) {
    next.lastToolByGroup = { ...store.drawingUi.lastToolByGroup, ...patch.lastToolByGroup };
  }
  setStore('drawingUi', next);
  persist();
}

/**
 * Shallow-merge a patch onto one user drawing by id (style bar dual-field updates).
 * Callers should dual-write legacy + `style` when changing paint props (see DrawingToolbar).
 */
export function patchDrawing(id: string, patch: Partial<Drawing>) {
  setStore(
    'drawings',
    store.drawings.map((d) => (d.id === id ? ({ ...d, ...patch } as Drawing) : d)),
  );
  persist();
}
