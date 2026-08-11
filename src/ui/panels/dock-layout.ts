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
 * Dock-slot helpers — which open panels live on left/right/bottom, stack order,
 * and shared column width. Used by {@link FloatableShell} (portal + flex stack)
 * and {@link DockColumn} hosts in the app shell.
 *
 * Left/right multi-panel docks lay out **side-by-side** (row): e.g. indicators
 * left of editor when both are open on the right. Bottom docks still stack
 * vertically. {@link DOCK_STACK_ORDER} is start→end (left→right on side docks).
 *
 * @module ui/panels/dock-layout
 */

import { store, isPanelOpen } from '../../store';
import type { PanelChrome, PanelDock, PanelId } from './types';
import { isHoverSlideEligible, PANEL_META } from './types';
import {
  getHoverSlideExpandedMap,
  hoverSlideLayoutSize,
  isPanelHoverSlideExpanded,
} from './hover-slide';

/**
 * Stable start→end order within a dock.
 * Left/right: left→right (indicators before editor ⇒ indicators sit left of editor).
 * Bottom: top→bottom.
 */
export const DOCK_STACK_ORDER: readonly PanelId[] = [
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
] as const;

/** CSS `order` so portal append order does not scramble the stack. */
export function dockStackCssOrder(id: PanelId): number {
  const i = DOCK_STACK_ORDER.indexOf(id);
  return i >= 0 ? i + 1 : 99;
}

/** Max fraction of viewport for a side dock strip (sum of side-by-side panels). */
export const DOCK_SIDE_MAX_VIEWPORT_FRAC = 0.72;

/** DOM ids for dock portal hosts (must match app shell). */
export const DOCK_HOST_IDS = {
  left: 'axis-dock-left',
  right: 'axis-dock-right',
  bottom: 'axis-dock-bottom',
  float: 'axis-float-root',
} as const;

/** Resolve portal mount element for a dock target (null if not in DOM yet). */
export function dockHostElement(dock: PanelDock): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (dock === 'left') return document.getElementById(DOCK_HOST_IDS.left);
  if (dock === 'right') return document.getElementById(DOCK_HOST_IDS.right);
  if (dock === 'bottom') return document.getElementById(DOCK_HOST_IDS.bottom);
  // float + window
  return (
    document.getElementById(DOCK_HOST_IDS.float) ||
    (typeof document.body !== 'undefined' ? document.body : null)
  );
}

/**
 * Open panels currently docked to `dock`, in stack order.
 * Uses {@link isPanelOpen} so legacy open flags stay in sync.
 */
export function panelsOnDock(dock: PanelDock): PanelId[] {
  if (dock === 'float' || dock === 'window') return [];
  const chrome = store.panelChrome;
  if (!chrome) return [];
  return DOCK_STACK_ORDER.filter((id) => {
    if (!isPanelOpen(id)) return false;
    const c = chrome[id] as PanelChrome | undefined;
    return c?.dock === dock;
  });
}

/** How many open panels share this dock (for flex stacking). */
export function dockStackCount(dock: PanelDock): number {
  return panelsOnDock(dock).length;
}

/**
 * Layout width of one panel on a side dock (respects hover-slide peek).
 * Tracks {@link getHoverSlideExpandedMap} for reactivity when collapsed.
 */
export function panelDockLayoutWidth(id: PanelId): number {
  void getHoverSlideExpandedMap();
  const c = store.panelChrome?.[id] as PanelChrome | undefined;
  const full = c?.w ?? PANEL_META[id].defaultW;
  const dock = c?.dock ?? PANEL_META[id].defaultDock;
  return hoverSlideLayoutSize(id, dock, full, {
    hoverSlide: !!c?.hoverSlide && isHoverSlideEligible(dock),
    expanded: isPanelHoverSlideExpanded(id),
  });
}

/**
 * Layout height of one panel on the bottom dock (respects hover-slide peek).
 */
export function panelDockLayoutHeight(id: PanelId): number {
  void getHoverSlideExpandedMap();
  const c = store.panelChrome?.[id] as PanelChrome | undefined;
  const full = c?.h ?? PANEL_META[id].defaultH;
  const dock = c?.dock ?? 'bottom';
  return hoverSlideLayoutSize(id, dock, full, {
    hoverSlide: !!c?.hoverSlide && isHoverSlideEligible(dock),
    expanded: isPanelHoverSlideExpanded(id),
  });
}

/**
 * Width of a left/right dock strip.
 * - 1 panel: that panel’s layout width (peek when hover-slide collapsed)
 * - 2+ panels: **sum** of layout widths (side-by-side), capped to a viewport fraction
 */
export function dockColumnWidth(dock: 'left' | 'right'): number {
  const ids = panelsOnDock(dock);
  if (!ids.length) return 0;
  // Track hover expand map so column width reflows with slide open/close
  void getHoverSlideExpandedMap();
  if (ids.length === 1) {
    return panelDockLayoutWidth(ids[0]!);
  }
  let sum = 0;
  for (const id of ids) {
    sum += Math.max(PANEL_META[id].minW || 1, panelDockLayoutWidth(id));
  }
  const cap =
    typeof window !== 'undefined' && window.innerWidth > 0
      ? Math.floor(window.innerWidth * DOCK_SIDE_MAX_VIEWPORT_FRAC)
      : sum;
  return Math.min(sum, cap) || PANEL_META[ids[0]!].defaultW;
}

/** Index of panel within its dock stack, or -1 if not stacked there. */
export function indexInDockStack(id: PanelId, dock: PanelDock): number {
  return panelsOnDock(dock).indexOf(id);
}

/** True when this panel is the last (bottom / end) in its dock stack. */
export function isLastInDockStack(id: PanelId, dock: PanelDock): boolean {
  const list = panelsOnDock(dock);
  return list.length > 0 && list[list.length - 1] === id;
}
