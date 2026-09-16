/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * First-party built-in catalog: original AXIS Pine, unique ids, searchable.
 */

import { describe, expect, it } from 'bun:test';
import {
  AXIS_PINE_BANNER,
  BUILTIN_SCRIPTS,
  SKIPPED_STUDIES,
  applyBuiltinScript,
  builtinCategoryLabel,
  builtinsInCategory,
  filterBuiltinScripts,
  getBuiltinScript,
  listBuiltinCategories,
} from '../src/indicators/builtins';
import { DEFAULT_COMMAND_SPECS, filterCommands } from '../src/ui/command-registry';

describe('BUILTIN_SCRIPTS catalog', () => {
  it('ships a full original set (indicators + strategies)', () => {
    expect(BUILTIN_SCRIPTS.length).toBeGreaterThanOrEqual(90);
    const kinds = new Set(BUILTIN_SCRIPTS.map((s) => s.kind));
    expect(kinds.has('indicator')).toBe(true);
    expect(kinds.has('strategy')).toBe(true);
  });

  it('has unique ids and titles', () => {
    const ids = BUILTIN_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const titles = BUILTIN_SCRIPTS.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('every script is Pine v6 with the AXIS origin banner', () => {
    for (const s of BUILTIN_SCRIPTS) {
      expect(s.code.startsWith(AXIS_PINE_BANNER)).toBe(true);
      expect(s.code).toContain('//@version=6');
      expect(s.code).toContain('Original source — not a TradingView® template');
      if (s.kind === 'strategy') {
        expect(s.code).toMatch(/\bstrategy\s*\(/);
      } else {
        expect(s.code).toMatch(/\bindicator\s*\(/);
      }
      expect(s.covers.length).toBeGreaterThan(2);
    }
  });

  it('does not ship TradingView copyright blocks or vendor template chrome', () => {
    const banned = [
      /copyright\s*\(c\)\s*tradingview/i,
      /tradingview,\s*inc/i,
      /©\s*tradingview/i,
      /pine-facade\.tradingview/i,
    ];
    for (const s of BUILTIN_SCRIPTS) {
      for (const re of banned) {
        expect(s.code).not.toMatch(re);
      }
    }
  });

  it('looks up by id', () => {
    expect(getBuiltinScript('rsi')?.shorttitle).toBe('RSI');
    expect(getBuiltinScript('sma')?.kind).toBe('indicator');
    expect(getBuiltinScript('strat-macd')?.kind).toBe('strategy');
    expect(getBuiltinScript('nope')).toBeUndefined();
  });

  it('filters by title / covers / tags', () => {
    const rsi = filterBuiltinScripts('rsi');
    expect(rsi.some((s) => s.id === 'rsi')).toBe(true);
    expect(rsi.some((s) => s.id === 'stoch-rsi')).toBe(true);
    expect(filterBuiltinScripts('')).toHaveLength(BUILTIN_SCRIPTS.length);
    expect(filterBuiltinScripts('zzzz-not-a-study')).toHaveLength(0);
  });

  it('lists categories with labels', () => {
    const cats = listBuiltinCategories();
    expect(cats).toContain('moving-average');
    expect(cats).toContain('strategy');
    expect(builtinsInCategory('moving-average').length).toBeGreaterThan(5);
    expect(builtinCategoryLabel('oscillator')).toBe('Oscillators');
  });
});

describe('SKIPPED_STUDIES', () => {
  it('documents host/proprietary studies we will not clone', () => {
    expect(SKIPPED_STUDIES.length).toBeGreaterThan(10);
    const names = SKIPPED_STUDIES.map((s) => s.name.toLowerCase());
    expect(names.some((n) => n.includes('technical ratings'))).toBe(true);
    expect(names.some((n) => n.includes('dividend'))).toBe(true);
    expect(names.some((n) => n.includes('volume delta'))).toBe(true);
    for (const s of SKIPPED_STUDIES) {
      expect(s.reason.length).toBeGreaterThan(8);
    }
  });
});

describe('applyBuiltinScript', () => {
  it('returns an error result for unknown ids without throwing', async () => {
    const r = await applyBuiltinScript('not-a-builtin');
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/unknown built-in/i);
    expect(r.builtinId).toBe('not-a-builtin');
  });
});

describe('command palette built-in command', () => {
  it('registers Add built-in script…', () => {
    const ids = new Set(DEFAULT_COMMAND_SPECS.map((c) => c.id));
    expect(ids.has('script.builtin')).toBe(true);
  });

  it('fuzzy-matches builtin / rsi keywords to the picker command', () => {
    const ranked = filterCommands([...DEFAULT_COMMAND_SPECS], 'builtin');
    expect(ranked.some((c) => c.id === 'script.builtin')).toBe(true);
  });
});
