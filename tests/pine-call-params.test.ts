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
  it('resolves ta.sma with source + length and an example', () => {
    const sig = resolveCallSignature('ta.sma');
    expect(sig).toBeTruthy();
    const names = sig!.params.map((p) => p.name);
    expect(names).toContain('source');
    expect(names).toContain('length');
    expect(sig!.example).toContain('ta.sma');
  });

  it('formatCallHoverMarkdown includes Parameters and Example', () => {
    const sig = resolveCallSignature('ta.sma');
    expect(sig).toBeTruthy();
    const md = formatCallHoverMarkdown(sig!);
    expect(md).toContain('**Parameters**');
    expect(md).toContain('**Example**');
  });

  it('formatParamHoverMarkdown mentions the param name and parent call', () => {
    const sig = resolveCallSignature('plot');
    expect(sig).toBeTruthy();
    const title = sig!.params.find((p) => p.name === 'title');
    expect(title).toBeTruthy();
    const md = formatParamHoverMarkdown(sig!, title!);
    expect(md).toContain('title');
    expect(md).toContain('plot');
  });
});
