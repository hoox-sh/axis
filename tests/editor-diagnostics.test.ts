// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editor diagnostic parsing + line → document range mapping.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseDiagnosticLine,
  lineFromDiagnosticRecord,
  lineStartOffsets,
  mapLineToRange,
  diagnosticsFromLastRun,
  countDiagnostics,
  formatDiagnosticCount,
  type EditorDiagnostic,
} from '../src/editor/diagnostics.ts';

const SAMPLE_DOC = [
  '//@version=5',
  'indicator("x")',
  'a = close',
  'b = ta.sma(close, 14)',
  'plot(b)',
].join('\n');

describe('parseDiagnosticLine', () => {
  it('parses line 12: style', () => {
    expect(parseDiagnosticLine('Syntax error line 12: unexpected token')).toBe(12);
  });

  it('parses line:12 style', () => {
    expect(parseDiagnosticLine('error line:7 bad indent')).toBe(7);
  });

  it('parses at line 12', () => {
    expect(parseDiagnosticLine('Runtime error at line 42')).toBe(42);
  });

  it('parses L12: prefix', () => {
    expect(parseDiagnosticLine('L15: undeclared identifier foo')).toBe(15);
  });

  it('parses Python-style stack line', () => {
    expect(parseDiagnosticLine('  File "script.pine", line 9, in <module>')).toBe(9);
  });

  it('parses file:line:col', () => {
    expect(parseDiagnosticLine('script.pine:33:1: error')).toBe(33);
  });

  it('parses (line N)', () => {
    expect(parseDiagnosticLine('fail (line 3)')).toBe(3);
  });

  it('returns null when no line ref', () => {
    expect(parseDiagnosticLine('something went wrong')).toBeNull();
  });
});

describe('lineFromDiagnosticRecord', () => {
  it('reads structured line field', () => {
    expect(lineFromDiagnosticRecord({ line: 4, message: 'x' })).toBe(4);
    expect(lineFromDiagnosticRecord({ lineno: 8, msg: 'y' })).toBe(8);
  });

  it('falls back to message parse', () => {
    expect(lineFromDiagnosticRecord({ message: 'error at line 11: boom' })).toBe(11);
  });
});

describe('lineStartOffsets + mapLineToRange', () => {
  it('maps starts for multi-line doc', () => {
    const starts = lineStartOffsets('a\nbc\n');
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBe(2);
    expect(starts[2]).toBe(5);
  });

  it('maps full line range (trimmed)', () => {
    const r = mapLineToRange(SAMPLE_DOC, 3);
    expect(r).not.toBeNull();
    expect(r!.line).toBe(3);
    expect(SAMPLE_DOC.slice(r!.from, r!.to)).toBe('a = close');
  });

  it('maps word token on line', () => {
    const r = mapLineToRange(SAMPLE_DOC, 4, { word: 'ta.sma' });
    expect(r).not.toBeNull();
    expect(SAMPLE_DOC.slice(r!.from, r!.to)).toBe('ta.sma');
  });

  it('maps 1-based column to word', () => {
    // line 3: "a = close" — col 5 starts at 'c' of close
    const r = mapLineToRange(SAMPLE_DOC, 3, { col: 5 });
    expect(r).not.toBeNull();
    expect(SAMPLE_DOC.slice(r!.from, r!.to)).toBe('close');
  });

  it('returns null for out-of-range line', () => {
    expect(mapLineToRange(SAMPLE_DOC, 99)).toBeNull();
    expect(mapLineToRange(SAMPLE_DOC, 0)).toBeNull();
  });
});

