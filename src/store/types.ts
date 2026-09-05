import type { PlotSample } from '../plugins/types';
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
 * AXIS application state shape (Solid store).
 *
 * This module is the single source of truth for `AppState` and related types
 * used by UI chrome, chart host, indicators, plugins, and persistence.
 *
 * ## Persistence contract
 * - **Persisted**: layout, plugins, drawings prefs, panel chrome, scripts list
 *   (code + inputs), watchlist symbols — via `store/index.ts` `persist()`.
 * - **Ephemeral** (never hydrated from disk): `bars`, `lastRun`, `logs`,
 *   `crosshair`, `scriptSettings` open state, `selectedDrawingId`,
 *   `presentation` (fullscreen / chart-only), full telemetry planes
 *   (only HUD layout prefs survive reload).
 * - **Live session**: `live.active` always hydrates as `false`; user re-enables.
 *
 * Drawing geometry types re-export from `chart/drawing-types`.
 */

/** Account / deployment tier. Gates Pro-only features (HPO walk-forward, …). */
export type AccountTier = 'free' | 'pro' | 'self-hosted';

/** Single OHLCV bar. `time` is Unix seconds (Lightweight Charts convention). */
export interface Bar {
  /** Bar open time (Unix seconds). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /**
   * Venue reported this candle as closed (e.g. Binance kline `k.x`).
   * Used when live.rerunOn === 'bar-close'. Not persisted.
   */
  closed?: boolean;
}

/**
 * Chart pane descriptor (price / volume / indicator / equity).
 * Heights and order drive multi-pane layout; `visible` gates series paint.
 */
export interface Pane {
  id: string;
  type: 'price' | 'volume' | 'indicator' | 'equity';
  /** Pane height in CSS px (0 = flex remainder for price). */
  height: number;
  /** Sort key among panes (lower = higher on chart). */
  order: number;
  visible: boolean;
  label?: string;
}

/**
 * Applied Pine indicator / strategy on the chart.
 * `code` is the full script body; runner uses `inputValues` as overrides.
 */
export interface Indicator {
  id: string;
  name: string;
  /** Full Pine source for re-run. */
  code: string;
  /** Target pane id (price overlay or dedicated indicator pane). */
  paneId: string;
  visible: boolean;
  /** Plot name → stroke color overrides for series paint. */
  plots: Record<string, { color: string }>;
  /** Last-known input values keyed by title (Script Settings) */
  inputValues?: Record<string, unknown>;
  /**
   * Strategy Properties overrides keyed by `strategy()` kwarg
   * (`initial_capital`, `pyramiding`, …). Applied by rewriting the declaration
   * on run — not Pine `input.*`.
   */
  strategyProps?: Record<string, unknown>;
}

/** High-level app / connection status shown in the status bar. */
export type AppStatus = 'ready' | 'loading' | 'running' | 'error' | 'connected' | 'disconnected';

/** Severity for system log strip entries. */
export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

/** One system log row (in-memory only; capped by store). */
export interface LogEntry {
  id: string;
  /** Epoch ms when the entry was created. */
  ts: number;
  level: LogLevel;
  message: string;
  /** Origin tag (e.g. `boot`, `library`, status key). */
  source?: string;
}

/** docked = right sidebar; popout = external window/tab owns the editor UI */
export type EditorMode = 'docked' | 'popout';

/** Watchlist panel open state, width, symbols, and REST poll interval. */
export interface WatchlistState {
  open: boolean;
  width: number;
  symbols: string[];
  /** Live quote poll interval in seconds (5–120) */
  refreshSec: number;
}

/** Docked Pine editor open/width/mode (also mirrored into panelChrome.editor). */
export interface EditorLayoutState {
  open: boolean;
  width: number;
  mode: EditorMode;
}

/** Re-export so persist / UI can type the editor intelligence bag. */
export type { EditorIntelSettings } from '../editor/editor-intel';

/** Built-in historical source ids (D1) */
export type SourceId = 'binance-rest' | 'mock-walk' | 'csv-upload' | string;

/**
 * Canonical active plugin selection (source / stream / engine / storage).
 * Flat `source` / `engine` / `live.streamId` fields are kept in sync by
 * `setActivePlugin`.
 */
export interface ActivePlugins {
  source: string;
  stream: string;
  engine: string;
  /** local | git | cloud (or dynamic storage plugin id) */
  storage: string;
  /**
   * Optional on-chain / alternate series plugin id.
   * Empty or omitted = dataset slot off.
   */
  dataset?: string;
}

