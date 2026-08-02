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

import { createStore, reconcile, unwrap } from 'solid-js/store';
import type {
  AppState,
  Bar,
  CompareState,
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
import {
  defaultChartLayout,
  normalizeChartLayout,
  type ChartGridMode,
  type ChartLayoutState,
  type SavedChartLayout,
} from '../chart/layout';
import {
  getActiveSlotId,
  setActiveSlotId,
  setSlotBars,
  removeSlotRuntime,
} from '../chart/chart-registry';
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

/** Default / clamp bounds for {@link AppState.historyBars}. */
export const HISTORY_BARS_DEFAULT = 500;
export const HISTORY_BARS_MIN = 50;
export const HISTORY_BARS_MAX = 5000;

/** Clamp history bar count into a safe range for REST kline APIs. */
export function clampHistoryBars(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return HISTORY_BARS_DEFAULT;
  return Math.min(HISTORY_BARS_MAX, Math.max(HISTORY_BARS_MIN, Math.round(v)));
}

const DEFAULTS: AppState = {
  bars: [],
  chartDataGen: 0,
  chartType: DEFAULT_CHART_TYPE,
  symbol: 'BTCUSDT',
  interval: '1d',
  exchange: 'binance',
  historyBars: HISTORY_BARS_DEFAULT,
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
    preferAfterLoad: true,
    rerunOn: 'every-tick',
  },
  theme: 'dark',
  uiScale: 1,
  editor: { open: true, width: 460, mode: 'docked' },
  watchlist: { open: true, width: 200, symbols: [...DEFAULT_WATCHLIST], refreshSec: 15 },
  indicatorPanel: { open: false, width: 224 },
  dataViewPanel: { open: false, width: 220 },
  layerPanel: { open: false, width: 220 },
  alertsPanel: { open: false, width: 280 },
  scriptSettings: { open: false, indicatorId: null },
  editorInputValues: {},
  crosshair: { time: null, barIndex: null },
  resultsPanel: { open: false, height: 220 },
  logsPanel: { open: false, height: 160 },
  profilerEnabled: false,
  inlineDebugEnabled: false,
  debugPinsEnabled: false,
  editorRulerEnabled: true,
  stream: { status: 'disconnected' },
  status: 'ready',
  statusMessage: 'Ready.',
  lastRunMs: null,
  lastRun: null,
  indicatorSeries: {},
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
  chartLayout: defaultChartLayout({
    symbol: 'BTCUSDT',
    interval: '1d',
    exchange: 'binance',
  }),
  savedLayouts: [],
  compare: {
    enabled: false,
    symbol: '',
    mode: 'percent',
    normalizeMain: false,
    bars: [],
    gen: 0,
    loading: false,
    error: null,
  },
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
        historyBars: clampHistoryBars(
          parsed.historyBars ?? (parsed as { barLimit?: unknown }).barLimit ?? DEFAULTS.historyBars,
        ),
        live: {
          ...DEFAULTS.live,
          ...parsed.live,
          // Never hydrate "live active" as running — user must re-enable
          active: false,
          preferAfterLoad:
            typeof parsed.live?.preferAfterLoad === 'boolean'
              ? parsed.live.preferAfterLoad
              : DEFAULTS.live.preferAfterLoad,
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
        alertsPanel: { ...DEFAULTS.alertsPanel, ...parsed.alertsPanel },
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
        inlineDebugEnabled: !!(parsed as { inlineDebugEnabled?: boolean }).inlineDebugEnabled,
        debugPinsEnabled: !!(parsed as { debugPinsEnabled?: boolean }).debugPinsEnabled,
        editorRulerEnabled:
          typeof (parsed as { editorRulerEnabled?: boolean }).editorRulerEnabled === 'boolean'
            ? !!(parsed as { editorRulerEnabled?: boolean }).editorRulerEnabled
            : DEFAULTS.editorRulerEnabled,
        activePlugins: {
          ...DEFAULTS.activePlugins,
          ...parsed.activePlugins,
          source: parsed.activePlugins?.source || source,
          engine: parsed.activePlugins?.engine || engine,
          stream: parsed.activePlugins?.stream || streamId,
          storage: parsed.activePlugins?.storage || DEFAULTS.activePlugins.storage,
        },
        pluginsConfig: parsed.pluginsConfig || DEFAULTS.pluginsConfig,
        // Do not hydrate lastRun / logs / series cache / telemetry / bars from storage
        lastRun: null,
        indicatorSeries: {},
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
          alerts: {
            open: parsed.alertsPanel?.open ?? false,
            w: parsed.alertsPanel?.width ?? 280,
          },
        }),
        chartLayout: normalizeChartLayout(
          (parsed as { chartLayout?: ChartLayoutState }).chartLayout,
          {
            symbol: parsed.symbol || DEFAULTS.symbol,
            interval: parsed.interval || DEFAULTS.interval,
            exchange: parsed.exchange || DEFAULTS.exchange,
            chartType: normalizeChartType(parsed.chartType),
          },
        ),
        savedLayouts: Array.isArray((parsed as { savedLayouts?: unknown }).savedLayouts)
          ? ((parsed as { savedLayouts: SavedChartLayout[] }).savedLayouts || [])
              .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
              .slice(0, 40)
          : [],
        compare: hydrateCompare(parsed.compare),
      };
    }
  } catch {}
  return {};
}

