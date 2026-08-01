// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { countDocStats } from '../src/editor/tabbed-editor.tsx';

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
