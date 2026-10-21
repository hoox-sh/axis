// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared popover shell.
 *
 * Four menus carried the same skeleton: an open flag, an anchor element, a
 * measure-and-clamp placement, a resize/scroll reposition, an outside-click
 * dismiss, an Escape handler and a portalled element. Two of them had drifted
 * — one dismissed on `mousedown` where the others used `pointerdown`, and one
 * hand-rolled the outside check the shared helper already provided.
 *
 * This test pins the consolidation.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/** The menus that share the shell. The context menu is pointer-positioned. */
const POPOVERS = [
  'src/ui/ChartLayoutMenu.tsx',
  'src/ui/ScreenshotMenu.tsx',
  'src/ui/extras/ExtraMenu.tsx',
  'src/ui/RunSplitButton.tsx',
] as const;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('shared popover shell', () => {
  it('every menu uses the shared Popover', () => {
    for (const rel of POPOVERS) {
      const src = read(rel);
      expect(src.includes("from './Popover'") || src.includes("from '../Popover'")).toBe(true);
    }
  });

  it('no menu hand-rolls the placement', () => {
    for (const rel of POPOVERS) {
      const src = read(rel);
      expect(src).not.toContain('getBoundingClientRect');
      expect(src).not.toMatch(/const place(Menu|Panel)\b/);
    }
  });

  it('no menu hand-rolls the outside dismiss', () => {
    for (const rel of POPOVERS) {
      const src = read(rel);
      expect(src).not.toContain('dismissOnOutside');
      expect(src).not.toContain("addEventListener('mousedown'");
    }
  });

  it('no menu hand-rolls the reposition listeners', () => {
    for (const rel of POPOVERS) {
      const src = read(rel);
      expect(src).not.toContain("addEventListener('resize'");
      expect(src).not.toContain("addEventListener('scroll'");
    }
  });

  it('the shell owns the placement, the dismiss and the portalling', () => {
    const src = read('src/ui/Popover.tsx');
    expect(src).toContain('getBoundingClientRect');
    expect(src).toContain('dismissOnOutside');
    expect(src).toContain('Portal');
    expect(src).toContain("addEventListener('resize'");
    expect(src).toContain("addEventListener('scroll'");
  });
});
