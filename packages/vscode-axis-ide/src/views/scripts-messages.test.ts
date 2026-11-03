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
  SCRIPTS_APPLY_BUILTIN_COMMAND,
  SCRIPTS_EMPTY_RUN,
  SCRIPTS_OPEN_CHART_COMMAND,
  SCRIPTS_RUN_COMMAND,
  SCRIPTS_SUGGESTION_MAX,
  buildScriptsSnapshot,
  encodeScriptsNotice,
  encodeScriptsSet,
  parseScriptsWebMessage,
  readRunEpoch,
  scriptRunCardFromLastRun,
  scriptSuggestionFromEntry,
  unwrapRunRecord,
} from './scripts-messages';

function boom(key: string): Record<string, unknown> {
  return {
    get [key]() {
      throw new Error(`get ${key}`);
    },
  };
}

describe('scripts command ids', () => {
  test('match package.json', () => {
    expect(SCRIPTS_RUN_COMMAND).toBe('axis.runScript');
    expect(SCRIPTS_OPEN_CHART_COMMAND).toBe('axis.openChart');
    expect(SCRIPTS_APPLY_BUILTIN_COMMAND).toBe('axis.applyBuiltin');
    expect(SCRIPTS_SUGGESTION_MAX).toBe(8);
    expect(SCRIPTS_EMPTY_RUN).toContain('Ctrl+Enter');
  });
});

describe('unwrapRunRecord', () => {
  test('rejects non-objects and null nested lastRun', () => {
    expect(unwrapRunRecord(null)).toBeNull();
    expect(unwrapRunRecord(undefined)).toBeNull();
    expect(unwrapRunRecord([])).toBeNull();
    expect(unwrapRunRecord('run')).toBeNull();
    expect(unwrapRunRecord(1)).toBeNull();
    expect(unwrapRunRecord({ lastRun: null })).toBeNull();
    expect(unwrapRunRecord({ lastRun: [] })).toBeNull();
    expect(unwrapRunRecord({ lastRun: 'x' })).toBeNull();
    expect(unwrapRunRecord(boom('lastRun'))).toBeNull();
  });

  test('returns the record or nested lastRun', () => {
    const row = { id: 'run-1' };
    expect(unwrapRunRecord(row)).toBe(row);
    expect(unwrapRunRecord({ lastRun: row })).toBe(row);
  });
});

