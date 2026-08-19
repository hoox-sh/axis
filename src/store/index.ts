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
 *    (`STORAGE_KEY`). Corrupt JSON is dropped (never throws on boot).
 * 2. Ephemeral fields are forced off on hydrate (live, logs, bars, lastRun,
 *    selection, open modals, presentation modes).
 * 3. `persist()` debounces a write that **omits** bars, lastRun, logs,
 *    crosshair, scriptSettings, selectedDrawingId, presentation, and full
 *    telemetry (only `telemetry.hud` is kept). QuotaExceededError degrades to
 *    slim write / in-memory only. Pending debounce flushes on beforeunload/pagehide.
 *
 * ## Data flow
 * - Chart / loaders call `loadBars` / `appendBar` / `setStatus` / telemetry helpers.
 * - UI panels use layout helpers (`setPanelOpen`, chrome, widths) and drawing
 *   helpers; panel open state is dual-written to legacy flat flags + `panelChrome`.
 * - Editor document body lives under `EDITOR_DOC_KEY` (separate from app JSON).
 *
 * Types: {@link ./types.ts}. Panel chrome shapes: `ui/panels/types`.
 */

import { batch } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type {
  AppState,
  Bar,
  CompareState,
  Indicator,
  OnchainState,
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
import {
  DEFAULT_EDITOR_INTEL,
  EDITOR_INTEL_REV,
  readEditorIntel,
  type EditorIntelSettings,
} from '../editor/editor-intel';
import { idlePlane, pushSample } from '../ui/telemetry';
import {
  defaultPanelChromeMap,
  isHoverSlideEligible,
  type PanelChrome,
  type PanelDock,
  type PanelId,
} from '../ui/panels/types';
import {
  clearPanelHoverSlideExpanded,
  setPanelHoverSlideExpanded,
} from '../ui/panels/hover-slide';
import {
  chartOverlayGeometry,
  defaultPanelPosition,
  getDefaultPanelChrome,
  isChartOverlayEligible,
  isManagedFloatablePanel,
  PANEL_IDS,
} from '../ui/panels/panel-manager';
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
import {
  defaultChartThemeState,
  hydrateChartTheme,
  withPreset,
  withTokenOverride,
  applyThemeToDocument,
  getThemeManager,
  type ChartThemeState,
  type ThemeTokenValue,
} from '../theme';
import { beginRunEpoch, releaseRunStatus } from '../indicators/run-helpers';
import {
  normalizePriceScaleDecimalsMode,
  type PriceScaleDecimalsMode,
} from '../chart/price-precision';

// Stable ID generation — uses timestamp prefix + counter to survive reloads
let idCounter = 0;
const uid = () => `id_${Date.now()}_${++idCounter}`;

/** Public id generator for stable pane / script keys (chart apply path). */
export function newEntityId(): string {
  return uid();
}

/** Current AXIS app-state localStorage key. */
export const STORAGE_KEY = 'pynescript.axis.v1';
/** Older app-state keys — read once and write forward. */
export const LEGACY_STORAGE_KEYS = [
  'pynescript.axis.v2',
] as const;

/** localStorage key for the docked/popout editor document body. */
export const EDITOR_DOC_KEY = 'pynescript.axis.editor.doc';
const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];

/** True after a QuotaExceededError (or equivalent) blocked a durable write this session. */
let persistQuotaExceeded = false;
/** One-shot console warning for quota / private-mode write failures. */
let persistWriteWarned = false;

/** Default / clamp bounds for {@link AppState.historyBars}. */
export const HISTORY_BARS_DEFAULT = 500;
export const HISTORY_BARS_MIN = 50;
export const HISTORY_BARS_MAX = 100_000;

/**
 * Default docked editor width = 50% of viewport (clamped).
 * Used for factory defaults / layout reset — not for overwriting user prefs.
 */
export function defaultEditorWidthPx(viewportWidth?: number): number {
  const vw =
    typeof viewportWidth === 'number' && Number.isFinite(viewportWidth) && viewportWidth > 0
      ? viewportWidth
      : typeof window !== 'undefined' &&
          typeof window.innerWidth === 'number' &&
          Number.isFinite(window.innerWidth) &&
          window.innerWidth > 0
        ? window.innerWidth
        : 1280;
  const half = Math.round(vw * 0.5);
  const max = Math.floor(vw * 0.9);
  return Math.min(Math.max(half, 1), Math.max(1, max));
}

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
  priceScaleLabelsVisible: true,
  lastValueLabelsVisible: true,
  lastValueNamesVisible: true,
  priceScaleDecimals: 'auto',
  strategyUi: {
    slippageNextOpen: false,
    invertTradeLabels: false,
    exactOnCandle: true,
  },
  symbol: 'BTCUSDT',
  interval: '1d',
  exchange: 'binance',
  historyBars: HISTORY_BARS_DEFAULT,
  source: 'binance-rest',
  engine: 'server',
  endpoint: 'https://axis.hoox.sh',
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
  chartTheme: defaultChartThemeState(),
  uiScale: 1,
  // Ephemeral presentation — never hydrate as on
  presentation: { fullscreen: false, chartOnly: false },
  editor: { open: true, width: defaultEditorWidthPx(), mode: 'docked' },
  watchlist: { open: true, width: 200, symbols: [...DEFAULT_WATCHLIST], refreshSec: 15 },
  indicatorPanel: { open: false, width: 224 },
  dataViewPanel: { open: false, width: 220 },
  layerPanel: { open: false, width: 220 },
  alertsPanel: { open: false, width: 280 },
  scriptSettings: { open: false, indicatorId: null },
  editorInputValues: {},
  editorStrategyProps: {},
  crosshair: { time: null, barIndex: null },
  resultsPanel: { open: false, height: 220 },
  logsPanel: { open: false, height: 160 },
  profilerEnabled: false,
  inlineDebugEnabled: false,
  debugPinsEnabled: false,
  editorRulerEnabled: true,
  editorWrapEnabled: true,
  editorIntel: { ...DEFAULT_EDITOR_INTEL },
  stream: { status: 'disconnected' },
  status: 'ready',
  statusMessage: 'Ready.',
  preEval: {
    diagnostics: [],
    hasErrors: false,
    pending: false,
    source: '',
  },
  lastRunMs: null,
  lastRun: null,
  runResults: {},
  resultsFocusId: null,
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
    // onchain?: optional 5th plane — created by health probe; never in DEFAULTS/hydrate
    runLatencySamples: [],
    lastTick: null,
    hud: { compact: false, overlay: false },
    // Privacy: never prompt to share error data unless the user opts in
    shareOnError: false,
  },
  errorShareOffer: null,
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
  onchain: {
    lastProtocolSlug: '',
    lastProtocolName: '',
  },
};

function readLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorage(key: string): void {
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) return;
    localStorage.removeItem(key);
  } catch {
    /* private mode / security */
  }
}

/**
 * Prefer current key; fall back to older keys and write forward to {@link STORAGE_KEY}.
 * Never throws. Exported for tests (v2 → v1 migration).
 */
export function loadRawState(): string | null {
  const current = readLocalStorage(STORAGE_KEY);
  if (current) return current;
  for (const legacy of LEGACY_STORAGE_KEYS) {
    const raw = readLocalStorage(legacy);
    if (raw) {
      try {
        localStorage.setItem(STORAGE_KEY, raw);
      } catch {
        /* quota — still return raw so hydrate can proceed in-memory */
      }
      return raw;
    }
  }
  return null;
}

/**
 * Pure parse of a localStorage JSON blob into a safe AppState overlay.
 * Returns `null` on corrupt / non-object JSON. **Never throws.**
 *
 * Always forces ephemeral fields off (bars, lastRun, logs, live.active, …)
 * even if they were written by an older client.
 */
