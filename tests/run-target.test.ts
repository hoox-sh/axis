/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor ↔ chart script matching for Run / Re-run / add instance.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  countChartScriptsForEditor,
  extractScriptTitle,
  findChartScriptForEditor,
  normalizeScriptSource,
  pickPreferredScript,
  resolveScriptDisplayName,
} from '../src/indicators/run-target';
import type { Indicator } from '../src/store/types';

function ind(
  partial: Partial<Indicator> & Pick<Indicator, 'id' | 'name' | 'code'>,
): Indicator {
  return {
    paneId: 'price',
    visible: true,
    plots: {},
    ...partial,
  };
}

describe('normalizeScriptSource', () => {
  it('trims and normalizes newlines', () => {
    expect(normalizeScriptSource('  a\r\nb\r  ')).toBe('a\nb');
  });
});

describe('extractScriptTitle', () => {
  it('reads positional indicator title', () => {
    expect(extractScriptTitle('//@version=5\nindicator("RSI", overlay=false)\n')).toBe(
      'RSI',
    );
  });

  it('reads title= form and strategy', () => {
    expect(
      extractScriptTitle('strategy(title="My Strat", overlay=true)'),
    ).toBe('My Strat');
  });

  it('reads library name', () => {
    expect(extractScriptTitle('//@version=5\nlibrary("MyLib")\n')).toBe('MyLib');
  });

  it('returns null when missing', () => {
    expect(extractScriptTitle('plot(close)')).toBeNull();
  });
});

describe('resolveScriptDisplayName', () => {
  const src = '//@version=6\nindicator("ATR Volatility", overlay=false)\nplot(1)\n';

  it('always prefers source title over engine meta and existing name', () => {
    expect(resolveScriptDisplayName(src, 'plot', 'old-file.pine')).toBe(
      'ATR Volatility',
    );
    expect(resolveScriptDisplayName(src, 'plot', null)).toBe('ATR Volatility');
  });

  it('ignores generic engine names when title missing', () => {
    expect(resolveScriptDisplayName('plot(close)', 'plot', 'My Script')).toBe(
      'My Script',
    );
    expect(resolveScriptDisplayName('plot(close)', 'plot', null)).toBe('plot');
  });

  it('falls back to Indicator when nothing useful', () => {
    expect(resolveScriptDisplayName('', null, null)).toBe('Indicator');
  });
});

describe('findChartScriptForEditor', () => {
  const rsi = `//@version=5
indicator("RSI", overlay=false)
plot(ta.rsi(close, 14))
`;
  const macd = `//@version=5
indicator("MACD", overlay=false)
plot(1)
`;

  it('returns undefined when chart empty', () => {
    expect(findChartScriptForEditor(rsi, [])).toBeUndefined();
  });

  it('matches exact code and prefers last / focus', () => {
    const a = ind({ id: 'a', name: 'RSI', code: rsi });
    const b = ind({ id: 'b', name: 'RSI', code: rsi });
    expect(findChartScriptForEditor(rsi, [a, b])?.id).toBe('b');
    expect(findChartScriptForEditor(rsi, [a, b], 'a')?.id).toBe('a');
  });

  it('matches by title when code was edited', () => {
    const onChart = ind({ id: 'x', name: 'RSI', code: rsi });
    const edited = rsi.replace('14', '21');
    expect(findChartScriptForEditor(edited, [onChart])?.id).toBe('x');
  });

  it('does not match unrelated scripts', () => {
    const onChart = ind({ id: 'm', name: 'MACD', code: macd });
    expect(findChartScriptForEditor(rsi, [onChart])).toBeUndefined();
  });

  it('counts instances by code or title', () => {
    const scripts = [
      ind({ id: '1', name: 'RSI', code: rsi }),
      ind({ id: '2', name: 'RSI', code: rsi.replace('14', '7') }),
      ind({ id: '3', name: 'MACD', code: macd }),
    ];
    expect(countChartScriptsForEditor(rsi, scripts)).toBe(2);
    expect(countChartScriptsForEditor(macd, scripts)).toBe(1);
  });
});

describe('pickPreferredScript', () => {
  it('uses focus id when present', () => {
    const a = ind({ id: 'a', name: 'A', code: 'a' });
    const b = ind({ id: 'b', name: 'B', code: 'b' });
    expect(pickPreferredScript([a, b], 'a')?.id).toBe('a');
    expect(pickPreferredScript([a, b], null)?.id).toBe('b');
  });
});
