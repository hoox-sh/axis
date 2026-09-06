// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure shortcut chord parser / formatter / matcher + registry helpers.
 */

import { describe, expect, it } from 'bun:test';
import {
  detectConflicts,
  formatChord,
  getDefaultChord,
  getDisplay,
  matchEvent,
  normalizeChord,
  parseChord,
  resolveBinding,
} from '../src/ui/shortcuts';
import type { ShortcutDef } from '../src/ui/shortcuts';

describe('parseChord', () => {
  it('expands Mod to ctrl on win/linux and meta on mac', () => {
    const linux = parseChord('Mod-Shift-K', 'linux');
    expect(linux.key).toBe('k');
    expect(linux.mod).toBe(true);
    expect(linux.shift).toBe(true);
    expect(linux.ctrl).toBe(true);
    expect(linux.meta).toBe(false);

    const mac = parseChord('Mod-Shift-K', 'mac');
    expect(mac.key).toBe('k');
    expect(mac.mod).toBe(true);
    expect(mac.shift).toBe(true);
    expect(mac.meta).toBe(true);
    expect(mac.ctrl).toBe(false);
  });

  it('parses Mod-/ with a slash key', () => {
    const c = parseChord('Mod-/', 'linux');
    expect(c.key).toBe('/');
    expect(c.mod).toBe(true);
    expect(c.ctrl).toBe(true);
    expect(c.shift).toBe(false);
    expect(c.alt).toBe(false);
  });

  it('parses Alt-Up as ArrowUp', () => {
    const c = parseChord('Alt-Up', 'linux');
    expect(c.key).toBe('ArrowUp');
    expect(c.alt).toBe(true);
  });

  it('parses Shift-? as a literal question mark', () => {
    const c = parseChord('Shift-?', 'linux');
    expect(c.key).toBe('?');
    expect(c.shift).toBe(true);
  });

  it('throws on empty chord', () => {
    expect(() => parseChord('', 'linux')).toThrow(/Invalid chord/);
  });

  it('throws on unknown modifier', () => {
    expect(() => parseChord('Foo-K', 'linux')).toThrow(/Invalid chord/);
  });

  it('throws when only modifiers are present', () => {
    expect(() => parseChord('Mod-Shift', 'linux')).toThrow(/missing key/);
  });
});

describe('formatChord', () => {
  it('formats mac glyphs', () => {
    expect(formatChord('Mod-Shift-K', { platform: 'mac' })).toBe('⌘⇧K');
  });

  it('formats win/linux text', () => {
    expect(formatChord('Mod-Shift-K', { platform: 'win' })).toBe('Ctrl+Shift+K');
  });

  it('formats a bare key without modifiers', () => {
    expect(formatChord('L', { platform: 'win' })).toBe('L');
  });
});

