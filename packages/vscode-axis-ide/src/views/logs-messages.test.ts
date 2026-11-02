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
  LOG_ROW_CAP,
  LOGS_EMPTY,
  LOGS_FILTERED_EMPTY,
  MAX_LOG_COPY_TEXT,
  attachLogsStore,
  countLogLevels,
  encodeLogsSet,
  filterLogs,
  logsEmptyMessage,
  logsFromRun,
  matchLogQuery,
  parseLogLine,
  parseLogsWebMessage,
  readLastRun,
  scrubLogMessage,
  type LogRow,
} from './logs-messages';
import './logs-html.test';

const HEX20 = '0123456789abcdef0123';
const HEX19 = '0123456789abcdef012';

function row(partial: Partial<LogRow> & Pick<LogRow, 'message'>): LogRow {
  return {
    level: partial.level ?? 'info',
    message: partial.message,
    line: partial.line ?? null,
    time: partial.time ?? null,
  };
}

describe('parseLogLine', () => {
  test('matches PWA line shapes and ignores RSI / close', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('see line 12 now')).toBe(12);
    expect(parseLogLine('Line:12')).toBe(12);
    expect(parseLogLine('line #12')).toBe(12);
    expect(parseLogLine('oops L12')).toBe(12);
    expect(parseLogLine('L:9')).toBe(9);
    expect(parseLogLine('src/foo.pine:12:1')).toBe(12);
    expect(parseLogLine('failed (line 12)')).toBe(12);
    expect(parseLogLine('failed at 12')).toBe(12);
    expect(parseLogLine('RSI: 55')).toBeNull();
    expect(parseLogLine('close: 14')).toBeNull();
    expect(parseLogLine('MA:20')).toBeNull();
    expect(parseLogLine('pipeline 12')).toBeNull();
    expect(parseLogLine('EL12')).toBeNull();
    expect(parseLogLine('line 0')).toBeNull();
    expect(parseLogLine('line 1000000')).toBeNull();
  });
});

describe('scrubLogMessage', () => {
  test('redacts secret-looking tokens and keeps the rest', () => {
    const hex = `pn_${HEX20}`;
    const text = scrubLogMessage(
      `use ${hex} pyn_abcdefghij Bearer abc.def API_KEY: secret and api_key="sk" tail`,
    );
    expect(text).toContain('[redacted]');
    expect(text).not.toContain(HEX20);
    expect(text).not.toContain('pyn_abcdefghij');
    expect(text).not.toContain('abc.def');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('sk');
    expect(text).toContain('use ');
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('tail');
    expect(scrubLogMessage(`pn_${HEX19} stays`)).toBe(`pn_${HEX19} stays`);
    expect(scrubLogMessage('missing api_key here')).toBe('missing api_key here');
    expect(scrubLogMessage('')).toBe('');
  });
});