/** Restore durable compare prefs; always clear bars / loading / error. */
function hydrateCompare(raw: unknown): CompareState {
  const base = { ...DEFAULTS.compare };
  if (!raw || typeof raw !== 'object') return base;
  const c = raw as Partial<CompareState>;
  return {
    enabled: !!c.enabled,
    symbol: typeof c.symbol === 'string' ? c.symbol.toUpperCase().trim() : '',
    mode: c.mode === 'absolute' ? 'absolute' : 'percent',
    normalizeMain: !!c.normalizeMain,
    bars: [],
    gen: 0,
    loading: false,
    error: null,
  };
}

function mergePanelChrome(
  raw: unknown,
  legacy: Partial<Record<PanelId, Partial<PanelChrome>>>,
): Record<PanelId, PanelChrome> {
  const base = defaultPanelChromeMap();
  const bag =
    raw && typeof raw === 'object' ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>) : {};
  // Migrate pre-rename panel id `pinelogs` → `scriptlogs`
  if (bag.pinelogs && !bag.scriptlogs) {
    bag.scriptlogs = bag.pinelogs;
  }
  delete bag.pinelogs;
  const src = bag as Partial<Record<PanelId, Partial<PanelChrome>>>;
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
 * selectedDrawingId, compare bars/loading, and full telemetry
 * (keeps only `telemetry.hud` + durable compare prefs).
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
      indicatorSeries: _is,
      compare,
      telemetry,
      ...rest
    } = plain;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...rest,
        // Durable compare prefs only — bars / loading / error stay session-local
        compare: {
          enabled: !!compare?.enabled,
          symbol: (compare?.symbol || '').toUpperCase(),
          mode: compare?.mode === 'absolute' ? 'absolute' : 'percent',
          normalizeMain: !!compare?.normalizeMain,
        },
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
  const t = normalizeChartType(type);
  setStore('chartType', t);
  // Keep active multi-chart slot in sync
  const layout = store.chartLayout;
  if (layout?.activeId) {
    const idx = layout.slots.findIndex((s) => s.id === layout.activeId);
    if (idx >= 0) setStore('chartLayout', 'slots', idx, 'chartType', t);
  }
  persist();
}

/* ── Multi-chart layouts ─────────────────────────────────────────── */

/** Focus a grid slot — mirrors symbol/interval/chartType into flat store fields. */
export function setActiveChartSlot(slotId: string) {
  ensureChartLayout();
  const layout = store.chartLayout;
  const slot = layout.slots.find((s) => s.id === slotId);
  if (!slot) return;
  setStore('chartLayout', 'activeId', slotId);
  setActiveSlotId(slotId);
  setStore('symbol', slot.symbol);
  setStore('interval', slot.interval);
  setStore('exchange', slot.exchange);
  setStore('chartType', normalizeChartType(slot.chartType));
  persist();
  emitWindowEvent('axis-chart-reflow');
  // Auto-load history when focusing an empty slot
  emitWindowEvent('axis-slot-activate', { slotId });
}

