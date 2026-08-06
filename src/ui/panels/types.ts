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
 * Panel chrome model — ids, dock targets, geometry, and default map.
 *
 * Persisted under `store.panelChrome`. Legacy flat flags (`watchlist.open`,
 * etc.) are dual-written by store helpers. {@link FloatableShell} reads
 * chrome; {@link drop-zones} maps pointer position → dock targets.
 */

/** Dockable / floatable AXIS chrome panels */
export type PanelId =
  | 'watchlist'
  | 'indicators'
  | 'editor'
  | 'results'
  | 'logs'
  | 'scriptlogs'
  | 'dataview'
  | 'layers'
  | 'alerts'
  | 'library'
  | 'datasource';

/**
 * Where a panel lives:
 * - left / right / bottom — docked in layout slots
 * - float — free window over the chart
 * - window — browser popup (content portaled when possible)
 */
export type PanelDock = 'left' | 'right' | 'bottom' | 'float' | 'window';

/** Open state, dock target, and float geometry for one panel. */
export interface PanelChrome {
  open: boolean;
  dock: PanelDock;
  /** Float / window geometry (CSS px) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order for float windows */
  z: number;
}

/** Full chrome map keyed by {@link PanelId}. */
export type PanelChromeMap = Record<PanelId, PanelChrome>;

/**
 * Static titles, default docks, and size constraints for each panel.
 * minW/minH are 1px so panels can shrink to the border.
 * Used by FloatableShell headers and default chrome factories.
 */
export const PANEL_META: Record<
  PanelId,
  { title: string; defaultDock: PanelDock; minW: number; minH: number; defaultW: number; defaultH: number }
> = {
  watchlist: {
    title: 'Watchlist',
    defaultDock: 'left',
    minW: 1,
    minH: 1,
    defaultW: 200,
    defaultH: 420,
  },
  indicators: {
    title: 'Indicators',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 224,
    defaultH: 420,
  },
  editor: {
    title: 'Editor',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 460,
    defaultH: 520,
  },
  results: {
    title: 'Results',
    defaultDock: 'bottom',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 220,
  },
  logs: {
    title: 'Logs',
    defaultDock: 'bottom',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 160,
  },
  scriptlogs: {
    title: 'Scriptlogs',
    defaultDock: 'bottom',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 200,
  },
  dataview: {
    title: 'Data window',
    defaultDock: 'float',
    minW: 1,
    minH: 1,
    defaultW: 240,
    defaultH: 360,
  },
  layers: {
    title: 'Layers',
    defaultDock: 'left',
    minW: 1,
    minH: 1,
    defaultW: 260,
    defaultH: 340,
  },
  alerts: {
    title: 'Alerts',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 280,
    defaultH: 420,
  },
  library: {
    title: 'Script Library',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 300,
    defaultH: 480,
  },
  datasource: {
    title: 'Data Sources',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 320,
    defaultH: 520,
  },
};

/** Drag overlay target (null = no zone / invalid). */
export type DropZone = 'left' | 'right' | 'bottom' | 'float' | null;

/** Build default chrome for one panel (closed unless overrides say otherwise). */
export function defaultPanelChrome(id: PanelId, overrides?: Partial<PanelChrome>): PanelChrome {
  const m = PANEL_META[id];
  return {
    open: false,
    dock: m.defaultDock,
    x: 48,
    y: 48,
    w: m.defaultW,
    h: m.defaultH,
    z: 20,
    ...overrides,
  };
}

/**
 * Fresh chrome map for DEFAULTS / reset — watchlist+editor open by default;
 * dataview/layers float closed.
 */
export function defaultPanelChromeMap(): PanelChromeMap {
  return {
    watchlist: defaultPanelChrome('watchlist', { open: true, dock: 'left', w: 200 }),
    indicators: defaultPanelChrome('indicators', { open: false, dock: 'right', w: 224 }),
    editor: defaultPanelChrome('editor', { open: true, dock: 'right', w: 460 }),
    results: defaultPanelChrome('results', { open: false, dock: 'bottom', h: 220 }),
    logs: defaultPanelChrome('logs', { open: false, dock: 'bottom', h: 160 }),
    scriptlogs: defaultPanelChrome('scriptlogs', { open: false, dock: 'bottom', h: 200 }),
    dataview: defaultPanelChrome('dataview', {
      open: false,
      dock: 'float',
      x: 72,
      y: 56,
      w: 240,
      h: 380,
    }),
    layers: defaultPanelChrome('layers', {
      open: false,
      dock: 'left',
      w: 260,
    }),
    alerts: defaultPanelChrome('alerts', {
      open: false,
      dock: 'right',
      w: 280,
    }),
    library: defaultPanelChrome('library', {
      open: false,
      dock: 'right',
      w: 300,
    }),
    datasource: defaultPanelChrome('datasource', {
      open: false,
      dock: 'right',
      w: 320,
    }),
  };
}
