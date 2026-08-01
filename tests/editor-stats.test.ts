// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { countDocStats, cursorLineCol } from '../src/editor/tabbed-editor.tsx';

describe('countDocStats', () => {
  it('counts empty doc as 1 line, 0 words', () => {
    expect(countDocStats('')).toEqual({ lines: 1, words: 0, chars: 0 });
  });

  it('counts lines words chars', () => {
    expect(countDocStats('hello world\nfoo')).toEqual({
      lines: 2,
      words: 3,
      chars: 15,
    });
  });

  it('trims for word count', () => {
    expect(countDocStats('  a   b  \n')).toEqual({ lines: 2, words: 2, chars: 10 });
  });
});

describe('cursorLineCol', () => {
  it('starts at 1:1 for empty doc / offset 0', () => {
    expect(cursorLineCol('', 0)).toEqual({ line: 1, col: 1 });
    expect(cursorLineCol('abc', 0)).toEqual({ line: 1, col: 1 });
  });

  it('tracks column within a line', () => {
    expect(cursorLineCol('hello', 3)).toEqual({ line: 1, col: 4 });
  });

  it('advances line after newline', () => {
    // "ab\ncd" — offset 3 is 'c' → line 2 col 1
    expect(cursorLineCol('ab\ncd', 3)).toEqual({ line: 2, col: 1 });
    expect(cursorLineCol('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
  });

  it('clamps out-of-range offsets', () => {
    expect(cursorLineCol('hi', 99)).toEqual({ line: 1, col: 3 });
    expect(cursorLineCol('hi', -5)).toEqual({ line: 1, col: 1 });
  });
});

