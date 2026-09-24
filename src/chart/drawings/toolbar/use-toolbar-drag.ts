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
 * Shared pointer-drag factory for the drawing toolbar handles.
 *
 * Both the tool rail and the floating style bar need the same contract:
 * press-and-hold + 4px slop → live drag with host clamping, plain click →
 * tap callback (toggle menu / no-op). Previously two ~50-line handlers
 * duplicated capture, slop, and listener teardown.
 *
 * @module chart/drawings/toolbar/use-toolbar-drag
 */

import { DRAG_SLOP_PX } from './shortcuts';

export interface ToolbarDragCallbacks {
  onLive: (pos: { x: number; y: number } | null) => void;
  onDrop: (moved: boolean) => void;
  onTap?: () => void;
}

/**
 * Build an `onPointerDown` handler that tracks a single pointer, reports live
 * positions via `resolve`, and calls `onDrop(moved)` on release.
 */
export function createToolbarDrag(
  resolve: (dx: number, dy: number) => { x: number; y: number } | null,
  cb: ToolbarDragCallbacks,
  setDragging: (v: boolean) => void,
): (e: PointerEvent) => void {
  return (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement | null;
    if (!handle) return;
    const pid = e.pointerId;
    try {
      handle.setPointerCapture(pid);
    } catch {
      /* Synthetic pointers and some browsers reject capture; move listeners still run. */
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_SLOP_PX) return;
      moved = true;
      const next = resolve(ev.clientX - startX, ev.clientY - startY);
      if (next) cb.onLive(next);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDragging(false);
      if (ev.type !== 'pointerup') {
        cb.onLive(null);
        cb.onDrop(false);
        return;
      }
      if (!moved) {
        cb.onTap?.();
        cb.onDrop(false);
        return;
      }
      cb.onDrop(true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
}

/** Keyboard nudge deltas for a floating bar (arrows + Shift for large steps). */
export function nudgeDelta(
  key: string,
  shift: boolean,
  step: number,
  largeStep: number,
): [number, number] | null {
  const s = shift ? largeStep : step;
  switch (key) {
    case 'ArrowLeft':
      return [-s, 0];
    case 'ArrowRight':
      return [s, 0];
    case 'ArrowUp':
      return [0, -s];
    case 'ArrowDown':
      return [0, s];
    default:
      return null;
  }
}
