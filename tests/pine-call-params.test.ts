/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Call-site parameter intelligence: signature parse, findCallSite, classify,
 * named-param completions, and hover markdown.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseSignatureParams,
  findCallSite,
  classifyParams,
  paramCompletions,
  resolveCallSignature,
  formatCallHoverMarkdown,
  formatParamHoverMarkdown,
  splitTopLevelParams,
  scanAllCallSites,
} from '../src/editor/pine-call-params';

describe('parseSignatureParams', () => {
  it('includes series/title/color and a rest param for plot(…)', () => {
    const params = parseSignatureParams('plot(series, title, color, …)');
    const names = params.map((p) => p.name);
    expect(names).toContain('series');
    expect(names).toContain('title');
    expect(names).toContain('color');
    expect(params.some((p) => p.rest)).toBe(true);
  });

  it('marks offset optional with default 0.85 on ta.alma', () => {
    const params = parseSignatureParams('ta.alma(series, length, offset=0.85, sigma=6)');
    const offset = params.find((p) => p.name === 'offset');
    expect(offset).toBeTruthy();
    expect(offset!.optional).toBe(true);
    expect(offset!.defaultValue).toBe('0.85');
  });

  it('extracts types from ta.sma(series float source, simple int length)', () => {
    const params = parseSignatureParams('ta.sma(series float source, simple int length) → series float');
    const source = params.find((p) => p.name === 'source');
    const length = params.find((p) => p.name === 'length');
    expect(source?.type).toBe('series float');
    expect(length?.type).toBe('simple int');
    expect(source?.optional).toBeFalsy();
  });
});

describe('splitTopLevelParams', () => {
  it('splits on top-level commas and keeps nested calls intact', () => {
    const parts = splitTopLevelParams('ta.sma(close, 14), title="x", color');
    expect(parts).toEqual(['ta.sma(close, 14)', 'title="x"', 'color']);
  });
});

describe('findCallSite', () => {
  it('classifies plot(close, title="x", ) after the last comma', () => {
    const src = 'plot(close, title="x", )';
    const pos = src.lastIndexOf(',') + 1;
    const site = findCallSite(src, pos);
    expect(site).toBeTruthy();
    expect(site!.name).toBe('plot');
    expect(site!.namedUsed.has('title')).toBe(true);
    expect(site!.positionalUsed).toBeGreaterThanOrEqual(1);
    expect(site!.prefix).toBe('');
  });

  it('does not treat if ( as a call', () => {
    expect(findCallSite('if (', 4)).toBeNull();
    expect(findCallSite('if (close > open)', 5)).toBeNull();
  });

  it('picks the outer plot call, not the nested ta.sma', () => {
    const src = 'plot(ta.sma(close, 14), ';
    const site = findCallSite(src, src.length);
    expect(site).toBeTruthy();
    expect(site!.name).toBe('plot');
    expect(site!.name).not.toBe('ta.sma');
  });
});

describe('scanAllCallSites', () => {
  it('finds nested plot + ta.sma and named args', () => {
    const src = 'plot(ta.sma(close, 14), coltor=color.green)';
    const sites = scanAllCallSites(src);
    const names = sites.map((s) => s.name);
    expect(names).toContain('plot');
    expect(names).toContain('ta.sma');
    const plot = sites.find((s) => s.name === 'plot');
    expect(plot?.namedUsed.has('coltor')).toBe(true);
  });
});

describe('classifyParams / paramCompletions', () => {
  it('marks series used and title current/unused after plot(close, )', () => {
    const src = 'plot(close, )';
    const site = findCallSite(src, src.lastIndexOf(',') + 1);
    expect(site).toBeTruthy();
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const rows = classifyParams(sig!, site!);
    const series = rows.find((p) => p.name === 'series');
    const title = rows.find((p) => p.name === 'title');
    const color = rows.find((p) => p.name === 'color');
    expect(series?.used).toBe(true);
    expect(title?.used).toBe(false);
    expect(title?.current).toBe(true);
    expect(color?.used).toBe(false);
    expect(color?.current).toBe(false);
  });

  it('marks title current at plot(close, |)', () => {
    const src = 'plot(close, ';
    const site = findCallSite(src, src.length);
    expect(site).toBeTruthy();
    expect(site!.name).toBe('plot');
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const rows = classifyParams(sig!, site!);
    expect(rows.find((p) => p.name === 'series')?.used).toBe(true);
    expect(rows.find((p) => p.name === 'title')?.current).toBe(true);
    expect(rows.find((p) => p.name === 'title')?.used).toBe(false);
  });

  it('keeps title current while typing a positional value', () => {
    const src = 'plot(close, "Close"';
    const site = findCallSite(src, src.length);
    expect(site).toBeTruthy();
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const rows = classifyParams(sig!, site!);
    expect(rows.find((p) => p.name === 'title')?.current).toBe(true);
  });

  it('suggests unused title=/color= after plot(close, )', () => {
    const src = 'plot(close, )';
    const site = findCallSite(src, src.lastIndexOf(',') + 1);
    expect(site).toBeTruthy();
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const items = paramCompletions(sig!, site!);
    expect(items.some((p) => p.insert === 'title=')).toBe(true);
    const unused = items.filter((p) => !p.used);
    expect(unused[0]?.insert).not.toBe('series=');
    expect(unused[0]?.name).not.toBe('series');
    const unusedNames = unused.map((p) => p.name);
    expect(unusedNames).toContain('title');
    expect(unusedNames).toContain('color');
  });
});

