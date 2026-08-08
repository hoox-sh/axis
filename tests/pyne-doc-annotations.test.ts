/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine library / doc annotation parser + markdown formatter.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatPyneDocMarkdown,
  lookupPyneDoc,
  parsePyneDocAnnotations,
} from '../src/editor/pyne-doc-annotations.ts';

const MIX_EMA = `//@version=6
library("Demo")

//@function Calculates an EMA of a source series, and mixes it with the \`source\` value.
//@param source The series of values to process.
//@param length The length of the EMA's smoothing parameter.
//@param mix Optional. The mix ratio. Requires a value from 0 to 1. The default is 1.
//@returns The mixture between the \`source\` value and its EMA.
export mixEMA(float source, int length, float mix = 1.0) =>
    float ma = ta.ema(source, length)
    (1.0 - mix) * source + mix * ma
`;

describe('parsePyneDocAnnotations', () => {
  it('parses @function / @param / @returns on export function', () => {
    const map = parsePyneDocAnnotations(MIX_EMA);
    const e = map.get('mixEMA');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('function');
    expect(e!.description).toContain('EMA of a source series');
    expect(e!.params.map((p) => p.name)).toEqual(['source', 'length', 'mix']);
    expect(e!.params[0]!.description).toContain('series of values');
    expect(e!.returns).toContain('mixture');
    expect(e!.signature).toContain('mixEMA(');
  });

  it('supports multi-line @function with empty // paragraph break', () => {
    const src = `//@function First paragraph.
//
// (**Second line**) more detail.
//@param x Input.
foo(x) =>
    x
`;
    const e = parsePyneDocAnnotations(src).get('foo');
    expect(e).toBeTruthy();
    expect(e!.description).toContain('First paragraph');
    expect(e!.description).toContain('Second line');
    expect(e!.params[0]!.name).toBe('x');
  });

  it('parses @type and @field', () => {
    const src = `// @type Point in chart space.
// @field x Bar time.
// @field y Price.
type Point
    int x
    float y
`;
    const e = parsePyneDocAnnotations(src).get('Point');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('type');
    expect(e!.description).toContain('Point in chart space');
    expect(e!.fields.map((f) => f.name)).toEqual(['x', 'y']);
  });

  it('parses @variable above assignment', () => {
    const src = `//@variable The 20-bar z-score of close values.
float osc = zScore(close, 20)
`;
    const e = parsePyneDocAnnotations(src).get('osc');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('variable');
    expect(e!.description).toContain('z-score');
  });

  it('ignores regular comments without @ tags', () => {
    const src = `// just a comment
foo() => 1
`;
    expect(parsePyneDocAnnotations(src).size).toBe(0);
  });

  it('method keyword functions are documented', () => {
    const src = `//@function Push helper.
method push(array<float> id, float v) =>
    array.push(id, v)
`;
    const e = parsePyneDocAnnotations(src).get('push');
    expect(e).toBeTruthy();
    expect(e!.kind).toBe('function');
  });
});

describe('formatPyneDocMarkdown', () => {
  it('builds signature fence + params + returns', () => {
    const e = parsePyneDocAnnotations(MIX_EMA).get('mixEMA')!;
    const md = formatPyneDocMarkdown(e);
    expect(md).toContain('```pinescript');
    expect(md).toContain('mixEMA(');
    expect(md).toContain('**Parameters**');
    expect(md).toContain('`source`');
    expect(md).toContain('**Returns**');
  });
});

describe('lookupPyneDoc', () => {
  it('finds by name', () => {
    expect(lookupPyneDoc(MIX_EMA, 'mixEMA')?.name).toBe('mixEMA');
    expect(lookupPyneDoc(MIX_EMA, 'nope')).toBeNull();
  });
});
