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
 * Low-level SVG primitives for AXIS chart drawings.
 *
 * Browser-only (`document` + SVG namespace). Building blocks for the drawing
 * overlay: create nodes, dual-stroke lines (hit + visible), handles, labels,
 * and stroke-dash patterns that match the legacy drawing-layer.
 *
 * Does **not**:
 * - Import Lightweight Charts or map time/price → pixels (see `coords.ts`)
 * - Own drawing models, hit-test math, or tool selection
 * - Render Pine Script™ plot drawings
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element in the standard SVG namespace, set attributes, append
 * to `parent`. Returns the new node for further customization (e.g. text content).
 */
export function el(
  parent: SVGElement,
  name: string,
  attrs: Record<string, string>,
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
}

/**
 * Draw a line with a fat invisible hit stroke under a visible stroke.
 * Hit layer uses max(sw, 8) width at near-zero opacity for easier picking.
 * Visible stroke has `pointer-events: none` so hits go to the fat layer.
 */
export function line(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  sw: number,
  dash?: string,
  pointerEvents = 'stroke',
): void {
  el(g, 'line', {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    stroke,
    'stroke-width': String(Math.max(sw, 8)), // wider hit area
    'stroke-opacity': '0.01',
    'pointer-events': pointerEvents,
    'stroke-linecap': 'round',
  });
  // visible stroke on top
  el(g, 'line', {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    stroke,
    'stroke-width': String(sw),
    'stroke-linecap': 'round',
    'pointer-events': 'none',
    ...(dash ? { 'stroke-dasharray': dash } : {}),
  });
}

/**
 * Circle marker. When `handle` is true, uses dark fill + stroke cursor for
 * resize grips; otherwise a simple filled disc.
 */
export function circle(
  g: SVGElement,
  cx: number,
  cy: number,
  r: number,
  stroke: string,
  handle = false,
): void {
  el(g, 'circle', {
    cx: String(cx),
    cy: String(cy),
    r: String(r),
    fill: handle ? '#0a0b10' : stroke,
    stroke: handle ? stroke : '#0a0b10',
    'stroke-width': handle ? '2' : '1',
    'pointer-events': 'auto',
    ...(handle ? { cursor: 'nwse-resize' } : {}),
  });
}

/** Monospace text label (non-interactive; `pointer-events: none`). */
export function label(
  g: SVGElement,
  x: number,
  y: number,
  text: string,
  fill: string,
  size = 11,
  anchor: 'start' | 'end' | 'middle' = 'start',
): void {
  const t = el(g, 'text', {
    x: String(x),
    y: String(y),
    fill,
    'font-size': String(size),
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    'text-anchor': anchor,
    'pointer-events': 'none',
  });
  t.textContent = text;
}

/**
 * Map line style (and optional selection) to SVG stroke-dasharray.
 * Matches patterns used in drawing-layer (dashed `4 3`, dotted `1 3`).
 * Selected solid lines get a dashed highlight so selection is visible.
 *
 * @returns `undefined` for unselected solid (no dash attribute).
 */
export function strokeDashFor(
  lineStyle: 'solid' | 'dashed' | 'dotted' | undefined,
  selected?: boolean,
): string | undefined {
  if (lineStyle === 'dashed') return '4 3';
  if (lineStyle === 'dotted') return '1 3';
  if (selected) return '4 3';
  return undefined;
}
