/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Phase 4 UX polish — source-level pins for theme tokens, safe-area /
 * motion CSS variables, coarse-pointer topbar targets, and compositor-only
 * drawing-rail transitions.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

/** First `{ … }` body after `selector {` (non-nested rules). */
function ruleBody(css: string, selector: string): string {
  const needle = `${selector} {`;
  const start = css.indexOf(needle);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open + 1);
  if (open < 0 || close < 0) return '';
  return css.slice(open + 1, close);
}

/** Brace-matched body of the first `@media (query)` block. */
function mediaBlock(css: string, query: string): string {
  const re = new RegExp(`@media\\s*\\(\\s*${query}\\s*\\)\\s*\\{`);
  const m = css.match(re);
  if (!m || m.index == null) return '';
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

describe('ChartScaleControls theme tokens', () => {
  const src = read('src/chart/ChartScaleControls.tsx');

  it('has no leftover hard-coded hex colors', () => {
    expect(src).not.toMatch(/#1C2230/i);
    expect(src).not.toMatch(/#8B9CFF/i);
    expect(src).not.toMatch(/#9AA3B2/i);
    expect(src).not.toMatch(/#E8EAEE/i);
    expect(src).not.toMatch(/#0C0E14/i);
  });

  it('uses theme color tokens', () => {
    expect(src).toContain('var(--color-border)');
    expect(src).toContain('var(--color-accent)');
  });
});

describe('index.css Phase 4 tokens', () => {
  const css = read('src/index.css');

  it('defines safe-area inset tokens', () => {
    expect(css).toContain('--ui-safe-top');
    expect(css).toContain('--ui-safe-bottom');
    expect(css).toContain('--ui-safe-left');
    expect(css).toContain('--ui-safe-right');
  });

  it('defines a fast motion-duration token', () => {
    expect(css).toContain('--ui-motion-duration-fast');
  });

  it('sizes coarse-pointer topbar buttons', () => {
    const coarse = mediaBlock(css, 'pointer:\\s*coarse');
    expect(coarse).toContain('.axis-command-bar .sc-btn');
  });

  it('keeps .axis-draw-rail transition compositor-only', () => {
    const body = ruleBody(css, '.axis-draw-rail');
    const trans = body.match(/transition\s*:\s*([^;]+)/);
    expect(trans?.[1]).toBeTruthy();
    expect(trans?.[1] ?? '').not.toMatch(/max-height|max-width/);
  });
});