export function parsePersistedState(raw: string): Partial<AppState> | null {
  try {
    if (typeof raw !== 'string' || !raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Only plain objects are durable app state (not arrays / primitives / null)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const bag = parsed as Record<string, unknown> & Partial<AppState>;
    const source =
      (typeof bag.source === 'string' && bag.source) || DEFAULTS.source;
    const engine =
      (typeof bag.engine === 'string' && bag.engine) || DEFAULTS.engine;
    const liveBag =
      bag.live && typeof bag.live === 'object' ? (bag.live as AppState['live']) : undefined;
    const pluginsBag =
      bag.activePlugins && typeof bag.activePlugins === 'object'
        ? (bag.activePlugins as AppState['activePlugins'])
        : undefined;
    const streamId =
      liveBag?.streamId || pluginsBag?.stream || DEFAULTS.live.streamId;

    // Legacy demo IP → same-origin HTTPS host (mixed content + CF edge)
    const rawEndpoint =
      typeof bag.endpoint === 'string' && bag.endpoint.trim()
        ? bag.endpoint.trim()
        : DEFAULTS.endpoint;
    const endpoint = /^https?:\/\/162\.254\.38\.194(:5002)?\/?$/i.test(rawEndpoint)
      ? 'https://axis.hoox.sh'
      : rawEndpoint;

    return {
      ...DEFAULTS,
      ...bag,
      endpoint,
      chartType: normalizeChartType(bag.chartType),
      priceScaleLabelsVisible:
        typeof bag.priceScaleLabelsVisible === 'boolean'
          ? bag.priceScaleLabelsVisible
          : DEFAULTS.priceScaleLabelsVisible,
      lastValueLabelsVisible:
        typeof bag.lastValueLabelsVisible === 'boolean'
          ? bag.lastValueLabelsVisible
          : DEFAULTS.lastValueLabelsVisible,
      lastValueNamesVisible:
        typeof bag.lastValueNamesVisible === 'boolean'
          ? bag.lastValueNamesVisible
          : DEFAULTS.lastValueNamesVisible,
      priceScaleDecimals: normalizePriceScaleDecimalsMode(
        (bag as { priceScaleDecimals?: unknown }).priceScaleDecimals,
      ),
      strategyUi: {
        ...DEFAULTS.strategyUi,
        ...(bag.strategyUi && typeof bag.strategyUi === 'object'
          ? {
              slippageNextOpen:
                typeof (bag.strategyUi as AppState['strategyUi']).slippageNextOpen ===
                'boolean'
                  ? (bag.strategyUi as AppState['strategyUi']).slippageNextOpen
                  : DEFAULTS.strategyUi.slippageNextOpen,
              invertTradeLabels:
                typeof (bag.strategyUi as AppState['strategyUi']).invertTradeLabels ===
                'boolean'
                  ? (bag.strategyUi as AppState['strategyUi']).invertTradeLabels
                  : DEFAULTS.strategyUi.invertTradeLabels,
              exactOnCandle:
                typeof (bag.strategyUi as AppState['strategyUi']).exactOnCandle ===
                'boolean'
                  ? (bag.strategyUi as AppState['strategyUi']).exactOnCandle
                  : DEFAULTS.strategyUi.exactOnCandle,
            }
          : {}),
      },
      historyBars: clampHistoryBars(
        bag.historyBars ?? (bag as { barLimit?: unknown }).barLimit ?? DEFAULTS.historyBars,
      ),
      live: {
        ...DEFAULTS.live,
        ...liveBag,
        // Never hydrate "live active" as running — user must re-enable
        active: false,
        preferAfterLoad:
          typeof liveBag?.preferAfterLoad === 'boolean'
            ? liveBag.preferAfterLoad
            : DEFAULTS.live.preferAfterLoad,
        rerunOn: liveBag?.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
      },
      editor: {
        ...DEFAULTS.editor,
        ...(bag.editor && typeof bag.editor === 'object' ? bag.editor : {}),
      },
      uiScale: clampUiScale(bag.uiScale ?? DEFAULTS.uiScale),
      // Chart theme: hydrate when present; else default and sync base from chrome theme
      chartTheme: (() => {
        if (bag.chartTheme != null) {
          return hydrateChartTheme(bag.chartTheme);
        }
        const chrome =
          bag.theme === 'light' || bag.theme === 'dark' ? bag.theme : null;
        if (chrome === 'light') return withPreset('void-light');
        if (chrome === 'dark') return withPreset('void-dark');
        return defaultChartThemeState();
      })(),
      watchlist: {
        ...DEFAULTS.watchlist,
        ...(bag.watchlist && typeof bag.watchlist === 'object' ? bag.watchlist : {}),
        symbols:
          bag.watchlist &&
          typeof bag.watchlist === 'object' &&
          Array.isArray((bag.watchlist as AppState['watchlist']).symbols) &&
          (bag.watchlist as AppState['watchlist']).symbols.length
            ? (bag.watchlist as AppState['watchlist']).symbols
            : DEFAULTS.watchlist.symbols,
        refreshSec: Math.min(
          120,
          Math.max(
            5,
            Number(
              bag.watchlist && typeof bag.watchlist === 'object'
                ? (bag.watchlist as AppState['watchlist']).refreshSec
                : undefined,
            ) || DEFAULTS.watchlist.refreshSec,
          ),
        ),
      },
      indicatorPanel: {
        ...DEFAULTS.indicatorPanel,
        ...(bag.indicatorPanel && typeof bag.indicatorPanel === 'object'
          ? bag.indicatorPanel
          : {}),
      },
      dataViewPanel: {
        ...DEFAULTS.dataViewPanel,
        ...(bag.dataViewPanel && typeof bag.dataViewPanel === 'object' ? bag.dataViewPanel : {}),
      },
      layerPanel: {
        ...DEFAULTS.layerPanel,
        ...(bag.layerPanel && typeof bag.layerPanel === 'object' ? bag.layerPanel : {}),
      },
      alertsPanel: {
        ...DEFAULTS.alertsPanel,
        ...(bag.alertsPanel && typeof bag.alertsPanel === 'object' ? bag.alertsPanel : {}),
      },
      editorInputValues:
        bag.editorInputValues && typeof bag.editorInputValues === 'object'
          ? (bag.editorInputValues as Record<string, unknown>)
          : DEFAULTS.editorInputValues,
      editorStrategyProps:
        (bag as { editorStrategyProps?: unknown }).editorStrategyProps &&
        typeof (bag as { editorStrategyProps?: unknown }).editorStrategyProps === 'object'
          ? ((bag as { editorStrategyProps: Record<string, unknown> }).editorStrategyProps)
          : DEFAULTS.editorStrategyProps,
      // Applied chart scripts (code + pane + colors) — durable so reopen re-paints
      scripts: sanitizePersistedScripts(bag.scripts),
      // Ephemeral UI — never hydrate open modals / crosshair from disk
      scriptSettings: { open: false, indicatorId: null },
      crosshair: { time: null, barIndex: null },
      resultsPanel: {
        ...DEFAULTS.resultsPanel,
        ...(bag.resultsPanel && typeof bag.resultsPanel === 'object' ? bag.resultsPanel : {}),
      },
      logsPanel: {
        ...DEFAULTS.logsPanel,
        ...(bag.logsPanel && typeof bag.logsPanel === 'object' ? bag.logsPanel : {}),
        open: false,
      },
      profilerEnabled: !!bag.profilerEnabled,
      inlineDebugEnabled: !!(bag as { inlineDebugEnabled?: boolean }).inlineDebugEnabled,
      debugPinsEnabled: !!(bag as { debugPinsEnabled?: boolean }).debugPinsEnabled,
      editorRulerEnabled:
        typeof (bag as { editorRulerEnabled?: boolean }).editorRulerEnabled === 'boolean'
          ? !!(bag as { editorRulerEnabled?: boolean }).editorRulerEnabled
          : DEFAULTS.editorRulerEnabled,
      editorWrapEnabled:
        typeof (bag as { editorWrapEnabled?: boolean }).editorWrapEnabled === 'boolean'
          ? !!(bag as { editorWrapEnabled?: boolean }).editorWrapEnabled
          : DEFAULTS.editorWrapEnabled,
      editorIntel: readEditorIntel((bag as { editorIntel?: unknown }).editorIntel),
      activePlugins: {
        ...DEFAULTS.activePlugins,
        ...pluginsBag,
        source: pluginsBag?.source || source,
        engine: pluginsBag?.engine || engine,
        stream: pluginsBag?.stream || streamId,
        storage: pluginsBag?.storage || DEFAULTS.activePlugins.storage,
      },
      pluginsConfig:
        bag.pluginsConfig && typeof bag.pluginsConfig === 'object'
          ? (bag.pluginsConfig as AppState['pluginsConfig'])
          : DEFAULTS.pluginsConfig,
      // Do not hydrate lastRun / runResults / logs / series cache / full telemetry / bars from storage
      lastRun: null,
      runResults: {},
      resultsFocusId: null,
      indicatorSeries: {},
      logs: [],
      bars: [],
      chartDataGen: 0,
      // Live editor pre-eval — always start clean
      preEval: {
        diagnostics: [],
        hasErrors: false,
        pending: false,
        source: '',
      },
      // Fresh planes only — never spread DEFAULTS.telemetry (shared with live store)
      // and never restore plane state from disk.
      telemetry: {
        source: idlePlane(
          pluginsBag?.source || source || DEFAULTS.activePlugins.source,
          'Source',
          'rest',
        ),
        stream: idlePlane(
          pluginsBag?.stream || streamId || DEFAULTS.live.streamId,
          'Stream',
          'ws',
        ),
        engine: idlePlane(
          pluginsBag?.engine || engine || DEFAULTS.activePlugins.engine,
          'Engine',
          'ws',
        ),
        storage: idlePlane(
          pluginsBag?.storage || DEFAULTS.activePlugins.storage,
          'Storage',
          'local',
        ),
        runLatencySamples: [],
        lastTick: null,
        hud: {
          compact: false,
          overlay: false,
          ...(bag.telemetry &&
          typeof bag.telemetry === 'object' &&
          (bag.telemetry as TelemetryState).hud &&
          typeof (bag.telemetry as TelemetryState).hud === 'object'
            ? (bag.telemetry as TelemetryState).hud
            : {}),
        },
        // Opt-in error share prompt — default false unless explicitly true
        shareOnError:
          !!(
            bag.telemetry &&
            typeof bag.telemetry === 'object' &&
            (bag.telemetry as TelemetryState).shareOnError === true
          ),
      },
      // Ephemeral error-share toast — never restore from disk
      errorShareOffer: null,
      // Ephemeral presentation modes — always start normal
      presentation: { fullscreen: false, chartOnly: false },
      // Drawing tool always starts as cursor; list normalized for dual legacy/style fields
      drawingTool: 'cursor',
      drawings: normalizeUserDrawings(bag.drawings) as Drawing[],

      drawingPrefs: {
        ...DEFAULTS.drawingPrefs,
        ...(bag.drawingPrefs && typeof bag.drawingPrefs === 'object' ? bag.drawingPrefs : {}),
      },
      drawingUi: {
        ...DEFAULTS.drawingUi,
        ...(bag.drawingUi && typeof bag.drawingUi === 'object' ? bag.drawingUi : {}),
        lastToolByGroup:
          bag.drawingUi &&
          typeof bag.drawingUi === 'object' &&
          (bag.drawingUi as AppState['drawingUi']).lastToolByGroup &&
          typeof (bag.drawingUi as AppState['drawingUi']).lastToolByGroup === 'object'
            ? { ...(bag.drawingUi as AppState['drawingUi']).lastToolByGroup }
            : { ...DEFAULTS.drawingUi.lastToolByGroup },
      },
      // Ephemeral selection — never hydrate from disk
      selectedDrawingId: null,
      panelChrome: mergePanelChrome(bag.panelChrome, {
        // Bridge legacy open/width into chrome on first load
        watchlist: {
          open:
            bag.watchlist && typeof bag.watchlist === 'object'
              ? (bag.watchlist as AppState['watchlist']).open
              : DEFAULTS.watchlist.open,
          w:
            bag.watchlist && typeof bag.watchlist === 'object'
              ? (bag.watchlist as AppState['watchlist']).width
              : DEFAULTS.watchlist.width,
        },
        indicators: {
          open:
            bag.indicatorPanel && typeof bag.indicatorPanel === 'object'
              ? (bag.indicatorPanel as AppState['indicatorPanel']).open
              : DEFAULTS.indicatorPanel.open,
          w:
            bag.indicatorPanel && typeof bag.indicatorPanel === 'object'
              ? (bag.indicatorPanel as AppState['indicatorPanel']).width
              : DEFAULTS.indicatorPanel.width,
        },
        editor: {
          open:
            bag.editor && typeof bag.editor === 'object'
              ? (bag.editor as AppState['editor']).open
              : DEFAULTS.editor.open,
          w:
            bag.editor && typeof bag.editor === 'object'
              ? (bag.editor as AppState['editor']).width
              : DEFAULTS.editor.width,
          dock:
            bag.editor &&
            typeof bag.editor === 'object' &&
            (bag.editor as AppState['editor']).mode === 'popout'
              ? 'window'
              : 'right',
        },
        results: {
          open:
            bag.resultsPanel && typeof bag.resultsPanel === 'object'
              ? (bag.resultsPanel as AppState['resultsPanel']).open
              : DEFAULTS.resultsPanel.open,
          h:
            bag.resultsPanel && typeof bag.resultsPanel === 'object'
              ? (bag.resultsPanel as AppState['resultsPanel']).height
              : DEFAULTS.resultsPanel.height,
        },
        logs: {
          open: false,
          h:
            bag.logsPanel && typeof bag.logsPanel === 'object'
              ? (bag.logsPanel as AppState['logsPanel']).height
              : DEFAULTS.logsPanel.height,
        },
        dataview: {
          open:
            bag.dataViewPanel && typeof bag.dataViewPanel === 'object'
              ? !!(bag.dataViewPanel as AppState['dataViewPanel']).open
              : false,
          w:
            bag.dataViewPanel && typeof bag.dataViewPanel === 'object'
              ? (bag.dataViewPanel as AppState['dataViewPanel']).width
              : 240,
        },
        layers: {
          open:
            bag.layerPanel && typeof bag.layerPanel === 'object'
              ? !!(bag.layerPanel as AppState['layerPanel']).open
              : false,
          w:
            bag.layerPanel && typeof bag.layerPanel === 'object'
              ? (bag.layerPanel as AppState['layerPanel']).width
              : 240,
        },
        alerts: {
          open:
            bag.alertsPanel && typeof bag.alertsPanel === 'object'
              ? !!(bag.alertsPanel as AppState['alertsPanel']).open
              : false,
          w:
            bag.alertsPanel && typeof bag.alertsPanel === 'object'
              ? (bag.alertsPanel as AppState['alertsPanel']).width
              : 280,
        },
      }),
      chartLayout: normalizeChartLayout(
        (bag as { chartLayout?: ChartLayoutState }).chartLayout,
        {
          symbol: (typeof bag.symbol === 'string' && bag.symbol) || DEFAULTS.symbol,
          interval: (typeof bag.interval === 'string' && bag.interval) || DEFAULTS.interval,
          exchange: (typeof bag.exchange === 'string' && bag.exchange) || DEFAULTS.exchange,
          chartType: normalizeChartType(bag.chartType),
        },
      ),
      savedLayouts: Array.isArray((bag as { savedLayouts?: unknown }).savedLayouts)
        ? ((bag as { savedLayouts: SavedChartLayout[] }).savedLayouts || [])
            .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
            .slice(0, 40)
        : [],
      compare: hydrateCompare(bag.compare),
      onchain: hydrateOnchain((bag as { onchain?: unknown }).onchain),
    };
  } catch {
    return null;
  }
}

/**
 * Normalize applied-script list from disk. Drops entries without id/code so
 * reopen cannot re-apply empty shells. Keeps paneId / colors / inputs.
 */
export function sanitizePersistedScripts(raw: unknown): Indicator[] {
  if (!Array.isArray(raw)) return [];
  const out: Indicator[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const code = typeof o.code === 'string' ? o.code : '';
    if (!id || !code.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const name =
      typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `Script ${i + 1}`;
    const paneId =
      typeof o.paneId === 'string' && o.paneId.trim() ? o.paneId.trim() : 'price';
    const plots: Record<string, { color: string }> = {};
    if (o.plots && typeof o.plots === 'object' && !Array.isArray(o.plots)) {
      for (const [k, v] of Object.entries(o.plots as Record<string, unknown>)) {
        if (v && typeof v === 'object' && typeof (v as { color?: unknown }).color === 'string') {
          plots[k] = { color: String((v as { color: string }).color) };
        }
      }
    }
    const item: Indicator = {
      id,
      name,
      code,
      paneId,
      visible: o.visible !== false,
      plots,
    };
    if (o.inputValues && typeof o.inputValues === 'object' && !Array.isArray(o.inputValues)) {
      item.inputValues = { ...(o.inputValues as Record<string, unknown>) };
    }
    if (
      o.strategyProps &&
      typeof o.strategyProps === 'object' &&
      !Array.isArray(o.strategyProps)
    ) {
      item.strategyProps = { ...(o.strategyProps as Record<string, unknown>) };
    }
    out.push(item);
  }
  return out;
}

/**
 * Hydrate durable fields from localStorage. Corrupt JSON is dropped (key cleared)
 * and never throws — boot always gets defaults + any valid overlay.
 */
function loadPersisted(): Partial<AppState> {
  try {
    // Prefer v1 when it parses; if v1 is corrupt, try legacy keys before giving up.
    const current = readLocalStorage(STORAGE_KEY);
    if (current) {
      const overlay = parsePersistedState(current);
      if (overlay) return overlay;
      // Corrupt v1 — clear so we do not keep failing on every reload
      removeLocalStorage(STORAGE_KEY);
    }
    for (const legacy of LEGACY_STORAGE_KEYS) {
      const raw = readLocalStorage(legacy);
      if (!raw) continue;
      const overlay = parsePersistedState(raw);
      if (overlay) {
        try {
          localStorage.setItem(STORAGE_KEY, raw);
        } catch {
          /* quota — in-memory hydrate still works */
        }
        return overlay;
      }
      removeLocalStorage(legacy);
    }
  } catch {
    /* localStorage / parse — fall through to defaults */
  }
  return {};
}

/** Whether the last durable write hit a storage quota error (session flag). */
export function isPersistQuotaExceeded(): boolean {
  return persistQuotaExceeded;
}

/** Test helper: clear the session quota flag. */
export function resetPersistQuotaFlag(): void {
  persistQuotaExceeded = false;
  persistWriteWarned = false;
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

/** Restore durable on-chain panel prefs (protocol slug/name only). */
function hydrateOnchain(raw: unknown): OnchainState {
  const base = { ...DEFAULTS.onchain };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<OnchainState>;
  return {
    lastProtocolSlug: typeof o.lastProtocolSlug === 'string' ? o.lastProtocolSlug : '',
    lastProtocolName: typeof o.lastProtocolName === 'string' ? o.lastProtocolName : '',
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
    const hoverSlideRaw =
      typeof fromDisk.hoverSlide === 'boolean'
        ? fromDisk.hoverSlide
        : typeof fromLegacy.hoverSlide === 'boolean'
          ? fromLegacy.hoverSlide
          : base[id].hoverSlide;
    const chartOverlayRaw =
      typeof fromDisk.chartOverlay === 'boolean'
        ? fromDisk.chartOverlay
        : typeof fromLegacy.chartOverlay === 'boolean'
          ? fromLegacy.chartOverlay
          : base[id].chartOverlay;
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
      hoverSlide: !!hoverSlideRaw,
      chartOverlay: !!chartOverlayRaw,
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
        id === 'pyodide'
          ? 'local'
          : id === 'server'
            ? 'ws'
            : id === 'pyne-worker'
              ? 'rest'
              : store.telemetry.engine.transport,
      );
      // Seed Backend URL when switching to pyne-worker if endpoint is empty or Flask loopback
      if (id === 'pyne-worker') {
        const ep = String(store.endpoint || '').trim();
        const isPw = /pyne-worker|pine-worker/i.test(ep);
        const isLoop =
          !ep ||
          /127\.0\.0\.1|localhost/i.test(ep) ||
          ep.includes(':5002');
        if (!isPw && isLoop) {
          setStore('endpoint', 'https://pyne-worker.cryptolinx.workers.dev');
        } else if (!isPw && !ep) {
          setStore('endpoint', 'https://pyne-worker.cryptolinx.workers.dev');
        }
      }
    }
  }
  persist();
}

/**
 * Deep-ish seed for createStore so nested DEFAULTS objects (telemetry, live,
 * panels, …) are never shared with the live store. setStore path updates would
 * otherwise mutate DEFAULTS and poison parsePersistedState / reset helpers.
 */
function seedStoreState(overlay: Partial<AppState> | null | undefined): AppState {
  const base: AppState = {
    ...DEFAULTS,
    activePlugins: { ...DEFAULTS.activePlugins },
    live: { ...DEFAULTS.live },
    editor: { ...DEFAULTS.editor },
    watchlist: {
      ...DEFAULTS.watchlist,
      symbols: [...DEFAULTS.watchlist.symbols],
    },
    indicatorPanel: { ...DEFAULTS.indicatorPanel },
    dataViewPanel: { ...DEFAULTS.dataViewPanel },
    layerPanel: { ...DEFAULTS.layerPanel },
    alertsPanel: { ...DEFAULTS.alertsPanel },
    resultsPanel: { ...DEFAULTS.resultsPanel },
    logsPanel: { ...DEFAULTS.logsPanel },
    scriptSettings: { ...DEFAULTS.scriptSettings },
    crosshair: { ...DEFAULTS.crosshair },
    preEval: { ...DEFAULTS.preEval, diagnostics: [] },
    presentation: { ...DEFAULTS.presentation },
    drawingPrefs: { ...DEFAULTS.drawingPrefs },
    drawingUi: {
      ...DEFAULTS.drawingUi,
      lastToolByGroup: { ...DEFAULTS.drawingUi.lastToolByGroup },
    },
    strategyUi: { ...DEFAULTS.strategyUi },
    stream: { ...DEFAULTS.stream },
    compare: { ...DEFAULTS.compare, bars: [] },
    onchain: { ...DEFAULTS.onchain },
    chartTheme: defaultChartThemeState(),
    panes: DEFAULTS.panes.map((p) => ({ ...p })),
    scripts: [],
    drawings: [],
    logs: [],
    bars: [],
    runResults: {},
    indicatorSeries: {},
    editorInputValues: {},
    editorStrategyProps: {},
    pluginsConfig: {},
    savedLayouts: [],
    panelChrome: defaultPanelChromeMap(),
    chartLayout: defaultChartLayout({
      symbol: DEFAULTS.symbol,
      interval: DEFAULTS.interval,
      exchange: DEFAULTS.exchange,
    }),
    telemetry: {
      source: idlePlane('binance-rest', 'Binance REST', 'rest'),
      stream: idlePlane('binance-ws', 'Binance WebSocket', 'ws'),
      engine: idlePlane('server', 'Server-Side', 'ws'),
      storage: idlePlane('local', 'Local', 'local'),
      runLatencySamples: [],
      lastTick: null,
      hud: { compact: false, overlay: false },
      shareOnError: false,
    },
    errorShareOffer: null,
    selectedDrawingId: null,
    lastRun: null,
    lastRunMs: null,
    chartDataGen: 0,
  };
  if (!overlay) return base;
  // Overlay wins for top-level keys; nested bags from parsePersistedState are already fresh.
  return { ...base, ...overlay };
}

/**
 * Reactive app state + setter. Hydrated once at module load from localStorage.
 * Prefer domain helpers below for multi-field updates that must persist correctly.
 */
export const [store, setStore] = createStore<AppState>(seedStoreState(loadPersisted()));

// Apply theme + density as soon as the store hydrates (before first paint when possible)
{
  const chartTheme = store.chartTheme || defaultChartThemeState();
  try {
    applyThemeToDocument(chartTheme);
    const tm = getThemeManager();
    tm.setState(chartTheme);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    try {
      // Prefer chartTheme.base when present; fall back to chrome theme
      const base = chartTheme.base || store.theme || 'dark';
      document.documentElement.setAttribute('data-theme', base);
      applyUiScale(store.uiScale);
    } catch {
      /* ignore */
    }
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** True while a debounced {@link persist} write is scheduled. */
export function isPersistPending(): boolean {
  return persistTimer != null;
}

/**
 * Detect QuotaExceededError across browsers (DOMException name/code variants).
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  // Legacy WebKit / IE codes
  if (e.code === 22 || e.code === 1014) return true;
  if (typeof e.message === 'string' && /quota/i.test(e.message)) return true;
  return false;
}

/**
 * Build the durable JSON payload (omits bars, lastRun, logs, …).
 *
 * Avoids walking the full `unwrap(store)` tree (would deep-copy 10k–100k
 * bars + lastRun series). Only durable subtrees are unwrapped.
 */
function buildPersistPayload(opts?: { slim?: boolean }): Record<string, unknown> {
  const s = store;
  const compare = s.compare;
  const telemetry = s.telemetry;

  const base: Record<string, unknown> = {
    symbol: s.symbol,
    interval: s.interval,
    exchange: s.exchange,
    source: s.source,
    endpoint: s.endpoint,
    engine: s.engine,
    historyBars: s.historyBars,
    theme: s.theme,
    chartType: s.chartType,
    chartTheme: unwrap(s.chartTheme),
    strategyUi: unwrap(s.strategyUi),
    uiScale: s.uiScale,
    editor: unwrap(s.editor),
    editorInputValues: unwrap(s.editorInputValues),
    editorStrategyProps: unwrap(s.editorStrategyProps),
    scripts: unwrap(s.scripts),
    panes: unwrap(s.panes),
    watchlist: unwrap(s.watchlist),
    indicatorPanel: unwrap(s.indicatorPanel),
    dataViewPanel: unwrap(s.dataViewPanel),
    layerPanel: unwrap(s.layerPanel),
    alertsPanel: unwrap(s.alertsPanel),
    resultsPanel: unwrap(s.resultsPanel),
    logsPanel: unwrap(s.logsPanel),
    live: {
      streamId: s.live?.streamId,
      preferAfterLoad: !!s.live?.preferAfterLoad,
      rerunOn: s.live?.rerunOn === 'bar-close' ? 'bar-close' : 'every-tick',
    },
    drawingTool: s.drawingTool,
    drawingPrefs: unwrap(s.drawingPrefs),
    profilerEnabled: s.profilerEnabled,
    inlineDebugEnabled: s.inlineDebugEnabled,
    debugPinsEnabled: s.debugPinsEnabled,
    editorRulerEnabled: s.editorRulerEnabled,
    editorWrapEnabled: s.editorWrapEnabled,
    editorIntel: readEditorIntel(s.editorIntel),
    lastValueLabelsVisible: s.lastValueLabelsVisible,
    lastValueNamesVisible: s.lastValueNamesVisible,
    priceScaleLabelsVisible: s.priceScaleLabelsVisible,
    priceScaleDecimals: normalizePriceScaleDecimalsMode(s.priceScaleDecimals),
    activePlugins: unwrap(s.activePlugins),
    pluginsConfig: unwrap(s.pluginsConfig),
    compare: {
      enabled: !!compare?.enabled,
      symbol: (compare?.symbol || '').toUpperCase(),
      mode: compare?.mode === 'absolute' ? 'absolute' : 'percent',
      normalizeMain: !!compare?.normalizeMain,
    },
    telemetry: {
      hud: telemetry?.hud || DEFAULTS.telemetry.hud,
      shareOnError: telemetry?.shareOnError === true,
    },
  };

  // Optional layout bags (may be undefined on older sessions)
  if (s.panelChrome != null) base.panelChrome = unwrap(s.panelChrome);
  if (s.panelWindows != null) base.panelWindows = unwrap(s.panelWindows);
  if (s.dockLayout != null) base.dockLayout = unwrap(s.dockLayout);
  if (s.chartLayout != null) base.chartLayout = unwrap(s.chartLayout);

  if (opts?.slim) {
    base.drawings = [];
    base.savedLayouts = [];
  } else {
    base.drawings = unwrap(s.drawings);
    base.savedLayouts = unwrap(s.savedLayouts ?? []);
  }

  return base;
}

function warnPersistOnce(message: string): void {
  if (persistWriteWarned) return;
  persistWriteWarned = true;
  try {
    console.warn(message);
  } catch {
    /* ignore */
  }
}

function trySetItem(key: string, value: string): { ok: true } | { ok: false; err: unknown } {
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) {
      return { ok: false, err: new Error('localStorage unavailable') };
    }
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * Debounced (~200ms) write of durable state to `STORAGE_KEY`.
 * Omits bars, lastRun, logs, chartDataGen, crosshair, scriptSettings,
 * selectedDrawingId, compare bars/loading, and full telemetry
 * (keeps only `telemetry.hud` + durable compare prefs).
 *
 * Uses {@link unwrap} so nested Solid store proxies serialize fully
 * (plain destructure can drop nested updates under some paths).
 *
 * Pending writes are flushed on `beforeunload` / `pagehide` so a tab close
 * does not drop the last debounced mutation.
 */
export function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    flushPersist();
  }, 200);
}