describe('scriptRunCardFromLastRun', () => {
  test('maps a results lastRun, series key, and success → ok', () => {
    const card = scriptRunCardFromLastRun({
      id: 'run-1',
      status: 'success',
      seriesKey: 'binance|spot|BTC/USDT|1m',
      engineId: 'server',
      createdAt: 1_700_000_000_000,
      meta: { script_name: 'AXIS SMA', ms: 12 },
    });
    expect(card).toEqual({
      title: 'AXIS SMA',
      symbol: 'BTC/USDT',
      interval: '1m',
      mode: 'server',
      status: 'ok',
      error: '',
      at: 1_700_000_000_000,
    });
  });

  test('unwraps a focus snapshot and prefers explicit symbol, interval, mode', () => {
    const card = scriptRunCardFromLastRun({
      lastRun: {
        id: 'run-2',
        status: 'error',
        seriesKey: 'binance|spot|ETH/USDT|5m',
        engineId: 'server',
        error: '  boom  ',
        meta: { symbol: 'ETHUSDT', interval: '15m', mode: 'auto' },
      },
    });
    expect(card).toMatchObject({
      title: 'run-2',
      symbol: 'ETHUSDT',
      interval: '15m',
      mode: 'auto',
      status: 'error',
      error: 'boom',
    });
  });

  test('title fallbacks: meta title, meta name, record title, id, Script', () => {
    expect(
      scriptRunCardFromLastRun({ status: 'ok', meta: { title: 'Meta title' } })?.title,
    ).toBe('Meta title');
    expect(
      scriptRunCardFromLastRun({ status: 'ok', meta: { name: 'Meta name' } })?.title,
    ).toBe('Meta name');
    expect(scriptRunCardFromLastRun({ title: 'Rec', status: 'ok' })?.title).toBe('Rec');
    expect(scriptRunCardFromLastRun({ id: 'only-id' })?.title).toBe('only-id');
    expect(scriptRunCardFromLastRun({ status: 'success' })).toEqual({
      title: 'Script',
      symbol: '',
      interval: '',
      mode: '',
      status: 'ok',
      error: '',
      at: 0,
    });
  });

  test('interval timeframe, record mode, engineId, and partial series keys', () => {
    expect(
      scriptRunCardFromLastRun({
        id: 'a',
        seriesKey: 'binance|spot|SOL/USDT|1h|extra',
        meta: { timeframe: '4h' },
        mode: 'compile',
      }),
    ).toMatchObject({ symbol: 'SOL/USDT', interval: '4h', mode: 'compile' });
    expect(
      scriptRunCardFromLastRun({
        id: 'b',
        seriesKey: 'only-three|parts|nope',
        engineId: 'server',
      }),
    ).toMatchObject({ symbol: '', interval: '', mode: 'server' });
    expect(
      scriptRunCardFromLastRun({ id: 'c', seriesKey: 'a|b|C|' }),
    ).toMatchObject({ symbol: 'C', interval: '' });
  });

  test('status words and error-without-status', () => {
    expect(scriptRunCardFromLastRun({ id: 'e', status: 'ERR' })?.status).toBe('error');
    expect(scriptRunCardFromLastRun({ id: 'e', status: 'error' })?.status).toBe('error');
    expect(scriptRunCardFromLastRun({ id: 'e', status: 'Success' })?.status).toBe('ok');
    expect(scriptRunCardFromLastRun({ id: 'e', status: 'OK' })?.status).toBe('ok');
    expect(scriptRunCardFromLastRun({ id: 'e', status: 'nope' })?.status).toBe('ok');
    expect(
      scriptRunCardFromLastRun({ id: 'e', status: 'nope', error: 'x' })?.status,
    ).toBe('error');
    expect(scriptRunCardFromLastRun({ id: 'e', error: 'x' })?.status).toBe('error');
    expect(scriptRunCardFromLastRun({ id: 'e', error: '   ' })?.error).toBe('');
  });

  test('timestamps: createdAt, at, meta.at, meta.createdAt, rejects non-finite', () => {
    expect(scriptRunCardFromLastRun({ id: 't', at: 50 })?.at).toBe(50);
    expect(scriptRunCardFromLastRun({ id: 't', createdAt: 0, at: 8 })?.at).toBe(8);
    expect(scriptRunCardFromLastRun({ id: 't', createdAt: -1, at: 9 })?.at).toBe(9);
    expect(scriptRunCardFromLastRun({ id: 't', meta: { at: 3 } })?.at).toBe(3);
    expect(scriptRunCardFromLastRun({ id: 't', meta: { createdAt: 4 } })?.at).toBe(4);
    expect(
      scriptRunCardFromLastRun({ id: 't', createdAt: Number.NaN, at: Number.POSITIVE_INFINITY })
        ?.at,
    ).toBe(0);
    expect(scriptRunCardFromLastRun({ id: 't', meta: [] })?.at).toBe(0);
    expect(scriptRunCardFromLastRun({ id: 't', meta: 'nope' })?.at).toBe(0);
  });

  test('each run signal is enough on its own', () => {
    expect(scriptRunCardFromLastRun({ seriesKey: 'binance|spot|BTC/USDT|1m' })).toMatchObject({
      title: 'Script',
      symbol: 'BTC/USDT',
      interval: '1m',
    });
    expect(scriptRunCardFromLastRun({ engineId: 'server' })).toMatchObject({
      title: 'Script',
      mode: 'server',
    });
    expect(scriptRunCardFromLastRun({ meta: { title: 'Only meta' } })?.title).toBe('Only meta');
    expect(scriptRunCardFromLastRun({ createdAt: 42 })).toMatchObject({ title: 'Script', at: 42 });
    expect(scriptRunCardFromLastRun({ id: 't', at: -2 })?.at).toBe(0);
    expect(scriptRunCardFromLastRun({ id: 't', meta: { at: 0, createdAt: 11 } })?.at).toBe(11);
    expect(scriptRunCardFromLastRun({ id: 't', meta: { at: -1, createdAt: 0 } })?.at).toBe(0);
  });

  test('empty and hostile records do not throw', () => {
    expect(scriptRunCardFromLastRun(null)).toBeNull();
    expect(scriptRunCardFromLastRun({})).toBeNull();
    expect(scriptRunCardFromLastRun({ meta: { script_name: 'Named' } })?.title).toBe('Named');
    const hostile = {
      get id() {
        throw new Error('id');
      },
      status: 'success',
      get seriesKey() {
        throw new Error('series');
      },
      get title() {
        throw new Error('title');
      },
      get engineId() {
        throw new Error('engine');
      },
      get error() {
        throw new Error('error');
      },
      get createdAt() {
        throw new Error('created');
      },
      get at() {
        throw new Error('at');
      },
      get meta() {
        throw new Error('meta');
      },
      get mode() {
        throw new Error('mode');
      },
      get epoch() {
        throw new Error('epoch');
      },
    };
    expect(scriptRunCardFromLastRun(hostile)).toEqual({
      title: 'Script',
      symbol: '',
      interval: '',
      mode: '',
      status: 'ok',
      error: '',
      at: 0,
    });
    expect(readRunEpoch(hostile)).toBeNull();
  });
});

