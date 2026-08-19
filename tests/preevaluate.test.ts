// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pre-eval: local structural checks, range mapping, merge, error gating.
 */

import { describe, expect, it } from 'bun:test';
import {
  cancelPreeval,
  checkUnknownBuiltinMembers,
  clearPreevalOnEdit,
  collectUserBindings,
  editDistance,
  hasErrorDiagnostics,
  isKnownBuiltinPath,
  isRemoteStyleNoise,
  localPreevaluate,
  mergePreevalDiagnostics,
  PREEVAL_DEBOUNCE_MS,
  PREEVAL_IDLE_MS,
  rangeFromLineCols,
  remoteToEditorDiagnostics,
  schedulePreeval,
  suggestBuiltinPath,
} from '../src/editor/preevaluate.ts';
import type { EditorDiagnostic } from '../src/editor/diagnostics.ts';
import { setPreEval, store } from '../src/store/index.ts';

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

  it('does not treat /* inside a string as a block comment', () => {
    const src = `//@version=6
indicator("t")
s = "/*"
plot(close)
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /unclosed block comment/i.test(d.message))).toBe(false);
    expect(hasErrorDiagnostics(diags)).toBe(false);
  });

  it('does not start a line comment at https:// inside a string', () => {
    const src = `//@version=6
indicator("t")
u = "https://example.com"
plot(close)
`;
    const diags = localPreevaluate(src);
    expect(hasErrorDiagnostics(diags)).toBe(false);
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

  it('accepts plot.style_stepline / plotshape enums (not false typo)', () => {
    const src = `//@version=5
indicator("t")
plot(close, style=plot.style_stepline)
plot(close, style=plot.style_columns)
plot(close, style=plot.style_histogram)
plotshape(true, style=shape.triangleup, location=location.belowbar, size=size.tiny)
hline(0, linestyle=hline.style_dashed)
`;
    const diags = localPreevaluate(src);
    const typos = diags.filter((d) => d.source === 'preeval-typo');
    expect(typos).toEqual([]);
    expect(isKnownBuiltinPath('plot.style_stepline')).toBe(true);
    expect(isKnownBuiltinPath('shape.triangleup')).toBe(true);
    expect(isKnownBuiltinPath('location.belowbar')).toBe(true);
    expect(isKnownBuiltinPath('hline.style_dashed')).toBe(true);
  });

  it('flags plot.style_steplne as typo (suggest stepline)', () => {
    const src = `//@version=5
indicator("t")
plot(close, style=plot.style_steplne)
`;
    const diags = localPreevaluate(src);
    expect(hasErrorDiagnostics(diags)).toBe(false);
    const hit = diags.find((d) => /plot\.style_steplne/i.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('typo');
    expect(hit!.source).toBe('preeval-typo');
    // distance steplne → stepline is 1 → suggestion when within threshold
    expect(hit!.message).toMatch(/plot\.style_stepline/);
  });

  it('warns on study() as a Pine v3 entry (does not error)', () => {
    const src = `//@version=3
study("t")
plot(close)
`;
    const diags = localPreevaluate(src);
    expect(hasErrorDiagnostics(diags)).toBe(false);
    const hit = diags.find((d) => /study\s*\(/i.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('warning');
    expect(hit!.message).toMatch(/indicator\(\)|strategy\(\)/);
    expect(diags.some((d) => /needs indicator/i.test(d.message))).toBe(false);
  });

  it('does not treat study() as an extra error when indicator() is also present', () => {
    const src = `//@version=6
indicator("t")
study("legacy")
plot(close)
`;
    const diags = localPreevaluate(src);
    expect(hasErrorDiagnostics(diags)).toBe(false);
    expect(diags.some((d) => d.severity === 'warning' && /study\s*\(/i.test(d.message))).toBe(
      true,
    );
  });

  it('warns on bare security() to prefer request.security', () => {
    const src = `//@version=6
indicator("t")
s = security(syminfo.tickerid, "D", close)
plot(s)
`;
    const diags = localPreevaluate(src);
    const hit = diags.find((d) => /security/i.test(d.message) && /request\.security/i.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('warning');
    expect(hasErrorDiagnostics(diags)).toBe(false);
  });

  it('does not warn on request.security', () => {
    const src = `//@version=6
indicator("t")
s = request.security(syminfo.tickerid, "D", close)
plot(s)
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /bare security/i.test(d.message) || /Prefer request\.security/i.test(d.message))).toBe(
      false,
    );
  });

  it('warns on duplicate indicator/strategy declarations', () => {
    const src = `//@version=6
indicator("a")
strategy("b")
plot(close)
`;
    const diags = localPreevaluate(src);
    const hit = diags.find((d) => /duplicate script declaration/i.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('warning');
  });

  it('does not flag user foo() as an unknown builtin', () => {
    const src = `//@version=6
indicator("t")
foo(x) => x + 1
plot(foo(close))
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /`foo`/.test(d.message))).toBe(false);
    expect(collectUserBindings(src).has('foo')).toBe(true);
  });

  it('does not flag import aliases as unknown builtins', () => {
    const src = `//@version=6
indicator("t")
import MyUser/MyLib/1 as mylib
plot(mylib.helper(close))
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /mylib/i.test(d.message))).toBe(false);
    expect(collectUserBindings(src).has('mylib')).toBe(true);
  });
});

