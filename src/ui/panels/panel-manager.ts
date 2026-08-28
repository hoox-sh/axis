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
 * Panel manager — defaults, chart-overlay layout, and bulk chrome helpers.
 *
 * Store mutations live in {@link store/index} (`resetPanelToDefault`,
 * `setPanelChartOverlay`, {@link setAllPanelsChartOverlay}). This module owns
 * pure position/layout logic so shells and tests stay free of store cycles.
 *
 * **Chart overlay** — when on for a left/right/bottom dock, the panel floats
 * over the chart edge instead of taking dock-column space (chart does not
 * shrink). Float/window docks are already overlays.
 *
 * @module ui/panels/panel-manager
 */

import {
  defaultPanelChromeMap,
  PANEL_META,
  type PanelChrome,
  type PanelDock,
  type PanelId,
} from './types';

/** All panel ids (stable iteration order matches default map). */
export const PANEL_IDS: readonly PanelId[] = [
  'watchlist',
  'layers',
  'dataview',
  'indicators',
  'alerts',
  'library',
  'datasource',
  'onchain',
  'editor',
  'logs',
  'scriptlogs',
  'statusbar',
] as const;

/**
 * Fixed app-shell strips — not FloatableShell; chart-overlay / dock reset N/A
 * for portal layout (open flag only).
 */
export const FIXED_APP_SHELL_PANELS: ReadonlySet<PanelId> = new Set([
  'logs',
  'statusbar',
]);

/** Factory chrome for one panel (dock, size, default float position). */
export function getDefaultPanelChrome(id: PanelId): PanelChrome {
  return defaultPanelChromeMap()[id];
}

/** True when chart-overlay mode is meaningful (edge docks that can shrink the chart). */
export function isChartOverlayEligible(dock: PanelDock): boolean {
  return dock === 'left' || dock === 'right' || dock === 'bottom';
}

/**
 * Whether a panel should present as chart overlay (float over plot).
 * - `chartOverlay` flag + edge dock → overlay
 * - float / window → always overlay
 */
export function isPanelInChartOverlayMode(chrome: PanelChrome): boolean {
  if (chrome.dock === 'float' || chrome.dock === 'window') return true;
  return !!chrome.chartOverlay && isChartOverlayEligible(chrome.dock);
}

/**
 * Portal host dock: edge panels with chart overlay use the float root so they
 * do not occupy left/right/bottom columns.
 */
export function effectivePortalDock(chrome: PanelChrome): PanelDock {
  if (isPanelInChartOverlayMode(chrome) && isChartOverlayEligible(chrome.dock)) {
    return 'float';
  }
  return chrome.dock;
}

/** Top chrome offset for edge overlays (approx topbar). */
export const CHART_OVERLAY_TOP_PAD = 48;
/** Bottom safe pad (status strip). */
export const CHART_OVERLAY_BOTTOM_PAD = 36;

export interface ChartOverlayGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Edge-aligned geometry when a docked panel is chart-overlaying the plot.
 * Uses chrome w/h and preferred dock; clamps into the viewport.
 */
export function chartOverlayGeometry(
  chrome: PanelChrome,
  vw: number,
  vh: number,
): ChartOverlayGeometry {
  const idDock = chrome.dock;
  const w = Math.max(1, chrome.w || 240);
  const h = Math.max(1, chrome.h || 200);
  const top = CHART_OVERLAY_TOP_PAD;
  const bottom = CHART_OVERLAY_BOTTOM_PAD;
  const usableH = Math.max(120, vh - top - bottom);

  if (idDock === 'left') {
    return {
      x: 0,
      y: top,
      w: Math.min(w, Math.max(1, vw - 8)),
      h: usableH,
    };
  }
  if (idDock === 'right') {
    const width = Math.min(w, Math.max(1, vw - 8));
    return {
      x: Math.max(0, vw - width),
      y: top,
      w: width,
      h: usableH,
    };
  }
  if (idDock === 'bottom') {
    const height = Math.min(h, Math.max(80, usableH));
    return {
      x: 0,
      y: Math.max(top, vh - bottom - height),
      w: Math.max(1, vw),
      h: height,
    };
  }
  // float / window — keep chrome geometry, lightly clamp
  const fw = Math.min(Math.max(1, chrome.w), Math.max(1, vw));
  const fh = Math.min(Math.max(1, chrome.h), Math.max(1, vh));
  return {
    x: Math.min(Math.max(0, chrome.x), Math.max(0, vw - Math.min(fw, vw))),
    y: Math.min(Math.max(0, chrome.y), Math.max(0, vh - Math.min(fh, vh))),
    w: fw,
    h: fh,
  };
}

/**
 * Default float/window position for a panel (used when seeding float or reset).
 * Viewport-aware so right-dock defaults land on the right edge.
 */
export function defaultPanelPosition(
  id: PanelId,
  vw = typeof window !== 'undefined' ? window.innerWidth || 1280 : 1280,
  vh = typeof window !== 'undefined' ? window.innerHeight || 800 : 800,
): ChartOverlayGeometry {
  const def = getDefaultPanelChrome(id);
  const m = PANEL_META[id];
  const w = def.w || m.defaultW;
  const h = def.h || m.defaultH;
  const top = CHART_OVERLAY_TOP_PAD;
  const bottom = CHART_OVERLAY_BOTTOM_PAD;

  // Explicit map positions win when set off the generic 48,48 seed
  if (def.x > 8 || def.y > 8) {
    return {
      x: Math.min(def.x, Math.max(0, vw - Math.min(w, vw))),
      y: Math.min(def.y, Math.max(0, vh - Math.min(h, vh))),
      w,
      h,
    };
  }

  if (def.dock === 'left') {
    return { x: 16, y: top, w, h: Math.max(h, vh - top - bottom) };
  }
  if (def.dock === 'right') {
    return {
      x: Math.max(24, vw - w - 24),
      y: top,
      w,
      h: Math.max(h, vh - top - bottom),
    };
  }
  if (def.dock === 'bottom') {
    return {
      x: 24,
      y: Math.max(top, vh - h - bottom),
      w: Math.min(w, vw - 48),
      h,
    };
  }
  return {
    x: Math.min(def.x || 72, Math.max(0, vw - w)),
    y: Math.min(def.y || 56, Math.max(0, vh - h)),
    w,
    h,
  };
}

/** Panel ids that support chart-overlay / dock reset via FloatableShell. */
export function isManagedFloatablePanel(id: PanelId): boolean {
  return !FIXED_APP_SHELL_PANELS.has(id);
}
