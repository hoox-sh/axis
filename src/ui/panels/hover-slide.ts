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
 * Docked panel **hover slide** — collapse to a peek strip, expand on pointer
 * enter, collapse on leave (with a short delay so the pointer can cross the
 * strip without flicker).
 *
 * Preference lives on {@link PanelChrome.hoverSlide} (persisted). Runtime
 * expanded/collapsed state is ephemeral and only applies while docked.
 *
 * @module ui/panels/hover-slide
 */

import { createStore } from 'solid-js/store';
import type { PanelDock, PanelId } from './types';
import { isHoverSlideEligible } from './types';

/** Collapsed rail size (px) for side docks. */
export const HOVER_SLIDE_PEEK_SIDE = 28;

/** Collapsed rail size (px) for bottom dock. */
export const HOVER_SLIDE_PEEK_BOTTOM = 28;

/** Delay before collapse after pointer leave (ms). */
export const HOVER_SLIDE_LEAVE_MS = 280;

/**
 * Ephemeral expanded map — not persisted.
 * Missing / false ⇒ collapsed when hover-slide is enabled.
 */
const [hoverExpanded, setHoverExpanded] = createStore<Partial<Record<PanelId, boolean>>>({});

/** Reactive expanded map (for DockColumn / shells). */
export function getHoverSlideExpandedMap(): Partial<Record<PanelId, boolean>> {
  return hoverExpanded;
}

/** Whether this panel is currently expanded under hover-slide. */
export function isPanelHoverSlideExpanded(id: PanelId): boolean {
  return hoverExpanded[id] === true;
}

/**
 * Set runtime expanded state. No-op when `expanded` matches current.
 * Callers should only expand when hover-slide is enabled and docked.
 */
export function setPanelHoverSlideExpanded(id: PanelId, expanded: boolean): void {
  if (hoverExpanded[id] === expanded) return;
  setHoverExpanded(id, expanded);
}

/** Force collapse (e.g. when hover-slide is turned off or panel undocks). */
export function clearPanelHoverSlideExpanded(id: PanelId): void {
  if (hoverExpanded[id] == null) return;
  setHoverExpanded(id, false);
}

/**
 * Layout size contribution for a docked panel when hover-slide may apply.
 * - hover-slide off → full size
 * - on + collapsed → peek
 * - on + expanded → full size
 */
export function hoverSlideLayoutSize(
  id: PanelId,
  dock: PanelDock,
  fullSize: number,
  opts: { hoverSlide: boolean; expanded: boolean },
): number {
  if (!opts.hoverSlide || !isHoverSlideEligible(dock)) {
    return Math.max(1, fullSize);
  }
  if (opts.expanded) return Math.max(1, fullSize);
  return dock === 'bottom' ? HOVER_SLIDE_PEEK_BOTTOM : HOVER_SLIDE_PEEK_SIDE;
}

/** Side peek width helper. */
export function hoverSlidePeekForDock(dock: PanelDock): number {
  return dock === 'bottom' ? HOVER_SLIDE_PEEK_BOTTOM : HOVER_SLIDE_PEEK_SIDE;
}
