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
 * Named workspace export / import — pure build, parse, apply, and download
 * helpers for a durable AXIS chrome + chart + drawings snapshot.
 *
 * Bars (OHLCV) are omitted by default (`includeBars` opt-in) so JSON stays small.
 * Apply never mutates the live store itself: callers pass setters. Failed parse
 * throws without calling setters so user data is not wiped.
 *
 * @module storage/workspace-snapshot
 */

import {
  DEFAULT_CHART_TYPE,
  normalizeChartType,
  type ChartType,
} from '../chart/chart-type';
import {
  normalizeChartLayout,
  type ChartLayoutState,
  type SavedChartLayout,
} from '../chart/layout';
import { normalizeUserDrawings } from '../chart/drawings/normalize';
import type { Drawing } from '../chart/drawing-types';
import type {
  Bar,
  DrawingPrefs,
  DrawingUi,
  EditorLayoutState,
  Indicator,
  Pane,
} from '../store/types';
import type { PanelChrome, PanelChromeMap, PanelDock, PanelId } from '../ui/panels/types';
import { PANEL_META } from '../ui/panels/types';

/** Discriminator for AXIS workspace JSON files. */
export const WORKSPACE_SNAPSHOT_KIND = 'axis-workspace' as const;

/** Bump when the snapshot shape breaks backward compatibility. */
export const WORKSPACE_SNAPSHOT_VERSION = 1;

/** Keys written under `editorPrefs` (restored into matching store fields). */
export const EDITOR_PREFS_KEYS = [
  'profilerEnabled',
  'inlineDebugEnabled',
  'editorOpen',
  'editorWidth',
  'editorMode',
] as const;

export type EditorPrefsKey = (typeof EDITOR_PREFS_KEYS)[number];

/** Panel chrome fields included in a workspace export (geometry + dock). */
export type PanelChromeSnapshot = Pick<
  PanelChrome,
  'open' | 'dock' | 'x' | 'y' | 'w' | 'h' | 'z' | 'hoverSlide' | 'chartOverlay'
>;

/** Applied-indicator metadata (code included so restore can re-run). */
export interface ScriptSnapshotMeta {
  id: string;
  name: string;
  /** Pine source — present when exported from a full workspace. */
  code?: string;
  paneId: string;
  visible: boolean;
  plots?: Record<string, { color: string }>;
  inputValues?: Record<string, unknown>;
}

/** Editor prefs bag inside the snapshot (stable key set). */
export interface EditorPrefsSnapshot {
  profilerEnabled?: boolean;
  inlineDebugEnabled?: boolean;
  editorOpen?: boolean;
  editorWidth?: number;
  editorMode?: 'docked' | 'popout';
}

/**
 * Full workspace snapshot file shape.
 * Optional fields may be absent in older or partial exports; apply ignores missing keys.
 */
export interface WorkspaceSnapshot {
  kind: typeof WORKSPACE_SNAPSHOT_KIND;
  version: number;
  createdAt: string;
  /** Optional human label (filename stem / user name). */
  name?: string;

  symbol: string;
  interval: string;
  exchange: string;
  chartType: ChartType;
  historyBars?: number;

  chartLayout?: ChartLayoutState;
  /** Named layouts library (optional — can be large). */
  savedLayouts?: SavedChartLayout[];
  panes?: Pane[];

  drawings?: Drawing[];
  drawingPrefs?: DrawingPrefs;
  drawingUi?: Partial<DrawingUi>;

  /** Subset of panel chrome (open / dock / geometry). */
  panelChrome?: Partial<Record<PanelId, PanelChromeSnapshot>>;

  theme?: 'dark' | 'light';
  uiScale?: number;

  editorPrefs?: EditorPrefsSnapshot;

  /** Applied scripts list (metadata + optional code). */
  scripts?: ScriptSnapshotMeta[];

  /** Omitted unless `includeBars` was set at build time. */
  bars?: Bar[];
  /** Echo of build option for importers. */
  includeBars?: boolean;
}

