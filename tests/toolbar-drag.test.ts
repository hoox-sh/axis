/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Toolbar drag must track the pointer 1:1. resolve() deltas are measured
 * from gesture start, so resolving against the live position compounds every
 * move event (~2x pointer speed). The drag base is snapshotted at gesture
 * start (static anchor, no live signal) instead.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const src = readFileSync(join(root, 'src/chart/DrawingToolbar.tsx'), 'utf8');

describe('toolbar drag base', () => {
  it('resolves tool drags from the gesture-start snapshot, not live', () => {
    const block = src.slice(src.indexOf('const resolveToolPos'), src.indexOf('const onToolPointerDown'));
    expect(block).toContain('toolsDragBase');
    expect(block).not.toMatch(/railAnchor\(\)/);
  });

  it('resolves stylebar drags from the gesture-start snapshot, not live', () => {
    const block = src.slice(src.indexOf('const resolveStylePos'), src.indexOf('const onStylePointerDown'));
    expect(block).toContain('styleDragBase');
    expect(block).not.toMatch(/styleOrigin\(\)/);
  });

  it('snapshots the static anchor when a drag starts', () => {
    expect(src).toContain('toolsDragBase = on ? staticRailAnchor() : null');
    expect(src).toContain('styleDragBase = on ? staticStyleOrigin() : null');
  });
});
