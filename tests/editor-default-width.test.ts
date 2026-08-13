/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { defaultEditorWidthPx } from '../src/store';

describe('defaultEditorWidthPx', () => {
  it('is half the viewport, clamped to 1…90%', () => {
    expect(defaultEditorWidthPx(1000)).toBe(500);
    expect(defaultEditorWidthPx(800)).toBe(400);
    expect(defaultEditorWidthPx(2)).toBe(1); // half=1, max=1
  });

  it('falls back when viewport is invalid', () => {
    const w = defaultEditorWidthPx(Number.NaN);
    expect(w).toBeGreaterThan(0);
    expect(w).toBe(defaultEditorWidthPx(1280)); // 640
  });
});