import type { Drawing, DrawingToolId } from '../chart/drawing-types';
import type { ChartThemeState } from '../theme';
import type { ProviderSession } from '../data/provider';
export type { Drawing, DrawingToolId };
export type { ChartThemeState };
export type { ProviderSession };

/**
 * Default stroke/fill applied when the layer places a new drawing.
 * Seeded onto {@link DrawingLayer} style prefs; style bar edits this when nothing is selected.
 * `byKind` remembers last-used extras per tool (extend, fib levels, RR, …).
 */
export interface DrawingPrefs {
  color: string;
  width: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  /** Rect fill opacity 0–1 (also used as create default via layer `stylePrefs`). */
  fillOpacity: number;
  /** Last-used style extras keyed by drawing kind. */
  byKind?: Partial<
    Record<
      import('../chart/drawing-types').DrawingKind,
      import('../chart/drawings/tool-settings').KindDrawingPrefs
    >
  >;
}

/**
 * Drawing toolbar interaction chrome (persisted).
 * Mirrored into the live layer by DrawingToolbar / ensureDrawingLayer.
 */
export interface DrawingUi {
  /**
   * Bar snap for pointer → (time, price):
   * `off` | `weak` (nearby) | `strong` (always snap when bars exist).
   */
  magnet: 'off' | 'weak' | 'strong';
  /** When true, layer keeps the place tool after each drawing instead of returning to cursor. */
  stayInMode: boolean;
  /** Last selected tool id per ToolGroupId (e.g. lines → ray) for group button recall. */
  lastToolByGroup: Record<string, string>;
  /** Hide non-selected user drawings on the SVG overlay (selection still paints). */
  hideDrawings: boolean;
  /** Global lock: blocks drag/resize/delete of all user drawings. */
  lockAll: boolean;
}

/** How a plane moves data (for Connection HUD badges). */
export type TransportClass = 'ws' | 'rest' | 'local' | 'broker' | 'none';

/** Connection lifecycle for a telemetry plane. */
export type ConnState = 'idle' | 'connecting' | 'open' | 'degraded' | 'error' | 'closed';

/**
 * Live status for one data plane (source / stream / engine / storage / onchain).
 * Ephemeral — rebuilt by loaders and multiplex; only HUD layout prefs persist.
 */
export interface PlaneTelemetry {
  id: string;
  name: string;
  transport: TransportClass;
  state: ConnState;
  detail?: string;
  latencyMs?: number | null;
  lastEventAt?: number | null;
  error?: string | null;
}

/** Last live tick snapshot for HUD “tick age / direction”. */
export interface TickTelemetry {
  /** Bar / trade time (Unix seconds when from kline). */
  time: number;
  price: number;
  dir: 'up' | 'down' | 'flat';
  /** Wall-clock ms when this tick was recorded. */
  at: number;
}

/** Connection HUD + run-latency telemetry (mostly ephemeral). */
export interface TelemetryState {
  source: PlaneTelemetry;
  stream: PlaneTelemetry;
  engine: PlaneTelemetry;
  storage: PlaneTelemetry;
  /**
   * Optional on-chain proxy plane (`GET {endpoint}/api/onchain/health`).
   * Ephemeral — omitted until first health probe; never hydrated from disk.
   */
  onchain?: PlaneTelemetry;
  /** Rolling run latency samples (ms), newest last */
  runLatencySamples: number[];
  lastTick: TickTelemetry | null;
  /** Layout prefs (may be persisted via rest of store carefully) */
  hud: { compact: boolean; overlay: boolean };
  /**
   * When true, UI errors may prompt to copy/download a redacted diagnostic
   * bundle. **Default false** — opt-in privacy. Persisted with hud.
   */
  shareOnError: boolean;
}

/**
 * Full AXIS reactive state tree.
 * Mutate via `setStore` / helpers in `store/index.ts`; call `persist()` for
 * durable fields. See module header for hydrate rules.
 */
