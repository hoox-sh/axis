// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers for the Editor Problems panel.
 */

import { describe, expect, it } from 'bun:test';
import type { EditorDiagnostic } from '../src/editor/diagnostics.ts';
import {
  countProblemsBySeverity,
  diagnosticsToProblems,
  formatProblemLine,
  severityRank,
  truncateProblemMessage,
} from '../src/ui/editor-problems.ts';

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
  it('counts errors and warnings', () => {
    const c = countProblemsBySeverity([
      { severity: 'error' },
      { severity: 'error' },
      { severity: 'warning' },
      { severity: 'info' },
    ]);
    expect(c).toEqual({ errors: 2, warnings: 1, total: 4 });
  });
});
