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
 * 16×16 silhouettes for drawing-toolbar tools.
 *
 * One stroke glyph per id in {@link TOOL_GROUPS}. `DrawingToolIcon` is the
 * mark rendered on the rail; `toolIconPath` is the same geometry as a path
 * `d` string. Unknown ids use a diamond. Does not select tools or paint.
 */

import type { JSX } from 'solid-js';

const FALLBACK = 'M8 2.4 L13.4 8 L8 13.6 L2.6 8 Z';

/** Highlighter is a filled swipe; every other glyph is stroke-only. */
const FILLED = new Set(['highlighter']);

const GLYPH: Record<string, string> = {
  cursor: 'M3.2 2.2 L3.2 11.4 L6.4 8.8 L9.4 13.8 L11.8 12.6 L8.6 7.8 L13 7.4 Z',
  eraser: 'M3.2 9.2 L9.4 4.6 L12.2 8 L6 12.6 Z M5.6 7.4 L8.4 10.8',

  trend: 'M3 12.8 L13 3.2',
  ray: 'M3.2 12.6 L12.2 3.6 M9.2 3.4 L12.6 3.2 L12.2 6.6',
  extend: 'M4 12 L12 4 M2.6 10.6 L5.4 13.4 M10.6 2.6 L13.4 5.4',
  infoLine: 'M2.4 13 L8.6 6.8 M14.1 4.1 a2.3 2.3 0 1 1 -4.6 0 a2.3 2.3 0 1 1 4.6 0 M11.8 3.1 V5.5',
  trendAngle: 'M3.2 12.2 H12.4 M3.2 12.2 L12.4 4.2 M6.6 12.2 A3.4 3.4 0 0 0 5.8 10',
  hline: 'M2.4 8 H13.6',
  hray: 'M2.4 8 H11.4 M8.6 5.2 L12.8 8 L8.6 10.8',
  vline: 'M8 2.4 V13.6',
  crossline: 'M2.6 8 H13.4 M8 2.6 V13.4',
  channel: 'M2.6 4.2 L12.6 6.6 M2.6 7.6 L12.6 10 M2.6 11 L12.6 13.4',
  pitchfork: 'M2.8 13 L7.4 8.2 M7.4 8.2 L13.4 3 M7.4 8.2 L13.4 12.2',
  gannFan: 'M3 13 H13 M3 13 L13 9.4 M3 13 L13 5.6 M3 13 L8.8 3 M3 13 V3.2',
  gannBox: 'M3.2 3.2 H12.8 V12.8 H3.2 Z M3.2 8 H12.8 M8 3.2 V12.8',
  gannSquare: 'M3.4 3.4 H12.6 V12.6 H3.4 Z M3.4 3.4 L12.6 12.6 M12.6 3.4 L3.4 12.6',

  fib: 'M4.4 3.6 H11.6 M2.4 6.8 H13.6 M4.4 9.6 H11.6 M4.4 12.4 H11.6',
  fibext: 'M2.6 12.6 L7.2 8.6 M3.4 10.6 H13.4 M4.2 7.2 H13.4 M5 4 H12',
  fibtime: 'M3.2 3.2 V12.8 M6.8 5.2 V12.8 M10.2 3.2 V12.8 M13.2 6 V11.4',
  fibchannel: 'M2.8 3.6 L13.2 6.2 M2.8 10.6 L13.2 13.2 M4.6 7.6 L8 8.4 M9.4 8.8 L12.2 9.5',
  fibArc: 'M2.4 13 A5.6 5.6 0 0 0 13.6 13 M4.4 13 A3.6 3.6 0 0 0 11.6 13 M6.2 13 A1.8 1.8 0 0 0 9.8 13',
  fibWedge: 'M3.4 12.4 H12.4 M3.4 12.4 L10.1 6.4 M3.4 12.4 L11.6 8.7 M12.4 12.4 A9 9 0 0 0 10.1 6.4',
  fibCircles:
    'M13.2 8 A5.2 5.2 0 1 0 2.8 8 A5.2 5.2 0 1 0 13.2 8 M11.1 8 A3.1 3.1 0 1 0 4.9 8 A3.1 3.1 0 1 0 11.1 8 M9.3 8 A1.3 1.3 0 1 0 6.7 8 A1.3 1.3 0 1 0 9.3 8',

  rect: 'M2.6 4.6 H13.4 V11.4 H2.6 Z',
  rotatedRect: 'M5.2 2.8 L13.2 6.2 L10.8 13.2 L2.8 9.8 Z',
  ellipse: 'M13.5 8 A5.5 3.3 0 1 0 2.5 8 A5.5 3.3 0 1 0 13.5 8',
  triangle: 'M8 2.8 L13.6 13.2 H2.4 Z',
  arrow: 'M2.8 12.4 L9.2 6 M8.4 3.6 L13.2 3.4 L10.6 7.8 Z',
  arc: 'M3 11.4 A8 7 0 0 1 13.2 7.2',
  curve: 'M2.6 12 C6.2 4.2 9.6 12.8 13.4 5.2',
  polyline: 'M2.6 10.6 L6.2 4.2 L9.4 9.2 L13.6 3.6',
  path: 'M2.8 12.2 L6.2 6.4 C8.4 3.2 11.4 4.2 13.4 8.8',
  brush: 'M2.4 9.4 C3.8 6.2 4.6 12 6.4 9.2 C8 6.6 7.6 5 9.2 7.6 C10.6 9.8 11 12.2 12.6 9.4 C13.4 8 13.6 6.2 14 6.6',
  highlighter: 'M2.6 9.6 L11.2 4.2 L13.4 7 L4.8 12.4 Z',
  xabcd: 'M2.2 7.2 L5.2 12.4 L8 3.4 L10.8 9.2 L13.8 4.2',
  headShoulders: 'M2.2 11.6 L4.6 6.8 L6.4 10.2 L8 3 L9.6 10.2 L11.4 6.4 L13.8 11.6 M2.4 13 H13.6',

  text: 'M4.2 3.4 H11.8 M8 3.4 V12.8',
  anchoredText: 'M4.6 2.4 H11.4 M8 2.4 V7.8 M9.5 11.4 A1.5 1.5 0 1 0 6.5 11.4 A1.5 1.5 0 1 0 9.5 11.4',
  priceLabel: 'M2.4 4.8 H9 L13.2 8 L9 11.2 H2.4 Z M5.4 8.9 A0.9 0.9 0 1 0 5.4 7.1 A0.9 0.9 0 1 0 5.4 8.9',
  callout: 'M2.8 2.8 H13.2 V9.2 H8.6 L6 13 L6.4 9.2 H2.8 Z',
  note: 'M3.4 2.6 H9.4 L13 6.2 V13.4 H3.4 Z M9.4 2.6 V6.2 H13 M5.6 8.8 H10.4 M5.6 11.2 H8.8',
  flag: 'M4.2 2.4 V13.6 M4.2 3.2 H11.4 L9.2 5.8 L11.4 8.6 H4.2',
  arrowMarkUp: 'M8 13.2 V4.4 M4.2 7.8 L8 2.8 L11.8 7.8',
  arrowMarkDown: 'M8 2.8 V11.6 M4.2 8.2 L8 13.2 L11.8 8.2',

  measure: 'M2.4 5.4 H13.6 V11 H2.4 Z M5.2 5.4 V7.6 M8 5.4 V8.6 M10.8 5.4 V7.6',
  dateRange: 'M3 8 H13 M3 5.2 V10.8 M13 5.2 V10.8 M8 6.6 V9.4',
  priceRange: 'M8 3 V13 M5.2 3 H10.8 M5.2 13 H10.8 M6.6 8 H9.4',
  datePriceRange: 'M3.2 3.2 H12.8 V12.8 H3.2 Z M5 11.2 L11.2 5 M8.4 5 H11.2 V7.8',

  long: 'M3.6 13 V5.6 H12.4 V13 M6.4 9.2 L8 6.6 L9.6 9.2',
  short: 'M3.6 3 V10.4 H12.4 V3 M6.4 6.8 L8 9.4 L9.6 6.8',
  forecast: 'M2.4 10.8 L6.2 7.4 M7.6 2.8 V13.2 M9.2 8.2 L12.4 5 M10.4 4.6 H13.4 V7.4',
};

/** Joined SVG path `d` for a tool id, or the diamond fallback. */
export function toolIconPath(id: string): string {
  return GLYPH[id] ?? FALLBACK;
}

export function DrawingToolIcon(props: {
  id: string;
  size?: number;
  strokeWidth?: number;
  class?: string;
}): JSX.Element {
  const filled = () => FILLED.has(props.id);
  return (
    <svg
      viewBox="0 0 16 16"
      width={props.size ?? 16}
      height={props.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={props.class}
    >
      <path
        d={toolIconPath(props.id)}
        fill={filled() ? 'currentColor' : 'none'}
        fill-opacity={filled() ? 0.4 : undefined}
        stroke={filled() ? 'none' : 'currentColor'}
      />
    </svg>
  );
}