describe('resolveCallSignature / hover markdown', () => {
  it('includes format / precision / force_overlay on plotshape and plotchar', () => {
    const shape = resolveCallSignature('plotshape');
    const ch = resolveCallSignature('plotchar');
    expect(shape).toBeTruthy();
    expect(ch).toBeTruthy();
    for (const sig of [shape!, ch!]) {
      const names = sig.params.map((p) => p.name);
      expect(names).toContain('format');
      expect(names).toContain('precision');
      expect(names).toContain('force_overlay');
      expect(sig.params.find((p) => p.name === 'series')?.type).toBe('series int/bool');
    }
  });

  it('resolves ta.sma with source + length and an example', () => {
    const sig = resolveCallSignature('ta.sma');
    expect(sig).toBeTruthy();
    const names = sig!.params.map((p) => p.name);
    expect(names).toContain('source');
    expect(names).toContain('length');
    expect(sig!.example).toContain('ta.sma');
  });

  it('resolves strategy.entry / request.security / color.new param names', () => {
    const entry = resolveCallSignature('strategy.entry');
    expect(entry).toBeTruthy();
    expect(entry!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(['id', 'direction', 'qty', 'limit', 'stop', 'alert_message']),
    );
    const sec = resolveCallSignature('request.security');
    expect(sec).toBeTruthy();
    expect(sec!.params.map((p) => p.name)).toEqual(
      expect.arrayContaining(['symbol', 'timeframe', 'expression', 'gaps', 'lookahead']),
    );
    const col = resolveCallSignature('color.new');
    expect(col).toBeTruthy();
    expect(col!.params.map((p) => p.name)).toEqual(['color', 'transp']);
  });

  it('attaches types from documentation when the signature line is untyped', () => {
    const sig = resolveCallSignature('ta.wma', {
      documentation:
        'ta.wma(source, length) → series float\n\nsource (series float) Series of values.\nlength (simple int) Number of bars.',
    });
    expect(sig).toBeTruthy();
    expect(sig!.params.find((p) => p.name === 'source')?.type).toBe('series float');
    expect(sig!.params.find((p) => p.name === 'length')?.type).toBe('simple int');
    expect(sig!.returns).toBe('series float');
  });

  it('formatCallHoverMarkdown includes Parameters and Example', () => {
    const sig = resolveCallSignature('ta.sma');
    expect(sig).toBeTruthy();
    const md = formatCallHoverMarkdown(sig!);
    expect(md).toContain('**Parameters**');
    expect(md).toContain('**Example**');
    expect(md).toMatch(/series float|simple int/);
  });

  it('formatCallHoverMarkdown shows type + default + optional', () => {
    const md = formatCallHoverMarkdown({
      name: 'foo',
      params: [
        {
          name: 'n',
          type: 'simple int',
          optional: true,
          defaultValue: '14',
          description: 'Lookback',
        },
      ],
    });
    expect(md).toContain('**Parameters**');
    expect(md).toContain('simple int');
    expect(md).toContain('14');
    expect(md).toContain('optional');
  });

  it('formatParamHoverMarkdown mentions the param name and parent call', () => {
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const title = sig!.params.find((p) => p.name === 'title');
    expect(title).toBeTruthy();
    const md = formatParamHoverMarkdown(sig!, title!);
    expect(md).toContain('title');
    expect(md).toContain('plot');
    expect(md).toMatch(/const string|optional/);
  });

  it('paramCompletions description includes type or default', () => {
    const src = 'plot(close, ';
    const site = findCallSite(src, src.length);
    const sig = resolveCallSignature('plot');
    expect(site && sig).toBeTruthy();
    const items = paramCompletions(sig!, site!);
    const title = items.find((p) => p.name === 'title');
    expect(title?.description).toMatch(/const string|optional|Plot title/);
  });
});
