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

export type ViewportMode = 'phone' | 'tablet' | 'desktop';

export const PHONE_MAX_WIDTH = 767;
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

export const isPhoneViewport = () => viewportMode() === 'phone';
export const isTabletViewport = () => viewportMode() === 'tablet';
export const isDesktopViewport = () => viewportMode() === 'desktop';
/** True when hover-gated UI should be replaced with tap equivalents. */
export const isTouchPointer = () => coarsePointer();
