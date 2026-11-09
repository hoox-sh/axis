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

describe('shared chrome control feedback', () => {
  const css = read('src/index.css');
  const studio = read('src/ui/studio/studio.css');
  const apply = read('src/theme/apply.ts');

  it('exposes press, inset-focus, disabled, busy, and status-strip tokens', () => {
    expect(css).toContain('--ui-focus-ring-inset:');
    expect(css).toContain('--ui-press-y:');
    expect(css).toContain('--ui-disabled-opacity:');
    expect(css).toContain('--ui-busy-opacity:');
    expect(css).toContain('--ui-capsule-h:');
    expect(css).toContain('--ui-statusbar-gap:');
    expect(css).toContain('--ui-statusbar-pad-x:');
    expect(apply).toContain("'--ui-focus-ring-inset'");
  });

  it('presses .sc-btn 1px without a scale bounce', () => {
    const body = ruleBody(
      css,
      ".sc-btn:active:not(:disabled, [aria-disabled='true'], [aria-busy='true'], .is-loading)",
    );
    expect(body).toContain('translateY(var(--ui-press-y))');
    expect(body).not.toMatch(/scale\(/);
  });

  it('keeps focus rings in-box (outline-offset -1px / inset shadow)', () => {
    const btn = ruleBody(css, '.sc-btn:focus-visible');
    expect(btn).toContain('outline-offset: -1px');
    expect(btn).toContain('var(--ui-focus-ring-inset)');
    const input = ruleBody(css, '.sc-input:focus-visible');
    expect(input).toContain('var(--ui-focus-ring-inset)');
    expect(input).not.toContain('outline-offset: 2px');
  });

  it('dims disabled / busy controls with wait/not-allowed cursors', () => {
    const disabled = ruleBody(css, ".sc-btn[aria-disabled='true']");
    expect(disabled).toContain('var(--ui-disabled-opacity)');
    expect(disabled).toContain('not-allowed');
    const inputOff = ruleBody(css, ".sc-input[aria-disabled='true']");
    expect(inputOff).toContain('var(--ui-disabled-opacity)');
    const busy = ruleBody(css, ".sc-btn[aria-busy='true']");
    expect(busy).toContain('var(--ui-busy-opacity)');
    expect(busy).toContain('cursor: wait');
  });

  it('selects chips with an inset ring instead of a border-color swap', () => {
    const on = ruleBody(css, '.sc-chip.is-active');
    expect(on).toContain('var(--ui-focus-ring-inset)');
    expect(on).not.toContain('border-color: var(--color-accent)');
    const idle = ruleBody(css, '.sc-chip');
    expect(idle).toContain('border: var(--border-w-input) solid var(--color-border-soft)');
    expect(idle).toContain('font-weight: 500');
  });

  it('floors capsule type at 10px and sizes the strip from tokens', () => {
    const bar = ruleBody(css, '.axis-statusbar');
    expect(bar).toContain('gap: var(--ui-statusbar-gap)');
    expect(bar).toContain('padding: 0 var(--ui-statusbar-pad-x)');
    const cap = ruleBody(css, '.axis-status-capsule');
    expect(cap).toContain('height: var(--ui-capsule-h)');
    expect(cap).toContain('max(10px, calc(10px * var(--ui-scale)))');
  });

  it('does not resurrect a HUD hover-bridge rule', () => {
    expect(css).not.toMatch(/\.axis-hud-info:hover/);
    expect(css).not.toMatch(/hover-bridge/);
  });

  it('aligns studio chip press and selected state to the same 1px language', () => {
    const press = ruleBody(studio, '.ax-chip:active:not(:disabled)');
    expect(press).toContain('translateY(var(--ui-press-y, 1px))');
    expect(press).not.toMatch(/scale\(/);
    const on = ruleBody(studio, ".ax-chip[aria-selected='true']");
    expect(on).toContain('var(--ui-focus-ring-inset');
    expect(on).toContain('border-color: var(--color-border)');
  });

  it('collapses interactive chrome transitions under reduced motion', () => {
    const reduce = mediaBlock(css, 'prefers-reduced-motion:\\s*reduce');
    expect(reduce).toContain('--ui-motion-duration-fast: 0.01ms');
    expect(reduce).toContain('.sc-btn:active');
    expect(reduce).toContain('transform: none');
  });
});
