/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing-rail titles read chords from the shortcut registry.
 * The selection cursor must not claim the crosshair key.
 */

import { describe, expect, it } from 'bun:test';
import { titleWithShortcut, toolChord } from '../src/chart/drawings/toolbar/shortcuts';
import { getDisplay } from '../src/ui/shortcuts/registry';

describe('drawing tool shortcuts', () => {
  it('shows the registry chord for trend on linux', () => {
    const display = getDisplay('chart.tool-trend', {}, 'linux');
    expect(display).toBe('L');
    expect(toolChord('trend', {}, 'linux')).toBe(display);
  });

  it('does not claim a chord for the selection cursor', () => {
    expect(toolChord('cursor', {}, 'linux')).toBe('');
  });

  it('drops the hint when the binding is cleared', () => {
    expect(toolChord('trend', { 'chart.tool-trend': null }, 'linux')).toBe('');
    expect(titleWithShortcut('Trend', '')).toBe('Trend');
  });

  it('appends a present shortcut in parentheses', () => {
    expect(titleWithShortcut('Trend', 'L')).toBe('Trend (L)');
  });

  it('resolves magnet and delete through the registry on linux', () => {
    const magnet = getDisplay('chart.tool-magnet', {}, 'linux');
    const del = getDisplay('chart.delete-selected', {}, 'linux');
    expect(magnet).not.toBe('');
    expect(del).not.toBe('');
    expect(magnet).toBe('W');
    expect(del).toBe('Delete');
  });
});
