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
 * TV-style drawing toolbar catalog — groups, flyouts, last-tool defaults.
 * Implemented tools map to ``DrawingToolId``; future tools stay as comments.
 */

import type { DrawingToolId } from '../drawing-types';

export type ToolGroupId =
  | 'select'
  | 'lines'
  | 'fib'
  | 'shapes'
  | 'annotation'
  | 'measure'
  | 'trading'
  | 'actions';

export interface ToolGroupDef {
  id: ToolGroupId;
  label: string;
  /** First entry is the default primary tool for the group. */
  tools: DrawingToolId[];
  flyout: boolean;
}

/**
 * Toolbar groups (left rail). Single-tool groups omit flyouts.
 *
 * Future (not in DrawingToolId yet — do not add until types exist):
 * - lines: parallel-channel, vertical-line, extended-line, info-line
 * - fib: fib-extension, fib-channel, fib-time
 * - shapes: circle, triangle, path, polyline, arrow, brush
 * - annotation: callout, price-note, anchored-text, pin
 * - measure: date-range, price-range, long-position, short-position
 * - trading: long-position, short-position, order, forecast
 * - actions: remove-selected, remove-all, hide-all, lock-all, magnet, stay-in-mode
 */
export const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: 'select',
    label: 'Select',
    tools: ['cursor'],
    flyout: false,
  },
  {
    id: 'lines',
    label: 'Lines',
    tools: ['trend', 'ray', 'hline'],
    flyout: true,
  },
  {
    id: 'fib',
    label: 'Fibonacci',
    tools: ['fib'],
    flyout: false,
  },
  {
    id: 'shapes',
    label: 'Shapes',
    tools: ['rect'],
    flyout: false,
  },
  {
    id: 'annotation',
    label: 'Annotation',
    tools: ['text'],
    flyout: false,
  },
  {
    id: 'measure',
    label: 'Measure',
    tools: ['measure'],
    flyout: false,
  },
  {
    id: 'trading',
    label: 'Trading',
    tools: [],
    flyout: false,
  },
  {
    id: 'actions',
    label: 'Actions',
    tools: [],
    flyout: false,
  },
];

/** Default primary tool id for a group (first entry), or null if empty. */
export function defaultToolForGroup(groupId: ToolGroupId): DrawingToolId | null {
  const g = TOOL_GROUPS.find((x) => x.id === groupId);
  return g?.tools[0] ?? null;
}

/** Group that owns a tool, if any. */
export function groupForTool(tool: DrawingToolId): ToolGroupDef | undefined {
  return TOOL_GROUPS.find((g) => g.tools.includes(tool));
}