describe('readRunEpoch', () => {
  test('record epoch beats meta; negative falls through; zero is kept', () => {
    expect(readRunEpoch(null)).toBeNull();
    expect(readRunEpoch({ id: 'a' })).toBeNull();
    expect(readRunEpoch({ id: 'a', epoch: 0, meta: { epoch: 9 } })).toBe(0);
    expect(readRunEpoch({ id: 'a', epoch: 4, meta: { epoch: 9 } })).toBe(4);
    expect(readRunEpoch({ id: 'a', epoch: -1, meta: { epoch: 2 } })).toBe(2);
    expect(readRunEpoch({ id: 'a', epoch: Number.NaN, meta: { epoch: -3, runEpoch: 6 } })).toBe(
      6,
    );
    expect(readRunEpoch({ id: 'a', meta: { epoch: 'nope', runEpoch: 1 } })).toBe(1);
    expect(readRunEpoch({ id: 'a', meta: [] })).toBeNull();
    expect(readRunEpoch({ id: 'a', meta: { epoch: Number.POSITIVE_INFINITY } })).toBeNull();
    expect(readRunEpoch({ id: 'a', meta: { runEpoch: -1 } })).toBeNull();
    expect(readRunEpoch({ id: 'a', meta: { runEpoch: 0 } })).toBe(0);
    expect(
      readRunEpoch({
        get epoch() {
          throw new Error('epoch');
        },
        id: 'a',
        meta: { runEpoch: 3 },
      }),
    ).toBe(3);
  });
});

describe('scriptSuggestionFromEntry', () => {
  test('keeps id, title, kind, category and drops code', () => {
    const row = scriptSuggestionFromEntry({
      id: ' sma ',
      title: 'AXIS SMA',
      kind: 'indicator',
      category: 'moving-average',
      categoryLabel: 'Moving averages',
      code: '//@version=6\nindicator("nope")',
    });
    expect(row).toEqual({
      id: 'sma',
      title: 'AXIS SMA',
      kind: 'indicator',
      category: 'Moving averages',
    });
    expect(row).not.toHaveProperty('code');
    expect(scriptSuggestionFromEntry({ id: 'bare', category: 'osc' })).toEqual({
      id: 'bare',
      title: 'bare',
      kind: 'indicator',
      category: 'osc',
    });
    expect(scriptSuggestionFromEntry({ id: 's', kind: 'strategy' })?.kind).toBe('strategy');
    expect(scriptSuggestionFromEntry(null)).toBeNull();
    expect(scriptSuggestionFromEntry([])).toBeNull();
    expect(scriptSuggestionFromEntry({ id: '   ' })).toBeNull();
    expect(scriptSuggestionFromEntry({ title: 'no id' })).toBeNull();
    expect(scriptSuggestionFromEntry(boom('id'))).toBeNull();
  });
});

describe('buildScriptsSnapshot', () => {
  test('caps at 8, skips dupes and junk, strips pine source', () => {
    const suggestions = [];
    for (let i = 0; i < 9; i += 1) {
      suggestions.push({
        id: `s${i}`,
        title: `T${i}`,
        kind: 'indicator',
        categoryLabel: 'Cat',
        code: `//@version=6 secret ${i}`,
      });
    }
    suggestions.splice(3, 0, { id: 's0', title: 'dup', code: 'nope' });
    suggestions.push(null, { id: '' }, 'bad');
    const snap = buildScriptsSnapshot({
      lastRun: {
        id: 'run-9',
        status: 'success',
        seriesKey: 'binance|spot|BTC/USDT|1m',
        engineId: 'server',
        meta: { script_name: 'AXIS SMA', epoch: 7 },
        createdAt: 10,
      },
      suggestions,
    });
    expect(snap.suggestions).toHaveLength(8);
    expect(snap.suggestions.map((s) => s.id)).toEqual([
      's0',
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
    ]);
    expect(snap.lastRun?.title).toBe('AXIS SMA');
    expect(snap.epoch).toBe(7);
    const packed = JSON.stringify(snap);
    expect(packed).not.toContain('code');
    expect(packed).not.toContain('@version');
    expect(packed).not.toContain('secret');
  });

  test('non-objects and hostile getters', () => {
    expect(buildScriptsSnapshot(null)).toEqual({
      lastRun: null,
      suggestions: [],
      epoch: null,
    });
    expect(buildScriptsSnapshot(undefined)).toEqual({
      lastRun: null,
      suggestions: [],
      epoch: null,
    });
    expect(buildScriptsSnapshot([])).toEqual({
      lastRun: null,
      suggestions: [],
      epoch: null,
    });
    expect(buildScriptsSnapshot('nope').suggestions).toEqual([]);
    expect(buildScriptsSnapshot({ suggestions: { id: 'sma' } }).suggestions).toEqual([]);
    expect(buildScriptsSnapshot({ lastRun: null, suggestions: null }).lastRun).toBeNull();
    const hostile = {
      get lastRun() {
        throw new Error('last');
      },
      get suggestions() {
        throw new Error('sug');
      },
    };
    expect(buildScriptsSnapshot(hostile)).toEqual({
      lastRun: null,
      suggestions: [],
      epoch: null,
    });
    expect(
      buildScriptsSnapshot({
        get lastRun() {
          throw new Error('last');
        },
        suggestions: [{ id: 'sma', title: 'SMA', kind: 'indicator', category: 'ma' }],
      }).suggestions,
    ).toEqual([{ id: 'sma', title: 'SMA', kind: 'indicator', category: 'ma' }]);
  });
});

