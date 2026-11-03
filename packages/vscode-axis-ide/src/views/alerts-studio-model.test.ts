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
  ALERTS_REMOVED,
  ALERTS_TITLE_REQUIRED,
  buildAlertsSnapshot,
  formatAlertsSummary,
  parseAlertsStudioMessage,
} from './alerts-studio-model';

const EMPTY = {
  total: 0,
  enabled: 0,
  summary: '0 alerts, 0 enabled',
  entries: [],
};

describe('buildAlertsSnapshot', () => {
  test('header phrase and empty inputs', () => {
    expect(ALERTS_TITLE_REQUIRED).toBe('Title required');
    expect(ALERTS_REMOVED).toBe('Removed');
    expect(formatAlertsSummary(0, 0)).toBe('0 alerts, 0 enabled');
    expect(formatAlertsSummary(2, 1)).toBe('2 alerts, 1 enabled');
    expect(buildAlertsSnapshot(undefined)).toEqual(EMPTY);
    expect(buildAlertsSnapshot(null)).toEqual(EMPTY);
    expect(buildAlertsSnapshot({})).toEqual(EMPTY);
    expect(buildAlertsSnapshot('nope')).toEqual(EMPTY);
    expect(buildAlertsSnapshot(1)).toEqual(EMPTY);
    expect(buildAlertsSnapshot([])).toEqual(EMPTY);
  });

  test('cleans rows, dedupes ids, and counts enabled', () => {
    const raw = { id: 'a', title: 'A', enabled: true, extra: 1 };
    const snap = buildAlertsSnapshot([
      raw,
      { id: ' a ', title: ' Dup after trim ' },
      { id: 'b', title: ' Quiet ', enabled: false, condition: ' close > 1 ' },
      { id: ' ', title: 'blank id' },
      { id: 'c', title: '   ' },
      { id: 1, title: 'num' },
      { title: 'missing id' },
      null,
      ['row'],
      'x',
      { id: 'd', title: 'Zero', condition: '   ', enabled: 0 },
      { id: 'e', title: 'Num cond', condition: 4 },
      { id: 'f', title: 'Off', enabled: false },
    ]);
    expect(snap.entries[0]).toEqual({ id: 'a', title: 'A', enabled: true });
    expect(snap.entries[0]).not.toBe(raw);
    expect(snap.entries.map((e) => e.id)).toEqual(['a', 'b', 'd', 'e', 'f']);
    expect(snap.entries[1]).toEqual({
      id: 'b',
      title: 'Quiet',
      condition: 'close > 1',
      enabled: false,
    });
    expect(snap.entries[2]).toEqual({ id: 'd', title: 'Zero', enabled: true });
    expect('condition' in snap.entries[2]!).toBe(false);
    expect(snap.entries[3]).toEqual({ id: 'e', title: 'Num cond', enabled: true });
    expect(snap.total).toBe(5);
    expect(snap.enabled).toBe(3);
    expect(snap.summary).toBe('5 alerts, 3 enabled');
    expect(snap.summary).toBe(formatAlertsSummary(snap.total, snap.enabled));
  });

  test('skips a throwing row and still keeps neighbors', () => {
    const bad = new Proxy(
      {},
      {
        get() {
          throw new Error('row');
        },
      },
    );
    const snap = buildAlertsSnapshot([
      { id: 'a', title: 'A', enabled: false },
      bad,
      { id: 'b', title: 'B' },
    ]);
    expect(snap.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(snap.total).toBe(2);
    expect(snap.enabled).toBe(1);
    expect(snap.summary).toBe('2 alerts, 1 enabled');
  });

  test('hostile iterator returns an empty snapshot and does not throw', () => {
    const entries = new Proxy([{ id: 'a', title: 'A', enabled: true }], {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator) throw new Error('iter');
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(Array.isArray(entries)).toBe(true);
    expect(() => buildAlertsSnapshot(entries)).not.toThrow();
    expect(buildAlertsSnapshot(entries)).toEqual(EMPTY);
  });
});

describe('parseAlertsStudioMessage', () => {
  test('ready, add, toggle, and remove', () => {
    expect(parseAlertsStudioMessage({ type: 'alerts.ready', extra: 1 })).toEqual({
      type: 'alerts.ready',
    });
    const bare = Object.create(null) as { type: string };
    bare.type = 'alerts.ready';
    expect(parseAlertsStudioMessage(bare)).toEqual({ type: 'alerts.ready' });

    const titled = parseAlertsStudioMessage({ type: 'alerts.add', title: ' T ' });
    expect(titled).toEqual({ type: 'alerts.add', title: 'T' });
    expect(titled && 'condition' in titled).toBe(false);

    expect(
      parseAlertsStudioMessage({
        type: 'alerts.add',
        title: ' BTC ',
        condition: ' close > 1 ',
      }),
    ).toEqual({ type: 'alerts.add', title: 'BTC', condition: 'close > 1' });

    const blankCond = parseAlertsStudioMessage({
      type: 'alerts.add',
      title: 'X',
      condition: '   ',
    });
    expect(blankCond).toEqual({ type: 'alerts.add', title: 'X' });
    expect(blankCond && 'condition' in blankCond).toBe(false);

    const numCond = parseAlertsStudioMessage({
      type: 'alerts.add',
      title: 'X',
      condition: 1,
    });
    expect(numCond).toEqual({ type: 'alerts.add', title: 'X' });

    expect(parseAlertsStudioMessage({ type: 'alerts.add', title: 5 })).toEqual({
      type: 'alerts.add',
      title: '',
    });
    expect(parseAlertsStudioMessage({ type: 'alerts.add', title: '   ' })).toEqual({
      type: 'alerts.add',
      title: '',
    });
    expect(parseAlertsStudioMessage({ type: 'alerts.add' })).toEqual({
      type: 'alerts.add',
      title: '',
    });

    expect(parseAlertsStudioMessage({ type: 'alerts.toggle', id: ' a1 ' })).toEqual({
      type: 'alerts.toggle',
      id: 'a1',
    });
    expect(parseAlertsStudioMessage({ type: 'alerts.remove', id: 'a1' })).toEqual({
      type: 'alerts.remove',
      id: 'a1',
    });
  });

  test('drops junk and never throws', () => {
    expect(parseAlertsStudioMessage(null)).toBeNull();
    expect(parseAlertsStudioMessage(undefined)).toBeNull();
    expect(parseAlertsStudioMessage(1)).toBeNull();
    expect(parseAlertsStudioMessage('alerts.add')).toBeNull();
    expect(parseAlertsStudioMessage([])).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.set' })).toBeNull();
    expect(parseAlertsStudioMessage({ type: '' })).toBeNull();
    expect(parseAlertsStudioMessage({})).toBeNull();
    expect(parseAlertsStudioMessage({ type: 1 })).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.toggle' })).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.toggle', id: '  ' })).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.toggle', id: 4 })).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.remove', id: '' })).toBeNull();
    expect(parseAlertsStudioMessage({ type: 'alerts.remove', id: 2 })).toBeNull();

    const boom = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(() => parseAlertsStudioMessage(boom)).not.toThrow();
    expect(parseAlertsStudioMessage(boom)).toBeNull();

    const titleBoom = {
      type: 'alerts.add',
      get title(): string {
        throw new Error('title');
      },
    };
    expect(parseAlertsStudioMessage(titleBoom)).toBeNull();
  });
});
