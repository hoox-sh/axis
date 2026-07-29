// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Floating panel drop-zone hit testing and dock mapping.
 * Invariant: edge hits → dock side; center → float; chrome defaults for PANEL_META.
 */

import { describe, expect, it } from 'bun:test';
import { hitDropZone, dropZoneToDock, skeletonSize } from '../src/ui/panels/drop-zones.ts';
import { defaultPanelChromeMap, PANEL_META } from '../src/ui/panels/types.ts';

describe('hitDropZone', () => {
  const vw = 1000;
  const vh = 800;

  it('hits left / right / bottom edges', () => {
    expect(hitDropZone(20, 400, vw, vh)).toBe('left');
    expect(hitDropZone(980, 400, vw, vh)).toBe('right');
    expect(hitDropZone(500, 780, vw, vh)).toBe('bottom');
  });

  it('center is float', () => {
    expect(hitDropZone(500, 400, vw, vh)).toBe('float');
  });

  it('maps zones to dock', () => {
    expect(dropZoneToDock('left')).toBe('left');
    expect(dropZoneToDock('float')).toBe('float');
    expect(dropZoneToDock(null)).toBe('float');
  });

  it('skeleton sizes differ by dock', () => {
    const L = skeletonSize('left', 200, 300, vw, vh);
    const B = skeletonSize('bottom', 200, 300, vw, vh);
    const F = skeletonSize('float', 200, 300, vw, vh);
    expect(L.h).toBeGreaterThan(B.h);
    expect(B.w).toBeGreaterThan(L.w);
    expect(F.w).toBeLessThanOrEqual(200);
  });
});

describe('defaultPanelChromeMap', () => {
  it('has all panel ids', () => {
    const m = defaultPanelChromeMap();
    for (const id of Object.keys(PANEL_META)) {
      expect(m[id as keyof typeof m]).toBeDefined();
      expect(m[id as keyof typeof m].dock).toBeTruthy();
    }
  });
});
