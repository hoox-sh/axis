/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { convertPineToV6, convertPineToV6Result, detectPineVersion } from '../src/editor/pine-convert';

describe('convertPineToV6', () => {
  it('detects //@version and missing pragma', () => {
    expect(detectPineVersion("study('x')\n")).toBeNull();
    expect(detectPineVersion('//@version=4\nstudy("x")\n')).toBe(4);
  });

  it('rewrites v5 study + security', () => {
    const src = `//@version=5
study("x")
s = security("BINANCE:BTCUSDT", "D", close)
plot(s)
`;
    const out = convertPineToV6(src);
    expect(out).toContain('//@version=6');
    expect(out).toContain('indicator(');
    expect(out).not.toContain('study(');
    expect(out).toContain('request.security(');
    expect(out).not.toContain('request.request.');
  });

  it('rewrites v4 namespaces and indicator', () => {
    const src = `//@version=4
study("x")
s = sma(close, 14)
h = security(tickerid, "D", close)
plot(s)
`;
    const out = convertPineToV6(src);
    expect(out).toContain('indicator(');
    expect(out).toContain('ta.sma(');
    expect(out).toContain('request.security(');
    expect(out).toContain('syminfo.tickerid');
  });

  it('rewrites v3 colors, bar_index, typed input', () => {
    const src = `//@version=3
study("old")
len = input(14, type=integer)
s = sma(close, len)
plot(s, color=red, style=line)
bgcolor(n == 0 ? green : na)
`;
    const out = convertPineToV6(src);
    expect(out).toContain('input.int(');
    expect(out).toContain('ta.sma(');
    expect(out).toContain('color.red');
    expect(out).toContain('plot.style_line');
    expect(out).toContain('bar_index');
    expect(out).toContain('color.green');
  });

  it('inserts indicator when the script has no declaration', () => {
    const out = convertPineToV6('plot(close)\n');
    expect(out.startsWith('//@version=6')).toBe(true);
    expect(out).toContain('indicator("Converted")');
    expect(out).toContain('plot(close)');
  });

  it('rewrites iff and offset', () => {
    const src = `//@version=4
study("x")
v = iff(close > open, offset(close, 1), open)
plot(v)
`;
    const out = convertPineToV6(src);
    expect(out).not.toContain('iff(');
    expect(out).not.toContain('offset(');
    expect(out).toContain('close[1]');
    expect(out).toContain('?');
  });

  it('rewrites tostring, math.abs, heikinashi(tickerid())', () => {
    const src = `//@version=4
study("x")
t = heikinashi(tickerid("BINANCE", "BTCUSDT"))
s = tostring(close)
m = abs(close - open)
plot(close)
`;
    const out = convertPineToV6(src);
    expect(out).toContain('ticker.heikinashi(');
    expect(out).toContain('ticker.new(');
    expect(out).toContain('str.tostring(');
    expect(out).toContain('math.abs(');
  });

  it('does not prefix UDF defs or unpack names', () => {
    const src = `//@version=4
study("x")
hma(src, len) => wma(src, len)
minimax(X, p, min, max) => max - min
[rsi, dev] = rsi(close, 14)
plot(hma(close, 9))
`;
    const out = convertPineToV6(src);
    expect(out).toContain('hma(src, len) =>');
    expect(out).toContain('ta.wma(');
    expect(out).toContain('minimax(X, p, min, max) =>');
    expect(out).toContain('[rsi, dev] =');
    expect(out).toContain('ta.rsi(');
  });

  it('is idempotent on v6', () => {
    const src = `//@version=6
indicator("x")
plot(ta.sma(close, 14))
`;
    expect(convertPineToV6(src)).toBe(src);
    expect(convertPineToV6Result(src).changed).toBe(false);
  });

  it('does not double-prefix namespaces', () => {
    const src = `//@version=5
indicator("x")
plot(ta.sma(close, 14), color=color.red)
`;
    const out = convertPineToV6(src);
    expect(out).not.toContain('ta.ta.');
    expect(out).not.toContain('color.color.');
    expect(out).toContain('ta.sma(');
  });

  it('leaves comments and strings alone', () => {
    const src = `//@version=5
indicator("x")
// security(sym, tf, close) leftover docs
plot("security(")
`;
    const out = convertPineToV6(src);
    expect(out).toContain('// security(sym, tf, close) leftover docs');
    expect(out).toContain('plot("security(")');
    expect(out.includes('request.security')).toBe(false);
  });
});
