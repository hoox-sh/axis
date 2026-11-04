// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import type { ScriptMeta } from '../src/plugins/types';
import { noteLibraryCommand, takeLibraryCommand } from '../src/ui/library/commands';
import {
  countScriptsByKind,
  filterPersonalScripts,
  kindChipClass,
  pinnedFirst,
  scriptMatchesQuery,
  shortRev,
  sortPersonalScripts,
  splitHighlight,
  suggestScriptName,
  visibleKindFilters,
} from '../src/ui/library/format';
import {
  clearRecentBuiltinIds,
  LIBRARY_FAVORITES_KEY,
  LIBRARY_RECENT_KEY,
  LIBRARY_RECENT_MAX,
  noteRecentBuiltinId,
  readFavoriteIds,
  readRecentBuiltinIds,
  toggleFavoriteId,
} from '../src/ui/library/prefs';
import { installMemoryLocalStorage } from './setup';

function script(partial: Partial<ScriptMeta> & Pick<ScriptMeta, 'id' | 'name'>): ScriptMeta {
  return { updatedAt: 0, ...partial };
}

describe('library format', () => {
  it('shortRev keeps short ids and clips long shas', () => {
    expect(shortRev(undefined)).toBe('');
    expect(shortRev('abc')).toBe('abc');
    expect(shortRev('0123456789abcdef')).toBe('0123456');
  });

  it('kindChipClass distinguishes strategy, library, and indicator', () => {
    expect(kindChipClass('strategy')).toContain('accent-2');
    expect(kindChipClass('indicator')).toContain('text-accent');
    expect(kindChipClass('library')).toContain('text-text-dim');
    expect(kindChipClass('unknown')).toContain('text-faint');
  });

  it('scriptMatchesQuery requires every word', () => {
    const item = script({
      id: 's1',
      name: 'RSI Cross',
      description: 'momentum',
      scriptKind: 'indicator',
      pineVersion: '6',
    });
    expect(scriptMatchesQuery(item, '')).toBe(true);
    expect(scriptMatchesQuery(item, 'rsi momentum')).toBe(true);
    expect(scriptMatchesQuery(item, 'rsi missing')).toBe(false);
  });

  it('filters by kind and sorts newest first without mutating the source', () => {
    const items = [
      script({ id: 'a', name: 'Alpha', scriptKind: 'indicator', updatedAt: 10 }),
      script({ id: 'b', name: 'Beta', scriptKind: 'strategy', updatedAt: 30 }),
      script({ id: 'c', name: 'Gamma', scriptKind: 'library', updatedAt: 20 }),
    ];
    expect(filterPersonalScripts(items, 'a', 'strategy').map((s) => s.id)).toEqual(['b']);
    const recent = sortPersonalScripts(items, 'recent');
    expect(recent.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(items.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(sortPersonalScripts(items, 'stored').map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('kind counts hide empty chips and surface unknown as Other', () => {
    const items = [
      script({ id: 'a', name: 'Alpha', scriptKind: 'indicator' }),
      script({ id: 'b', name: 'Beta' }),
    ];
    const counts = countScriptsByKind(items);
    expect(counts).toEqual({ all: 2, indicator: 1, strategy: 0, library: 0, unknown: 1 });
    expect(visibleKindFilters(counts).map((f) => f.id)).toEqual(['all', 'indicator', 'unknown']);
  });

  it('sorts alphabetically by name without mutating the source', () => {
    const items = [
      script({ id: 'b', name: 'Beta' }),
      script({ id: 'a', name: 'Alpha' }),
      script({ id: 'c', name: 'Gamma' }),
    ];
    expect(sortPersonalScripts(items, 'name').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(items.map((s) => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('pins favorites first while preserving the chosen order', () => {
    const items = [
      script({ id: 'a', name: 'Alpha' }),
      script({ id: 'b', name: 'Beta' }),
      script({ id: 'c', name: 'Gamma' }),
    ];
    expect(pinnedFirst(items, []).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(pinnedFirst(items, ['c', 'a']).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(items.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('suggests a script name from the Pine declaration', () => {
    expect(suggestScriptName('//@version=6\nindicator("RSI Cross")')).toBe('RSI Cross');
    expect(suggestScriptName('strategy(title="MACD Strat", overlay=true)')).toBe('MACD Strat');
    expect(suggestScriptName('library("Tools", "desc")')).toBe('Tools');
    expect(suggestScriptName('study("Old Study")')).toBe('Old Study');
    expect(suggestScriptName('indicator(shorttitle="x")')).toBe('');
    expect(suggestScriptName('')).toBe('');
  });
});

describe('highlight parts', () => {
  it('returns one plain part for an empty query', () => {
    expect(splitHighlight('RSI Cross', '')).toEqual([{ text: 'RSI Cross', match: false }]);
    expect(splitHighlight('', 'rsi')).toEqual([{ text: '', match: false }]);
  });

  it('marks every case-insensitive term and preserves the rest', () => {
    const parts = splitHighlight('RSI Cross momentum', 'rsi momentum');
    expect(parts).toEqual([
      { text: 'RSI', match: true },
      { text: ' Cross ', match: false },
      { text: 'momentum', match: true },
    ]);
  });

  it('escapes regex metacharacters in the query', () => {
    expect(splitHighlight('a+b (test)', 'a+b')).toEqual([
      { text: 'a+b', match: true },
      { text: ' (test)', match: false },
    ]);
  });
});

describe('library prefs', () => {
  it('toggles pins and persists them', () => {
    installMemoryLocalStorage();
    expect(readFavoriteIds()).toEqual([]);
    expect(toggleFavoriteId('rsi')).toEqual(['rsi']);
    expect(toggleFavoriteId('ema', ['rsi'])).toEqual(['ema', 'rsi']);
    expect(readFavoriteIds()).toEqual(['ema', 'rsi']);
    expect(toggleFavoriteId('rsi', ['ema', 'rsi'])).toEqual(['ema']);
    expect(readFavoriteIds()).toEqual(['ema']);
    expect(localStorage.getItem(LIBRARY_FAVORITES_KEY)).toContain('ema');
  });

  it('dedupes, caps, and clears recent built-ins', () => {
    installMemoryLocalStorage();
    for (let i = 0; i < LIBRARY_RECENT_MAX + 3; i++) noteRecentBuiltinId(`b${i}`);
    expect(noteRecentBuiltinId('b4')).toEqual(['b4', 'b8', 'b7', 'b6', 'b5', 'b3']);
    expect(readRecentBuiltinIds()).toHaveLength(LIBRARY_RECENT_MAX);
    expect(clearRecentBuiltinIds()).toEqual([]);
    expect(readRecentBuiltinIds()).toEqual([]);
    expect(localStorage.getItem(LIBRARY_RECENT_KEY)).toBe('[]');
  });

  it('ignores malformed storage payloads', () => {
    const mem = installMemoryLocalStorage();
    mem.setItem(LIBRARY_FAVORITES_KEY, 'not-json');
    mem.setItem(LIBRARY_RECENT_KEY, JSON.stringify(['ok', 42, '', 'ok']));
    expect(readFavoriteIds()).toEqual([]);
    expect(readRecentBuiltinIds()).toEqual(['ok']);
  });
});

describe('library commands', () => {
  it('buffers find and recent until the panel takes them', () => {
    expect(takeLibraryCommand()).toBeNull();
    noteLibraryCommand('find');
    expect(takeLibraryCommand()).toBe('find');
    noteLibraryCommand('recent');
    expect(takeLibraryCommand()).toBe('recent');
    expect(takeLibraryCommand()).toBeNull();
  });
});
