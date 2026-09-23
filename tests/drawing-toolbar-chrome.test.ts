// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  autoStylebarPos,
  clampToHost,
  sanitizeToolbarDock,
  snapToolbarDock,
} from '../src/chart/drawings/toolbar/chrome.ts';

describe('drawing toolbar chrome', () => {
  it('snaps the left edge before the top edge', () => {
    expect(snapToolbarDock(8, 8)).toBe('left');
    expect(snapToolbarDock(35, 10)).toBe('left');
    expect(snapToolbarDock(80, 12)).toBe('top');
    expect(snapToolbarDock(39, 39)).toBe('top');
    expect(snapToolbarDock(120, 80)).toBe('float');
  });

  it('clamps a bar inside the host', () => {
    expect(clampToHost(-20, -4, 400, 300, 40, 200)).toEqual({ x: 0, y: 0 });
    expect(clampToHost(390, 280, 400, 300, 40, 40)).toEqual({ x: 360, y: 260 });
    expect(clampToHost(12, 40, 400, 300, 40, 40)).toEqual({ x: 12, y: 40 });
  });

  it('places the style bar beside a vertical rail and under a top dock', () => {
    expect(autoStylebarPos('left', { x: 8, y: 56, w: 44, h: 320 })).toEqual({ x: 60, y: 56 });
    expect(autoStylebarPos('float', { x: 100, y: 80, w: 44, h: 320 })).toEqual({ x: 152, y: 80 });
    expect(autoStylebarPos('top', { x: 8, y: 8, w: 360, h: 42 })).toEqual({ x: 8, y: 58 });
  });

  it('rejects an unknown dock', () => {
    expect(sanitizeToolbarDock('top')).toBe('top');
    expect(sanitizeToolbarDock('nope')).toBe('left');
    expect(sanitizeToolbarDock(undefined)).toBe('left');
  });
});