/** Loose store-like object accepted by {@link buildWorkspaceSnapshot}. */
export type WorkspaceSnapshotSource = {
  symbol?: string;
  interval?: string;
  exchange?: string;
  chartType?: unknown;
  historyBars?: number;
  theme?: 'dark' | 'light' | string;
  uiScale?: number;
  chartLayout?: ChartLayoutState;
  savedLayouts?: SavedChartLayout[];
  panes?: Pane[];
  drawings?: Drawing[];
  drawingPrefs?: DrawingPrefs;
  drawingUi?: DrawingUi;
  panelChrome?: Partial<Record<PanelId, Partial<PanelChrome>>> | PanelChromeMap;
  scripts?: Indicator[];
  editor?: Partial<EditorLayoutState>;
  profilerEnabled?: boolean;
  inlineDebugEnabled?: boolean;
  bars?: Bar[];
};

export interface BuildWorkspaceSnapshotOptions {
  /** When true, copy OHLCV bars into the snapshot (can be huge). Default false. */
  includeBars?: boolean;
  /** Include `savedLayouts` array. Default true. */
  includeSavedLayouts?: boolean;
  /** Optional display name stored on the snapshot. */
  name?: string;
  /** Override createdAt (ISO string). Defaults to now. */
  createdAt?: string;
}

/**
 * Fields passed to setters during apply (only keys present on the snapshot).
 * Callers map these onto the live store / side effects.
 */
export interface WorkspaceSnapshotApplyFields {
  symbol?: string;
  interval?: string;
  exchange?: string;
  chartType?: ChartType;
  historyBars?: number;
  chartLayout?: ChartLayoutState;
  savedLayouts?: SavedChartLayout[];
  panes?: Pane[];
  drawings?: Drawing[];
  drawingPrefs?: DrawingPrefs;
  drawingUi?: Partial<DrawingUi>;
  panelChrome?: Partial<Record<PanelId, PanelChromeSnapshot>>;
  theme?: 'dark' | 'light';
  uiScale?: number;
  editorPrefs?: EditorPrefsSnapshot;
  scripts?: ScriptSnapshotMeta[];
  bars?: Bar[];
}

/**
 * Dependency-injected apply surface. Pure apply never touches `localStorage`
 * or the Solid store directly — the host wires these callbacks.
 */
export interface WorkspaceSnapshotSetters {
  /**
   * Receive validated fields to write. May be called once with the full patch.
   * Implementations should only write provided keys (do not wipe omitted fields
   * unless that is intentional product behavior).
   */
  assign(fields: WorkspaceSnapshotApplyFields): void;
  /** Optional: DOM theme attribute after theme assign. */
  applyTheme?(theme: 'dark' | 'light'): void;
  /** Optional: CSS --ui-scale after scale assign. */
  applyUiScale?(scale: number): void;
}

export class WorkspaceSnapshotParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceSnapshotParseError';
  }
}

