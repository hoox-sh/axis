/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Results equity curve uses semantic market tokens, not accent/red literals.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe('equity curve market tokens', () => {
  it('points fills at --color-up and --color-down', () => {
    const chart = readFileSync(join(root, 'src/ui/EquityChart.tsx'), 'utf8');
    expect(chart).toContain('stop-color="var(--color-up)"');
    expect(chart).toContain('stop-color="var(--color-down)"');
    expect(chart).toContain('stop-opacity="0.34"');
    expect(chart).toContain('stop-opacity="0.30"');
    expect(chart).toContain('stop-opacity="0.02"');
    expect(chart).not.toContain('stop-color="var(--color-accent-2)"');
    expect(chart).not.toContain('stop-color="var(--color-red)"');
  });

  it('points the equity rules at border, up, down, and mono', () => {
    const css = readFileSync(join(root, 'src/ui/studio/studio.css'), 'utf8');
    const zero = rule(css, '.ax-equity-zero');
    const pos = rule(css, '.ax-equity-line-pos');
    const neg = rule(css, '.ax-equity-line-neg');
    const dd = rule(css, '.ax-equity-dd');
    const axis = rule(css, '.ax-equity-axis');
    const tipVal = rule(css, '.ax-equity-tip-val');
    const tipDd = rule(css, '.ax-equity-tip-dd');

    expect(zero).toContain('stroke: var(--color-border)');
    expect(zero).toContain('stroke-dasharray: 3 3');
    expect(pos).toContain('stroke: var(--color-up)');
    expect(neg).toContain('stroke: var(--color-down)');
    expect(dd).toContain('fill: var(--color-down)');
    expect(dd).toContain('opacity: 0.12');
    expect(axis).toContain('font-family: var(--font-mono)');
    expect(tipVal).toContain('font-family: var(--font-mono)');
    expect(tipDd).toContain('color: var(--color-down)');
    expect(axis).not.toContain('ui-monospace');
    expect(tipVal).not.toContain('ui-monospace');
  });
});