export interface AppState {
  bars: Bar[];
  /**
   * Bumped only on full history loads (loadBars), not live appendBar.
   * ChartHost uses this so it does not full-setData on every tick.
   */
  chartDataGen: number;
  /**
   * Main price pane series style (candles, bars, line, Heikin-Ashi, …).
   * Persisted; see `chart/chart-type.ts`.
   */
  chartType: import('../chart/chart-type').ChartType;
  /**
   * Right price-scale labels visible on all panes (chart [$] control).
   * When false, the right gutter is collapsed. Persisted. Default true.
   */
  priceScaleLabelsVisible: boolean;
  /**
   * Series last-value labels (price + series name) on the right scale.
   * Chart [N] control. Independent of {@link priceScaleLabelsVisible}.
   * Persisted. Default true.
   */
  lastValueLabelsVisible: boolean;
  /**
   * Plot / hline **names** on last-value labels (`RSI`, `Overbought`, …).
   * When false, the numeric last value stays; only the left-side title is hidden.
   * Independent of {@link lastValueLabelsVisible}. Persisted. Default true.
   */
  lastValueNamesVisible: boolean;
  /**
   * Right price-scale decimal places.
   * - `'auto'` — detect from symbol heuristics + recent OHLCV
   * - `0`–`8` — fixed decimals
   * Persisted. Default `'auto'`.
   */
  priceScaleDecimals: import('../chart/price-precision').PriceScaleDecimalsMode;
  /**
   * Strategy tester + chart trade-marker prefs (persisted).
   * Fills default to signal-bar **close**; slippage uses next bar **open**.
   */
  strategyUi: {
    /**
     * When true, entry/exit fills shift to the **next bar open** (slippage).
     * When false (default), fills use the signal bar **close** (historical + live).
     */
    slippageNextOpen: boolean;
    /**
     * Invert long/short label sides: long above / short below (entries)
     * instead of long below / short above.
     */
    invertTradeLabels: boolean;
    /**
     * Place an exact `inBar` circle on the fill candle (plus side arrows).
     * Default true.
     */
    exactOnCandle: boolean;
  };
  symbol: string;
  interval: string;
  exchange: string;
  /**
   * How many historical OHLCV bars to request on Load / symbol change.
   * Persisted. Sources may clamp further to venue max (e.g. Binance 1000).
   */
  historyBars: number;
  /** Historical data source plugin id (mirrors activePlugins.source) */
  source: SourceId;
  engine: string;
  endpoint: string;
  /** Canonical active plugin ids */
  activePlugins: ActivePlugins;
  /**
   * Locked market-data identity (venue + source/stream pair + auth mode).
   * Aggregators (load, DSM, compare, watchlist, cache) inherit this.
   * Never stores API secrets — only optional `credentialId`.
   */
  provider: ProviderSession;
  /** Per-plugin config keyed by `${kind}:${id}` or bare id */
  pluginsConfig: Record<string, Record<string, unknown>>;

  scripts: Indicator[];
  panes: Pane[];

  live: {
    active: boolean;
    needsRerun: boolean;
    lastBarTime: number;
    streamId: string;
    /**
     * When true, successful Load auto-starts the paired live stream.
     * Default true (live mode preferred after historical load).
     */
    preferAfterLoad: boolean;
    /**
     * every-tick = re-run indicators on each bar update (default).
     * bar-close = only when venue marks candle closed (or bar time advances).
     */
    rerunOn: 'every-tick' | 'bar-close';
  };

