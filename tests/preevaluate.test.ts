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
  collectUserFunctionParams,
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
  suggestClosestName,
} from '../src/editor/preevaluate.ts';
import { combineEditorDiagnostics, type EditorDiagnostic } from '../src/editor/diagnostics.ts';
import { patchEditorIntel, resetEditorIntel, setPreEval, store } from '../src/store/index.ts';

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

  it('never flags built-in series variables or type qualifiers', () => {
    const src = [
      'indicator("ok", overlay=true)',
      'simple int len = 14',
      'series float x = close',
      'const color c = color.green',
      'float v = ohlc4 + hl2 + hlc3 + hlcc4',
      'plot(high - low, "range")',
      'if bar_index > last_bar_index - 1',
      '  plot(time_close)',
    ].join('\n');
    const diags = checkUnknownBuiltinMembers(src);
    expect(diags.filter((d) => /typo/i.test(d.message))).toEqual([]);
  });

  it('knows text align/wrap constants', () => {
    const src = [
      'indicator("t")',
      'label.new(bar_index, close, "x", textalign=text.align_center)',
      'label.new(bar_index, close, "y", textalign=text.align_right)',
      'label.new(bar_index, close, "z", textalign=text.wrap_auto)',
    ].join('\n');
    const diags = checkUnknownBuiltinMembers(src);
    expect(diags.filter((d) => /text\.align|text\.wrap/.test(d.message))).toEqual([]);
  });

  it('still flags genuinely unknown user identifiers', () => {
    const src = [
      'indicator("u")',
      'lenght = 14',
      'plot(ta.sma(close, lenght))',
      'plot(lenghtt)',
    ].join('\n');
    const diags = checkUnknownBuiltinMembers(src);
    expect(diags.some((d) => /`lenghtt`/.test(d.message))).toBe(true);
  });

  it('treats typographic (curly) quotes as string delimiters', () => {
    const src = [
      'indicator("s")',
      'swing = 1',
      'title = \u201cSwing init Hoox\u201d',
      'plot(close + swing)',
    ].join('\n');
    const diags = checkUnknownBuiltinMembers(src);
    expect(diags.filter((d) => /`Swing`|`init`|`Hoox`/.test(d.message))).toEqual([]);
  });

  it('closes paired curly quotes so localPreevaluate does not swallow the file', () => {
    const src = [
      '//@version=6',
      'indicator("s")',
      'title = \u201chello\u201d',
      'plot(close)',
    ].join('\n');
    const diags = localPreevaluate(src);
    expect(diags.filter((d) => /unclosed string/i.test(d.message))).toEqual([]);
    expect(hasErrorDiagnostics(diags)).toBe(false);
  });

  it('collects type methods and export enum members as declared names', () => {
    const src = [
      'indicator("d")',
      'export enum Side',
      '  LONG',
      '  SHORT',
      '',
      'type Trade',
      '  float qty',
      '  method profit(this) => this.qty',
      'plot(close)',
    ].join('\n');
    const names = collectUserBindings(src);
    expect(names.has('Side')).toBe(true);
    expect(names.has('LONG')).toBe(true);
    expect(names.has('SHORT')).toBe(true);
    expect(names.has('qty')).toBe(true);
    expect(names.has('profit')).toBe(true);
    expect(
      checkUnknownBuiltinMembers(src).filter((d) =>
        /`Side`|`LONG`|`qty`|`profit`/.test(d.message),
      ),
    ).toEqual([]);
  });

  it('collects enum members, type fields, and for-in vars as declared names', () => {
    const src = [
      'indicator("d")',
      'enum Mode',
      '  SINGLE',
      '  CROSS = 2',
      '',
      'type Trade',
      '  float TP1',
      '  string note = ""',
      '',
      'var mode = Mode.SINGLE',
      'for [idx, px] in highs',
      '  label.new(idx, px, "L")',
      't = Trade.new()',
      'plot(mode == Mode.CROSS ? 1 : 0)',
    ].join('\n');
    const diags = checkUnknownBuiltinMembers(src).filter((d) =>
      /`SINGLE`|`CROSS`|`TP1`|`note`|`idx`|`px`/.test(d.message),
    );
    expect(diags).toEqual([]);
  });

  it('accepts generic typed declarations (array<string> etc.)', () => {
    const src = [
      'indicator("g")',
      'var series array<string> TP1 = str.split("1|2", "|")',
      'array<float> vals = array.from(1.0)',
      'plot(array.size(TP1) + array.size(vals))',
    ].join('\n');
    expect(checkUnknownBuiltinMembers(src).filter((d) => /`TP1`|`vals`/.test(d.message))).toEqual([]);
  });

  it('ignores library coordinates on import lines', () => {
    const src = [
      'indicator("i")',
      'import cryptolinx/String/1 as strx',
      'import cryptolinx/Hoox/10 as hoox',
      'plot(close)',
    ].join('\n');
    expect(checkUnknownBuiltinMembers(src).filter((d) => /`String`|`Hoox`/.test(d.message))).toEqual([]);
  });

  it('does not flag dotted method calls as bare typos', () => {
    const src = [
      'indicator("m")',
      't = c.terminal.new()',
      'plot(math.abs(-1))',
    ].join('\n');
    expect(checkUnknownBuiltinMembers(src).filter((d) => /`init`|`new`|`abs`/.test(d.message))).toEqual([]);
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

  it('does not stamp the live buffer onto stale diagnostics when clear-on-edit is off', () => {
    resetEditorIntel();
    patchEditorIntel({ preevalClearOnEdit: false });
    const linted = '//@version=6\nindicator("t")\nplt(close)\n';
    const fixed = '//@version=6\nindicator("t")\nplot(close)\n';
    const stale: EditorDiagnostic = {
      from: linted.indexOf('plt'),
      to: linted.indexOf('plt') + 3,
      line: 3,
      severity: 'typo',
      message: 'Unknown `plt` — did you mean `plot`?',
      source: 'preeval-typo',
    };
    setPreEval({
      diagnostics: [stale],
      hasErrors: false,
      pending: false,
      source: linted,
    });
    schedulePreeval(fixed, 60_000);
    expect(store.preEval.source).toBe(linted);
    expect(store.preEval.diagnostics.some((d) => /plt/.test(d.message))).toBe(true);
    expect(
      combineEditorDiagnostics(
        store.preEval.diagnostics,
        null,
        fixed,
        store.preEval.source,
      ),
    ).toEqual([]);
    cancelPreeval();
    resetEditorIntel();
  });

  it('does not wipe a completed lint when the same buffer is scheduled again', () => {
    resetEditorIntel();
    const src = '//@version=6\nindicator("t")\nplt(close)\n';
    const typo: EditorDiagnostic = {
      from: src.indexOf('plt'),
      to: src.indexOf('plt') + 3,
      line: 3,
      severity: 'typo',
      message: 'Unknown `plt` — did you mean `plot`?',
      source: 'preeval-typo',
    };
    schedulePreeval(src, 60_000);
    cancelPreeval();
    setPreEval({
      diagnostics: [typo],
      hasErrors: false,
      pending: false,
      source: src,
    });
    schedulePreeval(src, 60_000);
    expect(store.preEval.diagnostics).toEqual([typo]);
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

describe('named-arg and user-var typos', () => {
  it('suggests color for plot(..., coltor=color.green)', () => {
    const src = `//@version=6
indicator("t")
plot("title", coltor=color.green)
`;
    const diags = localPreevaluate(src);
    const hit = diags.find((d) => /coltor/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/color/);
    expect(src.slice(hit!.from, hit!.to)).toBe('coltor');
    expect(hit!.severity).toBe('typo');
  });

  it('suggests length for ta.rsi(..., lengh=14)', () => {
    const src = `//@version=6
indicator("t")
plot(ta.rsi(close, lengh=14))
`;
    const hit = localPreevaluate(src).find((d) => /lengh/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/length/);
  });

  it('suggests title for input.int(..., titel=...)', () => {
    const src = `//@version=6
indicator("t")
len = input.int(14, titel="Length")
plot(len)
`;
    const hit = localPreevaluate(src).find((d) => /titel/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/title/);
  });

  it('uses user-function parameter names as the signature', () => {
    const src = `//@version=6
indicator("t")
foo(bar, baz) => bar + baz
plot(foo(ba=1, baz=2))
`;
    expect(collectUserFunctionParams(src).get('foo')).toEqual(['bar', 'baz']);
    const hit = localPreevaluate(src).find((d) => /`ba`/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/bar/);
  });

  it('indexes assignment declarations as the source of truth', () => {
    const src = `//@version=6
indicator("t")
length = 14
rsi = ta.rsi(close, length)
plot(rsi)
`;
    const names = collectUserBindings(src);
    expect(names.has('length')).toBe(true);
    expect(names.has('rsi')).toBe(true);
  });

  it('flags uses that look like a declared var typo (lenght → length)', () => {
    const src = `//@version=6
indicator("t")
length = 14
plot(ta.rsi(close, lenght))
`;
    const hit = localPreevaluate(src).find((d) => /lenght/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/length/);
    expect(src.slice(hit!.from, hit!.to)).toBe('lenght');
  });

  it('indexes tuple unpack names', () => {
    const src = `//@version=6
indicator("t")
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
plot(macdLin)
`;
    expect(collectUserBindings(src).has('macdLine')).toBe(true);
    const hit = localPreevaluate(src).find((d) => /macdLin/.test(d.message));
    expect(hit).toBeTruthy();
    expect(hit!.message).toMatch(/macdLine/);
  });

  it('does not flag exact declared names or builtins', () => {
    const src = `//@version=6
indicator("t")
length = 14
plot(ta.rsi(close, length))
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /`length`/.test(d.message))).toBe(false);
    expect(diags.some((d) => /`close`/.test(d.message))).toBe(false);
    expect(diags.some((d) => /`plot`/.test(d.message))).toBe(false);
  });

  it('does not flag short identifiers as user-var typos', () => {
    expect(suggestClosestName('xy', ['xyz'])).toBeNull();
    const src = `//@version=6
indicator("t")
foo(x, y) => x + y
plot(foo(1, 2))
`;
    const diags = localPreevaluate(src);
    expect(diags.some((d) => /did you mean/.test(d.message))).toBe(false);
  });
});
