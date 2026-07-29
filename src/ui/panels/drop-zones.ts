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
 * Pointer → dock zone hit-testing for panel drag overlay.
 * Outer ~14% of viewport edges map to left/right/bottom; center → float.
 * Also provides skeleton sizes for the drag ghost.
 */

import type { DropZone, PanelDock } from './types';

/** Edge hit fraction of viewport for dock zones */
const EDGE = 0.14;

/**
 * Map pointer position over the app shell to a dock target.
 * Outer edges → dock left/right/bottom; center → free float.
 */
export function hitDropZone(
  clientX: number,
  clientY: number,
  vw = typeof window !== 'undefined' ? window.innerWidth : 1200,
  vh = typeof window !== 'undefined' ? window.innerHeight : 800,
): DropZone {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return 'float';
  const nx = clientX / Math.max(1, vw);
  const ny = clientY / Math.max(1, vh);
  if (nx < EDGE) return 'left';
  if (nx > 1 - EDGE) return 'right';
  if (ny > 1 - EDGE) return 'bottom';
  return 'float';
}

/** Map a drop zone to a durable {@link PanelDock} (null/float → float). */
export function dropZoneToDock(zone: DropZone): PanelDock {
  if (zone === 'left' || zone === 'right' || zone === 'bottom') return zone;
  return 'float';
}

/** Skeleton size for drag preview (px). */
export function skeletonSize(
  dock: PanelDock,
  panelW: number,
  panelH: number,
  vw: number,
  vh: number,
): { w: number; h: number } {
  if (dock === 'left' || dock === 'right') {
    return { w: Math.min(panelW, Math.round(vw * 0.28)), h: Math.round(vh * 0.72) };
  }
  if (dock === 'bottom') {
    return { w: Math.round(vw * 0.72), h: Math.min(panelH, Math.round(vh * 0.32)) };
  }
  return {
    w: Math.min(panelW, Math.round(vw * 0.4)),
    h: Math.min(panelH, Math.round(vh * 0.5)),
  };
}
