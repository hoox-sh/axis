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
 * Finite number → attribute string. Rejects NaN / Infinity so SVG never gets
 * `x="NaN"` geometry (invisible/broken paint, noisy layout).
 */
export function finiteAttr(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return String(n);
}

/**
 * Create an SVG element in the standard SVG namespace, set attributes, append
 * to `parent`. Returns the new node for further customization (e.g. text content).
 * Attribute values are coerced with String(); callers should pass finite number
 * strings for geometry (see {@link finiteAttr}).
 */
export function el(
  parent: SVGElement,
  name: string,
  attrs: Record<string, string>,
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  parent.appendChild(node);
  return node;
}

/**
 * Draw a line with a fat invisible hit stroke under a visible stroke.
 * Hit layer uses max(sw, 8) width at near-zero opacity for easier picking.
 * Visible stroke has `pointer-events: none` so hits go to the fat layer.
 * No-ops when any endpoint is non-finite.
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
  const ax = finiteAttr(x1);
  const ay = finiteAttr(y1);
  const bx = finiteAttr(x2);
  const by = finiteAttr(y2);
  if (ax == null || ay == null || bx == null || by == null) return;

  const strokeW = Number.isFinite(sw) && sw > 0 ? sw : 1.5;
  const hitW = Math.max(strokeW, 8);

  el(g, 'line', {
    x1: ax,
    y1: ay,
    x2: bx,
    y2: by,
    stroke: stroke || '#939fff',
    'stroke-width': String(hitW), // wider hit area
    'stroke-opacity': '0.01',
    'pointer-events': pointerEvents,
    'stroke-linecap': 'round',
  });
  // visible stroke on top
  el(g, 'line', {
    x1: ax,
    y1: ay,
    x2: bx,
    y2: by,
    stroke: stroke || '#939fff',
    'stroke-width': String(strokeW),
    'stroke-linecap': 'round',
    'pointer-events': 'none',
    ...(dash ? { 'stroke-dasharray': dash } : {}),
  });
}

/**
 * Circle marker. When `handle` is true, uses dark fill + stroke cursor for
 * resize grips; otherwise a simple filled disc.
 * No-ops when center/radius is non-finite.
 */
export function circle(
  g: SVGElement,
  cx: number,
  cy: number,
  r: number,
  stroke: string,
  handle = false,
): void {
  const acx = finiteAttr(cx);
  const acy = finiteAttr(cy);
  const ar = finiteAttr(Number.isFinite(r) && r >= 0 ? r : NaN);
  if (acx == null || acy == null || ar == null) return;

  el(g, 'circle', {
    cx: acx,
    cy: acy,
    r: ar,
    fill: handle ? '#0a0b10' : stroke || '#939fff',
    stroke: handle ? stroke || '#939fff' : '#0a0b10',
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
  const ax = finiteAttr(x);
  const ay = finiteAttr(y);
  if (ax == null || ay == null) return;
  const fontSize = Number.isFinite(size) && size > 0 ? size : 11;

  const t = el(g, 'text', {
    x: ax,
    y: ay,
    fill: fill || '#939fff',
    'font-size': String(fontSize),
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    'text-anchor': anchor,
    'pointer-events': 'none',
  });
  t.textContent = text == null ? '' : String(text);
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
