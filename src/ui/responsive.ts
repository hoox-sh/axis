// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Viewport + pointer-mode signals for the responsive shell.
 *
 * Mobile redesign foundation: all JS layout branching (app shell, dock
 * columns, panel sheets, chart grid) keys off these signals instead of
 * CSS-only media queries — panel geometry is persisted px state, so layout
 * must *bypass* (never overwrite) desktop geometry while in mobile mode.
 *
 * Breakpoints:
 * - `phone`   ≤ 767px  — app-style shell: header + bottom tabs + sheets
 * - `tablet`  768–1023 — constrained desktop shell (one dock, scroll topbar)
 * - `desktop` ≥ 1024   — unchanged three-column dock layout
 *
 * @module ui/responsive
 */

import { createSignal } from 'solid-js';

/** Shell layout class derived from the viewport width. */
export type ViewportMode = 'phone' | 'tablet' | 'desktop';

/** Largest width still treated as `phone` (px, inclusive). */
export const PHONE_MAX_WIDTH = 767;
/** Largest width still treated as `tablet` (px, inclusive). */
export const TABLET_MAX_WIDTH = 1023;

function modeForWidth(width: number): ViewportMode {
  if (width <= PHONE_MAX_WIDTH) return 'phone';
  if (width <= TABLET_MAX_WIDTH) return 'tablet';
  return 'desktop';
}

const initialMode =
  typeof window !== 'undefined' ? modeForWidth(window.innerWidth || 1024) : 'desktop';

const [viewportMode, setViewportMode] = createSignal<ViewportMode>(initialMode);
const [coarsePointer, setCoarsePointer] = createSignal(
  typeof window !== 'undefined' ? !!window.matchMedia?.('(pointer: coarse)')?.matches : false,
);

// Keep signals in sync (module scope — one listener set for the app lifetime).
//
// These listeners are **app-lifetime by design**, not a leak: the module is
// imported once and the signals it feeds live for the whole session. There is
// no owner to clean them up with, and a resize listener that only exists
// while a component is mounted would stop tracking the viewport.
//
// Guarded defensively: test stubs may provide a window without event APIs —
// degrade to static defaults instead of throwing at import time.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      setViewportMode(modeForWidth(window.innerWidth || 1024));
    });
  });

  // Test stubs may provide a window without matchMedia — degrade gracefully.
  const coarseMql = window.matchMedia?.('(pointer: coarse)');
  if (coarseMql) {
    const onCoarseChange = () => setCoarsePointer(coarseMql.matches);
    if (coarseMql.addEventListener) coarseMql.addEventListener('change', onCoarseChange);
    else coarseMql.addListener?.(onCoarseChange);
  }
}

/** Reactive viewport mode (`phone` | `tablet` | `desktop`). */
export const viewport = viewportMode;
/** Reactive `pointer: coarse` (touch-first devices). */
export const pointerCoarse = coarsePointer;

/** True on phone widths — the app-style shell (header, tabs, sheets). */
export const isPhoneViewport = (): boolean => viewportMode() === 'phone';
/** True on tablet widths — constrained desktop shell with one dock. */
export const isTabletViewport = (): boolean => viewportMode() === 'tablet';
/** True on desktop widths — the three-column dock layout. */
export const isDesktopViewport = (): boolean => viewportMode() === 'desktop';
/**
 * Tablet left/right docks overlay the chart (in-flow width 0 + negative margin)
 * instead of shrinking it. Phone sheets still win over this.
 */
export const isTabletSideDockOverlay = (): boolean => isTabletViewport();
/** True when hover-gated UI should be replaced with tap equivalents. */
export const isTouchPointer = (): boolean => coarsePointer();
