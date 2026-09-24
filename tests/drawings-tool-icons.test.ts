/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing-tool icon paths — one non-empty silhouette per catalog id.
 */

import { describe, expect, it } from 'bun:test';
import { TOOL_GROUPS } from '../src/chart/drawings/tool-catalog.ts';
import { toolIconPath } from '../src/chart/drawings/tool-icons.tsx';

const CATALOG_IDS = TOOL_GROUPS.flatMap((g) => g.tools);

describe('drawing tool icons', () => {
  it('returns a non-empty path for every catalog tool and an unknown id', () => {
    const ids = [...CATALOG_IDS, 'not-a-drawing-tool'];
    for (const id of ids) {
      expect(toolIconPath(id).length).toBeGreaterThan(0);
    }
    const fallback = toolIconPath('not-a-drawing-tool');
    for (const id of CATALOG_IDS) {
      expect(toolIconPath(id)).not.toBe(fallback);
    }
    expect(new Set(CATALOG_IDS.map((id) => toolIconPath(id))).size).toBe(CATALOG_IDS.length);
  });

  it('keeps gann, fib, pitchfork, and rect glyphs distinct', () => {
    const ids = ['gannFan', 'fib', 'pitchfork', 'rect', 'gannBox', 'gannSquare'] as const;
    const paths = ids.map((id) => toolIconPath(id));
    expect(new Set(paths).size).toBe(ids.length);
  });

  it('draws the select cursor as a filled pointer clear of the flyout corner', () => {
    const cursor = toolIconPath('cursor');
    expect(cursor).toBe(
      'M2.2 1.5 L2.2 11.2 L5.15 8.35 L7.7 12.85 L9.55 11.9 L6.95 7.35 L10.7 7.05 Z',
    );
    expect(cursor).not.toContain('13.8');
  });

  it('separates cursor from eraser and trend from ray from extend', () => {
    expect(toolIconPath('cursor')).not.toBe(toolIconPath('eraser'));
    const trend = toolIconPath('trend');
    const ray = toolIconPath('ray');
    const extend = toolIconPath('extend');
    expect(trend).not.toBe(ray);
    expect(ray).not.toBe(extend);
    expect(trend).not.toBe(extend);
  });
});