/** Change grid arrangement (1 / 2H / 2V / 4); preserves existing slots when possible. */
export function setChartGridMode(mode: ChartGridMode) {
  ensureChartLayout();
  const prev = store.chartLayout;
  const next = normalizeChartLayout(
    { mode, activeId: prev.activeId, slots: prev.slots },
    {
      symbol: store.symbol,
      interval: store.interval,
      exchange: store.exchange,
      chartType: store.chartType,
    },
  );
  // Drop runtime for removed slots
  const keep = new Set(next.slots.map((s) => s.id));
  for (const s of prev.slots) {
    if (!keep.has(s.id)) removeSlotRuntime(s.id);
  }
  setStore('chartLayout', next);
  setActiveSlotId(next.activeId);
  const active = next.slots.find((s) => s.id === next.activeId) || next.slots[0]!;
  setStore('symbol', active.symbol);
  setStore('interval', active.interval);
  setStore('exchange', active.exchange);
  setStore('chartType', normalizeChartType(active.chartType));
  persist();
  emitWindowEvent('axis-chart-reflow');
}

/** Update one slot's market fields (and flat store when it's active). */
export function updateChartSlot(
  slotId: string,
  patch: Partial<{ symbol: string; interval: string; exchange: string; chartType: ChartType }>,
) {
  ensureChartLayout();
  const idx = store.chartLayout.slots.findIndex((s) => s.id === slotId);
  if (idx < 0) return;
  if (patch.symbol != null) {
    setStore('chartLayout', 'slots', idx, 'symbol', patch.symbol.toUpperCase());
  }
  if (patch.interval != null) setStore('chartLayout', 'slots', idx, 'interval', patch.interval);
  if (patch.exchange != null) setStore('chartLayout', 'slots', idx, 'exchange', patch.exchange);
  if (patch.chartType != null) {
    setStore('chartLayout', 'slots', idx, 'chartType', normalizeChartType(patch.chartType));
  }
  if (store.chartLayout.activeId === slotId) {
    if (patch.symbol != null) setStore('symbol', patch.symbol.toUpperCase());
    if (patch.interval != null) setStore('interval', patch.interval);
    if (patch.exchange != null) setStore('exchange', patch.exchange);
    if (patch.chartType != null) setStore('chartType', normalizeChartType(patch.chartType));
  }
  persist();
}

