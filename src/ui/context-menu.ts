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
 * Shared context-menu entries and viewport clamping.
 * Rendering lives in {@link ./ContextMenu}.
 *
 * @module ui/context-menu
 */

/** One row in a context menu. */
export type ContextMenuItem = {
  type: 'item';
  id: string;
  label: string;
  disabled?: boolean;
  /** Toggle / radio visual (accent row). */
  checked?: boolean;
  danger?: boolean;
};

/** Hairline between groups. */
export type ContextMenuSep = {
  type: 'sep';
  id: string;
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuSep;

/**
 * Keep a menu of `menuW`×`menuH` inside the viewport, opening from the pointer.
 * Flips left/up when the default corner would clip.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
  pad = 8,
): { x: number; y: number } {
  const w = Number.isFinite(menuW) && menuW > 0 ? menuW : 0;
  const h = Number.isFinite(menuH) && menuH > 0 ? menuH : 0;
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 0;
  const vh = Number.isFinite(viewportH) && viewportH > 0 ? viewportH : 0;
  let nx = Number.isFinite(x) ? x : pad;
  let ny = Number.isFinite(y) ? y : pad;
  if (vw > 0 && nx + w + pad > vw) nx = Math.max(pad, vw - w - pad);
  if (vh > 0 && ny + h + pad > vh) ny = Math.max(pad, vh - h - pad);
  if (nx < pad) nx = pad;
  if (ny < pad) ny = pad;
  return { x: nx, y: ny };
}
