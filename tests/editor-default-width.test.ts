/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { defaultEditorWidthPx } from '../src/store';

describe('defaultEditorWidthPx', () => {
  it('prefers 360–420 when the viewport can host it', () => {
    expect(defaultEditorWidthPx(1000)).toBe(360);
    expect(defaultEditorWidthPx(1280)).toBe(384);
    expect(defaultEditorWidthPx(1920)).toBe(420);
  });

  it('keeps 1…90% safety on viewports too narrow for 360px', () => {
    expect(defaultEditorWidthPx(2)).toBe(1); // 30% rounds to 1, max=1
    expect(defaultEditorWidthPx(300)).toBe(90);
  });

  it('falls back when viewport is invalid', () => {
    const w = defaultEditorWidthPx(Number.NaN);
    expect(w).toBeGreaterThan(0);
    expect(w).toBe(defaultEditorWidthPx(1280)); // 384
  });
});