/**
 * Immediate localStorage write (Settings save, tests, unload flush).
 * Never throws. Returns `true` on success, `false` on quota / private mode.
 *
 * On {@link QuotaExceededError}: drops legacy keys, retries; then writes a
 * slim payload (no drawings/savedLayouts). Session keeps working in memory.
 */
export function flushPersist(): boolean {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = buildPersistPayload();
  } catch {
    return false;
  }

  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return false;
  }

  let result = trySetItem(STORAGE_KEY, json);
  if (result.ok) {
    persistQuotaExceeded = false;
    return true;
  }

  if (isQuotaExceededError(result.err)) {
    // Free space from legacy keys and retry full payload
    for (const legacy of LEGACY_STORAGE_KEYS) {
      removeLocalStorage(legacy);
    }
    result = trySetItem(STORAGE_KEY, json);
    if (result.ok) {
      persistQuotaExceeded = false;
      return true;
    }

    // Slim payload (omit drawings + saved layouts)
    try {
      const slimJson = JSON.stringify(buildPersistPayload({ slim: true }));
      result = trySetItem(STORAGE_KEY, slimJson);
      if (result.ok) {
        persistQuotaExceeded = true;
        warnPersistOnce(
          '[axis] localStorage quota exceeded; persisted slim state (drawings/layouts omitted)',
        );
        return true;
      }
    } catch {
      /* fall through */
    }

    persistQuotaExceeded = true;
    warnPersistOnce(
      '[axis] localStorage quota exceeded; durable persist skipped this session (in-memory only)',
    );
    return false;
  }

  // private mode / SecurityError / missing localStorage
  warnPersistOnce('[axis] localStorage write failed; durable persist skipped this session');
  return false;
}

