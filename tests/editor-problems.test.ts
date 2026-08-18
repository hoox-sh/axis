// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for the Editor Problems panel.
 */

import { describe, expect, it } from 'bun:test';
import type { EditorDiagnostic } from '../src/editor/diagnostics.ts';
import {
  EDITOR_PROBLEMS_DEFAULT_HEIGHT,
  EDITOR_PROBLEMS_MIN_HEIGHT,
  clampProblemsHeight,
  countProblemsBySeverity,
  diagnosticsToProblems,
  formatProblemForCopy,
  formatProblemLine,
  formatProblemSource,
  formatProblemsListForCopy,
  severityRank,
  shouldAutoOpenProblems,
  truncateProblemMessage,
} from '../src/ui/editor-problems.ts';

describe('shouldAutoOpenProblems', () => {
  it('opens when count rises from empty or grows', () => {
    expect(shouldAutoOpenProblems(0, 3)).toBe(true);
    expect(shouldAutoOpenProblems(2, 5)).toBe(true);
  });

  it('does not re-open when count is unchanged or shrinks', () => {
    expect(shouldAutoOpenProblems(3, 3)).toBe(false);
    expect(shouldAutoOpenProblems(5, 2)).toBe(false);
    expect(shouldAutoOpenProblems(0, 0)).toBe(false);
    expect(shouldAutoOpenProblems(1, 0)).toBe(false);
  });
});

describe('severityRank', () => {
  it('ranks error above warning above info', () => {
    expect(severityRank('error')).toBeLessThan(severityRank('warning'));
    expect(severityRank('warning')).toBeLessThan(severityRank('info'));
  });
});

describe('truncateProblemMessage', () => {
  it('returns short messages unchanged', () => {
    expect(truncateProblemMessage('hello')).toBe('hello');
  });

  it('collapses whitespace and ellipsizes', () => {
    const long = 'a'.repeat(50) + '  ' + 'b'.repeat(50);
    const out = truncateProblemMessage(long, 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(40);
  });

  it('handles empty / tiny max', () => {
    expect(truncateProblemMessage('')).toBe('');
    expect(truncateProblemMessage('ab', 1)).toBe('…');
  });
});

describe('formatProblemLine', () => {
  it('formats unknown lines as em dash', () => {
    expect(formatProblemLine(0)).toBe('—');
    expect(formatProblemLine(-1)).toBe('—');
    expect(formatProblemLine(12)).toBe('12');
  });
});

describe('formatProblemSource', () => {
  it('maps pre-eval family to pre-eval', () => {
    expect(formatProblemSource('preeval')).toBe('pre-eval');
    expect(formatProblemSource('preeval-local')).toBe('pre-eval');
    expect(formatProblemSource('preeval-typo')).toBe('pre-eval');
    expect(formatProblemSource('local')).toBe('pre-eval');
  });

  it('maps last-run family to run', () => {
    expect(formatProblemSource('run')).toBe('run');
    expect(formatProblemSource('diagnostic')).toBe('run');
    expect(formatProblemSource('error')).toBe('run');
    expect(formatProblemSource('log')).toBe('run');
    expect(formatProblemSource('stack')).toBe('run');
    expect(formatProblemSource('meta.errors')).toBe('run');
  });

  it('passes through unknown tags and empty', () => {
    expect(formatProblemSource('lsp')).toBe('lsp');
    expect(formatProblemSource('')).toBe('');
    expect(formatProblemSource(undefined)).toBe('');
  });
});

describe('formatProblemForCopy / formatProblemsListForCopy', () => {
  it('formats a single problem for clipboard', () => {
    expect(
      formatProblemForCopy({
        line: 12,
        severity: 'error',
        message: 'Unexpected token',
        source: 'preeval',
      }),
    ).toBe('L12 [error] Unexpected token (pre-eval)');
  });

  it('labels last-run diagnostic source as run', () => {
    expect(
      formatProblemForCopy({
        line: 3,
        severity: 'error',
        message: 'boom',
        source: 'diagnostic',
      }),
    ).toBe('L3 [error] boom (run)');
  });

  it('formats typos without inventing a line', () => {
    expect(
      formatProblemForCopy({
        line: 0,
        severity: 'typo',
        message: 'Unknown `strategy.etry`',
      }),
    ).toBe('L— [typo] Unknown `strategy.etry`');
  });

  it('joins multiple problems with newlines', () => {
    const text = formatProblemsListForCopy([
      { line: 1, severity: 'warning', message: 'a' },
      { line: 2, severity: 'error', message: 'b' },
    ]);
    expect(text).toBe('L1 [warning] a\nL2 [error] b');
  });
});

describe('diagnosticsToProblems', () => {
  it('maps empty / null', () => {
    expect(diagnosticsToProblems(null)).toEqual([]);
    expect(diagnosticsToProblems([])).toEqual([]);
  });

  it('projects EditorDiagnostic fields', () => {
    const diags: EditorDiagnostic[] = [
      {
        from: 10,
        to: 15,
        line: 2,
        severity: 'error',
        message: 'boom',
        source: 'diagnostic',
      },
      {
        from: 0,
        to: 3,
        line: 1,
        severity: 'warning',
        message: 'unused',
      },
    ];
    const problems = diagnosticsToProblems(diags);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatchObject({
      line: 2,
      severity: 'error',
      message: 'boom',
      from: 10,
      to: 15,
    });
  });
});

describe('countProblemsBySeverity', () => {
  it('counts errors, warnings, and typos', () => {
    const c = countProblemsBySeverity([
      { severity: 'error' },
      { severity: 'error' },
      { severity: 'warning' },
      { severity: 'typo' },
      { severity: 'info' },
    ]);
    expect(c).toEqual({ errors: 2, warnings: 1, typos: 1, total: 5 });
  });
});

describe('clampProblemsHeight', () => {
  it('clamps to min / max and rounds', () => {
    expect(clampProblemsHeight(10, 400)).toBe(EDITOR_PROBLEMS_MIN_HEIGHT);
    expect(clampProblemsHeight(9999, 400)).toBe(400);
    expect(clampProblemsHeight(123.7, 400)).toBe(124);
  });

  it('falls back to default for non-finite', () => {
    expect(clampProblemsHeight(Number.NaN, 400)).toBe(EDITOR_PROBLEMS_DEFAULT_HEIGHT);
  });
});
