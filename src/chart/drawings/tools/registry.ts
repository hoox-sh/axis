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
 * Pluggable drawing-tool handlers — paint / hit-test / placement arity.
 *
 * New tools register here so {@link DrawingLayer} stays thin. Import side-effect
 * modules from `./index` to install handlers at load time.
 *
 * @module chart/drawings/tools/registry
 */

import type { Drawing, DrawingToolId, Point } from '../../drawing-types';

/** Pixel projection helpers provided by the layer. */
export interface ToolViewCtx {
  toXY: (p: Point) => { x: number; y: number } | null;
  timeToX: (t: number) => number | null;
  priceToY: (price: number) => number | null;
  width: number;
  height: number;
  /** Create SVG child under current paint group. */
  el: (name: string, attrs: Record<string, string>) => SVGElement;
  line: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke: string,
    sw: number,
    dash?: string,
    pointerEvents?: string,
  ) => void;
  circle: (
    x: number,
    y: number,
    r: number,
    stroke: string,
    filled: boolean,
  ) => void;
  label: (
    x: number,
    y: number,
    text: string,
    fill: string,
    size?: number,
    anchor?: 'start' | 'end' | 'middle',
  ) => void;
  stroke: string;
  strokeWidth: number;
  dash?: string;
  fillOpacity: number;
  selected: boolean;
  /** Optional bar-index helper for measure labels. */
  barIndexApprox?: (time: number) => number;
}

export interface ToolHitCtx {
  x: number;
  y: number;
  tol: number;
  toXY: (p: Point) => { x: number; y: number } | null;
  timeToX: (t: number) => number | null;
  priceToY: (price: number) => number | null;
  width: number;
  height: number;
}

export type PointArity = 0 | 1 | 2 | 3 | 'n';

export interface ToolHandler {
  id: DrawingToolId;
  label: string;
  /** Anchor count before commit (`n` = open-ended, finish on double-click). `0` = tool-only (eraser). */
  arity: PointArity;
  minPoints?: number;
  /** Paint user drawing into the active SVG group via ctx helpers. */
  paint?: (d: Drawing, ctx: ToolViewCtx) => void;
  /** Hit-test; return true if (x,y) hits the drawing. */
  hit?: (d: Drawing, ctx: ToolHitCtx) => boolean;
  /**
   * Build a drawing entity from collected anchors (after arity satisfied).
   * Layer assigns id / style defaults after.
   */
  create?: (points: Point[], color: string) => Drawing | null;
  /** Optional draft preview while placing (points include hover as last). */
  paintDraft?: (points: Point[], ctx: ToolViewCtx) => void;
}

const handlers = new Map<string, ToolHandler>();

export function registerToolHandler(h: ToolHandler): void {
  handlers.set(h.id, h);
}

export function getToolHandler(id: string): ToolHandler | undefined {
  return handlers.get(id);
}

export function listToolHandlers(): ToolHandler[] {
  return Array.from(handlers.values());
}

/** Placement arity for toolbar tools (cursor → 0). */
export function toolArity(tool: DrawingToolId): PointArity | 0 {
  if (tool === 'cursor' || tool === 'eraser') return 0;
  const h = handlers.get(tool);
  if (h) return h.arity;
  // Built-in legacy defaults
  if (tool === 'hline' || tool === 'vline' || tool === 'text' || tool === 'priceLabel') {
    return 1;
  }
  if (
    tool === 'channel' ||
    tool === 'fibext' ||
    tool === 'fibchannel' ||
    tool === 'triangle'
  ) {
    return 3;
  }
  if (tool === 'polyline' || tool === 'path') return 'n';
  if (
    tool === 'trend' ||
    tool === 'ray' ||
    tool === 'extend' ||
    tool === 'hray' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'fib' ||
    tool === 'fibtime' ||
    tool === 'measure' ||
    tool === 'dateRange' ||
    tool === 'priceRange' ||
    tool === 'long' ||
    tool === 'short' ||
    tool === 'infoLine'
  ) {
    return 2;
  }
  return 2;
}

export function toolNeedsMultiClick(tool: DrawingToolId): boolean {
  const a = toolArity(tool);
  return a === 2 || a === 3 || a === 'n';
}
