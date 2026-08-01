// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Toolbar catalog integrity — every DrawingToolId in exactly one group.
 */

import { describe, expect, it } from 'bun:test';
import {
  TOOL_GROUPS,
  defaultToolForGroup,
  groupForTool,
} from '../src/chart/drawings/tool-catalog.ts';
import type { DrawingToolId } from '../src/chart/drawing-types.ts';

const ALL: DrawingToolId[] = [
  'cursor',
  'hline',
  'vline',
  'trend',
  'ray',
  'extend',
  'rect',
  'ellipse',
  'arrow',
  'fib',
  'measure',
  'text',
];

describe('tool-catalog', () => {
  it('every tool appears in exactly one group', () => {
    const seen = new Map<DrawingToolId, string>();
    for (const g of TOOL_GROUPS) {
      for (const t of g.tools) {
        expect(seen.has(t)).toBe(false);
        seen.set(t, g.id);
      }
    }
    for (const t of ALL) {
      expect(seen.has(t)).toBe(true);
    }
  });

  it('defaultToolForGroup and groupForTool', () => {
    expect(defaultToolForGroup('lines')).toBe('trend');
    expect(defaultToolForGroup('shapes')).toBe('rect');
    expect(defaultToolForGroup('trading')).toBeNull();
    expect(groupForTool('vline')?.id).toBe('lines');
    expect(groupForTool('ellipse')?.id).toBe('shapes');
    expect(groupForTool('extend')?.flyout).toBe(true);
  });

  it('shapes and lines have flyouts when multi-tool', () => {
    expect(TOOL_GROUPS.find((g) => g.id === 'lines')!.flyout).toBe(true);
    expect(TOOL_GROUPS.find((g) => g.id === 'shapes')!.flyout).toBe(true);
    expect(TOOL_GROUPS.find((g) => g.id === 'shapes')!.tools.length).toBeGreaterThan(1);
  });
});