  theme: 'dark' | 'light';
  /**
   * Chart / canvas theme (presets + token overrides).
   * Kept in sync with {@link theme} chrome base via store helpers.
   * Persisted. See `src/theme/`.
   */
  chartTheme: ChartThemeState;
  /**
   * UI density / chrome scale (text, icons, controls, gaps).
   * 0.8–1.3, default 1. Applied as CSS ``--ui-scale`` on ``<html>``.
   */
  uiScale: number;
  /**
   * Workspace presentation (ephemeral — never hydrated / not persisted).
   * - `fullscreen` — browser Fullscreen API engaged on the app shell
   * - `chartOnly` — hide topbar / docks / status so the chart fills the shell
   */
  presentation: {
    fullscreen: boolean;
    chartOnly: boolean;
  };
  editor: EditorLayoutState;
  watchlist: WatchlistState;
  indicatorPanel: { open: boolean; width: number };
  /** Data Window (OHLCV + series at crosshair) */
  dataViewPanel: { open: boolean; width: number };
  /** Layers panel (panes / indicators / drawings visibility) */
  layerPanel: { open: boolean; width: number };
  /** Price alerts panel */
  alertsPanel: { open: boolean; width: number };
  /**
   * Script Settings modal — shows ``input.*`` fields (+ Strategy Properties).
   * indicatorId null = editor document (not yet an applied indicator).
   */
  scriptSettings: { open: boolean; indicatorId: string | null };
  /** Input overrides for the docked editor doc (keyed by input title) */
  editorInputValues: Record<string, unknown>;
  /**
   * Strategy Properties overrides for the docked editor doc
   * (keyed by strategy() kwarg name).
   */
  editorStrategyProps: Record<string, unknown>;
  /**
   * Ephemeral crosshair position for Data Window (not persisted).
   * time = bar time; barIndex = index into store.bars when known.
   */
  crosshair: { time: number | null; barIndex: number | null };
  /** Bottom results / export drawer */
  resultsPanel: { open: boolean; height: number };
  /**
   * When true (default), running a `strategy()` script auto-opens the
   * fullscreen Results modal. Indicators never auto-open. Persisted.
   */
  resultsAutoOpen: boolean;
  /**
   * Account / deployment tier. `free` (default) gates Pro-only features such as
   * HPO walk-forward validation; `pro` and `self-hosted` unlock them. Persisted.
   */
  tier: AccountTier;
  /** System log drawer (collapsed by default) */
  logsPanel: { open: boolean; height: number };
  /**
   * Editor profiler mode — when on, engines may collect per-line timing and the
   * editor chrome shows last-run latency. Persisted.
   */
  profilerEnabled: boolean;
  /**
   * Inline debug mode — end-of-line chips + line highlights from last-run
   * logs / errors / diagnostics. Persisted.
   */
  inlineDebugEnabled: boolean;
  /**
   * Show chart pins (series markers) for last-run logs that carry bar_index
   * or time. Persisted. Independent of {@link inlineDebugEnabled}.
   */
  debugPinsEnabled: boolean;
  /**
   * Editor column ruler — vertical guide at the recommended line length
   * (default 80 chars). Persisted. Default on.
   */
  editorRulerEnabled: boolean;
  /**
   * Soft line wrap in the Pine editor. Persisted. Default on.
   * Toggle from the editor stats strip “wrap” control.
   */
  editorWrapEnabled: boolean;
  /**
   * Editor intelligence — pre-eval / lint, hover cards, signature hints,
   * autocomplete, diagnostic marks, inline chips. Persisted.
   * See {@link EditorIntelSettings}.
   */
  editorIntel: import('../editor/editor-intel').EditorIntelSettings;
  stream: { status: 'connected' | 'disconnected' | 'error' | 'connecting' };
  status: AppStatus;
  statusMessage: string;
  /**
   * Pre-eval (parse/lint) for the active editor buffer after Save / Run.
   * Cleared while typing. Ephemeral — drives underlines + Run gating. Not persisted.
   */
  preEval: {
    /** Editor diagnostics for current buffer (empty while pending first pass). */
    diagnostics: Array<{
      from: number;
      to: number;
      line: number;
      severity: 'error' | 'warning' | 'typo' | 'info';
      message: string;
      source?: string;
    }>;
    /**
     * True when any diagnostic is severity **error** (blocks Run when not pending).
     * Typos are non-blocking (engine may autocorrect).
     */
    hasErrors: boolean;
    /** True while a debounced / in-flight check is running. */
    pending: boolean;
    /** Source text last checked (or currently checking). */
    source: string;
  };
  lastRunMs: number | null;
  /**
   * Focused script run payload for Results / Scriptlogs / debug chrome.
   * Always mirrors {@link runResults}[{@link resultsFocusId}] (or null).
   * Not persisted.
   */
  lastRun: unknown | null;
  /**
   * Per-script last engine payload (keyed by indicator id or
   * {@link EDITOR_RUN_KEY}). Prevents multi-indicator live re-runs from
   * thrashing Scriptlogs/Results. Ephemeral — not persisted.
   */
  runResults: Record<string, unknown>;
  /**
   * Which key in {@link runResults} is shown in Results / Scriptlogs.
   * `null` until the first run (then auto-set). Ephemeral — not persisted.
   */
  resultsFocusId: string | null;
  /**
   * Ephemeral last plot series per applied indicator (for cross-indicator
   * `input.source` picks). Not persisted — rebuilt on re-run.
   */
  indicatorSeries: Record<
    string,
    {
      name: string;
      series: Record<string, PlotSample[]>;
      titles?: Record<string, string>;
    }
  >;
  /** In-memory system logs (not persisted) */
  logs: LogEntry[];