/**
 * Flush only when a debounced {@link persist} is pending.
 * Used by `beforeunload` / `pagehide` so the last write is not lost.
 * @returns `true` if a pending write was flushed successfully
 */
export function flushPersistIfPending(): boolean {
  if (persistTimer == null) return false;
  return flushPersist();
}

/** Register unload handlers so debounced persist does not lose the last write. */
function installPersistFlushOnExit(): void {
  if (typeof window === 'undefined') return;
  if (typeof window.addEventListener !== 'function') return;
  const onExit = () => {
    try {
      flushPersistIfPending();
    } catch {
      /* never block unload */
    }
  };
  try {
    window.addEventListener('beforeunload', onExit);
    window.addEventListener('pagehide', onExit);
  } catch {
    /* ignore */
  }
}

installPersistFlushOnExit();

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
 * Key for editor/ad-hoc runs that are not yet an applied indicator.
 * Used in {@link AppState.runResults} / {@link AppState.resultsFocusId}.
 */
export const EDITOR_RUN_KEY = '__editor__';

export type SetLastRunOpts = {
  /**
   * Applied indicator id, or omit / null for the docked editor document
   * ({@link EDITOR_RUN_KEY}).
   */
  scriptId?: string | null;
  /**
   * When true, switch Results/Scriptlogs focus to this script (user-initiated
   * Run). Silent live re-runs pass false so other scripts do not thrash the UI.
   */
  focus?: boolean;
};

