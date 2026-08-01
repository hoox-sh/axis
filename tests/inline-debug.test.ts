// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inline debug annotation extraction from run payloads.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseSourceLine,
  collectInlineDebugAnnotations,
  collapseAnnotationsByLine,
  isPinableAnnotation,
  filterPinableAnnotations,
} from '../src/results/inline-debug.ts';

describe('parseSourceLine', () => {
  it('parses common patterns', () => {
    expect(parseSourceLine('error at line 12: bad')).toBe(12);
    expect(parseSourceLine('Line:7 foo')).toBe(7);
    expect(parseSourceLine('line #9 oops')).toBe(9);
    expect(parseSourceLine('L:4 value')).toBe(4);
    expect(parseSourceLine('script.pine:42:1 error')).toBe(42);
    expect(parseSourceLine('(line 3)')).toBe(3);
    expect(parseSourceLine('no line here')).toBeNull();
  });
});

describe('isPinableAnnotation / filterPinableAnnotations', () => {
  it('detects barIndex or time', () => {
    expect(isPinableAnnotation({ barIndex: 1 })).toBe(true);
    expect(isPinableAnnotation({ time: 1000 })).toBe(true);
    expect(isPinableAnnotation({ barIndex: null, time: null })).toBe(false);
    expect(isPinableAnnotation({})).toBe(false);
  });

  it('filters pinable list', () => {
    const out = filterPinableAnnotations([
      { line: 1, level: 'info', message: 'a', barIndex: 2 },
      { line: 2, level: 'error', message: 'b' },
      { line: 3, level: 'debug', message: 'c', time: 99 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.line)).toEqual([1, 3]);
  });
});

describe('collectInlineDebugAnnotations', () => {
  it('collects logs with structured line field', () => {
    const anns = collectInlineDebugAnnotations({
      status: 'success',
      logs: [
        { level: 'info', message: 'ok', line: 5 },
        { level: 'error', message: 'boom', line: 10 },
      ],
    });
    expect(anns.some((a) => a.line === 5 && a.level === 'info')).toBe(true);
    expect(anns.some((a) => a.line === 10 && a.level === 'error')).toBe(true);
  });

  it('parses line from error message', () => {
    const anns = collectInlineDebugAnnotations({
      status: 'error',
      error: 'Syntax error on line 8: unexpected token',
    });
    expect(anns.some((a) => a.line === 8 && a.level === 'error')).toBe(true);
  });

  it('collects diagnostics', () => {
    const anns = collectInlineDebugAnnotations({
      diagnostics: [{ line: 2, message: 'unused', severity: 'warning' }],
    });
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({ line: 2, level: 'warning' });
  });

  it('collapse keeps highest severity per line', () => {
    const collapsed = collapseAnnotationsByLine([
      { line: 1, level: 'info', message: 'a' },
      { line: 1, level: 'error', message: 'b' },
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.level).toBe('error');
  });

  it('parses bar_index from log message for pin-able chips', () => {
    const anns = collectInlineDebugAnnotations({
      logs: [{ level: 'info', message: 'cross bar_index=44', line: 9 }],
    });
    const a = anns.find((x) => x.line === 9);
    expect(a?.barIndex).toBe(44);
  });
});
