// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `shortcutTitle` appends the registry display chord and never doubles it.
 * Pure — no store, no localStorage.
 */

import { describe, expect, it } from 'bun:test';
import { getDisplay } from '../src/ui/shortcuts';
import { shortcutTitle } from '../src/ui/shortcuts/title';

const LABEL = 'Toggle docked editor';

describe('shortcutTitle', () => {
  it('appends the linux display for app.toggle-editor', () => {
    const display = getDisplay('app.toggle-editor', {}, 'linux');
    expect(display).not.toBe('');
    expect(shortcutTitle(LABEL, 'app.toggle-editor', {}, 'linux')).toBe(`${LABEL} · ${display}`);
  });

  it('uses the mac display string from getDisplay', () => {
    const display = getDisplay('app.toggle-editor', {}, 'mac');
    expect(display).not.toBe('');
    expect(shortcutTitle(LABEL, 'app.toggle-editor', {}, 'mac')).toBe(`${LABEL} · ${display}`);
  });

  it('returns the label when the binding is cleared', () => {
    expect(
      shortcutTitle(LABEL, 'app.toggle-editor', { 'app.toggle-editor': null }, 'linux'),
    ).toBe(LABEL);
  });

  it('does not double the chord on an already-suffixed label', () => {
    const once = shortcutTitle(LABEL, 'app.toggle-editor', {}, 'linux');
    expect(shortcutTitle(once, 'app.toggle-editor', {}, 'linux')).toBe(once);
  });

  it('returns the label when getDisplay is empty', () => {
    const overrides = { 'app.toggle-editor': null };
    expect(getDisplay('app.toggle-editor', overrides, 'linux')).toBe('');
    expect(shortcutTitle(LABEL, 'app.toggle-editor', overrides, 'linux')).toBe(LABEL);
  });
});
