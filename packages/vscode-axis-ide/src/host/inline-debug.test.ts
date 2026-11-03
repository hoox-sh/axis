// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  INLINE_DEBUG_CHIP_MAX,
  INLINE_DEBUG_MAX_ANNOTATIONS,
  collectInlineDebug,
  parseSourceLine,
  redactInlineDebugText,
  truncateInlineDebugChip,
} from './inline-debug';

describe('parseSourceLine', () => {
  test('parses the supported line references', () => {
    expect(parseSourceLine('error at line 12: bad')).toBe(12);
    expect(parseSourceLine('Line:7 foo')).toBe(7);
    expect(parseSourceLine('line #9 oops')).toBe(9);
    expect(parseSourceLine('see L:4 value')).toBe(4);
    expect(parseSourceLine('see L12 now')).toBe(12);
    expect(parseSourceLine('script.pine:42:1 error')).toBe(42);
    expect(parseSourceLine('(line 3)')).toBe(3);
    expect(parseSourceLine('failed at 8')).toBe(8);
  });

  test('does not treat value suffixes as a source line', () => {
    expect(parseSourceLine('')).toBeNull();
    expect(parseSourceLine('no line here')).toBeNull();
    expect(parseSourceLine('RSI: 55')).toBeNull();
    expect(parseSourceLine('close: 14')).toBeNull();
    expect(parseSourceLine('timeout: 5000')).toBeNull();
    expect(parseSourceLine('EL12')).toBeNull();
    expect(parseSourceLine('line 0')).toBeNull();
    expect(parseSourceLine('line 1000000')).toBeNull();
    expect(parseSourceLine('at 4pm')).toBeNull();
  });
});

describe('truncateInlineDebugChip', () => {
  test('returns short messages unchanged and collapses whitespace', () => {
    expect(truncateInlineDebugChip('RSI 55')).toBe('RSI 55');
    expect(truncateInlineDebugChip('  a   b \n c  ')).toBe('a b c');
    expect(truncateInlineDebugChip('x'.repeat(INLINE_DEBUG_CHIP_MAX)).length).toBe(
      INLINE_DEBUG_CHIP_MAX,
    );
    expect(truncateInlineDebugChip('ab', 2)).toBe('ab');
    expect(truncateInlineDebugChip('')).toBe('');
  });

  test('ellipsizes past the chip budget; full text stays longer', () => {
    const long = 'y'.repeat(80);
    const out = truncateInlineDebugChip(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(INLINE_DEBUG_CHIP_MAX);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('y')).toBe(true);
    expect(truncateInlineDebugChip('abcdef', 1)).toBe('…');
    expect(truncateInlineDebugChip('abcdef', 0)).toBe('abcdef');
  });
});

describe('redactInlineDebugText', () => {
  test('redacts bearer tokens, api keys, and sk- secrets', () => {
    expect(redactInlineDebugText('Bearer eyJhbGciOiJIUzI1NiJ9')).toBe('[redacted]');
    expect(redactInlineDebugText('api_key=abcdef')).toBe('[redacted]');
    expect(redactInlineDebugText('api-key: abcdef')).toBe('[redacted]');
    expect(redactInlineDebugText('api key=abcdef')).toBe('[redacted]');
    expect(redactInlineDebugText('sk-abcdefghij')).toBe('[redacted]');
  });

  test('leaves ordinary log text alone', () => {
    expect(redactInlineDebugText('')).toBe('');
    expect(redactInlineDebugText('RSI 55')).toBe('RSI 55');
    expect(redactInlineDebugText('Bearer abc')).toBe('Bearer abc');
    expect(redactInlineDebugText('api_key=abc')).toBe('api_key=abc');
    expect(redactInlineDebugText('the bearer of bad news')).toBe('the bearer of bad news');
  });
});