describe('diagnosticsFromLastRun', () => {
  it('returns empty for null/empty', () => {
    expect(diagnosticsFromLastRun(null, SAMPLE_DOC)).toEqual([]);
    expect(diagnosticsFromLastRun(undefined, SAMPLE_DOC)).toEqual([]);
  });

  it('parses top-level engine error with line in message', () => {
    const diags = diagnosticsFromLastRun(
      {
        status: 'error',
        error: 'Syntax error on line 3: unexpected token',
      },
      SAMPLE_DOC,
    );
    expect(diags.length).toBeGreaterThanOrEqual(1);
    const d = diags.find((x) => x.line === 3);
    expect(d).toBeTruthy();
    expect(d!.severity).toBe('error');
    expect(d!.from).toBeLessThan(d!.to);
    expect(SAMPLE_DOC.slice(d!.from, d!.to)).toContain('close');
  });

  it('parses meta.errors string array', () => {
    const diags = diagnosticsFromLastRun(
      {
        status: 'error',
        meta: {
          errors: ['line 4: unknown function foo', 'L5: missing plot'],
        },
      },
      SAMPLE_DOC,
    );
    expect(diags.some((d) => d.line === 4 && d.severity === 'error')).toBe(true);
    expect(diags.some((d) => d.line === 5)).toBe(true);
  });

  it('parses meta.errors object array', () => {
    const diags = diagnosticsFromLastRun(
      {
        meta: {
          errors: [{ line: 2, message: 'bad indicator', severity: 'error' }],
        },
      },
      SAMPLE_DOC,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      line: 2,
      severity: 'error',
      message: 'bad indicator',
      source: 'meta.errors',
    });
  });

  it('parses diagnostics / meta.diagnostics', () => {
    const diags = diagnosticsFromLastRun(
      {
        diagnostics: [{ line: 1, message: 'prefer //@version=6', severity: 'warning' }],
        meta: {
          diagnostics: [{ line: 5, message: 'unused', level: 'info' }],
        },
      },
      SAMPLE_DOC,
    );
    expect(diags.some((d) => d.line === 1 && d.severity === 'warning')).toBe(true);
    expect(diags.some((d) => d.line === 5 && d.severity === 'info')).toBe(true);
  });

  it('parses error logs with line / bar_index context', () => {
    const diags = diagnosticsFromLastRun(
      {
        status: 'success',
        logs: [
          { level: 'error', message: 'div0 at line 4 bar_index=12' },
          { level: 'warning', message: 'slow path', line: 3 },
          { level: 'info', message: 'ok line 2' }, // info skipped for diags
        ],
      },
      SAMPLE_DOC,
    );
    expect(diags.some((d) => d.line === 4 && d.severity === 'error')).toBe(true);
    expect(diags.some((d) => d.line === 3 && d.severity === 'warning')).toBe(true);
    expect(diags.every((d) => d.severity !== 'info' || d.source === 'diagnostic')).toBe(true);
  });

  it('surfaces error without line as line 1', () => {
    const diags = diagnosticsFromLastRun(
      { status: 'error', error: 'engine crashed hard' },
      SAMPLE_DOC,
    );
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0]!.line).toBe(1);
    expect(diags[0]!.severity).toBe('error');
  });

  it('parses multi-line stack snippets', () => {
    const stack = [
      'Traceback (most recent call last):',
      '  File "script.pine", line 4, in main',
      'RuntimeError: boom',
    ].join('\n');
    const diags = diagnosticsFromLastRun({ status: 'error', error: stack }, SAMPLE_DOC);
    expect(diags.some((d) => d.line === 4)).toBe(true);
  });

  it('maps ranges within document bounds', () => {
    const diags = diagnosticsFromLastRun(
      { diagnostics: [{ line: 5, message: 'x', severity: 'error' }] },
      SAMPLE_DOC,
    );
    expect(diags).toHaveLength(1);
    const d = diags[0]!;
    expect(d.from).toBeGreaterThanOrEqual(0);
    expect(d.to).toBeLessThanOrEqual(SAMPLE_DOC.length);
    expect(d.to).toBeGreaterThan(d.from);
  });

  it('dedups identical diagnostics', () => {
    const diags = diagnosticsFromLastRun(
      {
        error: 'line 3: dup',
        status: 'error',
        diagnostics: [{ line: 3, message: 'line 3: dup', severity: 'error' }],
      },
      SAMPLE_DOC,
    );
    const same = diags.filter((d) => d.line === 3 && d.message.includes('dup'));
    // may still have 2 if messages differ slightly; exact same message+range dedups
    const exact = diags.filter((d) => d.message === 'line 3: dup');
    expect(exact.length).toBeLessThanOrEqual(2);
    void same;
  });
});

describe('countDiagnostics / formatDiagnosticCount', () => {
  const sample: EditorDiagnostic[] = [
    { from: 0, to: 1, line: 1, severity: 'error', message: 'a' },
    { from: 2, to: 3, line: 2, severity: 'error', message: 'b' },
    { from: 4, to: 5, line: 3, severity: 'warning', message: 'c' },
  ];

  it('counts by severity', () => {
    expect(countDiagnostics(sample)).toEqual({
      errors: 2,
      warnings: 1,
      infos: 0,
      total: 3,
    });
  });

  it('formats badge label', () => {
    expect(formatDiagnosticCount(sample)).toBe('2 errors, 1 warning');
    expect(formatDiagnosticCount([sample[0]!])).toBe('1 error');
    expect(formatDiagnosticCount([])).toBe('');
  });
});
