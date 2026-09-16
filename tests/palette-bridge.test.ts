/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, afterEach } from 'bun:test';
import {
  closePalette,
  getPaletteIntent,
  isPaletteOpen,
  openBuiltinPicker,
  openPalette,
} from '../src/ui/shortcuts/palette-bridge';

afterEach(() => {
  closePalette();
});

describe('palette-bridge', () => {
  it('openPalette defaults to commands', () => {
    openPalette();
    expect(isPaletteOpen()).toBe(true);
    expect(getPaletteIntent()).toBe('commands');
  });

  it('openBuiltinPicker sets builtins intent', () => {
    openBuiltinPicker();
    expect(isPaletteOpen()).toBe(true);
    expect(getPaletteIntent()).toBe('builtins');
  });

  it('closePalette resets intent', () => {
    openBuiltinPicker();
    closePalette();
    expect(isPaletteOpen()).toBe(false);
    expect(getPaletteIntent()).toBe('commands');
  });
});
