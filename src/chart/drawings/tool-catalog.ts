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
 * Drawing toolbar catalog — groups, flyouts, last-tool defaults.
 *
 * Maps left-rail groups to {@link DrawingToolId} lists. UI uses this to:
 * - Render group buttons in order
 * - Decide whether a group opens a **flyout** (multi-tool picker) vs a
 *   single-click activate
 * - Resolve the default (primary) tool for a group: first entry in `tools`
 *
 * Flyout semantics:
 * - `flyout: true` — group has (or expects) multiple tools; UI shows a
 *   secondary menu / last-used tool on the rail icon
 * - `flyout: false` — single-tool or empty placeholder groups; no flyout chrome
 *
 * Implemented tools map to ``DrawingToolId``; future tools stay as comments.
 * Does **not** render the toolbar, persist last-used tools, or activate tools.
 */

import type { DrawingToolId } from '../drawing-types';

/** Stable id for a left-rail toolbar group. */
export type ToolGroupId =
  | 'select'
  | 'lines'
  | 'fib'
  | 'shapes'
  | 'annotation'
  | 'measure'
  | 'trading'
  | 'actions';

/**
 * One toolbar group definition.
 * `tools[0]` is the default primary tool when the group is non-empty.
 */
export interface ToolGroupDef {
  id: ToolGroupId;
  label: string;
  /** First entry is the default primary tool for the group. */
  tools: DrawingToolId[];
  /**
   * When true, the group supports a flyout of alternate tools (and typically
   * remembers the last selected tool). Single-tool groups use `false`.
   */
  flyout: boolean;
}

/**
 * Toolbar groups (left rail). Single-tool groups omit flyouts.
 *
 * Actions group stays empty — utilities (magnet, lock, erase) live as
 * dedicated rail toggles in DrawingToolbar.
 */
export const TOOL_GROUPS: ToolGroupDef[] = [
  {
    id: 'select',
    label: 'Select',
    tools: ['cursor', 'eraser'],
    flyout: true,
  },
  {
    id: 'lines',
    label: 'Lines',
    tools: [
      'trend',
      'ray',
      'extend',
      'infoLine',
      'trendAngle',
      'hline',
      'hray',
      'vline',
      'crossline',
      'channel',
      'pitchfork',
    ],
    flyout: true,
  },
  {
    id: 'fib',
    label: 'Fibonacci',
    tools: ['fib', 'fibext', 'fibtime', 'fibchannel'],
    flyout: true,
  },
  {
    id: 'shapes',
    label: 'Shapes',
    tools: [
      'rect',
      'ellipse',
      'triangle',
      'arrow',
      'polyline',
      'path',
      'brush',
      'highlighter',
    ],
    flyout: true,
  },
  {
    id: 'annotation',
    label: 'Annotation',
    tools: ['text', 'priceLabel', 'callout', 'note'],
    flyout: true,
  },
  {
    id: 'measure',
    label: 'Measure',
    tools: ['measure', 'dateRange', 'priceRange'],
    flyout: true,
  },
  {
    id: 'trading',
    label: 'Trading',
    tools: ['long', 'short'],
    flyout: true,
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
