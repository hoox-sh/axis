// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pre-eval: local structural checks, range mapping, merge, error gating.
 */

import { describe, expect, it } from 'bun:test';
import {
  checkUnknownBuiltinMembers,
  editDistance,
  hasErrorDiagnostics,
  isKnownBuiltinPath,
  isRemoteStyleNoise,
  localPreevaluate,
  mergePreevalDiagnostics,
  rangeFromLineCols,
  remoteToEditorDiagnostics,
  suggestBuiltinPath,
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

  it('flags strategy.etry as non-blocking typo (violet mark)', () => {
    const src = `//@version=5
strategy("t")
strategy.etry("Long", strategy.long)
`;
    const diags = localPreevaluate(src);
    // Typos must not block Run
    expect(hasErrorDiagnostics(diags)).toBe(false);
    const hit = diags.find((d) => /strategy\.etry/i.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('typo');
    expect(hit!.source).toBe('preeval-typo');
    expect(hit!.message).toMatch(/strategy\.entry/);
  });

  it('accepts strategy.entry as known', () => {
    const src = `//@version=5
strategy("t")
strategy.entry("Long", strategy.long)
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /strategy\.entry/i.test(d.message) && /unknown/i.test(d.message))).toBe(
      false,
    );
  });
});

describe('builtin path helpers', () => {
  it('knows strategy.entry and namespaces', () => {
    expect(isKnownBuiltinPath('strategy.entry')).toBe(true);
    expect(isKnownBuiltinPath('strategy.long')).toBe(true);
    expect(isKnownBuiltinPath('ta.rsi')).toBe(true);
    expect(isKnownBuiltinPath('strategy.etry')).toBe(false);
  });

  it('suggests entry for etry', () => {
    expect(suggestBuiltinPath('strategy.etry')).toBe('strategy.entry');
    expect(editDistance('etry', 'entry')).toBeLessThanOrEqual(2);
  });

  it('checkUnknownBuiltinMembers returns a range on the typo', () => {
    const src = 'strategy.etry("x")\n';
    const diags = checkUnknownBuiltinMembers(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.from).toBe(0);
    expect(diags[0]!.to).toBe('strategy.etry'.length);
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
  it('unions local member errors with remote (remote alone misses typos)', () => {
    const local: EditorDiagnostic[] = [
      {
        from: 0,
        to: 13,
        line: 3,
        severity: 'error',
        message: 'Unknown `strategy.etry`',
        source: 'preeval-local',
      },
    ];
    const remote: EditorDiagnostic[] = [
      { from: 0, to: 2, line: 1, severity: 'warning', message: 'Missing @version' },
    ];
    const merged = mergePreevalDiagnostics(local, remote);
    expect(merged.some((d) => d.message.includes('strategy.etry'))).toBe(true);
    expect(merged.some((d) => d.message.includes('@version'))).toBe(true);
  });

  it('falls back to local when remote null', () => {
    const local: EditorDiagnostic[] = [
      { from: 0, to: 1, line: 1, severity: 'warning', message: 'local' },
    ];
    expect(mergePreevalDiagnostics(local, null)).toEqual(local);
  });
});

describe('isRemoteStyleNoise', () => {
  it('drops C001 camelCase and C004 newline noise', () => {
    expect(
      isRemoteStyleNoise({
        line: 1,
        message: 'Variable rsi should use camelCase',
        severity: 'warning',
        code: 'C001',
      }),
    ).toBe(true);
    expect(
      isRemoteStyleNoise({
        line: 1,
        message: 'File should end with a newline',
        severity: 'warning',
        code: 'C004',
      }),
    ).toBe(true);
    expect(
      isRemoteStyleNoise({
        line: 1,
        message: 'Syntax error: unexpected token',
        severity: 'error',
        code: 'E001',
      }),
    ).toBe(false);
  });
});
