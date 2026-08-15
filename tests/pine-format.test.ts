/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { formatPineSource, pineSourceNeedsFormat } from '../src/editor/pine-format';

describe('formatPineSource', () => {
  it('normalizes indent to 4 spaces and trims trailing space', () => {
    const src = 'indicator("t")  \n  plot(close)\n';
    expect(formatPineSource(src)).toBe('indicator("t")\n    plot(close)\n');
  });

  it('keeps //@version at column 0', () => {
    const src = '  //@version=5\nindicator("t")\n';
    expect(formatPineSource(src)).toBe('//@version=5\nindicator("t")\n');
  });

  it('aligns else with if', () => {
    const src = 'if close > open\n    plot(1)\n        else\n    plot(0)\n';
    const out = formatPineSource(src);
    expect(out).toContain('if close > open\n');
    expect(out).toMatch(/^else$/m);
  });

  it('collapses excess blank lines and ensures trailing newline', () => {
    const src = 'plot(close)\n\n\n\nplot(open)';
    expect(formatPineSource(src)).toBe('plot(close)\n\nplot(open)\n');
  });

  it('expands tabs', () => {
    expect(formatPineSource('\tplot(close)\n')).toBe('    plot(close)\n');
  });

  it('does not reindent the body of a multiline string', () => {
    const src = 'msg = "hello\n    world"\nplot(close)\n';
    expect(formatPineSource(src)).toBe(src);
  });

  it('pineSourceNeedsFormat detects change', () => {
    expect(pineSourceNeedsFormat('plot(close)  \n')).toBe(true);
    const clean = formatPineSource('plot(close)\n');
    expect(pineSourceNeedsFormat(clean)).toBe(false);
  });
});
