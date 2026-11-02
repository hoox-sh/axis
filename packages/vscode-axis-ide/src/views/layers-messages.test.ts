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
  LAYER_SECTION_EMPTY,
  LAYER_SECTION_ROLES,
  LAYER_SECTION_TITLES,
  LAYERS_SOURCE_CLOSED,
  LAYERS_SOURCE_OPEN,
  buildLayersSnapshot,
  encodeLayersSet,
  parseLayersWebMessage,
  type LayersSection,
  type LayersSnapshot,
} from './layers-messages';

function section(snapshot: LayersSnapshot, title: string): LayersSection {
  const found = snapshot.sections.find((item) => item.title === title);
  if (!found) throw new Error(`missing section ${title}`);
  return found;
}

function lengthProxy(length: unknown, values: unknown[] = []): unknown[] {
  return new Proxy(values, {
    get(target, prop, recv) {
      if (prop === 'length') return length;
      return Reflect.get(target, prop, recv);
    },
  });
}

describe('parseLayersWebMessage', () => {
  test('accepts ready and openChart only', () => {
    expect(parseLayersWebMessage(null)).toBeNull();
    expect(parseLayersWebMessage(undefined)).toBeNull();
    expect(parseLayersWebMessage(1)).toBeNull();
    expect(parseLayersWebMessage('layers.ready')).toBeNull();
    expect(parseLayersWebMessage([])).toBeNull();
    expect(parseLayersWebMessage({})).toBeNull();
    expect(parseLayersWebMessage({ type: 1 })).toBeNull();
    expect(parseLayersWebMessage({ type: '' })).toBeNull();
    expect(parseLayersWebMessage({ type: 'layers.set' })).toBeNull();
    expect(parseLayersWebMessage({ type: 'layers.ready', extra: 1 })).toEqual({
      type: 'layers.ready',
    });
    expect(parseLayersWebMessage({ type: 'layers.openChart' })).toEqual({
      type: 'layers.openChart',
    });
  });

  test('never throws on a hostile type getter or revoked proxy', () => {
    expect(
      parseLayersWebMessage({
        get type(): string {
          throw new Error('type');
        },
      }),
    ).toBeNull();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(parseLayersWebMessage(revoked.proxy)).toBeNull();
  });
});