function applyLastRunMs(result: unknown) {
  if (result && typeof result === 'object' && result !== null && 'meta' in result) {
    const ms = (result as { meta?: { ms?: number } }).meta?.ms;
    if (typeof ms === 'number') setStore('lastRunMs', ms);
  }
}

/**
 * Store an indicator/strategy run payload for Results / Scriptlogs / Data View.
 *
 * Always writes {@link AppState.runResults}[scriptId]. Updates focused
 * {@link AppState.lastRun} only when this script is focused, or when
 * `focus: true` / no focus yet (auto-select first run).
 */
export function setLastRun(result: unknown, opts: SetLastRunOpts = {}) {
  const id =
    typeof opts.scriptId === 'string' && opts.scriptId.trim()
      ? opts.scriptId.trim()
      : EDITOR_RUN_KEY;

  if (result == null) {
    const prev = { ...(store.runResults || {}) };
    if (id in prev) {
      delete prev[id];
      // reconcile replaces keys (plain setStore merges nested objects)
      setStore('runResults', reconcile(prev));
    }
    if (store.resultsFocusId === id) {
      setResultsFocusId(Object.keys(prev).filter((k) => k !== id)[0] ?? null);
    }
    return;
  }

  setStore('runResults', id, result as never);

  if (opts.focus || store.resultsFocusId == null) {
    setStore('resultsFocusId', id);
  }

  if (store.resultsFocusId === id) {
    setStore('lastRun', result as never);
    applyLastRunMs(result);
  }
}

/**
 * Switch Results / Scriptlogs to a stored run (indicator id or
 * {@link EDITOR_RUN_KEY}). No-op if the key has no payload yet (still updates
 * focus so a later re-run fills the panel).
 */
export function setResultsFocusId(id: string | null) {
  const key =
    id == null || !String(id).trim() ? null : String(id).trim();
  setStore('resultsFocusId', key);
  if (key == null) {
    setStore('lastRun', null);
    setStore('lastRunMs', null);
    return;
  }
  const payload = store.runResults?.[key] ?? null;
  setStore('lastRun', payload as never);
  if (payload) applyLastRunMs(payload);
  else setStore('lastRunMs', null);
}

/** One option for the Results / Scriptlogs script picker. */
export type RunResultOption = {
  id: string;
  label: string;
  /** True when a run payload is cached for this id. */
  hasResult: boolean;
};

/**
 * Scripts available in the Results/Scriptlogs dropdown: applied indicators
 * plus the editor run slot when present.
 */
