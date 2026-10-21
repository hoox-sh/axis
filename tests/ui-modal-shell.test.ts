// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shared modal shell.
 *
 * Six dialogs carried the same chrome — backdrop, accent, header (title,
 * hint, close), body, footer — each with its own copy of the focus trap, the
 * Escape handling and the backdrop dismiss. One of them (the shortcuts modal)
 * had `aria-modal="true"` and **no** focus trap.
 *
 * This test pins the consolidation: the dialogs use the shared shell, and the
 * shell is the only place that renders the dialog chrome.
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

/** The six dialogs that share the shell. */
const DIALOGS = [
  'src/ui/AboutModal.tsx',
  'src/ui/SymbolModal.tsx',
  'src/ui/ScriptSettingsModal.tsx',
  'src/ui/CachedDatasetsModal.tsx',
  'src/ui/shortcuts/ShortcutsModal.tsx',
  'src/ui/StorageChangeDialog.tsx',
] as const;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

describe('shared modal shell', () => {
  it('every dialog uses the shared Modal', () => {
    for (const rel of DIALOGS) {
      const src = read(rel);
      expect(src.includes("from './Modal'") || src.includes("from '../Modal'")).toBe(true);
    }
  });

  it('no dialog hand-rolls the dialog chrome', () => {
    for (const rel of DIALOGS) {
      const src = read(rel);
      // The chrome belongs to the shared shell.
      expect(src).not.toContain('sc-dialog-header');
      expect(src).not.toContain('sc-dialog-accent');
      expect(src).not.toContain('class="sc-dialog-backdrop"');
    }
  });

  it('no dialog installs its own Escape listener', () => {
    for (const rel of DIALOGS) {
      const src = read(rel);
      expect(src).not.toContain("addEventListener('keydown'");
    }
  });

  it('no dialog installs its own focus trap', () => {
    for (const rel of DIALOGS) {
      const src = read(rel);
      expect(src).not.toContain('installFocusTrap');
    }
  });

  it('the shell owns the chrome and the focus trap', () => {
    const src = read('src/ui/Modal.tsx');
    expect(src).toContain('sc-dialog-backdrop');
    expect(src).toContain('sc-dialog-accent');
    expect(src).toContain('sc-dialog-header');
    expect(src).toContain('sc-dialog-body');
    expect(src).toContain('sc-dialog-footer');
    expect(src).toContain('installFocusTrap');
    expect(src).toContain('useEventListener');
  });
});