describe('buildLayersSnapshot', () => {
  test('no chart → five zero sections and the closed label', () => {
    const closed = buildLayersSnapshot(undefined);
    expect(closed.chartOpen).toBe(false);
    expect(closed.total).toBe(0);
    expect(closed.source).toBe(LAYERS_SOURCE_CLOSED);
    expect(closed.source).toBe('no chart open');
    expect(closed.sections.map((item) => item.title)).toEqual([
      ...LAYER_SECTION_TITLES,
    ]);
    for (const item of closed.sections) {
      expect(item.count).toBe(0);
      expect(item.rows).toEqual([]);
      expect(item.empty).toBe(LAYER_SECTION_EMPTY[item.title]);
      expect(item.role).toBe(LAYER_SECTION_ROLES[item.title]);
      expect(item.role.includes('\n')).toBe(false);
      expect(item.id).toBe(
        `layers.section.${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      );
    }
    expect(section(closed, 'Scripts').empty).toBe('Apply a builtin');
    expect(section(closed, 'Panes').empty).toBe('No panes yet');
    expect(section(closed, 'Overlays').empty).toBe('No overlays yet');
    expect(section(closed, 'On-chain').empty).toBe('No on-chain yet');
    expect(section(closed, 'On-chain').id).toBe('layers.section.on-chain');
    expect(section(closed, 'Drawings').empty).toBe('No drawings yet');

    expect(buildLayersSnapshot(null).source).toBe(LAYERS_SOURCE_CLOSED);
    expect(buildLayersSnapshot([]).chartOpen).toBe(false);
    expect(buildLayersSnapshot('chart').chartOpen).toBe(false);
    expect(buildLayersSnapshot(0).total).toBe(0);
    expect(buildLayersSnapshot({ chartOpen: false, doc: { scripts: ['sma'] } }).total).toBe(
      0,
    );
    expect(buildLayersSnapshot({ chartOpen: 'true', doc: { scripts: ['sma'] } }).chartOpen).toBe(
      false,
    );
    expect(
      buildLayersSnapshot({
        get chartOpen(): boolean {
          throw new Error('open');
        },
        doc: { scripts: ['sma'] },
      }).chartOpen,
    ).toBe(false);
    const revoked = Proxy.revocable({ chartOpen: true }, {});
    revoked.revoke();
    expect(buildLayersSnapshot(revoked.proxy).chartOpen).toBe(false);
  });

  test('open chart with no usable doc stays empty but says the chart is open', () => {
    const open = buildLayersSnapshot({ chartOpen: true });
    expect(open.chartOpen).toBe(true);
    expect(open.source).toBe(LAYERS_SOURCE_OPEN);
    expect(open.source).toBe('from the open chart');
    expect(open.total).toBe(0);
    expect(buildLayersSnapshot({ chartOpen: true, doc: null }).source).toBe(LAYERS_SOURCE_OPEN);
    expect(buildLayersSnapshot({ chartOpen: true, doc: [] }).total).toBe(0);
    expect(buildLayersSnapshot({ chartOpen: true, doc: 'x' }).total).toBe(0);
    const revoked = Proxy.revocable({ scripts: ['sma'] }, {});
    revoked.revoke();
    expect(buildLayersSnapshot({ chartOpen: true, doc: revoked.proxy }).total).toBe(0);
    const hostileDoc = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('own');
        },
      },
    );
    const snapped = buildLayersSnapshot({ chartOpen: true, doc: hostileDoc });
    expect(snapped.chartOpen).toBe(true);
    expect(snapped.total).toBe(0);
    expect(snapped.source).toBe('from the open chart');
  });

  test('lists script ids and ignores entries that are not ids', () => {
    const snapshot = buildLayersSnapshot({
      chartOpen: true,
      doc: {
        scripts: [
          ' sma ',
          '',
          '   ',
          { id: 'ema', name: 'EMA', kind: 'overlay' },
          { scriptId: 'rsi' },
          { name: 'MACD' },
          { id: 'ema', name: 'again' },
          { label: 'no-id' },
          null,
          1,
          ['nested'],
          {
            get id(): string {
              throw new Error('id');
            },
            scriptId: 'thrown-id',
            name: 'Thrown',
          },
        ],
        scriptIds: ['ignored-because-scripts-key'],
      },
    });
    const scripts = section(snapshot, 'Scripts');
    expect(scripts.rows.map((row) => row.label)).toEqual([
      'sma',
      'EMA',
      'rsi',
      'MACD',
      'Thrown',
    ]);
    expect(scripts.rows.map((row) => row.id)).toEqual([
      'layers.script.sma',
      'layers.script.ema',
      'layers.script.rsi',
      'layers.script.MACD',
      'layers.script.thrown-id',
    ]);
    expect(scripts.rows[1]?.detail).toBe('overlay');
    expect(scripts.rows[2]?.detail).toBe('');
    expect(scripts.count).toBe(5);
    expect(scripts.empty).toBe('Apply a builtin');
    expect(section(snapshot, 'Scripts').rows).toHaveLength(5);

    const idsOnly = buildLayersSnapshot({
      chartOpen: true,
      doc: { scriptIds: ['a', { id: 'b', kind: 'study' }, 'a', ''] },
    });
    expect(section(idsOnly, 'Scripts').rows.map((row) => row.label)).toEqual(['a', 'b']);

    const scriptsNotArray = buildLayersSnapshot({
      chartOpen: true,
      doc: { scripts: 'sma', scriptIds: ['a'] },
    });
    expect(section(scriptsNotArray, 'Scripts').count).toBe(0);

    const neither = buildLayersSnapshot({ chartOpen: true, doc: { drawings: [] } });
    expect(section(neither, 'Scripts').rows).toEqual([]);
  });

  test('skips a script slot whose index getter throws and a revoked entry', () => {
    const scripts = new Proxy(['ok'], {
      get(target, prop, recv) {
        if (prop === '0') throw new Error('index');
        return Reflect.get(target, prop, recv);
      },
    });
    const skipped = buildLayersSnapshot({ chartOpen: true, doc: { scripts } });
    expect(section(skipped, 'Scripts').rows).toEqual([]);

    const revoked = Proxy.revocable({ id: 'gone' }, {});
    revoked.revoke();
    const boom = buildLayersSnapshot({
      chartOpen: true,
      doc: { scripts: [revoked.proxy, 'kept'] },
    });
    expect(section(boom, 'Scripts').rows.map((row) => row.label)).toEqual(['kept']);

    const badLength = buildLayersSnapshot({
      chartOpen: true,
      doc: { scripts: lengthProxy('nope', ['x']) },
    });
    expect(section(badLength, 'Scripts').count).toBe(0);
    expect(
      section(
        buildLayersSnapshot({
          chartOpen: true,
          doc: { scripts: lengthProxy(1.5, ['x']) },
        }),
        'Scripts',
      ).count,
    ).toBe(0);
    expect(
      section(
        buildLayersSnapshot({
          chartOpen: true,
          doc: { scripts: lengthProxy(-1, ['x']) },
        }),
        'Scripts',
      ).count,
    ).toBe(0);
    const throwingLength = new Proxy(['x'], {
      get() {
        throw new Error('length');
      },
    });
    expect(
      section(
        buildLayersSnapshot({ chartOpen: true, doc: { scripts: throwingLength } }),
        'Scripts',
      ).count,
    ).toBe(0);
    expect(
      section(buildLayersSnapshot({ chartOpen: true, doc: { scripts: [] } }), 'Scripts').count,
    ).toBe(0);
  });

  test('drawings count is the array length, including empty slots', () => {
    const snapshot = buildLayersSnapshot({
      chartOpen: true,
      doc: {
        drawings: [
          null,
          4,
          ['nope'],
          '  ',
          'trend',
          { id: 'd1', tool: 'trendline' },
          { name: 'Ray', tool: 'ray' },
          { tool: 'brush' },
          { id: 'bare' },
          {},
        ],
      },
    });
    const drawings = section(snapshot, 'Drawings');
    expect(drawings.count).toBe(10);
    expect(drawings.rows).toHaveLength(10);
    expect(drawings.rows[0]).toEqual({
      id: 'layers.drawing.0',
      label: 'Drawing 1',
      detail: '',
    });
    expect(drawings.rows[3]).toEqual({
      id: 'layers.drawing.3',
      label: 'Drawing 4',
      detail: '',
    });
    expect(drawings.rows[4]).toEqual({
      id: 'layers.drawing.4',
      label: 'trend',
      detail: '',
    });
    expect(drawings.rows[5]).toEqual({
      id: 'layers.drawing.d1',
      label: 'd1',
      detail: 'trendline',
    });
    expect(drawings.rows[6]).toEqual({
      id: 'layers.drawing.6',
      label: 'Ray',
      detail: 'ray',
    });
    expect(drawings.rows[7]).toEqual({
      id: 'layers.drawing.7',
      label: 'brush',
      detail: 'brush',
    });
    expect(drawings.rows[8]).toEqual({
      id: 'layers.drawing.bare',
      label: 'bare',
      detail: '',
    });
    expect(drawings.rows[9]).toEqual({
      id: 'layers.drawing.9',
      label: 'Drawing 10',
      detail: '',
    });
    expect(drawings.empty).toBe('No drawings yet');

    expect(
      section(buildLayersSnapshot({ chartOpen: true, doc: { drawings: 'nope' } }), 'Drawings')
        .count,
    ).toBe(0);
    expect(
      section(buildLayersSnapshot({ chartOpen: true, doc: {} }), 'Drawings').count,
    ).toBe(0);

    const hostileIndex = new Proxy([null], {
      get(target, prop, recv) {
        if (prop === '0') throw new Error('index');
        return Reflect.get(target, prop, recv);
      },
    });
    const fromThrow = section(
      buildLayersSnapshot({ chartOpen: true, doc: { drawings: hostileIndex } }),
      'Drawings',
    );
    expect(fromThrow.count).toBe(1);
    expect(fromThrow.rows[0]?.label).toBe('Drawing 1');

    const revoked = Proxy.revocable({ id: 'z', tool: 'trendline' }, {});
    revoked.revoke();
    const fromRevoked = section(
      buildLayersSnapshot({ chartOpen: true, doc: { drawings: [revoked.proxy] } }),
      'Drawings',
    );
    expect(fromRevoked.count).toBe(1);
    expect(fromRevoked.rows[0]?.label).toBe('Drawing 1');

    expect(
      section(
        buildLayersSnapshot({
          chartOpen: true,
          doc: {
            get drawings(): unknown[] {
              throw new Error('drawings');
            },
          },
        }),
        'Drawings',
      ).count,
    ).toBe(0);
  });

  test('panes, overlays, and on-chain stay empty unless the doc has that field', () => {
    const absent = buildLayersSnapshot({
      chartOpen: true,
      doc: {
        scripts: [],
        drawings: [],
        onchain: [{ id: 'hidden-by-priority' }],
      },
    });
    expect(section(absent, 'Panes').rows).toEqual([]);
    expect(section(absent, 'Panes').empty).toBe('No panes yet');
    expect(section(absent, 'Overlays').empty).toBe('No overlays yet');
    expect(section(absent, 'On-chain').count).toBe(1);
    expect(section(absent, 'On-chain').rows[0]?.label).toBe('hidden-by-priority');

    const filled = buildLayersSnapshot({
      chartOpen: true,
      doc: {
        panes: [
          { id: 'price', kind: 'price' },
          { label: 'Osc' },
          { name: 'Volume' },
          '',
          '  ',
          'notes',
          { kind: 'skip' },
          null,
          2,
          ['nested'],
        ],
        overlays: ['vwap', { id: 'bb', name: 'Bollinger', kind: 'overlay' }],
        onChain: 'not-a-list',
        onchain: [{ id: 'should-not-win' }],
        'on-chain': [{ id: 'also-not' }],
      },
    });
    const panes = section(filled, 'Panes');
    expect(panes.rows.map((row) => [row.label, row.detail, row.id])).toEqual([
      ['price', 'price', 'layers.panes.price'],
      ['Osc', '', 'layers.panes.1'],
      ['Volume', '', 'layers.panes.2'],
      ['notes', '', 'layers.panes.5'],
    ]);
    expect(panes.count).toBe(4);
    expect(panes.empty).toBe('No panes yet');
    expect(section(filled, 'Overlays').rows.map((row) => row.label)).toEqual([
      'vwap',
      'Bollinger',
    ]);
    expect(section(filled, 'Overlays').rows[1]?.detail).toBe('overlay');
    expect(section(filled, 'Overlays').rows[1]?.id).toBe('layers.overlays.bb');
    expect(section(filled, 'On-chain').count).toBe(0);
    expect(section(filled, 'On-chain').empty).toBe('No on-chain yet');

    const hyphen = buildLayersSnapshot({
      chartOpen: true,
      doc: { 'on-chain': [{ id: 'tvl', label: 'TVL', kind: 'dataset' }] },
    });
    expect(section(hyphen, 'On-chain').rows).toEqual([
      { id: 'layers.on-chain.tvl', label: 'TVL', detail: 'dataset' },
    ]);

    const emptyPanes = buildLayersSnapshot({ chartOpen: true, doc: { panes: [] } });
    expect(section(emptyPanes, 'Panes').count).toBe(0);

    const revoked = Proxy.revocable({ id: 'p' }, {});
    revoked.revoke();
    const skipped = buildLayersSnapshot({
      chartOpen: true,
      doc: { panes: [revoked.proxy, { id: 'ok', kind: 'price' }] },
    });
    expect(section(skipped, 'Panes').rows.map((row) => row.label)).toEqual(['ok']);

    const hostileIndex = new Proxy([{ id: 'x' }], {
      get(target, prop, recv) {
        if (prop === '0') throw new Error('index');
        return Reflect.get(target, prop, recv);
      },
    });
    expect(
      section(
        buildLayersSnapshot({ chartOpen: true, doc: { overlays: hostileIndex } }),
        'Overlays',
      ).count,
    ).toBe(0);
  });

  test('total is the sum of the five section counts', () => {
    const snapshot = buildLayersSnapshot({
      chartOpen: true,
      doc: {
        scripts: ['sma', { id: 'ema', name: 'EMA', kind: 'overlay' }],
        panes: [{ id: 'price', kind: 'price' }],
        overlays: ['vwap'],
        onChain: [{ id: 'tvl', label: 'TVL', kind: 'dataset' }],
        drawings: [null, { id: 'd1', tool: 'trendline' }],
      },
    });
    expect(snapshot.sections.map((item) => item.count)).toEqual([2, 1, 1, 1, 2]);
    expect(snapshot.total).toBe(7);
    expect(snapshot.chartOpen).toBe(true);
    expect(snapshot.source).toBe('from the open chart');
  });
});

describe('encodeLayersSet', () => {
  test('wraps the snapshot without copying it', () => {
    const snapshot = buildLayersSnapshot({ chartOpen: true, doc: { scripts: ['sma'] } });
    const message = encodeLayersSet(snapshot);
    expect(message.type).toBe('layers.set');
    expect(message.snapshot).toBe(snapshot);
  });
});