export function listRunResultOptions(): RunResultOption[] {
  const results = store.runResults || {};
  const out: RunResultOption[] = [];
  const seen = new Set<string>();

  for (const ind of store.scripts || []) {
    if (!ind?.id) continue;
    seen.add(ind.id);
    out.push({
      id: ind.id,
      label: ind.name || ind.id,
      hasResult: ind.id in results,
    });
  }

  if (EDITOR_RUN_KEY in results || store.resultsFocusId === EDITOR_RUN_KEY) {
    out.unshift({
      id: EDITOR_RUN_KEY,
      label: 'Editor',
      hasResult: EDITOR_RUN_KEY in results,
    });
    seen.add(EDITOR_RUN_KEY);
  }

  // Orphan keys (indicator removed but result still cached)
  for (const key of Object.keys(results)) {
    if (seen.has(key)) continue;
    out.push({
      id: key,
      label: key === EDITOR_RUN_KEY ? 'Editor' : key,
      hasResult: true,
    });
  }

  return out;
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

/**
 * Update editor pre-eval state (parse/lint after Save / Run). Ephemeral — not persisted.
 * Used by {@link ../editor/preevaluate} to mark wrong code and gate Run.
 */
export function setPreEval(next: AppState['preEval']) {
  setStore('preEval', next);
}

/** True when pre-eval found errors and is not still pending. */
export function isScriptRunBlockedByPreEval(): boolean {
  const intel = readEditorIntel(store.editorIntel);
  if (!intel.preevalEnabled || !intel.preevalBlockRun) return false;
  const pe = store.preEval;
  if (!pe || pe.pending) return false;
  return !!pe.hasErrors;
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
  const foundChartTheme = (found as { chartTheme?: unknown }).chartTheme;
  if (foundChartTheme != null) {
    const next = hydrateChartTheme(foundChartTheme);
    setStore('chartTheme', next);
    setStore('theme', next.base);
    applyThemeToDocument(next);
    getThemeManager().setState(next);
  } else if (found.theme === 'dark' || found.theme === 'light') {
    setStore('theme', found.theme);
    const chartTheme = withPreset(found.theme === 'light' ? 'void-light' : 'void-dark');
    setStore('chartTheme', chartTheme);
    applyThemeToDocument(chartTheme);
    getThemeManager().setState(chartTheme);
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
  // One reactive flush for Topbar + ChartHost + StatusBar (not 5 micro-updates)
  batch(() => {
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
  });
  persist();
}

/** Register an applied script on the chart; returns new indicator id. */
export function addIndicator(
  name: string,
  code: string,
  paneId: string,
  plots: Record<string, { color: string }>,
  inputValues?: Record<string, unknown>,
  strategyProps?: Record<string, unknown>,
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
      strategyProps: strategyProps ? { ...strategyProps } : undefined,
    },
  ]);
  persist();
  return id;
}

/**
 * Patch an applied indicator (re-run replace path updates code / name / pane).
 * No-op when id is unknown.
 */
