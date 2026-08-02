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
 *   `crosshair`, `scriptSettings` open state, `selectedDrawingId`, full
 *   telemetry planes (only HUD layout prefs survive reload).
 * - **Live session**: `live.active` always hydrates as `false`; user re-enables.
 *
 * Drawing geometry types re-export from `chart/drawing-types`.
 */

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
}

import type { Drawing, DrawingToolId } from '../chart/drawing-types';
export type { Drawing, DrawingToolId };

/**
 * Default stroke/fill applied when the layer places a new drawing.
 * Seeded onto {@link DrawingLayer} style prefs; style bar edits this when nothing is selected.
 */
export interface DrawingPrefs {
  color: string;
  width: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  /** Rect fill opacity 0–1 (also used as create default via layer `stylePrefs`). */
  fillOpacity: number;
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
 * Live status for one data plane (source / stream / engine / storage).
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
  /** Rolling run latency samples (ms), newest last */
  runLatencySamples: number[];
  lastTick: TickTelemetry | null;
  /** Layout prefs (may be persisted via rest of store carefully) */
  hud: { compact: boolean; overlay: boolean };
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
   * UI density / chrome scale (text, icons, controls, gaps).
   * 0.8–1.3, default 1. Applied as CSS ``--ui-scale`` on ``<html>``.
   */
  uiScale: number;
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
   * Script Settings modal — shows ``input.*`` fields.
   * indicatorId null = editor document (not yet an applied indicator).
   */
  scriptSettings: { open: boolean; indicatorId: string | null };
  /** Input overrides for the docked editor doc (keyed by input title) */
  editorInputValues: Record<string, unknown>;
  /**
   * Ephemeral crosshair position for Data Window (not persisted).
   * time = bar time; barIndex = index into store.bars when known.
   */
  crosshair: { time: number | null; barIndex: number | null };
  /** Bottom results / export drawer */
  resultsPanel: { open: boolean; height: number };
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
  stream: { status: 'connected' | 'disconnected' | 'error' | 'connecting' };
  status: AppStatus;
  statusMessage: string;
  lastRunMs: number | null;
  /** Last script run payload for Results panel (not always persisted fully) */
  lastRun: unknown | null;
  /**
   * Ephemeral last plot series per applied indicator (for cross-indicator
   * `input.source` picks). Not persisted — rebuilt on re-run.
   */
  indicatorSeries: Record<
    string,
    {
      name: string;
      series: Record<string, (number | null)[]>;
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

  /** Connection / engine / datafeed telemetry (ephemeral) */
  telemetry: TelemetryState;

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
