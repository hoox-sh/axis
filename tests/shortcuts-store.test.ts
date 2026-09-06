// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Store slice for keyboard shortcut overrides — hydration, persistence,
 * and the set/reset helpers.
 */

import { describe, expect, it } from 'bun:test';
import {
  resetShortcuts,
  setShortcutOverride,
  store,
} from '../src/store';
import { parsePersistedState } from '../src/store';

describe('shortcuts store slice', () => {
  it('fresh state has empty overrides', () => {
    expect(store.shortcuts).toBeDefined();
    expect(store.shortcuts.overrides).toEqual({});
  });

  it('setShortcutOverride adds an entry', () => {
    setShortcutOverride('app.save', 'Mod-Shift-S');
    expect(store.shortcuts.overrides['app.save']).toBe('Mod-Shift-S');
  });

  it('setShortcutOverride with null clears the entry', () => {
    setShortcutOverride('app.save', null);
    expect(store.shortcuts.overrides['app.save']).toBeNull();
  });

  it('resetShortcuts clears all overrides', () => {
    setShortcutOverride('app.save', 'Mod-Shift-S');
    setShortcutOverride('chart.tool-trend', 'T');
    resetShortcuts();
    expect(store.shortcuts.overrides).toEqual({});
  });

  it('parsePersistedState hydrates shortcuts from a payload', () => {
    const overlay = parsePersistedState(
      JSON.stringify({ shortcuts: { overrides: { 'app.save': 'Mod-Shift-S' } } }),
    );
    expect(overlay?.shortcuts?.overrides['app.save']).toBe('Mod-Shift-S');
  });

  it('parsePersistedState tolerates missing / malformed shortcuts', () => {
    const empty = parsePersistedState(JSON.stringify({}));
    expect(empty?.shortcuts?.overrides).toEqual({});
    const bad = parsePersistedState(JSON.stringify({ shortcuts: 'nope' }));
    expect(bad?.shortcuts?.overrides).toEqual({});
  });
});