describe('builtin path helpers', () => {
  it('knows strategy.entry and namespaces', () => {
    expect(isKnownBuiltinPath('strategy.entry')).toBe(true);
    expect(isKnownBuiltinPath('strategy.long')).toBe(true);
    expect(isKnownBuiltinPath('ta.rsi')).toBe(true);
    expect(isKnownBuiltinPath('strategy.etry')).toBe(false);
  });

  it('knows EXTRA plot / line / label / alert / math constants', () => {
    // plot.style_* (full set used by plot style parity)
    expect(isKnownBuiltinPath('plot.style_columns')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_area')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_line')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_linebr')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_stepline')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_steplinebr')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_stepline_diamond')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_histogram')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_cross')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_areabr')).toBe(true);
    expect(isKnownBuiltinPath('plot.style_circles')).toBe(true);
    // line / label styles
    expect(isKnownBuiltinPath('line.style_dashed')).toBe(true);
    expect(isKnownBuiltinPath('label.style_label_up')).toBe(true);
    // alert + math
    expect(isKnownBuiltinPath('alert.freq_all')).toBe(true);
    expect(isKnownBuiltinPath('math.pi')).toBe(true);
    expect(isKnownBuiltinPath('display.pane')).toBe(true);
    expect(isKnownBuiltinPath('math.isnan')).toBe(false);
    expect(isKnownBuiltinPath('math.isfinite')).toBe(false);
  });

  it('still rejects real typos (plot.style_steplne, strategy.etry)', () => {
    expect(isKnownBuiltinPath('plot.style_steplne')).toBe(false);
    expect(isKnownBuiltinPath('strategy.etry')).toBe(false);
    expect(suggestBuiltinPath('plot.style_steplne')).toBe('plot.style_stepline');
    expect(suggestBuiltinPath('strategy.etry')).toBe('strategy.entry');
  });

  it('knows strategy.percent_of_equity / strategy.fixed (qty-type constants)', () => {
    expect(isKnownBuiltinPath('strategy.percent_of_equity')).toBe(true);
    expect(isKnownBuiltinPath('strategy.fixed')).toBe(true);
    expect(isKnownBuiltinPath('strategy.cash')).toBe(true);
    // Should not flag as typo in a real strategy() declaration
    const src = `//@version=5
strategy("t", default_qty_type=strategy.percent_of_equity, default_qty_value=10)
strategy.entry("L", strategy.long)
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /percent_of_equity/i.test(d.message))).toBe(false);
  });

  it('suggests entry for etry', () => {
    expect(suggestBuiltinPath('strategy.etry')).toBe('strategy.entry');
    expect(editDistance('etry', 'entry')).toBeLessThanOrEqual(2);
  });

  it('does not suggest a builtin for short user names like foo', () => {
    expect(suggestBuiltinPath('foo')).toBeNull();
  });

  it('suggests stepline for steplne', () => {
    expect(editDistance('steplne', 'stepline')).toBeLessThanOrEqual(2);
    expect(suggestBuiltinPath('plot.style_steplne')).toBe('plot.style_stepline');
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
        severity: 'typo',
        message: 'Unknown `strategy.etry` — did you mean `strategy.entry`?',
        source: 'preeval-typo',
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

  it('lets remote syntax errors win the same span', () => {
    const local: EditorDiagnostic[] = [
      {
        from: 10,
        to: 20,
        line: 2,
        severity: 'error',
        message: "Unclosed '('",
        source: 'preeval-local',
      },
    ];
    const remote: EditorDiagnostic[] = [
      {
        from: 12,
        to: 18,
        line: 2,
        severity: 'error',
        message: '[E001] Syntax error: unexpected end of input',
        source: 'preeval',
      },
    ];
    const merged = mergePreevalDiagnostics(local, remote);
    expect(merged.some((d) => /E001/.test(d.message))).toBe(true);
    expect(merged.some((d) => /Unclosed/.test(d.message))).toBe(false);
  });

  it('keeps local unknown-member when remote is down', () => {
    const local: EditorDiagnostic[] = [
      {
        from: 0,
        to: 13,
        line: 3,
        severity: 'typo',
        message: 'Unknown `strategy.etry` — did you mean `strategy.entry`?',
        source: 'preeval-typo',
      },
    ];
    const merged = mergePreevalDiagnostics(local, null);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.message).toMatch(/strategy\.etry/);
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

describe('clearPreevalOnEdit', () => {
  it('clears diagnostics so mid-typing does not keep stale errors', () => {
    // Seed as if a prior Save/Run found errors
    setPreEval({
      diagnostics: [
        {
          from: 0,
          to: 4,
          line: 1,
          severity: 'error',
          message: 'Unclosed parenthesis',
          source: 'preeval-local',
        },
      ],
      hasErrors: true,
      pending: false,
      source: 'plot(close',
    });
    expect(store.preEval.hasErrors).toBe(true);
    clearPreevalOnEdit('plot(close)');
    expect(store.preEval.diagnostics).toEqual([]);
    expect(store.preEval.hasErrors).toBe(false);
    expect(store.preEval.pending).toBe(false);
    expect(store.preEval.source).toBe('plot(close)');
  });
});

describe('schedulePreeval idle lint', () => {
  it('exports idle window used by schedulePreeval (900–1200ms)', () => {
    expect(PREEVAL_IDLE_MS).toBe(1000);
    expect(PREEVAL_IDLE_MS).toBeGreaterThanOrEqual(900);
    expect(PREEVAL_IDLE_MS).toBeLessThanOrEqual(1200);
    expect(PREEVAL_DEBOUNCE_MS).toBe(PREEVAL_IDLE_MS);
  });

  it('clears marks immediately without pending for the whole idle window', () => {
    setPreEval({
      diagnostics: [
        {
          from: 0,
          to: 3,
          line: 1,
          severity: 'error',
          message: 'stale',
          source: 'preeval-local',
        },
      ],
      hasErrors: true,
      pending: false,
      source: 'old',
    });

    // Long idle so we only assert the immediate clear (no remote race)
    schedulePreeval('//@version=6\nindicator("t")\nplt(close)\n', 60_000);
    expect(store.preEval.hasErrors).toBe(false);
    expect(store.preEval.diagnostics).toEqual([]);
    expect(store.preEval.pending).toBe(false);
    cancelPreeval();
  });

  it('flags bare call typos like plt() locally', () => {
    const diags = localPreevaluate('//@version=6\nindicator("t")\nplt(close)\n');
    const typo = diags.find((d) => /plt/.test(d.message));
    expect(typo).toBeTruthy();
    expect(typo!.message).toMatch(/plot/i);
    expect(typo!.severity).toBe('typo');
  });
});