describe('matchEvent', () => {
  it('matches Mod-Shift-K on linux with ctrl', () => {
    expect(
      matchEvent(
        { key: 'k', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false },
        'Mod-Shift-K',
      ),
    ).toBe(true);
  });

  it('does not match Mod-Shift-K with meta on linux', () => {
    expect(
      matchEvent(
        { key: 'k', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false },
        'Mod-Shift-K',
      ),
    ).toBe(false);
  });

  it('matches Mod-/ via code fallback', () => {
    expect(
      matchEvent(
        { key: '/', code: 'Slash', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        'Mod-/',
      ),
    ).toBe(true);
  });

  it('matches Mod-A via code fallback', () => {
    expect(
      matchEvent(
        { code: 'KeyA', key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        'Mod-A',
      ),
    ).toBe(true);
  });

  it('requires exact modifier state', () => {
    // Mod-K should not fire when Shift is also held
    expect(
      matchEvent(
        { key: 'k', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false },
        'Mod-K',
      ),
    ).toBe(false);
  });
});

describe('normalizeChord', () => {
  it('canonicalizes casing and modifier order', () => {
    expect(normalizeChord('mod-shift-k')).toBe('Mod-Shift-K');
  });

  it('normalizes key aliases', () => {
    expect(normalizeChord('alt-up')).toBe('Alt-ArrowUp');
  });
});

describe('detectConflicts', () => {
  it('finds overlapping chords', () => {
    const bindings: ShortcutDef[] = [
      { id: 'chart.tool-trend', chord: 'L', description: 'Trend', scope: 'chart' },
      { id: 'chart.tool-fib', chord: 'L', description: 'Fib', scope: 'chart' },
    ];
    const conflicts = detectConflicts(bindings, {});
    expect(conflicts.get('L')).toEqual(['chart.tool-trend', 'chart.tool-fib']);
  });

  it('ignores cleared bindings', () => {
    const bindings: ShortcutDef[] = [
      { id: 'chart.tool-trend', chord: 'L', description: 'Trend', scope: 'chart' },
      { id: 'chart.tool-fib', chord: 'L', description: 'Fib', scope: 'chart' },
    ];
    const conflicts = detectConflicts(bindings, { 'chart.tool-fib': null });
    expect(conflicts.size).toBe(0);
  });
});

describe('resolveBinding', () => {
  it('returns null when override clears a binding', () => {
    const def: ShortcutDef = { id: 'app.save', chord: 'Mod-S', description: 'Save', scope: 'app' };
    expect(resolveBinding(def, { 'app.save': null })).toBeNull();
  });

  it('returns override when set', () => {
    const def: ShortcutDef = { id: 'app.save', chord: 'Mod-S', description: 'Save', scope: 'app' };
    expect(resolveBinding(def, { 'app.save': 'Mod-Shift-S' })).toBe('Mod-Shift-S');
  });

  it('returns default when no override', () => {
    const def: ShortcutDef = { id: 'app.save', chord: 'Mod-S', description: 'Save', scope: 'app' };
    expect(resolveBinding(def, {})).toBe('Mod-S');
  });
});

describe('getDisplay', () => {
  it('formats default and override', () => {
    expect(getDisplay('app.save', {}, 'win')).toBe('Ctrl+S');
    expect(getDisplay('app.save', { 'app.save': 'Mod-Shift-S' }, 'win')).toBe('Ctrl+Shift+S');
  });

  it('returns empty for unknown id', () => {
    expect(getDisplay('palette.recent', {}, 'win')).toBe('');
  });
});

describe('getDefaultChord', () => {
  it('returns the default chord for a known id', () => {
    expect(getDefaultChord('app.open-palette')).toBe('Mod-K');
    expect(getDefaultChord('chart.tool-trend')).toBe('L');
  });

  it('returns undefined for palette-only ids', () => {
    expect(getDefaultChord('palette.recent')).toBeUndefined();
  });
});

describe('useRecordChord', () => {
  let listeners: Set<(e: KeyboardEvent) => void>;
  let origWindow: unknown;

  const installWindowStub = () => {
    listeners = new Set();
    origWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window: unknown }).window = {
      addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
        if (type === 'keydown') listeners.add(fn);
      },
      removeEventListener: (type: string, fn: (e: KeyboardEvent) => void) => {
        if (type === 'keydown') listeners.delete(fn);
      },
    };
  };

  const restoreWindow = () => {
    if (origWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window: unknown }).window = origWindow;
  };

  const fire = (e: Partial<KeyboardEvent>) => {
    for (const fn of [...listeners]) fn(e as KeyboardEvent);
  };

  it('records the next keydown as a canonical chord', async () => {
    installWindowStub();
    try {
      const { useRecordChord } = await import('../src/ui/shortcuts/use-record-chord');
      let recorded = '';
      const api = useRecordChord((chord) => {
        recorded = chord;
      });
      api.start();
      expect(api.recording()).toBe(true);
      fire({
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      } as Partial<KeyboardEvent>);
      expect(recorded).toBe('Mod-K');
      expect(api.recording()).toBe(false);
    } finally {
      restoreWindow();
    }
  });

  it('does not listen outside an active recording session', async () => {
    installWindowStub();
    try {
      const { useRecordChord } = await import('../src/ui/shortcuts/use-record-chord');
      let recorded = '';
      const api = useRecordChord((chord) => {
        recorded = chord;
      });
      // No start() — a keydown must not be captured
      fire({
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      } as Partial<KeyboardEvent>);
      expect(recorded).toBe('');
      expect(api.recording()).toBe(false);
    } finally {
      restoreWindow();
    }
  });
});