describe('parseScriptsWebMessage', () => {
  test('accepts ready, run, openChart, and apply', () => {
    expect(parseScriptsWebMessage({ type: 'scripts.ready' })).toEqual({
      type: 'scripts.ready',
    });
    expect(parseScriptsWebMessage({ type: ' scripts.run ' })).toEqual({ type: 'scripts.run' });
    expect(parseScriptsWebMessage({ type: 'scripts.openChart' })).toEqual({
      type: 'scripts.openChart',
    });
    expect(parseScriptsWebMessage({ type: 'scripts.apply', id: ' sma ' })).toEqual({
      type: 'scripts.apply',
      id: 'sma',
    });
    expect(
      parseScriptsWebMessage({
        type: 'scripts.apply',
        id: 'sma',
        payload: { id: 'ema' },
      }),
    ).toEqual({ type: 'scripts.apply', id: 'sma' });
    expect(parseScriptsWebMessage({ type: 'scripts.apply', payload: { id: 'ema' } })).toEqual({
      type: 'scripts.apply',
      id: 'ema',
    });
  });

  test('rejects junk and hostile messages', () => {
    expect(parseScriptsWebMessage(null)).toBeNull();
    expect(parseScriptsWebMessage(undefined)).toBeNull();
    expect(parseScriptsWebMessage([])).toBeNull();
    expect(parseScriptsWebMessage('scripts.run')).toBeNull();
    expect(parseScriptsWebMessage(1)).toBeNull();
    expect(parseScriptsWebMessage(true)).toBeNull();
    expect(parseScriptsWebMessage({})).toBeNull();
    expect(parseScriptsWebMessage({ type: 1 })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.nope' })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.apply' })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.apply', id: '   ' })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.apply', id: 4 })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.apply', payload: [] })).toBeNull();
    expect(parseScriptsWebMessage({ type: 'scripts.apply', payload: { id: '' } })).toBeNull();
    expect(parseScriptsWebMessage(boom('type'))).toBeNull();
    expect(
      parseScriptsWebMessage({
        type: 'scripts.apply',
        id: '',
        get payload() {
          throw new Error('payload');
        },
      }),
    ).toBeNull();
  });
});

describe('encode host messages', () => {
  test('scripts.set and scripts.notice', () => {
    const set = encodeScriptsSet({
      lastRun: { id: 'run-1', status: 'success', meta: { script_name: 'A' } },
      suggestions: [{ id: 'sma', title: 'SMA', code: 'hidden' }],
    });
    expect(set.type).toBe('scripts.set');
    if (set.type !== 'scripts.set') return;
    expect(set.snapshot.lastRun?.title).toBe('A');
    expect(set.snapshot.suggestions[0]).toEqual({
      id: 'sma',
      title: 'SMA',
      kind: 'indicator',
      category: '',
    });
    expect(JSON.stringify(set)).not.toContain('hidden');
    expect(encodeScriptsNotice('  Applied  ')).toEqual({
      type: 'scripts.notice',
      text: 'Applied',
    });
    expect(encodeScriptsNotice('Run started').text).toBe('Run started');
    expect(encodeScriptsNotice(1)).toEqual({ type: 'scripts.notice', text: '' });
    expect(encodeScriptsNotice(null)).toEqual({ type: 'scripts.notice', text: '' });
    expect(encodeScriptsNotice(undefined).text).toBe('');
  });
});
