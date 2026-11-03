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

import { beforeEach, describe, expect, it } from 'bun:test';
import { HOST_TO_VIEW, PROTOCOL_VERSION, VIEW_TO_HOST, encode } from '../protocol';
import { ResultsFocusStore } from '../run/results-store';
import {
  encodeResultsAction,
  encodeResultsSet,
  handleResultsWebviewMessage,
  parseResultsActionMessage,
} from './results-messages';

describe('parseResultsActionMessage / encodeResultsAction', () => {
  it('parses copyId with text and focus kinds', () => {
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'copyId', text: 'run-1' })).toEqual({
      type: 'results.action',
      kind: 'copyId',
      text: 'run-1',
    });
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'focusProfiler' })).toEqual({
      type: 'results.action',
      kind: 'focusProfiler',
    });
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'focusLogs' })).toEqual({
      type: 'results.action',
      kind: 'focusLogs',
    });
  });

  it('rejects empty copyId, unknown kinds, envelopes, and junk', () => {
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'copyId', text: '' })).toBeNull();
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'copyId', text: '   ' })).toBeNull();
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'copyId' })).toBeNull();
    expect(parseResultsActionMessage({ type: 'results.action', kind: 'nope' })).toBeNull();
    expect(parseResultsActionMessage({ type: 'results.copy', text: 'x' })).toBeNull();
    expect(
      parseResultsActionMessage({
        v: PROTOCOL_VERSION,
        type: 'results.action',
        kind: 'focusLogs',
        payload: {},
        ts: 1,
      }),
    ).toBeNull();
    expect(parseResultsActionMessage(null)).toBeNull();
    expect(parseResultsActionMessage('results.action')).toBeNull();
    expect(parseResultsActionMessage([])).toBeNull();
    expect(() => parseResultsActionMessage(undefined)).not.toThrow();
  });

  it('encodeResultsAction mirrors local wire shape', () => {
    expect(encodeResultsAction('copyId', 'run-9')).toEqual({
      type: 'results.action',
      kind: 'copyId',
      text: 'run-9',
    });
    expect(encodeResultsAction('focusProfiler')).toEqual({
      type: 'results.action',
      kind: 'focusProfiler',
    });
    expect(encodeResultsAction('focusLogs')).toEqual({
      type: 'results.action',
      kind: 'focusLogs',
    });
    expect(encodeResultsAction('copyId')).toEqual({
      type: 'results.action',
      kind: 'copyId',
      text: '',
    });
  });

  it('catch path returns null when getters throw', () => {
    const hostile = {
      get type() {
        throw new Error('boom');
      },
    };
    expect(parseResultsActionMessage(hostile)).toBeNull();
  });
});

describe('handleResultsWebviewMessage', () => {
  let store: ResultsFocusStore;

  beforeEach(() => {
    store = new ResultsFocusStore();
  });

  it('results.ready → results.set with current snapshot', () => {
    const id = store.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      meta: { script_name: 'A' },
    });
    const handle = handleResultsWebviewMessage(
      encode(VIEW_TO_HOST.ResultsReady, {}),
      store,
    );
    expect(handle.kind).toBe('ready');
    if (handle.kind !== 'ready') return;
    expect(handle.set.type).toBe(HOST_TO_VIEW.ResultsSet);
    expect(handle.set.payload.focusId).toBe(id);
    expect(
      (handle.set.payload.lastRun as { meta?: { script_name?: string } })?.meta?.script_name,
    ).toBe('A');
  });

  it('results.focus retargets store and returns results.set', () => {
    const a = store.publish({
      status: 'success',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      meta: { script_name: 'A' },
    });
    const b = store.publish({
      status: 'success',
      focus: false,
      seriesKey: 'k',
      engineId: 'server',
      meta: { script_name: 'B' },
    });
    const handle = handleResultsWebviewMessage(
      encode(VIEW_TO_HOST.ResultsFocus, { runId: b }),
      store,
    );
    expect(handle.kind).toBe('focus');
    if (handle.kind !== 'focus') return;
    expect(handle.runId).toBe(b);
    expect(store.getResultsFocusId()).toBe(b);
    expect(store.getLastRun()?.meta?.script_name).toBe('B');
    expect(handle.set.payload.focusId).toBe(b);
    // Original focus id still in cache
    expect(store.get(a)).toBeTruthy();
  });

  it('routes local results.action before protocol decode', () => {
    const handle = handleResultsWebviewMessage(
      encodeResultsAction('copyId', 'run-42'),
      store,
    );
    expect(handle.kind).toBe('action');
    if (handle.kind !== 'action') return;
    expect(handle.action).toEqual({ type: 'results.action', kind: 'copyId', text: 'run-42' });

    const focus = handleResultsWebviewMessage(encodeResultsAction('focusProfiler'), store);
    expect(focus.kind).toBe('action');
    if (focus.kind !== 'action') return;
    expect(focus.action.kind).toBe('focusProfiler');
  });

  it('rejects host→view types and bad envelopes', () => {
    const badType = handleResultsWebviewMessage(
      encode(HOST_TO_VIEW.ResultsSet, {
        lastRun: null,
        strategyReport: null,
        focusId: null,
      }),
      store,
    );
    expect(badType.kind).toBe('reject');

    const badEnv = handleResultsWebviewMessage({ v: 99, type: 'results.ready' }, store);
    expect(badEnv.kind).toBe('reject');
  });

  it('ignores empty results.focus runId and unrelated view messages', () => {
    expect(
      handleResultsWebviewMessage(encode(VIEW_TO_HOST.ResultsFocus, { runId: '' }), store)
        .kind,
    ).toBe('ignore');
    expect(
      handleResultsWebviewMessage(
        {
          v: PROTOCOL_VERSION,
          type: VIEW_TO_HOST.WebviewReady,
          payload: { view: 'chart', capabilities: [] },
          ts: Date.now(),
        },
        store,
      ).kind,
    ).toBe('ignore');
  });

  it('encodeResultsSet mirrors store payload', () => {
    store.publish({
      status: 'error',
      focus: true,
      seriesKey: 'k',
      engineId: 'server',
      error: 'boom',
      strategyReport: { trades: 0 },
    });
    const env = encodeResultsSet(store);
    expect(env.type).toBe(HOST_TO_VIEW.ResultsSet);
    expect(env.payload.strategyReport).toEqual({ trades: 0 });
    expect((env.payload.lastRun as { error?: string })?.error).toBe('boom');
  });

  it('catch path rejects when store.focusResults throws', () => {
    const hostile = {
      getResultsSetPayload: () => ({ lastRun: null, strategyReport: null, focusId: null }),
      focusResults: () => {
        throw new Error('focus boom');
      },
    };
    const handle = handleResultsWebviewMessage(
      encode(VIEW_TO_HOST.ResultsFocus, { runId: 'run-1' }),
      hostile,
    );
    expect(handle.kind).toBe('reject');
    if (handle.kind !== 'reject') return;
    expect(handle.error.message).toContain('focus boom');
  });

  it('catch path stringifies non-Error throws', () => {
    const hostile = {
      getResultsSetPayload: () => {
        throw 'nope';
      },
      focusResults: () => true,
    };
    const handle = handleResultsWebviewMessage(
      encode(VIEW_TO_HOST.ResultsReady, {}),
      hostile,
    );
    expect(handle.kind).toBe('reject');
    if (handle.kind !== 'reject') return;
    expect(handle.error.message).toContain('nope');
  });
});