describe('logsFromRun', () => {
  test('reads logs, meta, diagnostics, and one error row', () => {
    const rows = logsFromRun({
      id: 'run-9',
      status: 'error',
      logs: ['plain', { level: 'warning', msg: 'via msg', line: 3 }],
      meta: {
        logs: [{ severity: 'debug', text: 'via text', ts: 42 }],
        diagnostics: ['meta diag at 8'],
      },
      diagnostics: { message: 'diag', line_no: '15', time: 't0' },
      error: 'boom at 2',
    });
    expect(rows.map((r) => r.message)).toEqual([
      'plain',
      'via msg',
      'via text',
      'diag',
      'meta diag at 8',
      'boom at 2',
    ]);
    expect(rows[1]).toMatchObject({ level: 'warning', line: 3, time: null });
    expect(rows[2]).toMatchObject({ level: 'debug', time: '42', line: null });
    expect(rows[3]).toMatchObject({ level: 'info', line: 15, time: 't0' });
    expect(rows[4]).toMatchObject({ level: 'info', line: 8 });
    expect(rows[5]).toMatchObject({ level: 'error', line: 2 });
  });

  test('prefers structured line and time, then text and ts', () => {
    expect(
      logsFromRun({
        logs: [
          { message: 'line 9', line: 2, lineno: 8, time: 'keep', ts: 'drop' },
          { message: 'line 4', line: 0, ts: 'later' },
          { msg: '   ', text: 'from text', severity: 'warn' },
          { message: '   ', msg: 'from msg' },
          { text: Number.NaN },
          { message: false, text: 'kept' },
          { lineno: 6, message: 'no line word' },
          { line_no: 7, text: 'only text' },
        ],
      }),
    ).toEqual([
      row({ message: 'line 9', line: 2, time: 'keep' }),
      row({ message: 'line 4', line: 4, time: 'later' }),
      row({ level: 'warning', message: 'from text' }),
      row({ message: 'from msg' }),
      row({ message: 'kept' }),
      row({ message: 'no line word', line: 6 }),
      row({ message: 'only text', line: 7 }),
    ]);
  });

  test('normalizes levels, prefixes, tuples, and numbers', () => {
    const rows = logsFromRun({
      logs: [
        'error: bad at 12',
        'error:',
        'debug: pyn_abcdefghij',
        'information: ok',
        { level: 0, message: 'sev0' },
        { level: 1, message: 'sev1' },
        { level: 2, message: 'sev2' },
        { level: 3, message: 'sev3' },
        { level: -1, message: 'neg' },
        { level: Number.NaN, message: 'nan' },
        { severity: '1', message: 'sev str' },
        { level: 'fatal', message: 'fatal' },
        { level: 'critical', message: 'crit' },
        { level: 'trace', message: 'trace' },
        { level: 'hint', message: 'hint' },
        { level: 'log', message: 'log' },
        { level: 'err', message: 'err' },
        { level: 'ERROR', message: 'upper' },
        { level: 'nope', message: 'fallback' },
        ['warn', 'tuple', 4, '12:01'],
        ['info', 'at 12'],
        ['info', 'at 12', 4],
        ['1', 'numeric level', 5, 1700],
        [1, 'num level', 2],
        ['see line 6', 'warning'],
        ['see line 7', 'nope'],
        ['only'],
        [42],
        [[]],
        [['nested']],
        [true],
        ['error', '   '],
        [null, 'warning'],
        false,
        '   ',
      ],
      error: ['info', 'forced', 9, 'te'],
    });
    const byMessage = Object.fromEntries(rows.map((r) => [r.message, r]));
    expect(byMessage['bad at 12']).toMatchObject({ level: 'error', line: 12 });
    expect(byMessage['error:']).toMatchObject({ level: 'error', line: null });
    expect(byMessage['[redacted]']).toMatchObject({ level: 'debug' });
    expect(byMessage.ok.level).toBe('info');
    expect(byMessage.sev0.level).toBe('error');
    expect(byMessage.sev1.level).toBe('warning');
    expect(byMessage.sev2.level).toBe('info');
    expect(byMessage.sev3.level).toBe('debug');
    expect(byMessage.neg.level).toBe('info');
    expect(byMessage.nan.level).toBe('info');
    expect(byMessage['sev str'].level).toBe('warning');
    expect(byMessage.fatal.level).toBe('error');
    expect(byMessage.crit.level).toBe('error');
    expect(byMessage.trace.level).toBe('debug');
    expect(byMessage.hint.level).toBe('debug');
    expect(byMessage.log.level).toBe('info');
    expect(byMessage.err.level).toBe('error');
    expect(byMessage.upper.level).toBe('error');
    expect(byMessage.fallback.level).toBe('info');
    expect(byMessage.tuple).toMatchObject({ level: 'warning', line: 4, time: '12:01' });
    expect(rows.filter((r) => r.message === 'at 12').map((r) => r.line)).toEqual([12, 4]);
    expect(byMessage['numeric level']).toMatchObject({ level: 'warning', line: 5, time: '1700' });
    expect(byMessage['num level']).toMatchObject({ level: 'warning', line: 2, time: null });
    expect(byMessage['see line 6']).toMatchObject({ level: 'warning', line: 6 });
    expect(byMessage['see line 7']).toMatchObject({ level: 'info', line: 7 });
    expect(byMessage.only.level).toBe('info');
    expect(byMessage['42']).toMatchObject({ level: 'info', line: null, time: null });
    expect(byMessage.forced).toMatchObject({ level: 'error', line: 9, time: 'te' });
    expect(rows.some((r) => r.message === 'true')).toBe(false);
  });

  test('accepts a single string or object and ignores empty sources', () => {
    expect(logsFromRun({ logs: 'line 3' })).toEqual([row({ message: 'line 3', line: 3 })]);
    expect(logsFromRun({ logs: { message: 'obj' } })).toEqual([row({ message: 'obj' })]);
    expect(logsFromRun({ logs: '', meta: null, diagnostics: 0, error: '' })).toEqual([]);
    expect(logsFromRun({ error: 7 })).toEqual([row({ level: 'error', message: '7' })]);
    expect(logsFromRun({ error: { level: 'info', message: 'obj err', line: ' 12 ' } })).toEqual([
      row({ level: 'error', message: 'obj err', line: 12 }),
    ]);
    expect(logsFromRun(null)).toEqual([]);
    expect(logsFromRun(1)).toEqual([]);
    expect(logsFromRun(undefined)).toEqual([]);
  });

  test('caps at 200 and still reads later sources when earlier ones throw', () => {
    const full = Array.from({ length: LOG_ROW_CAP }, (_, i) => `m${i}`);
    const capped = logsFromRun({ logs: full, diagnostics: ['extra'], error: 'boom' });
    expect(capped).toHaveLength(LOG_ROW_CAP);
    expect(capped.some((r) => r.message === 'boom' || r.message === 'extra')).toBe(false);

    const almost = logsFromRun({
      logs: Array.from({ length: LOG_ROW_CAP - 1 }, () => 'a'),
      error: 'boom line 4',
    });
    expect(almost).toHaveLength(LOG_ROW_CAP);
    expect(almost[LOG_ROW_CAP - 1]).toMatchObject({ level: 'error', message: 'boom line 4', line: 4 });

    const hostile: { meta: { logs: string[] } } = {
      meta: { logs: ['from-meta'] },
    };
    Object.defineProperty(hostile, 'logs', {
      get() {
        throw new Error('logs');
      },
    });
    expect(logsFromRun(hostile).map((r) => r.message)).toEqual(['from-meta']);

    const list = ['keep', 'drop'];
    const proxied = new Proxy(list, {
      get(target, prop, receiver) {
        if (prop === '1') throw new Error('index');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(logsFromRun({ logs: proxied }).map((r) => r.message)).toEqual(['keep']);

    const brokenLen = new Proxy(['nope'], {
      get(target, prop, receiver) {
        if (prop === 'length') throw new Error('length');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(logsFromRun({ logs: brokenLen, error: 'still' })).toEqual([
      row({ level: 'error', message: 'still' }),
    ]);

    const weirdLen = new Proxy(['x'], {
      get(target, prop, receiver) {
        if (prop === 'length') return Number.NaN;
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(logsFromRun({ logs: weirdLen })).toEqual([]);
  });

  test('scrubs secrets inside rows', () => {
    const rows = logsFromRun({
      logs: [`note Bearer tok_1 api_key=super pn_${HEX20}`],
    });
    expect(rows[0]?.message).toBe('note Bearer [redacted] api_key=[redacted] [redacted]');
    expect(rows[0]?.message).not.toContain('tok_1');
    expect(rows[0]?.message).not.toContain('super');
    expect(rows[0]?.message).not.toContain(HEX20);
  });
});

describe('filterLogs', () => {
  test('filters by level, caps, and never throws', () => {
    const rows = [
      row({ level: 'error', message: 'e', line: 1, time: 't' }),
      row({ level: 'warning', message: 'w' }),
      row({ level: 'info', message: 'i', line: 1.5 as never, time: 1 as never }),
      row({ level: 'debug', message: 'd' }),
      { level: 'nope', message: 'x' },
      { message: 'missing level' },
      'str',
    ];
    expect(filterLogs(rows, 'all')).toEqual([
      row({ level: 'error', message: 'e', line: 1, time: 't' }),
      row({ level: 'warning', message: 'w' }),
      row({ level: 'info', message: 'i' }),
      row({ level: 'debug', message: 'd' }),
    ]);
    expect(filterLogs(rows, ' Error ').map((r) => r.message)).toEqual(['e']);
    expect(filterLogs(rows, 'debug')).toHaveLength(1);
    expect(filterLogs(rows, null)).toHaveLength(4);
    expect(filterLogs(rows, '   ')).toHaveLength(4);
    expect(filterLogs(rows, 'verbose')).toEqual([]);
    expect(filterLogs(rows, 1)).toEqual([]);
    expect(filterLogs(null, 'all')).toEqual([]);
    expect(filterLogs('nope', 'all')).toEqual([]);

    const many = Array.from({ length: LOG_ROW_CAP + 5 }, (_, i) =>
      row({ level: 'info', message: `n${i}` }),
    );
    expect(filterLogs(many, 'all')).toHaveLength(LOG_ROW_CAP);

    const copy = filterLogs([row({ message: 'a' })], 'all');
    copy[0]!.message = 'changed';
    expect(rows).not.toContainEqual(row({ message: 'changed' }));

    const throwing = [row({ message: 'a' }), row({ level: 'error', message: 'b', line: 2 })];
    const proxied = new Proxy(throwing, {
      get(target, prop, receiver) {
        if (prop === '0') throw new Error('idx');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(filterLogs(proxied, 'all')).toEqual([row({ level: 'error', message: 'b', line: 2 })]);

    const badLen = new Proxy([row({ message: 'a' })], {
      get(target, prop, receiver) {
        if (prop === 'length') throw new Error('len');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(filterLogs(badLen, 'all')).toEqual([]);

    const hostileLevel = [
      {
        get level(): string {
          throw new Error('lvl');
        },
        message: 'm',
        line: null,
        time: null,
      },
    ];
    expect(filterLogs(hostileLevel, 'all')).toEqual([]);
  });

  test('filters by message query (case-insensitive substring)', () => {
    const rows = [
      row({ level: 'error', message: 'Boom at close' }),
      row({ level: 'info', message: 'RSI ready' }),
      row({ level: 'warning', message: 'close gap' }),
    ];
    expect(filterLogs(rows, 'all', 'CLOSE').map((r) => r.message)).toEqual([
      'Boom at close',
      'close gap',
    ]);
    expect(filterLogs(rows, 'error', 'close').map((r) => r.message)).toEqual(['Boom at close']);
    expect(filterLogs(rows, 'all', 'nope')).toEqual([]);
    expect(filterLogs(rows, 'all', '   ')).toHaveLength(3);
    expect(filterLogs(rows, 'all', null)).toHaveLength(3);
    expect(filterLogs(rows, 'all', 1)).toEqual([]);
    expect(matchLogQuery('Hello', 'hel')).toBe(true);
    expect(matchLogQuery('Hello', '')).toBe(true);
    expect(matchLogQuery('Hello', null)).toBe(true);
    expect(matchLogQuery('Hello', 1)).toBe(false);
    expect(matchLogQuery(1, 'a')).toBe(false);
  });
});

describe('countLogLevels / logsEmptyMessage', () => {
  test('counts levels and picks empty copy', () => {
    const rows = [
      row({ level: 'error', message: 'e' }),
      row({ level: 'error', message: 'e2' }),
      row({ level: 'warning', message: 'w' }),
      row({ level: 'info', message: 'i' }),
      row({ level: 'debug', message: 'd' }),
      { level: 'nope', message: 'x' },
    ];
    expect(countLogLevels(rows)).toEqual({
      all: 5,
      error: 2,
      warning: 1,
      info: 1,
      debug: 1,
    });
    expect(countLogLevels(null)).toEqual({ all: 0, error: 0, warning: 0, info: 0, debug: 0 });
    expect(countLogLevels('nope')).toEqual({ all: 0, error: 0, warning: 0, info: 0, debug: 0 });
    expect(logsEmptyMessage(0, 0)).toBe(LOGS_EMPTY);
    expect(logsEmptyMessage(3, 0)).toBe(LOGS_FILTERED_EMPTY);
    expect(logsEmptyMessage(3, 2)).toBe('');
    expect(logsEmptyMessage(-1, 'x')).toBe(LOGS_EMPTY);
    expect(logsEmptyMessage(2, Number.NaN)).toBe(LOGS_FILTERED_EMPTY);
  });
});

describe('encodeLogsSet / parseLogsWebMessage', () => {
  test('encodes run id and status without throwing', () => {
    const encoded = encodeLogsSet({
      id: 'run-1',
      runId: 'other',
      status: '  error  ',
      logs: ['hi'],
    });
    expect(encoded).toEqual({
      type: 'logs.set',
      rows: [row({ message: 'hi' })],
      runId: 'run-1',
      status: 'error',
    });
    expect(encodeLogsSet({ runId: 4, status: '   ', logs: [] })).toMatchObject({
      runId: '4',
      status: null,
      rows: [],
    });
    expect(encodeLogsSet({ status: 1 })).toMatchObject({ runId: null, status: null, rows: [] });
    const boom = new Proxy(
      {},
      {
        get() {
          throw new Error('record');
        },
      },
    );
    expect(encodeLogsSet(boom)).toEqual({
      type: 'logs.set',
      rows: [],
      runId: null,
      status: null,
    });
  });

  test('parses reveal, filter, copy, and ready', () => {
    expect(parseLogsWebMessage({ type: 'logs.ready', payload: { line: 1 } })).toEqual({
      type: 'logs.ready',
    });
    expect(parseLogsWebMessage({ type: 'logs.reveal', line: 4 })).toEqual({
      type: 'logs.reveal',
      line: 4,
    });
    expect(parseLogsWebMessage({ type: 'logs.reveal', payload: { line: '8' } })).toEqual({
      type: 'logs.reveal',
      line: 8,
    });
    expect(parseLogsWebMessage({ type: 'logs.reveal', line: 0 })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.reveal', line: 1.5 })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.filter', level: 'Warning' })).toEqual({
      type: 'logs.filter',
      level: 'warning',
    });
    expect(parseLogsWebMessage({ type: 'logs.filter', payload: { level: 'debug' } })).toEqual({
      type: 'logs.filter',
      level: 'debug',
    });
    expect(parseLogsWebMessage({ type: 'logs.filter', level: '' })).toEqual({
      type: 'logs.filter',
      level: 'all',
    });
    expect(parseLogsWebMessage({ type: 'logs.filter', level: 1 })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.filter', level: 'verbose' })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.copy', text: 'hello' })).toEqual({
      type: 'logs.copy',
      text: 'hello',
    });
    expect(parseLogsWebMessage({ type: 'logs.copy', payload: { text: 'via payload' } })).toEqual({
      type: 'logs.copy',
      text: 'via payload',
    });
    expect(parseLogsWebMessage({ type: 'logs.copy', text: '' })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.copy', text: 'x'.repeat(MAX_LOG_COPY_TEXT + 1) })).toBeNull();
    expect(parseLogsWebMessage({ type: 'logs.copy', text: 'x'.repeat(MAX_LOG_COPY_TEXT) })).toEqual({
      type: 'logs.copy',
      text: 'x'.repeat(MAX_LOG_COPY_TEXT),
    });
    expect(parseLogsWebMessage({ type: 'logs.copy', text: 1 })).toBeNull();
    expect(parseLogsWebMessage({ type: 'nope' })).toBeNull();
    expect(parseLogsWebMessage([])).toBeNull();
    expect(parseLogsWebMessage(null)).toBeNull();
    expect(parseLogsWebMessage('logs.ready')).toBeNull();
  });
});

describe('attachLogsStore', () => {
  test('reads getLastRun and follows lastRun snapshots', () => {
    const seen: unknown[] = [];
    let current: unknown = { id: 'a', logs: ['one'] };
    const listeners = new Set<(snap: unknown) => void>();
    const store = {
      getLastRun() {
        return current;
      },
      subscribe(listener: (snap: unknown) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit(snapshot: unknown) {
        for (const listener of listeners) listener(snapshot);
      },
      set(next: unknown) {
        current = next;
      },
    };
    const unsub = attachLogsStore(store, (record) => {
      seen.push(record);
    });
    expect(seen).toEqual([current]);
    store.emit({ lastRun: { id: 'b' } });
    store.emit({ focusChanged: true });
    store.set({ id: 'c' });
    store.emit(null);
    store.emit({ lastRun: null });
    store.emit({ lastRun: undefined });
    unsub();
    store.emit({ lastRun: { id: 'after' } });
    expect(seen.map((r) => (r && typeof r === 'object' ? (r as { id?: string }).id : r))).toEqual([
      'a',
      'b',
      'a',
      'c',
      null,
      null,
    ]);
  });

  test('swallows hostile stores, listeners, and unsubscribe', () => {
    expect(readLastRun(null)).toBeNull();
    expect(readLastRun([])).toBeNull();
    expect(readLastRun({})).toBeNull();
    expect(
      readLastRun({
        getLastRun() {
          throw new Error('get');
        },
      }),
    ).toBeNull();
    const throwingGet = {};
    Object.defineProperty(throwingGet, 'getLastRun', {
      get() {
        throw new Error('getter');
      },
    });
    expect(readLastRun(throwingGet)).toBeNull();

    const seen: unknown[] = [];
    const unsubThrow = attachLogsStore(
      {
        getLastRun() {
          return { id: 'init' };
        },
        subscribe(listener: (snap: unknown) => void) {
          listener({ lastRun: { id: 'snap' } });
          return () => {
            throw new Error('unsub');
          };
        },
      },
      () => {
        seen.push('hit');
        throw new Error('listener');
      },
    );
    expect(seen).toEqual(['hit', 'hit']);
    expect(() => unsubThrow()).not.toThrow();

    const noopUnsub = attachLogsStore(
      {
        getLastRun() {
          throw new Error('get');
        },
        subscribe() {
          throw new Error('sub');
        },
      },
      () => {},
    );
    expect(() => noopUnsub()).not.toThrow();

    let fallback: unknown = 'missing';
    attachLogsStore([], (record) => {
      fallback = record;
    });
    expect(fallback).toBeNull();

    expect(attachLogsStore({ getLastRun: () => ({ id: 'x' }) }, undefined as never)).toBeTypeOf(
      'function',
    );

    const noSub = attachLogsStore({ getLastRun: () => ({ id: 'only' }) }, () => {});
    expect(() => noSub()).not.toThrow();

    const nonFn = attachLogsStore(
      {
        getLastRun() {
          return null;
        },
        subscribe() {
          return 1;
        },
      },
      () => {},
    );
    expect(() => nonFn()).not.toThrow();

    const owned = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('own');
        },
      },
    );
    let fromProxy: unknown = 'unset';
    attachLogsStore(
      {
        getLastRun() {
          return { id: 'fallback' };
        },
        subscribe(listener: (snap: unknown) => void) {
          listener(owned);
          return () => {};
        },
      },
      (record) => {
        fromProxy = record;
      },
    );
    expect(fromProxy).toEqual({ id: 'fallback' });
  });
});
