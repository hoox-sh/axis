// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  SCRIPT_SETTINGS_COLLAPSED_KEY,
  readCollapsedGroups,
  toggleCollapsedGroup,
  writeCollapsedGroups,
} from '../src/ui/script-settings/prefs';
import { installMemoryLocalStorage } from './setup';

describe('script settings prefs', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it('reads an empty list when storage is empty', () => {
    expect(readCollapsedGroups()).toEqual([]);
  });

  it('write + read round-trips collapsed group names', () => {
    writeCollapsedGroups(['MA Settings', 'Strategy']);
    expect(readCollapsedGroups()).toEqual(['MA Settings', 'Strategy']);
    expect(JSON.parse(localStorage.getItem(SCRIPT_SETTINGS_COLLAPSED_KEY) ?? '[]')).toEqual([
      'MA Settings',
      'Strategy',
    ]);
  });

  it('toggles a group on and off in place', () => {
    writeCollapsedGroups(['A']);
    expect(toggleCollapsedGroup('B', readCollapsedGroups())).toEqual(['A', 'B']);
    expect(toggleCollapsedGroup('A', readCollapsedGroups())).toEqual(['B']);
  });

  it('ignores junk entries and caps the list', () => {
    const junk = Array.from({ length: 100 }, (_, i) => `g${i}`);
    writeCollapsedGroups([...junk, 42, null]);
    const read = readCollapsedGroups();
    expect(read.length).toBe(64);
    expect(read[0]).toBe('g0');
    expect(read).not.toContain(null);
  });

  it('clips over-long group ids', () => {
    writeCollapsedGroups(['x'.repeat(500)]);
    expect(readCollapsedGroups()[0].length).toBe(128);
  });
});
