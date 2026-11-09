// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Status-bar HUD inspector: click/keyboard only. Hover never opens a container.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reduceHudInspector } from '../src/ui/hud-model';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('reduceHudInspector', () => {
  it('opens a chip on toggle from closed', () => {
    expect(reduceHudInspector(null, { type: 'toggle', id: 'live' })).toBe('live');
  });

  it('closes the same chip on a second toggle', () => {
    expect(reduceHudInspector('live', { type: 'toggle', id: 'live' })).toBe(null);
  });

  it('switches chips without a hover step', () => {
    expect(reduceHudInspector('live', { type: 'toggle', id: 'tick' })).toBe('tick');
  });

  it('close always clears', () => {
    expect(reduceHudInspector('eng', { type: 'close' })).toBe(null);
    expect(reduceHudInspector(null, { type: 'close' })).toBe(null);
  });
});

describe('scanline source contract', () => {
  it('ConnectionHud has no hover-open inspector', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).not.toContain('onMouseEnter');
    expect(src).not.toContain('onMouseLeave');
    expect(src).not.toContain('scheduleClose');
    expect(src).not.toContain('useStickyInfo');
    expect(src).not.toContain('hover bridge');
    expect(src).not.toContain('axis-hud-pin');
    expect(src).not.toContain('Hover for info');
    expect(src).not.toContain('getBoundingClientRect');
  });

  it('ConnectionHud Last and Live follow current symbol and stream arm', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).toContain('lastTickForSymbol');
    expect(src).toContain('readLiveArm');
    expect(src).toContain('displayedLastPrice');
  });

  it('ConnectionHud click-opens the shared Popover above the rail', () => {
    const src = read('src/ui/ConnectionHud.tsx');
    expect(src).toContain("from './Popover'");
    expect(src).toContain('side="top"');
    expect(src).toContain('reduceHudInspector');
    expect(src).toContain('role="dialog"');
    expect(src).toContain('axis-hud-info');
    expect(src).toContain('Click a chip for details');
  });

  it('StatusBar documents the scanline (no hover-gated HUD)', () => {
    const src = read('src/ui/StatusBar.tsx');
    expect(src).toMatch(/scanline/i);
    expect(src).toContain('There is no hover-open');
    expect(src).toContain("data-testid=\"axis-statusbar\"");
    expect(src).toContain("data-testid=\"axis-statusbar-bars\"");
    expect(src).toContain("data-testid=\"axis-statusbar-dataset\"");
  });

  it('Popover can pin above the anchor', () => {
    const src = read('src/ui/Popover.tsx');
    expect(src).toContain("side?: 'top' | 'bottom'");
    expect(src).toContain("props.side === 'top'");
  });
});
