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
  | 'statusbar'
  | 'dataview'
  | 'layers'
  | 'alerts'
  | 'library'
  | 'datasource'
  | 'onchain';

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
  /**
   * When true and the panel is **docked** (left/right/bottom), the shell
   * collapses to a peek strip and slides open on pointer enter / closed on leave.
   * Ignored for float / window docks.
   */
  hoverSlide?: boolean;
  /**
   * When true and dock is left/right/bottom, the panel floats over the chart
   * edge (chart does not shrink). Ignored for float / window (already overlay).
   * See {@link ui/panels/panel-manager}.
   */
  chartOverlay?: boolean;
}

/** Full chrome map keyed by {@link PanelId}. */
export type PanelChromeMap = Record<PanelId, PanelChrome>;

/**
 * Static titles, default docks, size constraints, and default float positions.
 * minW/minH are 1px so panels can shrink to the border.
 * Used by FloatableShell headers and default chrome factories.
 * `defaultX` / `defaultY` are factory float coordinates (viewport-relative at runtime).
 */
export const PANEL_META: Record<
  PanelId,
  {
    title: string;
    defaultDock: PanelDock;
    minW: number;
    minH: number;
    defaultW: number;
    defaultH: number;
    /** Default float x (px) when undocked / reset */
    defaultX: number;
    /** Default float y (px) when undocked / reset */
    defaultY: number;
  }
> = {
  watchlist: {
    title: 'Watchlist',
    defaultDock: 'left',
    minW: 1,
    minH: 1,
    defaultW: 200,
    defaultH: 420,
    defaultX: 16,
    defaultY: 56,
  },
  indicators: {
    title: 'Scripts',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 224,
    defaultH: 420,
    defaultX: 1000,
    defaultY: 56,
  },
  editor: {
    title: 'Editor',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 460,
    defaultH: 520,
    defaultX: 780,
    defaultY: 48,
  },
  results: {
    title: 'Results',
    defaultDock: 'bottom',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 220,
    defaultX: 48,
    defaultY: 520,
  },
  /** Fixed app-shell strip (not a dock portal); chrome.open = show/hide. */
  logs: {
    title: 'System Logs',
    defaultDock: 'float',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 160,
    defaultX: 48,
    defaultY: 560,
  },
  scriptlogs: {
    title: 'Script Logs',
    defaultDock: 'bottom',
    minW: 1,
    minH: 80,
    defaultW: 640,
    defaultH: 200,
    defaultX: 48,
    defaultY: 500,
  },
  /** Fixed app-shell strip (not a dock portal); chrome.open = show/hide. */
  statusbar: {
    title: 'Status',
    defaultDock: 'float',
    minW: 1,
    minH: 1,
    defaultW: 640,
    defaultH: 36,
    defaultX: 48,
    defaultY: 700,
  },
  dataview: {
    title: 'Data window',
    defaultDock: 'float',
    minW: 1,
    minH: 1,
    defaultW: 240,
    defaultH: 360,
    defaultX: 72,
    defaultY: 56,
  },
  layers: {
    title: 'Layers',
    defaultDock: 'left',
    minW: 1,
    minH: 1,
    defaultW: 260,
    defaultH: 340,
    defaultX: 16,
    defaultY: 100,
  },
  alerts: {
    title: 'Alerts',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 280,
    defaultH: 420,
    defaultX: 960,
    defaultY: 56,
  },
  library: {
    title: 'Script Library',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 300,
    defaultH: 480,
    defaultX: 940,
    defaultY: 56,
  },
  datasource: {
    title: 'Data Sources',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 320,
    defaultH: 520,
    defaultX: 920,
    defaultY: 56,
  },
  onchain: {
    title: 'On-Chain',
    defaultDock: 'right',
    minW: 1,
    minH: 1,
    defaultW: 320,
    defaultH: 480,
    defaultX: 920,
    defaultY: 80,
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
    x: m.defaultX,
    y: m.defaultY,
    w: m.defaultW,
    h: m.defaultH,
    z: 20,
    hoverSlide: false,
    chartOverlay: false,
    ...overrides,
  };
}

/** True when hover-slide is meaningful (docked side/bottom, not float/window). */
export function isHoverSlideEligible(dock: PanelDock): boolean {
  return dock === 'left' || dock === 'right' || dock === 'bottom';
}

/**
 * Fresh chrome map for DEFAULTS / reset — watchlist+editor open by default;
 * dataview/layers float closed.
 */
export function defaultPanelChromeMap(): PanelChromeMap {
  return {
    watchlist: defaultPanelChrome('watchlist', {
      open: true,
      dock: 'left',
      w: 200,
      x: PANEL_META.watchlist.defaultX,
      y: PANEL_META.watchlist.defaultY,
    }),
    indicators: defaultPanelChrome('indicators', {
      open: false,
      dock: 'right',
      w: 224,
      x: PANEL_META.indicators.defaultX,
      y: PANEL_META.indicators.defaultY,
    }),
    editor: defaultPanelChrome('editor', {
      open: true,
      dock: 'right',
      w: 460,
      x: PANEL_META.editor.defaultX,
      y: PANEL_META.editor.defaultY,
    }),
    results: defaultPanelChrome('results', {
      open: false,
      dock: 'bottom',
      h: 220,
      x: PANEL_META.results.defaultX,
      y: PANEL_META.results.defaultY,
    }),
    // Classic fixed bottom strips (not FloatableShell); chrome.open = show/hide
    logs: defaultPanelChrome('logs', {
      open: true,
      dock: 'float',
      h: 160,
      x: PANEL_META.logs.defaultX,
      y: PANEL_META.logs.defaultY,
    }),
    scriptlogs: defaultPanelChrome('scriptlogs', {
      open: false,
      dock: 'bottom',
      h: 200,
      x: PANEL_META.scriptlogs.defaultX,
      y: PANEL_META.scriptlogs.defaultY,
    }),
    statusbar: defaultPanelChrome('statusbar', {
      open: true,
      dock: 'float',
      h: 36,
      x: PANEL_META.statusbar.defaultX,
      y: PANEL_META.statusbar.defaultY,
    }),
    dataview: defaultPanelChrome('dataview', {
      open: false,
      dock: 'float',
      x: PANEL_META.dataview.defaultX,
      y: PANEL_META.dataview.defaultY,
      w: 240,
      h: 380,
    }),
    layers: defaultPanelChrome('layers', {
      open: false,
      dock: 'left',
      w: 260,
      x: PANEL_META.layers.defaultX,
      y: PANEL_META.layers.defaultY,
    }),
    alerts: defaultPanelChrome('alerts', {
      open: false,
      dock: 'right',
      w: 280,
      x: PANEL_META.alerts.defaultX,
      y: PANEL_META.alerts.defaultY,
    }),
    library: defaultPanelChrome('library', {
      open: false,
      dock: 'right',
      w: 300,
      x: PANEL_META.library.defaultX,
      y: PANEL_META.library.defaultY,
    }),
    datasource: defaultPanelChrome('datasource', {
      open: false,
      dock: 'right',
      w: 320,
      x: PANEL_META.datasource.defaultX,
      y: PANEL_META.datasource.defaultY,
    }),
    onchain: defaultPanelChrome('onchain', {
      open: false,
      dock: 'right',
      w: 320,
      x: PANEL_META.onchain.defaultX,
      y: PANEL_META.onchain.defaultY,
    }),
  };
}