describe('collectInlineDebug', () => {
  test('empty and non-records are []', () => {
    expect(collectInlineDebug(undefined)).toEqual([]);
    expect(collectInlineDebug(null)).toEqual([]);
    expect(collectInlineDebug(0)).toEqual([]);
    expect(collectInlineDebug('line 1')).toEqual([]);
    expect(collectInlineDebug(false)).toEqual([]);
    expect(collectInlineDebug([])).toEqual([]);
    expect(collectInlineDebug({})).toEqual([]);
    expect(collectInlineDebug({ logs: [] })).toEqual([]);
    expect(collectInlineDebug({ logs: 'line 3 hi' })).toEqual([]);
    expect(collectInlineDebug({ error: '' })).toEqual([]);
    expect(collectInlineDebug({ error: '   ' })).toEqual([]);
    expect(collectInlineDebug({ error: 'RSI: 55' })).toEqual([]);
    expect(collectInlineDebug({ error: 12 })).toEqual([]);
  });

  test('collects structured logs, string logs, and field aliases', () => {
    const anns = collectInlineDebug({
      logs: [
        { level: 'info', message: 'ok', line: 5 },
        { level: 'error', message: 'boom', lineno: 10 },
        { severity: 'warning', msg: 'via msg', line_no: ' 11 ' },
        { level: 'debug', text: 'via text', line: 12.9 },
        { level: 'trace', message: 'traced', line: 13 },
        { level: 'fatal', message: 'died', line: 14 },
        { level: 'critical', message: 'crit', line: 15 },
        { level: 'warn', message: 'w', line: 16 },
        { level: 'err', message: 'e', line: 17 },
        { level: '', message: 'blank level', line: 18 },
        { level: 'log', message: 'logged', line: 19 },
        { level: 2, message: 'numeric level', line: 20 },
        { message: 7, line: 21 },
        { message: false, line: 22 },
        { message: true, line: 23 },
        { message: { nested: true }, line: 24 },
        { line: 25 },
        'info: see line 26',
        'warn: check line 27',
        'error: line 28 boom',
        'debug: line 29',
        'trace: at 30',
        'critical: line 31',
        'log: line 32',
        'see line 33',
        'RSI: 55',
        '   ',
        'error:',
        null,
        1,
        ['info', 'line 34'],
        { line: 0, message: 'at 35' },
        { line: '', lineno: 36, message: 'from lineno' },
        { line: 'nope', line_no: 37, message: 'RSI: 55' },
        { line: -3, message: 'at 38' },
        { line: 1_000_000, message: 'at 39' },
        { line: '8', message: 'string line' },
        { line: 40, message: 'has time', time: 123 },
      ],
    });
    expect(anns.find((a) => a.line === 5)).toMatchObject({
      level: 'info',
      message: 'ok',
      source: 'log',
    });
    expect(anns.find((a) => a.line === 10)).toMatchObject({ level: 'error', source: 'log' });
    expect(anns.find((a) => a.line === 11)).toMatchObject({
      level: 'warning',
      message: 'via msg',
    });
    expect(anns.find((a) => a.line === 12)).toMatchObject({ level: 'debug', message: 'via text' });
    expect(anns.find((a) => a.line === 13)?.level).toBe('debug');
    expect(anns.find((a) => a.line === 14)?.level).toBe('error');
    expect(anns.find((a) => a.line === 15)?.level).toBe('error');
    expect(anns.find((a) => a.line === 16)?.level).toBe('warning');
    expect(anns.find((a) => a.line === 17)?.level).toBe('error');
    expect(anns.find((a) => a.line === 18)?.level).toBe('info');
    expect(anns.find((a) => a.line === 19)?.level).toBe('info');
    expect(anns.find((a) => a.line === 20)?.level).toBe('info');
    expect(anns.find((a) => a.line === 21)?.message).toBe('7');
    expect(anns.find((a) => a.line === 22)?.message).toBe('false');
    expect(anns.find((a) => a.line === 23)?.message).toBe('true');
    expect(anns.some((a) => a.line === 24)).toBe(false);
    expect(anns.some((a) => a.line === 25)).toBe(false);
    expect(anns.find((a) => a.line === 26)?.level).toBe('info');
    expect(anns.find((a) => a.line === 27)?.level).toBe('warning');
    expect(anns.find((a) => a.line === 28)?.level).toBe('error');
    expect(anns.find((a) => a.line === 29)?.level).toBe('debug');
    expect(anns.find((a) => a.line === 30)?.level).toBe('debug');
    expect(anns.find((a) => a.line === 31)?.level).toBe('error');
    expect(anns.find((a) => a.line === 32)?.level).toBe('info');
    expect(anns.find((a) => a.line === 33)?.message).toBe('see line 33');
    expect(anns.some((a) => a.line === 55)).toBe(false);
    expect(anns.find((a) => a.line === 35)?.message).toBe('at 35');
    expect(anns.find((a) => a.line === 36)?.message).toBe('from lineno');
    expect(anns.find((a) => a.line === 37)?.message).toBe('RSI: 55');
    expect(anns.find((a) => a.line === 38)?.message).toBe('at 38');
    expect(anns.find((a) => a.line === 39)?.message).toBe('at 39');
    expect(anns.find((a) => a.line === 8)?.message).toBe('string line');
    const timed = anns.find((a) => a.line === 40);
    expect(timed?.message).toBe('has time');
    expect(timed).not.toHaveProperty('time');
  });

  test('prefers an explicit line over numbers in the message', () => {
    const anns = collectInlineDebug({
      logs: [{ level: 'info', message: 'RSI: 55', line: 9 }],
    });
    expect(anns).toEqual([
      { line: 9, level: 'info', message: 'RSI: 55', source: 'log' },
    ]);
  });

  test('reads meta.logs, diagnostics, meta.diagnostics, and error', () => {
    const anns = collectInlineDebug({
      meta: {
        logs: [{ level: 'debug', message: 'meta log', line: 2 }],
        diagnostics: ['warning: unused at 6'],
      },
      diagnostics: [{ line: 4, message: 'unused', severity: 'warning' }],
      error: 'Syntax error on line 8: unexpected token',
    });
    expect(anns.map((a) => a.line)).toEqual([2, 4, 6, 8]);
    expect(anns.find((a) => a.line === 2)?.source).toBe('log');
    expect(anns.find((a) => a.line === 4)).toMatchObject({
      level: 'warning',
      source: 'diagnostic',
    });
    expect(anns.find((a) => a.line === 6)).toMatchObject({
      level: 'warning',
      source: 'diagnostic',
      message: 'unused at 6',
    });
    expect(anns.find((a) => a.line === 8)).toMatchObject({
      level: 'error',
      source: 'error',
      message: 'Syntax error on line 8: unexpected token',
    });
  });

  test('ignores a non-record meta and a non-array diagnostics field', () => {
    expect(
      collectInlineDebug({
        meta: [],
        diagnostics: { line: 1, message: 'not a list' },
        logs: [{ line: 3, message: 'only', level: 'info' }],
      }),
    ).toEqual([{ line: 3, level: 'info', message: 'only', source: 'log' }]);
    expect(
      collectInlineDebug({
        meta: 'nope',
        logs: [{ line: 1, message: 'still', level: 'info' }],
      }),
    ).toEqual([{ line: 1, level: 'info', message: 'still', source: 'log' }]);
  });

  test('one chip per line, highest severity first in the message', () => {
    const anns = collectInlineDebug({
      logs: [
        { line: 1, level: 'info', message: 'a' },
        { line: 1, level: 'debug', message: 'a' },
        { line: 1, level: 'warning', message: 'b' },
        { line: 1, level: 'error', message: 'c' },
      ],
      diagnostics: [{ line: 1, severity: 'info', message: 'd' }],
      error: 'bad at line 1',
    });
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({
      line: 1,
      level: 'error',
      source: 'log',
    });
    expect(anns[0]?.message.startsWith('c · b · a')).toBe(true);
    expect(anns[0]?.message).toContain('bad at line 1');
    expect(anns[0]?.message).not.toContain('a · a');
  });

  test('same severity keeps the first message and appends a distinct one', () => {
    const anns = collectInlineDebug({
      logs: [
        { line: 4, level: 'info', message: 'first' },
        { line: 4, level: 'info', message: 'first' },
        { line: 4, level: 'info', message: 'second' },
      ],
    });
    expect(anns).toEqual([
      { line: 4, level: 'info', message: 'first · second', source: 'log' },
    ]);
  });

  test('sorts by line and caps a noisy run', () => {
    const logs = [];
    for (let line = INLINE_DEBUG_MAX_ANNOTATIONS + 5; line >= 1; line--) {
      logs.push({ line, level: 'info', message: `m${line}` });
    }
    const anns = collectInlineDebug({ logs });
    expect(anns).toHaveLength(INLINE_DEBUG_MAX_ANNOTATIONS);
    expect(anns[0]?.line).toBe(1);
    expect(anns[anns.length - 1]?.line).toBe(INLINE_DEBUG_MAX_ANNOTATIONS);
    expect(anns.some((a) => a.line === INLINE_DEBUG_MAX_ANNOTATIONS + 1)).toBe(false);
  });

  test('keeps the full message for hover and truncates only the chip', () => {
    const message = `hello\n${'x'.repeat(80)}`;
    const anns = collectInlineDebug({
      logs: [{ line: 1, level: 'info', message }],
    });
    expect(anns[0]?.message).toBe(message.trim());
    expect(anns[0]!.message.length).toBeGreaterThan(INLINE_DEBUG_CHIP_MAX);
    const chip = truncateInlineDebugChip(anns[0]!.message);
    expect(chip.length).toBe(INLINE_DEBUG_CHIP_MAX);
    expect(chip.endsWith('…')).toBe(true);
    expect(chip.includes('\n')).toBe(false);
  });

  test('does not throw when a source getter is hostile', () => {
    const record: Record<string, unknown> = {
      diagnostics: [{ line: 3, message: 'kept', severity: 'warning' }],
    };
    Object.defineProperty(record, 'logs', {
      get() {
        throw new Error('logs');
      },
    });
    expect(collectInlineDebug(record)).toEqual([
      { line: 3, level: 'warning', message: 'kept', source: 'diagnostic' },
    ]);

    const metaBoom: Record<string, unknown> = {
      logs: [{ line: 1, message: 'ok', level: 'info' }],
    };
    Object.defineProperty(metaBoom, 'meta', {
      get() {
        throw new Error('meta');
      },
    });
    expect(collectInlineDebug(metaBoom)).toEqual([
      { line: 1, level: 'info', message: 'ok', source: 'log' },
    ]);
  });

  test('skips a hostile item and a hostile error without dropping siblings', () => {
    const logs: unknown[] = [null, { line: 2, message: 'sibling', level: 'debug' }];
    Object.defineProperty(logs, 0, {
      get() {
        throw new Error('idx');
      },
    });
    const record: Record<string, unknown> = { logs };
    Object.defineProperty(record, 'error', {
      get() {
        throw new Error('error');
      },
    });
    expect(collectInlineDebug(record)).toEqual([
      { line: 2, level: 'debug', message: 'sibling', source: 'log' },
    ]);
  });

  test('message field wins over msg and text; level wins over severity', () => {
    const anns = collectInlineDebug({
      logs: [
        { line: 2, message: 'm', msg: 'g', text: 't', level: 'info', severity: 'error' },
      ],
    });
    expect(anns).toEqual([{ line: 2, level: 'info', message: 'm', source: 'log' }]);
  });

  test('string diagnostic without a line is dropped', () => {
    expect(
      collectInlineDebug({
        meta: { diagnostics: ['no line here'], logs: null },
        diagnostics: [''],
      }),
    ).toEqual([]);
  });
});
