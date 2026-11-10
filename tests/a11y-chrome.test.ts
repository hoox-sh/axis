/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * A11y chrome: skip-link / main landmark, faint+accent 4.5:1 first-paint
 * tokens, and :focus-visible rings (no outline:none without a replacement).
 */

import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contrastRatioHex, TEXT_CONTRAST_MIN } from '../src/theme';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('skip-link and main landmark', () => {
  it('PWA index ships a skip-link to #axis-main outside #app', () => {
    const html = read('index.html');
    expect(html).toContain('class="axis-skip-link"');
    expect(html).toContain('href="#axis-main"');
    expect(html).toContain('<div id="app"></div>');
    const skipAt = html.indexOf('axis-skip-link');
    const appAt = html.indexOf('id="app"');
    expect(skipAt).toBeGreaterThan(0);
    expect(skipAt).toBeLessThan(appAt);
    expect(html).toContain('<noscript>');
    expect(html).toContain('<h1>AXIS</h1>');
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    const headerAt = html.indexOf('<header');
    expect(headerAt).toBeGreaterThan(0);
    expect(headerAt).toBeLessThan(appAt);
  });

  it('App workspace and editor popout expose #axis-main', () => {
    const app = read('src/app.tsx');
    const editor = read('src/editor/EditorApp.tsx');
    expect(app).toMatch(/<main[\s\S]*id="axis-main"/);
    expect(editor).toMatch(/<main[\s\S]*id="axis-main"/);
  });
});

describe('first-paint faint / accent contrast', () => {
  const css = read('src/index.css');

  it('dark and light tokens clear 4.5:1 on their bases', () => {
    expect(css).toMatch(/--color-text-faint:\s*#737b8a/);
    expect(css).toMatch(/--color-text-faint:\s*#636b7a/);
    expect(css).toMatch(/\[data-theme='light'\][\s\S]*--color-accent:\s*#4a59c4/);

    const darkFaint = contrastRatioHex('#737b8a', '#07080c');
    const darkFaintPanel = contrastRatioHex('#737b8a', '#0c0e14');
    const lightFaint = contrastRatioHex('#636b7a', '#f3f4f8');
    const lightFaintPanel = contrastRatioHex('#636b7a', '#eaebf1');
    const lightAccent = contrastRatioHex('#4a59c4', '#f3f4f8');
    const lightAccentPanel = contrastRatioHex('#4a59c4', '#eaebf1');
    for (const [name, ratio] of [
      ['dark faint/base', darkFaint],
      ['dark faint/panel', darkFaintPanel],
      ['light faint/base', lightFaint],
      ['light faint/panel', lightFaintPanel],
      ['light accent/base', lightAccent],
      ['light accent/panel', lightAccentPanel],
    ] as const) {
      expect(ratio, name).not.toBeNull();
      expect(ratio!, `${name} = ${ratio}`).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
    }
  });
});

const SHELL_OWNED = [
  '--bare',
  'axis-tb-field-control',
  'axis-color-swatch-input',
  'ax-color-input-text',
  "ax-color-input-swatch input[type='color']",
  'ax-color-input-swatch input[type="color"]',
];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(css: string): { sel: string; body: string }[] {
  const rules: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const cleaned = stripComments(css);
  for (const m of cleaned.matchAll(re)) {
    rules.push({ sel: m[1]!.trim(), body: m[2]! });
  }
  return rules;
}

function hasRing(body: string): boolean {
  const outline = /outline\s*:\s*(?!none\b)[^;]+/i.test(body);
  const shadow = /box-shadow\s*:\s*(?!none\b)[^;]+/i.test(body);
  return outline || shadow;
}

function killsOutline(body: string): boolean {
  return /outline\s*:\s*none\b/i.test(body);
}

function isShellOwned(selector: string): boolean {
  return SHELL_OWNED.some((s) => selector.includes(s));
}

function listCssFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) listCssFiles(p, acc);
    else if (name.name.endsWith('.css')) acc.push(p);
  }
  return acc;
}

describe('focus-visible rings', () => {
  it('does not leave :focus-visible { outline: none } without a ring', () => {
    const files = [join(ROOT, 'src/index.css'), ...listCssFiles(join(ROOT, 'src/ui'))];
    const missing: string[] = [];

    for (const file of files) {
      const rules = parseRules(readFileSync(file, 'utf8'));
      const focusSels = new Set<string>();
      for (const rule of rules) {
        for (const part of rule.sel.split(',').map((s) => s.trim())) {
          if (part.includes(':focus-visible')) focusSels.add(part);
        }
      }
      for (const sel of focusSels) {
        if (isShellOwned(sel)) continue;
        const bodies = rules
          .filter((r) =>
            r.sel
              .split(',')
              .map((s) => s.trim())
              .includes(sel),
          )
          .map((r) => r.body);
        const kills = bodies.some(killsOutline);
        if (!kills) continue;
        if (bodies.some(hasRing)) continue;
        missing.push(`${relative(ROOT, file)} :: ${sel}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