/** Snapshot current grid (+ optional chrome) into savedLayouts. */
export function saveChartLayout(name: string): SavedChartLayout {
  ensureChartLayout();
  const id = `lay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const snap: SavedChartLayout = {
    id,
    name: (name || 'Layout').trim() || 'Layout',
    updatedAt: Date.now(),
    chartLayout: JSON.parse(JSON.stringify(store.chartLayout)) as ChartLayoutState,
    panelChrome: JSON.parse(JSON.stringify(store.panelChrome)) as typeof store.panelChrome,
    panes: store.panes.map((p) => ({ ...p })),
    theme: store.theme,
    uiScale: store.uiScale,
    historyBars: store.historyBars,
  };
  setStore('savedLayouts', (list) => [snap, ...(list || [])].slice(0, 40));
  persist();
  appendLog('ok', `Layout saved · ${snap.name}`, 'layout');
  return snap;
}

/** Restore a named layout by id. */
export function loadChartLayout(id: string): boolean {
  ensureChartLayout();
  const found = (store.savedLayouts || []).find((l) => l.id === id);
  if (!found) return false;
  const next = normalizeChartLayout(found.chartLayout, {
    symbol: store.symbol,
    interval: store.interval,
    exchange: store.exchange,
    chartType: store.chartType,
  });
  // Clear runtimes for slots that disappear
  const keep = new Set(next.slots.map((s) => s.id));
  for (const s of store.chartLayout.slots) {
    if (!keep.has(s.id)) removeSlotRuntime(s.id);
  }
  setStore('chartLayout', next);
  setActiveSlotId(next.activeId);
  const active = next.slots.find((s) => s.id === next.activeId) || next.slots[0]!;
  setStore('symbol', active.symbol);
  setStore('interval', active.interval);
  setStore('exchange', active.exchange);
  setStore('chartType', normalizeChartType(active.chartType));
  if (found.panelChrome) {
    setStore('panelChrome', found.panelChrome);
  }
  if (found.panes?.length) {
    setStore(
      'panes',
      found.panes.map((p) => ({ ...p })),
    );
  }
  if (found.theme === 'dark' || found.theme === 'light') {
    setStore('theme', found.theme);
    try {
      document?.documentElement?.setAttribute('data-theme', found.theme);
    } catch {
      /* test envs without full DOM */
    }
  }
  if (found.uiScale != null) {
    setUiScale(found.uiScale);
  }
  if (found.historyBars != null) {
    setStore('historyBars', clampHistoryBars(found.historyBars));
  }
  persist();
  appendLog('ok', `Layout loaded · ${found.name}`, 'layout');
  emitWindowEvent('axis-chart-reflow');
  return true;
}

/** Safe CustomEvent for test DOMs without dispatchEvent. */
function emitWindowEvent(name: string, detail?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
  } catch {
    /* ignore */
  }
}

/** Delete a saved layout by id. */
export function deleteChartLayout(id: string) {
  setStore('savedLayouts', (list) => (list || []).filter((l) => l.id !== id));
  persist();
}

function ensureChartLayout() {
  if (!store.chartLayout?.slots?.length) {
    setStore(
      'chartLayout',
      defaultChartLayout({
        symbol: store.symbol,
        interval: store.interval,
        exchange: store.exchange,
        chartType: store.chartType,
      }),
    );
  }
}

// Boot: bind active multi-chart slot id for registry
if (typeof window !== 'undefined') {
  try {
    const id = store.chartLayout?.activeId;
    if (id) setActiveSlotId(id);
  } catch {
    /* ignore */
  }
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
  // Mirror into active multi-chart slot + runtime bar cache
  const slotId = getActiveSlotId() || store.chartLayout?.activeId;
  if (slotId) {
    setSlotBars(slotId, bars, true);
    const idx = store.chartLayout?.slots?.findIndex((s) => s.id === slotId) ?? -1;
    if (idx >= 0) {
      setStore('chartLayout', 'slots', idx, 'symbol', symbol);
      setStore('chartLayout', 'slots', idx, 'interval', interval);
      setStore('chartLayout', 'slots', idx, 'exchange', exchange);
    }
  }
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
  setStore('indicatorSeries', (cache) => {
    if (!cache || !(id in cache)) return cache;
    const next = { ...cache };
    delete next[id];
    return next;
  });
  persist();
}

/**
 * Cache last plot series for an applied indicator (cross-indicator sources).
 * Ephemeral — not written to localStorage.
 */
export function setIndicatorSeries(
  id: string,
  payload: {
    name: string;
    series: Record<string, (number | null)[]>;
    titles?: Record<string, string>;
  },
) {
  setStore('indicatorSeries', id, {
    name: payload.name,
    series: payload.series,
    titles: payload.titles,
  });
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

/**
 * Append a chart pane and return its id.
 * Pass `opts.id` for a stable id (e.g. shared `'indicator'` sub-pane).
 * If that id already exists, updates label/height and returns it.
 */
export function addPane(
  type: Pane['type'],
  label?: string,
  opts?: { id?: string; height?: number },
): string {
  const preferred = opts?.id?.trim();
  if (preferred) {
    const existing = store.panes.find((p) => p.id === preferred);
    if (existing) {
      if (label && existing.label !== label) {
        setStore('panes', (p) =>
          p.map((pane) => (pane.id === preferred ? { ...pane, label } : pane)),
        );
        persist();
      }
      return preferred;
    }
  }
  const id = preferred || uid();
  const maxOrder = Math.max(...store.panes.map((p) => p.order), -1);
  const height = opts?.height != null ? opts.height : type === 'indicator' ? 140 : 120;
  setStore('panes', (p) => [
    ...p,
    { id, type, height, order: maxOrder + 1, visible: true, label },
  ]);
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
  try {
    document?.documentElement?.setAttribute('data-theme', next);
  } catch {
    /* test envs without full DOM */
  }
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
  // Guard incomplete test DOMs (happy-dom/jsdom stubs without CSSOM)
  if (!root?.style || typeof root.style.setProperty !== 'function') return s;
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

/**
 * Reset workspace chrome to factory defaults without touching market data,
 * scripts, plugins, endpoint, drawings, or watchlist symbols.
 *
 * Restores: panel docks/open/geometry, side-panel widths/heights, UI scale,
 * HUD layout prefs, drawing toolbar chrome (tool → cursor), pane visibility.
 */
export function resetUiLayout(): void {
  ensurePanelChrome();
  // Fresh maps/arrays — DEFAULTS nested objects are shared with the live store
  // (shallow-spread at createStore) and must not be read back as “defaults”.
  const chrome = defaultPanelChromeMap();
  setStore('panelChrome', reconcile(chrome));

  setStore('editor', 'open', chrome.editor.open);
  setStore('editor', 'width', chrome.editor.w);
  setStore('editor', 'mode', 'docked');
  setStore('watchlist', 'open', chrome.watchlist.open);
  setStore('watchlist', 'width', chrome.watchlist.w);
  setStore('indicatorPanel', 'open', chrome.indicators.open);
  setStore('indicatorPanel', 'width', chrome.indicators.w);
  setStore('dataViewPanel', 'open', chrome.dataview.open);
  setStore('dataViewPanel', 'width', chrome.dataview.w);
  setStore('layerPanel', 'open', chrome.layers.open);
  setStore('layerPanel', 'width', chrome.layers.w);
  setStore('alertsPanel', 'open', chrome.alerts.open);
  setStore('alertsPanel', 'width', chrome.alerts.w);
  setStore('resultsPanel', 'open', chrome.results.open);
  setStore('resultsPanel', 'height', chrome.results.h);
  setStore('logsPanel', 'open', chrome.logs.open);
  setStore('logsPanel', 'height', chrome.logs.h);

  setStore('uiScale', 1);
  applyUiScale(1);

  setStore('telemetry', 'hud', 'compact', false);
  setStore('telemetry', 'hud', 'overlay', false);

  setStore('drawingTool', 'cursor');
  setStore('selectedDrawingId', null);
  setStore('drawingUi', 'magnet', 'off');
  setStore('drawingUi', 'stayInMode', false);
  setStore('drawingUi', 'hideDrawings', false);
  setStore('drawingUi', 'lockAll', false);
  setStore('drawingUi', 'lastToolByGroup', reconcile({}));

  // Chart pane strip (price + volume) — restore heights/visibility
  setStore(
    'panes',
    reconcile([
      { id: 'price', type: 'price' as const, height: 0, order: 0, visible: true, label: 'Price' },
      {
        id: 'volume',
        type: 'volume' as const,
        height: 120,
        order: 1,
        visible: true,
        label: 'Volume',
      },
    ]),
  );

  flushPersist();
  appendLog('ok', 'UI layout reset to defaults', 'ui');
  setStatus('ready', 'UI layout reset to defaults');
}

/* ── Layout helpers ─────────────────────────────────────────────── */

/** Clamp and persist docked editor width (px); mirrors panelChrome.editor.w. Min 1px (border). */
export function setEditorWidth(width: number) {
  const w = Math.min(Math.max(width, 1), Math.floor(window.innerWidth * 0.9));
  setStore('editor', 'width', w);
  ensurePanelChrome();
  setStore('panelChrome', 'editor', 'w', w);
  persist();
}

/** Clamp and persist watchlist width (px). Min 1px (border). */
export function setWatchlistWidth(width: number) {
  const w = Math.min(Math.max(width, 1), Math.floor(window.innerWidth * 0.9));
  setStore('watchlist', 'width', w);
  ensurePanelChrome();
  setStore('panelChrome', 'watchlist', 'w', w);
  persist();
}

/** Clamp and persist indicator panel width (px). Min 1px (border). */
export function setIndicatorWidth(width: number) {
  const w = Math.min(Math.max(width, 1), Math.floor(window.innerWidth * 0.9));
  setStore('indicatorPanel', 'width', w);
  ensurePanelChrome();
  setStore('panelChrome', 'indicators', 'w', w);
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

/** Open/close Layers (drawings) panel — docks left as a slide-in column. */
export function setLayerPanelOpen(open: boolean) {
  setPanelOpen('layers', open);
  if (open) setPanelDock('layers', 'left');
}

/** Toggle Layers panel — left slide-in when opening. */
export function toggleLayerPanel() {
  const next = !isPanelOpen('layers');
  setPanelOpen('layers', next);
  if (next) setPanelDock('layers', 'left');
}

/** Open/close Alerts panel. */
export function setAlertsPanelOpen(open: boolean) {
  setPanelOpen('alerts', open);
}

/** Toggle Alerts panel visibility. */
export function toggleAlertsPanel() {
  setPanelOpen('alerts', !isPanelOpen('alerts'));
}

/** Open/close Scriptlogs panel (script `log.*` output — not system telemetry). */
export function setScriptLogsPanelOpen(open: boolean) {
  setPanelOpen('scriptlogs', open);
}

/** Toggle Scriptlogs panel visibility. */
export function toggleScriptLogsPanel() {
  setPanelOpen('scriptlogs', !isPanelOpen('scriptlogs'));
}

/** Open/close Script Library panel. */
export function setLibraryPanelOpen(open: boolean) {
  setPanelOpen('library', open);
}

/** Toggle Script Library panel visibility. */
export function toggleLibraryPanel() {
  setPanelOpen('library', !isPanelOpen('library'));
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

/** Enable/disable inline debug decorations (persisted). */
export function setInlineDebugEnabled(on: boolean) {
  setStore('inlineDebugEnabled', !!on);
  persist();
}

/** Toggle inline debug mode (end-of-line log/error chips). */
export function toggleInlineDebugEnabled() {
  setStore('inlineDebugEnabled', !store.inlineDebugEnabled);
  persist();
}

/** Enable/disable chart pins from last-run logs with bar_index/time. */
export function setDebugPinsEnabled(on: boolean) {
  setStore('debugPinsEnabled', !!on);
  persist();
}

/** Toggle chart debug pins (markers on bars referenced by logs). */
export function toggleDebugPinsEnabled() {
  setStore('debugPinsEnabled', !store.debugPinsEnabled);
  persist();
}

/** Enable/disable editor column ruler (persisted; default on). */
export function setEditorRulerEnabled(on: boolean) {
  setStore('editorRulerEnabled', !!on);
  persist();
}

/** Toggle the 80-column recommended line-length ruler in the Pine editor. */
export function toggleEditorRulerEnabled() {
  setStore('editorRulerEnabled', !store.editorRulerEnabled);
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
    case 'scriptlogs':
      // Chrome-only (no legacy flat flag)
      return chromeOpen;
    case 'library':
      // Chrome-only (no legacy flat flag)
      return chromeOpen;
    case 'dataview':
      return !!store.dataViewPanel.open || chromeOpen;
    case 'layers':
      return !!store.layerPanel.open || chromeOpen;
    case 'alerts':
      return !!store.alertsPanel.open || chromeOpen;
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
  else if (id === 'alerts') setStore('alertsPanel', 'open', open);
}

/** Open/close a panel; dual-writes panelChrome and legacy flat flags. */
export function setPanelOpen(id: PanelId, open: boolean) {
  ensurePanelChrome();
  setStore('panelChrome', id, 'open', open);
  syncLegacyOpen(id, open);
  // Opening onto a shared side column stacks panels; rebalance flex heights
  if (open) {
    const dock = getPanelChrome(id).dock;
    if (dock === 'left' || dock === 'right') {
      rebalanceDockStack(dock);
    }
  }
  persist();
}

/** Stable stack order when several panels share left/right/bottom. */
const DOCK_STACK_IDS: PanelId[] = [
  'watchlist',
  'layers',
  'dataview',
  'indicators',
  'alerts',
  'editor',
  'results',
  'logs',
  'scriptlogs',
];

/** Open panel ids currently assigned to a side dock (stack order). */
function openIdsOnDock(dock: PanelDock): PanelId[] {
  if (dock === 'float' || dock === 'window') return [];
  return DOCK_STACK_IDS.filter((pid) => {
    if (!isPanelOpen(pid)) return false;
    return store.panelChrome?.[pid]?.dock === dock;
  });
}

/**
 * Side docks lay out side-by-side (independent widths). Height weights are
 * equalized for chrome bookkeeping; shells use height:100% of the strip.
 */
function rebalanceDockStack(dock: PanelDock) {
  if (dock !== 'left' && dock !== 'right') return;
  const ids = openIdsOnDock(dock);
  if (ids.length < 2) return;
  const weight = 100;
  for (const pid of ids) {
    setStore('panelChrome', pid, 'h', weight);
  }
}

/** Mirror one panel’s width into legacy layout fields. */
function mirrorPanelWidth(id: PanelId, w: number) {
  setStore('panelChrome', id, 'w', w);
  if (id === 'watchlist') setStore('watchlist', 'width', w);
  if (id === 'indicators') setStore('indicatorPanel', 'width', w);
  if (id === 'editor') setStore('editor', 'width', w);
  if (id === 'dataview') setStore('dataViewPanel', 'width', w);
  if (id === 'layers') setStore('layerPanel', 'width', w);
  if (id === 'alerts') setStore('alertsPanel', 'width', w);
}

/**
 * Change panel dock target. Editor `window` sets popout mode; other docks
 * set docked. Float/window bump z-index. Side docks keep independent widths
 * (side-by-side strip).
 */
export function setPanelDock(id: PanelId, dock: PanelDock) {
  ensurePanelChrome();
  const prev = getPanelChrome(id).dock;
  setStore('panelChrome', id, 'dock', dock);
  if (dock === 'window' && id === 'editor') {
    setStore('editor', 'mode', 'popout');
  } else if (id === 'editor' && dock !== 'window') {
    setStore('editor', 'mode', 'docked');
  }
  if (dock === 'float' || dock === 'window') {
    bumpPanelZ(id);
  } else {
    // Do not force-match peer widths — each panel keeps its own w
    rebalanceDockStack(dock);
  }
  if (prev !== dock && (prev === 'left' || prev === 'right' || prev === 'bottom')) {
    rebalanceDockStack(prev);
  }
  persist();
}

/**
 * Update float geometry and mirror width/height into legacy layout fields.
 * Left/right: each panel’s width is independent (side-by-side dock strip).
 *
 * @param opts.persist - set false while dragging to avoid localStorage thrash
 */
export function setPanelGeometry(
  id: PanelId,
  geo: Partial<Pick<PanelChrome, 'x' | 'y' | 'w' | 'h'>>,
  opts?: { persist?: boolean },
) {
  ensurePanelChrome();
  if (geo.x != null) setStore('panelChrome', id, 'x', Math.round(geo.x));
  if (geo.y != null) setStore('panelChrome', id, 'y', Math.round(geo.y));
  if (geo.w != null) {
    const w = Math.max(1, Math.round(geo.w));
    mirrorPanelWidth(id, w);
  }
  if (geo.h != null) {
    const h = Math.max(1, Math.round(geo.h));
    setStore('panelChrome', id, 'h', h);
    if (id === 'results') setStore('resultsPanel', 'height', h);
    if (id === 'logs') setStore('logsPanel', 'height', h);
  }
  if (opts?.persist !== false) persist();
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

/* ── Compare overlay ─────────────────────────────────────────────── */

/**
 * Enable/disable second-symbol compare. Clearing disables and drops bars.
 * Does not fetch — ChartHost / CompareSymbolControl own loading.
 */
export function setCompareEnabled(enabled: boolean) {
  setStore('compare', 'enabled', !!enabled);
  if (!enabled) {
    setStore('compare', 'bars', []);
    setStore('compare', 'error', null);
    setStore('compare', 'loading', false);
    setStore('compare', 'gen', (g) => (typeof g === 'number' ? g + 1 : 1));
  }
  persist();
}

/** Update compare ticker (uppercased). Does not auto-fetch. */
export function setCompareSymbol(symbol: string) {
  setStore('compare', 'symbol', (symbol || '').toUpperCase().trim());
  persist();
}

/** percent = % from first common bar; absolute = raw close on left scale. */
export function setCompareMode(mode: 'percent' | 'absolute') {
  setStore('compare', 'mode', mode === 'absolute' ? 'absolute' : 'percent');
  persist();
}

/** Dual-% mode: also paint main closes as percent when mode is percent. */
export function setCompareNormalizeMain(on: boolean) {
  setStore('compare', 'normalizeMain', !!on);
  persist();
}

/**
 * Replace ephemeral compare bars (after fetch). Bumps `compare.gen`.
 * Not persisted.
 */
export function setCompareBars(bars: Bar[]) {
  setStore('compare', 'bars', bars);
  setStore('compare', 'loading', false);
  setStore('compare', 'error', null);
  setStore('compare', 'gen', (g) => (typeof g === 'number' ? g + 1 : 1));
}

/** Mark compare fetch in flight / failed. */
export function setCompareLoadState(
  state: { loading?: boolean; error?: string | null },
) {
  if (state.loading !== undefined) setStore('compare', 'loading', state.loading);
  if (state.error !== undefined) setStore('compare', 'error', state.error);
}

/** Clear compare series data without toggling the enabled pref. */
export function clearCompareBars() {
  setStore('compare', 'bars', []);
  setStore('compare', 'loading', false);
  setStore('compare', 'error', null);
  setStore('compare', 'gen', (g) => (typeof g === 'number' ? g + 1 : 1));
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

/** Remove one user drawing by id (Layers panel / external). */
export function deleteDrawing(id: string) {
  setStore(
    'drawings',
    store.drawings.filter((d) => d.id !== id),
  );
  if (store.selectedDrawingId === id) setStore('selectedDrawingId', null);
  persist();
}

/**
 * Selection for the style bar / hit-test / Layers panel. Ephemeral — not persisted.
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