const PANEL_IDS = Object.keys(PANEL_META) as PanelId[];

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function snapshotPanelChrome(
  raw: WorkspaceSnapshotSource['panelChrome'],
): Partial<Record<PanelId, PanelChromeSnapshot>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<Record<PanelId, PanelChromeSnapshot>> = {};
  for (const id of PANEL_IDS) {
    const p = (raw as Record<string, Partial<PanelChrome> | undefined>)[id];
    if (!p || typeof p !== 'object') continue;
    out[id] = {
      open: !!p.open,
      dock: (p.dock as PanelDock) || PANEL_META[id].defaultDock,
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      w: Number(p.w) || PANEL_META[id].defaultW,
      h: Number(p.h) || PANEL_META[id].defaultH,
      z: Number(p.z) || 20,
      hoverSlide: !!p.hoverSlide,
      chartOverlay: !!p.chartOverlay,
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function snapshotScripts(scripts: Indicator[] | undefined): ScriptSnapshotMeta[] | undefined {
  if (!Array.isArray(scripts) || !scripts.length) return scripts ? [] : undefined;
  return scripts.map((s) => ({
    id: String(s.id || ''),
    name: String(s.name || 'Script'),
    code: typeof s.code === 'string' ? s.code : '',
    paneId: String(s.paneId || 'price'),
    visible: s.visible !== false,
    plots: s.plots && typeof s.plots === 'object' ? deepClone(s.plots) : {},
    inputValues:
      s.inputValues && typeof s.inputValues === 'object' ? deepClone(s.inputValues) : undefined,
  }));
}

function snapshotEditorPrefs(src: WorkspaceSnapshotSource): EditorPrefsSnapshot {
  const prefs: EditorPrefsSnapshot = {};
  if (typeof src.profilerEnabled === 'boolean') prefs.profilerEnabled = src.profilerEnabled;
  if (typeof src.inlineDebugEnabled === 'boolean') prefs.inlineDebugEnabled = src.inlineDebugEnabled;
  if (src.editor && typeof src.editor === 'object') {
    if (typeof src.editor.open === 'boolean') prefs.editorOpen = src.editor.open;
    if (typeof src.editor.width === 'number' && Number.isFinite(src.editor.width)) {
      prefs.editorWidth = src.editor.width;
    }
    if (src.editor.mode === 'docked' || src.editor.mode === 'popout') {
      prefs.editorMode = src.editor.mode;
    }
  }
  return prefs;
}

/**
 * Build a serializable workspace snapshot from a store-like object.
 * Does not read `localStorage` or mutate the source.
 */
export function buildWorkspaceSnapshot(
  storeLike: WorkspaceSnapshotSource,
  options: BuildWorkspaceSnapshotOptions = {},
): WorkspaceSnapshot {
  const includeBars = !!options.includeBars;
  const includeSavedLayouts = options.includeSavedLayouts !== false;
  const symbol = String(storeLike.symbol || 'BTCUSDT').toUpperCase();
  const interval = String(storeLike.interval || '1d');
  const exchange = String(storeLike.exchange || 'binance');
  const chartType = normalizeChartType(storeLike.chartType ?? DEFAULT_CHART_TYPE);

  const snap: WorkspaceSnapshot = {
    kind: WORKSPACE_SNAPSHOT_KIND,
    version: WORKSPACE_SNAPSHOT_VERSION,
    createdAt: options.createdAt || new Date().toISOString(),
    symbol,
    interval,
    exchange,
    chartType,
  };

  if (options.name != null && String(options.name).trim()) {
    snap.name = String(options.name).trim();
  }

  if (typeof storeLike.historyBars === 'number' && Number.isFinite(storeLike.historyBars)) {
    snap.historyBars = Math.round(storeLike.historyBars);
  }

  if (storeLike.chartLayout && typeof storeLike.chartLayout === 'object') {
    snap.chartLayout = deepClone(
      normalizeChartLayout(storeLike.chartLayout, {
        symbol,
        interval,
        exchange,
        chartType,
      }),
    );
  }

  if (includeSavedLayouts && Array.isArray(storeLike.savedLayouts)) {
    snap.savedLayouts = deepClone(storeLike.savedLayouts).slice(0, 40);
  }

  if (Array.isArray(storeLike.panes)) {
    snap.panes = deepClone(storeLike.panes);
  }

  if (Array.isArray(storeLike.drawings)) {
    snap.drawings = normalizeUserDrawings(deepClone(storeLike.drawings)) as Drawing[];
  }

  if (storeLike.drawingPrefs && typeof storeLike.drawingPrefs === 'object') {
    snap.drawingPrefs = deepClone(storeLike.drawingPrefs);
  }

  if (storeLike.drawingUi && typeof storeLike.drawingUi === 'object') {
    const ui = storeLike.drawingUi;
    snap.drawingUi = {
      magnet: ui.magnet,
      stayInMode: ui.stayInMode,
      hideDrawings: ui.hideDrawings,
      lockAll: ui.lockAll,
      lastToolByGroup:
        ui.lastToolByGroup && typeof ui.lastToolByGroup === 'object'
          ? { ...ui.lastToolByGroup }
          : {},
    };
  }

  const chrome = snapshotPanelChrome(storeLike.panelChrome);
  if (chrome) snap.panelChrome = chrome;

  if (storeLike.theme === 'dark' || storeLike.theme === 'light') {
    snap.theme = storeLike.theme;
  }

  if (typeof storeLike.uiScale === 'number' && Number.isFinite(storeLike.uiScale)) {
    snap.uiScale = storeLike.uiScale;
  }

  const editorPrefs = snapshotEditorPrefs(storeLike);
  if (Object.keys(editorPrefs).length) snap.editorPrefs = editorPrefs;

  const scripts = snapshotScripts(storeLike.scripts);
  if (scripts) snap.scripts = scripts;

  snap.includeBars = includeBars;
  if (includeBars && Array.isArray(storeLike.bars)) {
    snap.bars = deepClone(storeLike.bars);
  }

  return snap;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, fallback?: string): string {
  const v = obj[key];
  if (typeof v === 'string' && v.length) return v;
  if (fallback !== undefined) return fallback;
  throw new WorkspaceSnapshotParseError(`Missing or invalid string field: ${key}`);
}

/**
 * Parse and validate workspace JSON text.
 * Throws {@link WorkspaceSnapshotParseError} on invalid input — never partial-applies.
 */
export function parseSnapshotJson(text: string): WorkspaceSnapshot {
  if (typeof text !== 'string' || !text.trim()) {
    throw new WorkspaceSnapshotParseError('Empty snapshot');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkspaceSnapshotParseError('Invalid JSON');
  }
  if (!isRecord(raw)) {
    throw new WorkspaceSnapshotParseError('Snapshot must be a JSON object');
  }

  // Accept kind missing only when version is present (forward-compat soft)
  const kind = raw.kind;
  if (kind != null && kind !== WORKSPACE_SNAPSHOT_KIND) {
    throw new WorkspaceSnapshotParseError(
      `Unsupported snapshot kind: ${String(kind)} (expected ${WORKSPACE_SNAPSHOT_KIND})`,
    );
  }

  const version = Number(raw.version);
  if (!Number.isFinite(version) || version < 1) {
    throw new WorkspaceSnapshotParseError('Missing or invalid snapshot version');
  }
  if (version > WORKSPACE_SNAPSHOT_VERSION) {
    throw new WorkspaceSnapshotParseError(
      `Snapshot version ${version} is newer than supported (${WORKSPACE_SNAPSHOT_VERSION})`,
    );
  }

  const symbol = requireString(raw, 'symbol', 'BTCUSDT').toUpperCase();
  const interval = requireString(raw, 'interval', '1d');
  const exchange = requireString(raw, 'exchange', 'binance');
  const chartType = normalizeChartType(raw.chartType);

  let createdAt: string;
  if (typeof raw.createdAt === 'string' && raw.createdAt) {
    createdAt = raw.createdAt;
  } else if (typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)) {
    createdAt = new Date(raw.createdAt).toISOString();
  } else {
    createdAt = new Date().toISOString();
  }

  const snap: WorkspaceSnapshot = {
    kind: WORKSPACE_SNAPSHOT_KIND,
    version: Math.floor(version),
    createdAt,
    symbol,
    interval,
    exchange,
    chartType,
  };

  if (typeof raw.name === 'string' && raw.name.trim()) {
    snap.name = raw.name.trim();
  }

  if (typeof raw.historyBars === 'number' && Number.isFinite(raw.historyBars)) {
    snap.historyBars = Math.round(raw.historyBars);
  }

  if (isRecord(raw.chartLayout) || (raw.chartLayout && typeof raw.chartLayout === 'object')) {
    try {
      snap.chartLayout = normalizeChartLayout(raw.chartLayout as ChartLayoutState, {
        symbol,
        interval,
        exchange,
        chartType,
      });
    } catch {
      throw new WorkspaceSnapshotParseError('Invalid chartLayout');
    }
  }

  if (Array.isArray(raw.savedLayouts)) {
    snap.savedLayouts = (raw.savedLayouts as SavedChartLayout[])
      .filter((l) => l && typeof l === 'object' && typeof (l as SavedChartLayout).id === 'string')
      .slice(0, 40);
  }

  if (Array.isArray(raw.panes)) {
    snap.panes = raw.panes as Pane[];
  }

  if (Array.isArray(raw.drawings)) {
    snap.drawings = normalizeUserDrawings(raw.drawings) as Drawing[];
  }

  if (isRecord(raw.drawingPrefs)) {
    snap.drawingPrefs = raw.drawingPrefs as unknown as DrawingPrefs;
  }

  if (isRecord(raw.drawingUi)) {
    snap.drawingUi = raw.drawingUi as Partial<DrawingUi>;
  }

  if (isRecord(raw.panelChrome)) {
    const chrome: Partial<Record<PanelId, PanelChromeSnapshot>> = {};
    for (const id of PANEL_IDS) {
      const p = raw.panelChrome[id];
      if (!isRecord(p)) continue;
      chrome[id] = {
        open: !!p.open,
        dock: (typeof p.dock === 'string' ? p.dock : PANEL_META[id].defaultDock) as PanelDock,
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        w: Number(p.w) || PANEL_META[id].defaultW,
        h: Number(p.h) || PANEL_META[id].defaultH,
        z: Number(p.z) || 20,
        hoverSlide: !!p.hoverSlide,
        chartOverlay: !!p.chartOverlay,
      };
    }
    snap.panelChrome = chrome;
  }

  if (raw.theme === 'dark' || raw.theme === 'light') {
    snap.theme = raw.theme;
  }

  if (typeof raw.uiScale === 'number' && Number.isFinite(raw.uiScale)) {
    snap.uiScale = raw.uiScale;
  }

  if (isRecord(raw.editorPrefs)) {
    const ep = raw.editorPrefs;
    const prefs: EditorPrefsSnapshot = {};
    if (typeof ep.profilerEnabled === 'boolean') prefs.profilerEnabled = ep.profilerEnabled;
    if (typeof ep.inlineDebugEnabled === 'boolean') prefs.inlineDebugEnabled = ep.inlineDebugEnabled;
    if (typeof ep.editorOpen === 'boolean') prefs.editorOpen = ep.editorOpen;
    if (typeof ep.editorWidth === 'number' && Number.isFinite(ep.editorWidth)) {
      prefs.editorWidth = ep.editorWidth;
    }
    if (ep.editorMode === 'docked' || ep.editorMode === 'popout') {
      prefs.editorMode = ep.editorMode;
    }
    if (Object.keys(prefs).length) snap.editorPrefs = prefs;
  }

  if (Array.isArray(raw.scripts)) {
    snap.scripts = (raw.scripts as unknown[]).map((s, i) => {
      if (!isRecord(s)) {
        throw new WorkspaceSnapshotParseError(`Invalid scripts[${i}]`);
      }
      return {
        id: typeof s.id === 'string' ? s.id : `script_${i}`,
        name: typeof s.name === 'string' ? s.name : 'Script',
        code: typeof s.code === 'string' ? s.code : '',
        paneId: typeof s.paneId === 'string' ? s.paneId : 'price',
        visible: s.visible !== false,
        plots: isRecord(s.plots) ? (s.plots as ScriptSnapshotMeta['plots']) : {},
        inputValues: isRecord(s.inputValues)
          ? (s.inputValues as Record<string, unknown>)
          : undefined,
      };
    });
  }

  if (raw.includeBars === true && Array.isArray(raw.bars)) {
    snap.includeBars = true;
    snap.bars = raw.bars as Bar[];
  } else if (Array.isArray(raw.bars) && raw.bars.length) {
    // Bars present without flag — still accept but mark includeBars
    snap.includeBars = true;
    snap.bars = raw.bars as Bar[];
  } else {
    snap.includeBars = false;
  }

  return snap;
}

/**
 * Apply a validated snapshot via dependency-injected setters.
 * Does not call setters when the snapshot object is incomplete (throws first).
 * Never clears fields that are absent from the snapshot.
 */
export function applyWorkspaceSnapshot(
  snap: WorkspaceSnapshot,
  setters: WorkspaceSnapshotSetters,
): void {
  if (!snap || typeof snap !== 'object') {
    throw new WorkspaceSnapshotParseError('Invalid snapshot');
  }
  if (snap.kind != null && snap.kind !== WORKSPACE_SNAPSHOT_KIND) {
    throw new WorkspaceSnapshotParseError(`Unsupported snapshot kind: ${String(snap.kind)}`);
  }
  if (!snap.symbol || !snap.interval) {
    throw new WorkspaceSnapshotParseError('Snapshot missing symbol/interval');
  }

  const fields: WorkspaceSnapshotApplyFields = {
    symbol: String(snap.symbol).toUpperCase(),
    interval: String(snap.interval),
    exchange: String(snap.exchange || 'binance'),
    chartType: normalizeChartType(snap.chartType),
  };

  if (typeof snap.historyBars === 'number' && Number.isFinite(snap.historyBars)) {
    fields.historyBars = Math.round(snap.historyBars);
  }
  if (snap.chartLayout) {
    fields.chartLayout = normalizeChartLayout(snap.chartLayout, {
      symbol: fields.symbol,
      interval: fields.interval,
      exchange: fields.exchange,
      chartType: fields.chartType,
    });
  }
  if (Array.isArray(snap.savedLayouts)) {
    fields.savedLayouts = snap.savedLayouts;
  }
  if (Array.isArray(snap.panes)) {
    fields.panes = snap.panes;
  }
  if (Array.isArray(snap.drawings)) {
    fields.drawings = normalizeUserDrawings(snap.drawings) as Drawing[];
  }
  if (snap.drawingPrefs) {
    fields.drawingPrefs = snap.drawingPrefs;
  }
  if (snap.drawingUi) {
    fields.drawingUi = snap.drawingUi;
  }
  if (snap.panelChrome) {
    fields.panelChrome = snap.panelChrome;
  }
  if (snap.theme === 'dark' || snap.theme === 'light') {
    fields.theme = snap.theme;
  }
  if (typeof snap.uiScale === 'number' && Number.isFinite(snap.uiScale)) {
    fields.uiScale = snap.uiScale;
  }
  if (snap.editorPrefs) {
    fields.editorPrefs = snap.editorPrefs;
  }
  if (Array.isArray(snap.scripts)) {
    fields.scripts = snap.scripts;
  }
  if (snap.includeBars && Array.isArray(snap.bars)) {
    fields.bars = snap.bars;
  }

  setters.assign(fields);

  if (fields.theme && setters.applyTheme) {
    setters.applyTheme(fields.theme);
  }
  if (fields.uiScale != null && setters.applyUiScale) {
    setters.applyUiScale(fields.uiScale);
  }
}

/**
 * Trigger a browser download of the snapshot as pretty-printed JSON.
 * No-ops safely when `document` is unavailable (SSR / tests).
 */
export function downloadSnapshot(
  snap: WorkspaceSnapshot,
  filename = 'axis-workspace.json',
): void {
  const text = JSON.stringify(snap, null, 2);
  if (typeof document === 'undefined') return;
  const safeName = (filename || 'axis-workspace.json').replace(/[^\w.\-]+/g, '_');
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}

/** Default download filename from snapshot name / symbol / date. */
export function defaultSnapshotFilename(snap: WorkspaceSnapshot): string {
  const stamp = (snap.createdAt || '').slice(0, 10) || 'export';
  const base = (snap.name || snap.symbol || 'workspace')
    .toLowerCase()
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `axis-workspace-${base || 'export'}-${stamp}.json`;
}