  /**
   * Active interactive drawing tool (`cursor` or a place tool).
   * Session-ish but still persisted so the toolbar restores on reload.
   * Layer may set this back to `cursor` after place when stay-in-mode is off.
   */
  drawingTool: DrawingToolId;
  /**
   * User chart drawings (persisted). Geometry uses legacy kind fields; style may
   * dual-exist as flat + nested `style` — see `resolveDrawingStyle`.
   * Pine script drawings are not stored here (layer script group only).
   */
  drawings: Drawing[];
  /** Default style for newly placed drawings (persisted); toolbar when no selection. */
  drawingPrefs: DrawingPrefs;
  /** Toolbar magnet / stay / lock / hide + last tool per group (persisted). */
  drawingUi: DrawingUi;
  /**
   * Currently selected drawing id on the chart (ephemeral — never hydrated from disk).
   * Driven by layer hit-test / drag; toolbar style bar reads this.
   */
  selectedDrawingId: string | null;

  /** Connection / engine / datafeed telemetry (ephemeral planes; hud + shareOnError persist) */
  telemetry: TelemetryState;
  /**
   * Pending opt-in error diagnostic toast (ephemeral — never hydrated).
   * Set by {@link maybeOfferErrorShare} when shareOnError is enabled.
   */
  errorShareOffer: {
    id: string;
    summary: string;
    payload: Record<string, unknown>;
    at: number;
  } | null;

  /**
   * Dock / float / window chrome for side panels (persisted).
   * See ``ui/panels/types.ts``.
   */
  panelChrome: import('../ui/panels/types').PanelChromeMap;

  /**
   * Multi-chart grid (1 / 2H / 2V / 4) + active slot.
   * Per-slot bars live in memory ({@link chart/chart-registry}); only slot
   * descriptors are persisted. Active slot mirrors flat `symbol` / `interval`.
   */
  chartLayout: import('../chart/layout').ChartLayoutState;
  /** User-saved named layouts (grid + optional chrome snapshot). */
  savedLayouts: import('../chart/layout').SavedChartLayout[];

  /**
   * Second-symbol compare overlay (persisted prefs; bars/loading ephemeral).
   * When enabled, ChartHost loads `symbol` via the active source and paints a
   * line series aligned to the main bars (% or absolute).
   */
  compare: CompareState;

  /**
   * On-chain panel prefs (persisted). Series points / chart attachments live
   * in the onchain manager module — not here.
   */
  onchain: OnchainState;

  /**
   * Topbar button visibility. Each group and individual button can be toggled
   * on/off. Persisted. Default: everything visible.
   */
  topbar: TopbarSettings;
}

/** Topbar button visibility settings (persisted). */
export interface TopbarSettings {
  /** Brand logo + title — always visible in practice, but kept for parity. */
  brand: boolean;
  /** Market group: symbol, interval, chart type, compare. */
  market: boolean;
  /** Data group: venue, plugin config, load, reload. */
  data: boolean;
  /** Compute group: engine, stream, run, live, replay. */
  compute: boolean;
  /** Layout group: chart layout menu. */
  layout: boolean;
  /** Panels group: panel toggle buttons. */
  panels: boolean;
  /** Individual panel toggles (inside panels group). */
  panelsWatchlist: boolean;
  panelsEditor: boolean;
  panelsLibrary: boolean;
  panelsScripts: boolean;
  panelsInputs: boolean;
  panelsLayers: boolean;
  panelsDsm: boolean;
  panelsOnchain: boolean;
  panelsAlerts: boolean;
  panelsValues: boolean;
  panelsResults: boolean;
  panelsScriptLogs: boolean;
  panelsSystemLogs: boolean;
  panelsStatus: boolean;
  /** System group: fullscreen, chart-only, studio, theme. */
  system: boolean;
}

/** Thin on-chain panel prefs (last protocol search/use). */
export interface OnchainState {
  /** Last protocol slug searched/used (persisted). */
  lastProtocolSlug: string;
  /** Last protocol display name (persisted). */
  lastProtocolName: string;
}

/** Compare-overlay preferences + ephemeral load state. */
export interface CompareState {
  /** Master switch — when false, clear series and free bars. */
  enabled: boolean;
  /** Compare ticker (uppercased). */
  symbol: string;
  /** percent = % change from first common bar; absolute = raw close. */
  mode: 'percent' | 'absolute';
  /**
   * When true and mode is percent, also paint the main symbol as % change
   * (dual % mode) on the shared scale.
   */
  normalizeMain: boolean;
  /** Ephemeral compare OHLCV (not persisted). */
  bars: Bar[];
  /** Bumped when compare bars load or clear (ChartHost reactivity). */
  gen: number;
  loading: boolean;
  error: string | null;
}
