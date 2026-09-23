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
 * Drawing-toolbar placement math.
 *
 * The rail docks to the left or the top of the chart host, or floats.
 * Dropping the handle near the left edge snaps left; near the top edge
 * (and not the left) snaps top. The style bar only floats.
 *
 * @module chart/drawings/toolbar/chrome
 */

export type ToolbarDock = 'left' | 'top' | 'float';

/** Distance from the host's left edge that snaps a drop to the left dock. */
export const DOCK_LEFT_PX = 36;

/** Distance from the host's top edge that snaps a drop to the top dock. */
export const DOCK_TOP_PX = 40;

/** Gap between the tool rail and an auto-placed style bar. */
export const STYLEBAR_GAP_PX = 8;

/** Coerce a persisted dock value. Unknown / missing → left. */
export function sanitizeToolbarDock(value: unknown): ToolbarDock {
  return value === 'top' || value === 'float' || value === 'left' ? value : 'left';
}

/** Finite coordinate, otherwise `fallback`. */
export function finitePx(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Snap on pointer-up. Left wins over top so the corner docks to the side rail.
 * `localX` / `localY` are the handle's top-left inside the chart host.
 */
export function snapToolbarDock(localX: number, localY: number): ToolbarDock {
  if (localX < DOCK_LEFT_PX) return 'left';
  if (localY < DOCK_TOP_PX) return 'top';
  return 'float';
}

/** Keep a bar's top-left inside the host, allowing it to sit flush with the edges. */
export function clampToHost(
  x: number,
  y: number,
  hostW: number,
  hostH: number,
  barW: number,
  barH: number,
): { x: number; y: number } {
  const w = Number.isFinite(hostW) ? Math.max(0, hostW) : 0;
  const h = Number.isFinite(hostH) ? Math.max(0, hostH) : 0;
  const bw = Number.isFinite(barW) ? Math.max(0, barW) : 0;
  const bh = Number.isFinite(barH) ? Math.max(0, barH) : 0;
  const maxX = Math.max(0, w - Math.min(bw, w));
  const maxY = Math.max(0, h - Math.min(bh, h));
  const nx = Number.isFinite(x) ? x : 0;
  const ny = Number.isFinite(y) ? y : 0;
  return {
    x: Math.min(maxX, Math.max(0, nx)),
    y: Math.min(maxY, Math.max(0, ny)),
  };
}

/**
 * Auto style-bar anchor: to the right of a vertical rail, under a top dock.
 * `rail` is the tool shell's box inside the chart host.
 */
export function autoStylebarPos(
  dock: ToolbarDock,
  rail: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  if (dock === 'top') {
    return { x: rail.x, y: rail.y + rail.h + STYLEBAR_GAP_PX };
  }
  return { x: rail.x + rail.w + STYLEBAR_GAP_PX, y: rail.y };
}
