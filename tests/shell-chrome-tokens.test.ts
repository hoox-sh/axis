/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shell finish tokens — semantic market colors, figure font, and the
 * calm group / resize hairlines. Pins the contract in src/index.css.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '../src/index.css'), 'utf-8');

describe('void semantic tokens', () => {
  it('aliases market colors so light theme follows', () => {
    expect(css).toContain('--color-up: var(--color-green)');
    expect(css).toContain('--color-down: var(--color-red)');
    expect(css).toContain('--color-warning: var(--color-accent-3)');
    expect(css).toContain('--color-info: var(--color-cyan)');
  });

  it('names the chrome and figure fonts', () => {
    expect(css).toContain('--font-sans:');
    expect(css).toContain('--font-mono:');
    expect(css).toContain('font-family: var(--font-sans)');
  });

  it('gives the light theme a focus edge', () => {
    const light = css.split("[data-theme='light']")[1] ?? '';
    expect(light).toContain('--color-border-focus:');
  });
});

describe('shell hairlines', () => {
  it('uses a short command-bar group rule instead of a full border', () => {
    expect(css).toContain('.axis-command-bar [data-tb-group] + [data-tb-group]::before');
    expect(css).toMatch(/\[data-tb-group\] \+ \[data-tb-group\]::before \{[^}]*height: 16px/s);
  });

  it('draws a resting mark on vertical resize handles', () => {
    expect(css).toContain('.sc-resize-handle::after');
    expect(css).toContain('.sc-resize-handle:not(.absolute)');
  });
});
