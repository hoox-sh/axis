/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  PINE_SYMBOLS,
  filterPineSymbols,
  plotcharSnippet,
  quotePineString,
} from '../src/editor/pine-symbols';

describe('pine-symbols catalog', () => {
  it('includes TV plotchar arrows and box-drawing', () => {
    const chars = PINE_SYMBOLS.map((s) => s.char);
    expect(chars).toContain('▲');
    expect(chars).toContain('🠇');
    expect(chars).toContain('─');
    expect(chars).not.toContain('\\n');
  });

  it('marks emoji as not mono-safe', () => {
    const fire = PINE_SYMBOLS.find((s) => s.id === 'em-fire');
    expect(fire?.monoSafe).toBe(false);
    expect(PINE_SYMBOLS.find((s) => s.id === 'box-h')?.monoSafe).toBe(true);
  });

  it('filters by query and mono-only', () => {
    expect(filterPineSymbols('triangle').length).toBeGreaterThan(0);
    expect(filterPineSymbols('', { monoOnly: true }).every((s) => s.monoSafe)).toBe(
      true,
    );
    expect(filterPineSymbols('', { category: 'emoji' }).every((s) => s.category === 'emoji')).toBe(
      true,
    );
  });

  it('builds quoted and plotchar snippets', () => {
    expect(quotePineString('▲')).toBe('"▲"');
    expect(quotePineString('say "hi"')).toBe('"say \\"hi\\""');
    expect(plotcharSnippet('▲')).toContain('plotchar(cond, "mark", "▲"');
  });
});
