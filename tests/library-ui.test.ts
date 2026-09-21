// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import type { ScriptMeta } from '../src/plugins/types';
import { noteLibraryCommand, takeLibraryCommand } from '../src/ui/library/commands';
import {
  countScriptsByKind,
  filterPersonalScripts,
  kindChipClass,
  scriptMatchesQuery,
  shortRev,
  sortPersonalScripts,
  visibleKindFilters,
} from '../src/ui/library/format';

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
