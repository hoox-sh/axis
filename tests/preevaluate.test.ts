// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pre-eval: local structural checks, range mapping, merge, error gating.
 */

import { describe, expect, it } from 'bun:test';
import {
  hasErrorDiagnostics,
  localPreevaluate,
  mergePreevalDiagnostics,
  rangeFromLineCols,
  remoteToEditorDiagnostics,
} from '../src/editor/preevaluate.ts';
import type { EditorDiagnostic } from '../src/editor/diagnostics.ts';

const GOOD = `//@version=5
indicator("t")
plot(close)
`;

const UNBALANCED = `//@version=5
indicator("t")
plot(close
`;

const NO_ENTRY = `//@version=5
// no indicator/strategy
x = close
`;

describe('localPreevaluate', () => {
  it('accepts a minimal valid script (no errors)', () => {
    const diags = localPreevaluate(GOOD);
    expect(hasErrorDiagnostics(diags)).toBe(false);
  });

  it('flags unclosed paren as error', () => {
    const diags = localPreevaluate(UNBALANCED);
    expect(hasErrorDiagnostics(diags)).toBe(true);
    expect(diags.some((d) => d.severity === 'error' && /unclosed|mismatched/i.test(d.message))).toBe(
      true,
    );
  });

  it('flags missing indicator/strategy/library as error', () => {
    const diags = localPreevaluate(NO_ENTRY);
    expect(hasErrorDiagnostics(diags)).toBe(true);
    expect(diags.some((d) => /indicator\(\)|strategy\(\)|library\(\)/i.test(d.message))).toBe(
      true,
    );
  });

  it('warns on missing //@version', () => {
    const diags = localPreevaluate('indicator("t")\nplot(close)\n');
    expect(diags.some((d) => d.severity === 'warning' && /@version/i.test(d.message))).toBe(true);
  });

  it('flags unclosed string', () => {
    const diags = localPreevaluate('//@version=5\nindicator("t\nplot(close)\n');
    expect(hasErrorDiagnostics(diags)).toBe(true);
    expect(diags.some((d) => /unclosed string/i.test(d.message))).toBe(true);
  });

  it('returns empty for blank source', () => {
    expect(localPreevaluate('')).toEqual([]);
    expect(localPreevaluate('   \n')).toEqual([]);
  });
});

describe('rangeFromLineCols', () => {
  it('maps line 1 to start of doc', () => {
    const doc = 'abc\ndef';
    const r = rangeFromLineCols(doc, 1, 0);
    expect(r.line).toBe(1);
    expect(r.from).toBe(0);
    expect(r.to).toBe(3);
  });

  it('maps line 2 with column', () => {
    const doc = 'abc\ndef';
    const r = rangeFromLineCols(doc, 2, 1, 2, 3);
    expect(r.line).toBe(2);
    expect(r.from).toBe(5); // after "d"
    expect(r.to).toBe(7);
  });
});

describe('remoteToEditorDiagnostics', () => {
  it('converts remote rows to ranges', () => {
    const doc = 'a\nbad\nc\n';
    const diags = remoteToEditorDiagnostics(doc, [
      {
        line: 2,
        character: 0,
        endLine: 2,
        endCharacter: 3,
        message: 'Syntax error',
        severity: 'error',
        code: 'E001',
      },
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.line).toBe(2);
    expect(diags[0]!.severity).toBe('error');
    expect(diags[0]!.message).toContain('E001');
    expect(diags[0]!.from).toBe(2);
  });
});

describe('mergePreevalDiagnostics', () => {
  it('uses remote when present', () => {
    const local: EditorDiagnostic[] = [
      { from: 0, to: 1, line: 1, severity: 'error', message: 'local' },
    ];
    const remote: EditorDiagnostic[] = [
      { from: 0, to: 2, line: 1, severity: 'error', message: 'remote' },
    ];
    expect(mergePreevalDiagnostics(local, remote)).toEqual(remote);
  });

  it('falls back to local when remote null', () => {
    const local: EditorDiagnostic[] = [
      { from: 0, to: 1, line: 1, severity: 'warning', message: 'local' },
    ];
    expect(mergePreevalDiagnostics(local, null)).toEqual(local);
  });
});