export function updateIndicator(
  id: string,
  patch: Partial<
    Pick<Indicator, 'name' | 'code' | 'paneId' | 'plots' | 'inputValues' | 'strategyProps' | 'visible'>
  >,
) {
  if (!id || !patch || !Object.keys(patch).length) return;
  let found = false;
  setStore('scripts', (s) =>
    s.map((ind) => {
      if (ind.id !== id) return ind;
      found = true;
      return { ...ind, ...patch };
    }),
  );
  if (found) persist();
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
  // Drop cached run so Scriptlogs/Results cannot select a ghost script
  const nextResults: Record<string, unknown> = { ...(store.runResults || {}) };
  if (id in nextResults) {
    delete nextResults[id];
    setStore('runResults', reconcile(nextResults));
  }
  if (store.resultsFocusId === id) {
    setResultsFocusId(Object.keys(nextResults)[0] ?? null);
  }
  // Clear stuck Run button if a long/failed apply left status on "running".
  // Supersede the in-flight generation so chart apply no-ops, and release
  // interactive status ownership so the button cannot stay on Running….
  if (store.status === 'running') {
    beginRunEpoch();
    releaseRunStatus();
    setStatus('ready', 'Script removed');
  }
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
 *
 * **Hot path:** path-update the last index (no O(N) `slice()` clone) so Solid
 * and GC stay cheap on 10k–100k histories. Full array replace only when
 * capping or the series is empty.
 */
export function appendBar(bar: Bar) {
  const b = store.bars;
  const n = b.length;
  if (n && b[n - 1]!.time === bar.time) {
    // Same open bar — fine-grained path set (no full-array clone)
    setStore('bars', n - 1, bar);
  } else if (n >= HISTORY_BARS_MAX) {
    setStore('bars', [...b.slice(n - (HISTORY_BARS_MAX - 1)), bar]);
  } else if (n === 0) {
    setStore('bars', [bar]);
  } else {
    // Append by index — Solid extends the array without copying prior bars
    setStore('bars', n, bar);
  }
  if (store.live.lastBarTime !== bar.time) {
    setStore('live', 'lastBarTime', bar.time);
  }
  // Dirtiness for live re-run scheduler — only set when not already true
  if (!store.live.needsRerun) {
    setStore('live', 'needsRerun', true);
  }
}

/** Enable/disable live streaming preference (stream start/stop is elsewhere). */
export function setLive(active: boolean) {
  setStore('live', 'active', active);
  persist();
}

/* ── Telemetry helpers (ephemeral Connection HUD) ───────────────── */

/** Telemetry plane keys under `store.telemetry` (onchain is optional / ephemeral). */
export type TelemetryPlane = keyof Pick<
  TelemetryState,
  'source' | 'stream' | 'engine' | 'storage' | 'onchain'
>;

/** Merge a partial update into one telemetry plane (ephemeral). */
export function setTelemetryPlane(
  plane: TelemetryPlane,
  patch: Partial<PlaneTelemetry> & { id?: string; name?: string; transport?: TransportClass },
) {
  const cur =
    store.telemetry?.[plane] ||
    idlePlane(patch.id || String(plane), patch.name || String(plane), patch.transport || 'none');
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

/** Flip dark/light theme and update chart theme + `data-theme` on `<html>`. */
export function toggleTheme() {
  const next = store.theme === 'dark' ? 'light' : 'dark';
  setStore('theme', next);
  const presetId = next === 'light' ? 'void-light' : 'void-dark';
  const chartTheme = withPreset(presetId);
  setStore('chartTheme', chartTheme);
  applyThemeToDocument(chartTheme);
  getThemeManager().setState(chartTheme);
  persist();
}

/** Apply a named chart theme preset (void-dark, void-light, classic, …). */
export function setChartThemePreset(presetId: string) {
  const chartTheme = withPreset(presetId);
  setStore('chartTheme', chartTheme);
  setStore('theme', chartTheme.base);
  applyThemeToDocument(chartTheme);
  getThemeManager().setState(chartTheme);
  persist();
}

/** Override one chart theme token (supports aliases like chart.bg_color). */
export function setChartThemeToken(key: string, value: ThemeTokenValue) {
  const next = withTokenOverride(store.chartTheme || defaultChartThemeState(), key, value);
  setStore('chartTheme', next);
  // keep chrome theme base in sync
  setStore('theme', next.base);
  applyThemeToDocument(next);
  getThemeManager().setState(next);
  persist();
}

/** Replace full chart theme state (from picker / import / layout restore). */
export function setChartThemeState(state: ChartThemeState) {
  const next = hydrateChartTheme(state);
  setStore('chartTheme', next);
  setStore('theme', next.base);
  applyThemeToDocument(next);
  getThemeManager().setState(next);
  persist();
}

/** Reset overrides by re-applying the void preset for the current chrome theme. */
export function resetChartTheme() {
  setChartThemePreset(store.theme === 'light' ? 'void-light' : 'void-dark');
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

/* ── Presentation (fullscreen / chart-only) ─────────────────────── */

/** Sync browser Fullscreen API state into the store (ephemeral). */
export function setPresentationFullscreen(on: boolean): void {
  if (store.presentation?.fullscreen === !!on) return;
  setStore('presentation', 'fullscreen', !!on);
}

/** Hide or restore workspace chrome (topbar / docks / status). Ephemeral. */
export function setChartOnly(on: boolean): void {
  if (store.presentation?.chartOnly === !!on) return;
  setStore('presentation', 'chartOnly', !!on);
}

/** Toggle chart-only presentation (chart fills the shell). */
export function toggleChartOnly(): void {
  setChartOnly(!store.presentation?.chartOnly);
}

/** Exit chart-only (and report previous state). */
export function exitChartOnly(): boolean {
  const was = !!store.presentation?.chartOnly;
  if (was) setChartOnly(false);
  return was;
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
  // Leave browser fullscreen alone (user OS gesture); clear chart-only chrome hide
  setStore('presentation', 'chartOnly', false);

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

/** Open/close Script Logs panel (script `log.*` output — not system telemetry). */
export function setScriptLogsPanelOpen(open: boolean) {
  setPanelOpen('scriptlogs', open);
}

/** Toggle Script Logs panel visibility. */
export function toggleScriptLogsPanel() {
  setPanelOpen('scriptlogs', !isPanelOpen('scriptlogs'));
}

/** Open/close System Logs panel (app / transport telemetry). */
export function setSystemLogsPanelOpen(open: boolean) {
  setPanelOpen('logs', open);
}

/** Toggle System Logs panel visibility. */
export function toggleSystemLogsPanel() {
  setPanelOpen('logs', !isPanelOpen('logs'));
}

/** Open/close Status bar pane (connection HUD + status message). */
export function setStatusBarPanelOpen(open: boolean) {
  setPanelOpen('statusbar', open);
}

/** Toggle Status bar pane visibility. */
export function toggleStatusBarPanel() {
  setPanelOpen('statusbar', !isPanelOpen('statusbar'));
}

/** Open/close Script Library panel. */
export function setLibraryPanelOpen(open: boolean) {
  setPanelOpen('library', open);
}

/** Toggle Script Library panel visibility. */
export function toggleLibraryPanel() {
  setPanelOpen('library', !isPanelOpen('library'));
}

/** Open/close Data Source Manager panel. */
export function setDataSourcePanelOpen(open: boolean) {
  setPanelOpen('datasource', open);
}

/** Toggle Data Source Manager panel visibility. */
export function toggleDataSourcePanel() {
  setPanelOpen('datasource', !isPanelOpen('datasource'));
}

/** Open/close On-Chain (DefiLlama TVL) panel. */
export function setOnchainPanelOpen(open: boolean) {
  setPanelOpen('onchain', open);
}

/** Toggle On-Chain panel visibility. */
export function toggleOnchainPanel() {
  setPanelOpen('onchain', !isPanelOpen('onchain'));
}

/** Persist last on-chain protocol slug (search/use recall). */
export function setOnchainLastProtocolSlug(slug: string) {
  setStore('onchain', 'lastProtocolSlug', typeof slug === 'string' ? slug : '');
  persist();
}

/** Persist last on-chain protocol display name. */
export function setOnchainLastProtocolName(name: string) {
  setStore('onchain', 'lastProtocolName', typeof name === 'string' ? name : '');
  persist();
}

/** Set last protocol slug + name together (persisted). */
export function setOnchainLastProtocol(slug: string, name: string) {
  setStore('onchain', {
    lastProtocolSlug: typeof slug === 'string' ? slug : '',
    lastProtocolName: typeof name === 'string' ? name : '',
  });
  persist();
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

/**
 * Toggle inline debug mode (end-of-line log/error chips from last run).
 * Surfaces a short status tip so the menu hover how-to is mirrored on toggle.
 */
export function toggleInlineDebugEnabled() {
  const next = !store.inlineDebugEnabled;
  setStore('inlineDebugEnabled', next);
  persist();
  if (!next) {
    setStatus('ready', 'Inline debug off');
    return;
  }
  if (store.lastRun == null) {
    setStatus(
      'ready',
      'Inline debug on — Run a script with log.* (or fix errors) to see end-of-line chips',
    );
    return;
  }
  setStatus(
    'ready',
    'Inline debug on — chips on source lines from last run (click pin-able chips to jump chart)',
  );
}

/** Enable/disable chart pins from last-run logs with bar_index/time. */
export function setDebugPinsEnabled(on: boolean) {
  setStore('debugPinsEnabled', !!on);
  persist();
}

/**
 * Toggle chart debug pins (markers on bars referenced by logs + editor 📍 gutter).
 * Alt-P also toggles this (editor overflow menu + global when focus is outside CM).
 */
export function toggleDebugPinsEnabled() {
  const next = !store.debugPinsEnabled;
  setStore('debugPinsEnabled', next);
  persist();
  if (!next) {
    setStatus('ready', 'Chart pins off');
    return;
  }
  if (store.lastRun == null) {
    setStatus(
      'ready',
      'Chart pins on — Run with log.info("…", bar_index) so pins can attach to bars',
    );
    return;
  }
  setStatus(
    'ready',
    'Chart pins on — markers on the chart + 📍 gutter; click to jump (needs bar_index or time in logs)',
  );
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

/** Enable/disable soft line wrap in the Pine editor (persisted; default on). */
export function setEditorWrapEnabled(on: boolean) {
  setStore('editorWrapEnabled', !!on);
  persist();
}

/** Toggle soft line wrap in the Pine editor. */
export function toggleEditorWrapEnabled() {
  setStore('editorWrapEnabled', !store.editorWrapEnabled);
  persist();
}

/** Normalized editor intelligence bag (defaults filled). */
export function getEditorIntel(): EditorIntelSettings {
  return readEditorIntel(store.editorIntel);
}

/** Replace the editor intelligence bag and persist. */
export function setEditorIntel(next: EditorIntelSettings | Record<string, unknown>) {
  setStore('editorIntel', readEditorIntel(next));
  persist();
}

const PREEVAL_GEN_KEYS: (keyof EditorIntelSettings)[] = [
  'preevalEnabled',
  'preevalTypos',
  'preevalVersionWarn',
  'preevalStudyWarn',
  'preevalSecurityWarn',
  'preevalDuplicateDecl',
  'preevalLocal',
  'preevalRemote',
];

/** Merge a partial editor-intel patch and persist. */
export function patchEditorIntel(partial: Partial<EditorIntelSettings>) {
  const prev = readEditorIntel(store.editorIntel);
  // Always merge the normalized bag — spreading the Solid store proxy can
  // yield `{}` or all-undefined and persist a dead all-off intel bag.
  const next = readEditorIntel({ ...prev, ...partial, rev: EDITOR_INTEL_REV });
  setStore('editorIntel', next);
  persist();
  const genChanged = PREEVAL_GEN_KEYS.some((k) => prev[k] !== next[k]);
  if (!genChanged) return;
  const source = store.preEval?.source || '';
  if (!next.preevalEnabled) {
    setPreEval({
      diagnostics: [],
      hasErrors: false,
      pending: false,
      source,
    });
    return;
  }
  if (!source) return;
  void import('../editor/preevaluate')
    .then((m) => m.runPreevalNow(source))
    .catch(() => {
      /* editor optional */
    });
}

/** Restore factory editor-intelligence defaults. */
export function resetEditorIntel() {
  const prev = readEditorIntel(store.editorIntel);
  setStore('editorIntel', { ...DEFAULT_EDITOR_INTEL });
  persist();
  const next = DEFAULT_EDITOR_INTEL;
  const genChanged = PREEVAL_GEN_KEYS.some((k) => prev[k] !== next[k]);
  if (!genChanged) return;
  const source = store.preEval?.source || '';
  void import('../editor/preevaluate')
    .then((m) => m.runPreevalNow(source))
    .catch(() => {
      /* editor optional */
    });
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
      // Visibility of the System Logs strip (topbar). Body expand uses
      // `logsPanel.open` separately so collapse does not hide the strip.
      return chromeOpen;
    case 'scriptlogs':
    case 'statusbar':
    case 'library':
    case 'datasource':
    case 'onchain':
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
  'library',
  'datasource',
  'onchain',
  'editor',
  'results',
  'logs',
  'scriptlogs',
  'statusbar',
];

/** Open panel ids currently assigned to a side dock (stack order). */
function openIdsOnDock(dock: PanelDock): PanelId[] {
  if (dock === 'float' || dock === 'window') return [];
  return DOCK_STACK_IDS.filter((pid) => {
    if (!isPanelOpen(pid)) return false;
    const c = store.panelChrome?.[pid];
    if (!c || c.dock !== dock) return false;
    // Chart-overlay panels do not occupy the dock column
    if (c.chartOverlay && isChartOverlayEligible(dock)) return false;
    return true;
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
    // Hover-slide only applies when docked
    clearPanelHoverSlideExpanded(id);
  } else {
    // Do not force-match peer widths — each panel keeps its own w
    rebalanceDockStack(dock);
    // Re-arm collapsed peek when hover-slide is on
    if (getPanelChrome(id).hoverSlide && isHoverSlideEligible(dock)) {
      setPanelHoverSlideExpanded(id, false);
    } else {
      clearPanelHoverSlideExpanded(id);
    }
  }
  if (prev !== dock && (prev === 'left' || prev === 'right' || prev === 'bottom')) {
    rebalanceDockStack(prev);
  }
  persist();
}

/**
 * Enable/disable **hover slide** for a panel (docked only).
 * When enabled, the panel collapses to a peek strip and expands on pointer
 * enter / collapses on leave. Preference is persisted on panel chrome.
 */
export function setPanelHoverSlide(id: PanelId, enabled: boolean) {
  ensurePanelChrome();
  const on = !!enabled;
  setStore('panelChrome', id, 'hoverSlide', on);
  const dock = getPanelChrome(id).dock;
  if (on && isHoverSlideEligible(dock) && isPanelOpen(id)) {
    // Start collapsed so the chart gains space until the user hovers
    setPanelHoverSlideExpanded(id, false);
  } else {
    clearPanelHoverSlideExpanded(id);
  }
  persist();
  // Chart reflow (best-effort — skip when window is partial, e.g. unit tests)
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      window.dispatchEvent(new CustomEvent('axis-chart-reflow'));
    }
  } catch {
    /* ignore */
  }
}

/** Toggle {@link setPanelHoverSlide} for a panel. */
export function togglePanelHoverSlide(id: PanelId): boolean {
  const next = !getPanelChrome(id).hoverSlide;
  setPanelHoverSlide(id, next);
  return next;
}

/** Read hover-slide preference (false when unset). */
export function isPanelHoverSlide(id: PanelId): boolean {
  return !!getPanelChrome(id).hoverSlide;
}

function requestPanelChartReflow() {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      window.dispatchEvent(new CustomEvent('axis-chart-reflow'));
    }
  } catch {
    /* ignore — partial window in unit tests */
  }
}

/**
 * Reset one panel to factory dock, size, position, and flags.
 * Keeps the current open/closed state so an open shell does not vanish.
 * Fixed app-shell strips (logs / statusbar) only restore size flags.
 */
export function resetPanelToDefault(id: PanelId): void {
  ensurePanelChrome();
  const def = getDefaultPanelChrome(id);
  const keepOpen = isPanelOpen(id);
  const pos = defaultPanelPosition(id);
  setStore('panelChrome', id, {
    open: keepOpen,
    dock: def.dock,
    x: pos.x,
    y: pos.y,
    w: def.w,
    h: def.h,
    z: def.z,
    hoverSlide: !!def.hoverSlide,
    chartOverlay: !!def.chartOverlay,
  });
  // Mirror legacy layout fields
  mirrorPanelWidth(id, def.w);
  if (id === 'results') setStore('resultsPanel', 'height', def.h);
  if (id === 'logs') setStore('logsPanel', 'height', def.h);
  if (id === 'editor' && def.dock !== 'window') {
    setStore('editor', 'mode', 'docked');
  }
  syncLegacyOpen(id, keepOpen);
  clearPanelHoverSlideExpanded(id);
  if (def.dock === 'left' || def.dock === 'right') {
    rebalanceDockStack(def.dock);
  }
  persist();
  requestPanelChartReflow();
}

/**
 * Enable/disable **chart overlay** for one panel.
 * When on and docked left/right/bottom, the panel floats over the chart edge
 * (dock column does not shrink). Float/window docks are always overlays.
 */
export function setPanelChartOverlay(id: PanelId, enabled: boolean): void {
  ensurePanelChrome();
  if (!isManagedFloatablePanel(id)) return;
  const on = !!enabled;
  const cur = getPanelChrome(id);
  setStore('panelChrome', id, 'chartOverlay', on);
  if (on) {
    // Seed edge geometry when entering overlay from a layout dock
    if (isChartOverlayEligible(cur.dock)) {
      const vw =
        typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280;
      const vh =
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 800;
      const geo = chartOverlayGeometry({ ...cur, chartOverlay: true }, vw, vh);
      setStore('panelChrome', id, 'x', geo.x);
      setStore('panelChrome', id, 'y', geo.y);
      if (cur.dock === 'bottom') {
        setStore('panelChrome', id, 'h', geo.h);
      } else {
        setStore('panelChrome', id, 'w', geo.w);
      }
      bumpPanelZ(id);
    }
    clearPanelHoverSlideExpanded(id);
  } else if (isChartOverlayEligible(cur.dock)) {
    // Returning to layout dock — rebalance peers
    rebalanceDockStack(cur.dock);
    if (cur.hoverSlide) {
      setPanelHoverSlideExpanded(id, false);
    }
  }
  persist();
  requestPanelChartReflow();
}

/** Toggle {@link setPanelChartOverlay} for a panel. */
export function togglePanelChartOverlay(id: PanelId): boolean {
  const next = !getPanelChrome(id).chartOverlay;
  setPanelChartOverlay(id, next);
  return next;
}

/** Read chart-overlay preference (false when unset). */
export function isPanelChartOverlay(id: PanelId): boolean {
  return !!getPanelChrome(id).chartOverlay;
}

/**
 * Main panel-manager bulk control: set chart overlay on/off for **all**
 * managed floatable panels (every dock option / panel id).
 *
 * When `enabled` is true, edge-docked panels float over the chart.
 * When false, they return to normal dock columns (chart shrinks).
 */
export function setAllPanelsChartOverlay(enabled: boolean): void {
  ensurePanelChrome();
  const on = !!enabled;
  for (const id of PANEL_IDS) {
    if (!isManagedFloatablePanel(id)) continue;
    const cur = getPanelChrome(id);
    // Always write the flag so float panels keep preference for later docks
    setStore('panelChrome', id, 'chartOverlay', on);
    if (on && isChartOverlayEligible(cur.dock) && isPanelOpen(id)) {
      bumpPanelZ(id);
      clearPanelHoverSlideExpanded(id);
    } else if (!on && isChartOverlayEligible(cur.dock)) {
      rebalanceDockStack(cur.dock);
    }
  }
  persist();
  requestPanelChartReflow();
}

/** True when every managed panel has chart overlay enabled. */
export function isAllPanelsChartOverlay(): boolean {
  return PANEL_IDS.filter(isManagedFloatablePanel).every((id) => !!getPanelChrome(id).chartOverlay);
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
    return;
  }
  // Fill missing PanelIds (e.g. new panels after upgrade) without clobbering geometry
  const defaults = defaultPanelChromeMap();
  for (const id of Object.keys(defaults) as PanelId[]) {
    if (!store.panelChrome[id]) {
      setStore('panelChrome', id, defaults[id]);
    }
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
  const cur = store.crosshair;
  if (cur?.time === time && cur?.barIndex === barIndex) return;
  setStore('crosshair', { time, barIndex });
}

/** Persist price-scale decimal mode (`auto` or 0–8). */
export function setPriceScaleDecimals(mode: PriceScaleDecimalsMode | unknown) {
  setStore('priceScaleDecimals', normalizePriceScaleDecimalsMode(mode));
  persist();
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

/** Persist Strategy Properties overrides for the docked editor document. */
export function setEditorStrategyProps(values: Record<string, unknown>) {
  setStore('editorStrategyProps', values);
  persist();
}

/** Persist Strategy Properties overrides on an applied strategy script. */
export function setIndicatorStrategyProps(id: string, values: Record<string, unknown>) {
  setStore('scripts', (s) =>
    s.map((ind) => (ind.id === id ? { ...ind, strategyProps: { ...values } } : ind)),
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
 * Replace the full user-drawing list (layer `onChange` merge, imports, clear paths).
 * Persisted. Does not touch Pine script drawings.
 * Prefer layer `onChange` / symbol-scoped helpers so multi-symbol drawings stay intact.
 */
export function setDrawings(drawings: Drawing[]) {
  setStore('drawings', drawings);
  persist();
}

/**
 * Empty **all** user drawings and persist.
 * Prefer {@link clearDrawingsForSymbol} for toolbar clear (keeps other symbols).
 */
export function clearDrawings() {
  setStore('drawings', []);
  persist();
}

/** Merge strategy UI prefs (fill model, marker labels) and persist. */
export function setStrategyUi(patch: Partial<AppState['strategyUi']>) {
  setStore('strategyUi', {
    ...DEFAULTS.strategyUi,
    ...(store.strategyUi || {}),
    ...patch,
  });
  persist();
}

/**
 * Remove drawings for one symbol (and untagged legacy when clearing the active view).
 * Other symbols’ drawings are preserved.
 */
export function clearDrawingsForSymbol(symbol: string = store.symbol) {
  const want = String(symbol || '')
    .trim()
    .toUpperCase();
  if (!want) {
    clearDrawings();
    return;
  }
  setStore(
    'drawings',
    store.drawings.filter((d) => {
      const s =
        d.meta?.symbol != null && d.meta.symbol !== ''
          ? String(d.meta.symbol).trim().toUpperCase()
          : null;
      // Untagged show on every symbol view — clear them with the active clear
      if (s == null) return false;
      return s !== want;
    }),
  );
  if (store.selectedDrawingId) {
    const still = store.drawings.some((d) => d.id === store.selectedDrawingId);
    if (!still) setStore('selectedDrawingId', null);
  }
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
