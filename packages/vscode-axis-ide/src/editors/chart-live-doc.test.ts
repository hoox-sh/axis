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
  clearChartLiveDoc,
  getChartLiveDoc,
  mergeChartDoc,
  setChartLiveDoc,
  subscribeChartLiveDoc,
} from './chart-live-doc';
import { buildLayersSnapshot } from '../views/layers-messages';

const URI = 'file:///tmp/chart.axis.json';

const trendline = {
  id: 'tl-1',
  tool: 'trendline',
  points: [
    { time: 1_700_000_000, price: 42000 },
    { time: 1_700_000_600, price: 43000 },
  ],
};

function drawingsSection(doc: Record<string, unknown> | null) {
  const snapshot = buildLayersSnapshot({ chartOpen: true, doc });
  const section = snapshot.sections.find((entry) => entry.title === 'Drawings');
  if (!section) throw new Error('missing Drawings section');
  return section;
}

describe('chart live doc', () => {
  test('stores a shallow array snapshot and ignores non-arrays', () => {
    const drawings = [trendline];
    const scripts = ['sma'];
    setChartLiveDoc(URI, {
      drawings,
      scripts,
      panes: 'nope',
      overlays: { id: 'not-array' },
      onChain: 1,
    });
    drawings.push({ id: 'later', tool: 'trendline', points: [] });
    scripts.push('ema');
    const snap = getChartLiveDoc(URI);
    expect(snap?.drawings).toHaveLength(1);
    expect(snap?.drawings?.[0]).toEqual(trendline);
    expect(snap?.scripts).toEqual(['sma']);
    expect(snap?.panes).toBeUndefined();
    expect(snap?.overlays).toBeUndefined();
    expect(snap?.onChain).toBeUndefined();
    snap?.drawings?.push({ id: 'mut', tool: 'trendline', points: [] });
    expect(getChartLiveDoc(URI)?.drawings).toHaveLength(1);
    clearChartLiveDoc(URI);
    expect(getChartLiveDoc(URI)).toBeNull();
  });

  test('replaces the same uri, deletes on null, and notifies after the write', () => {
    const seen: string[] = [];
    const off = subscribeChartLiveDoc((uri) => {
      seen.push(`${uri}:${getChartLiveDoc(uri)?.drawings?.length ?? 'none'}`);
    });
    setChartLiveDoc(URI, { drawings: [trendline], panes: [{ id: 'price', kind: 'price' }] });
    setChartLiveDoc(URI, {
      drawings: [{ id: 'tl-2', tool: 'trendline', points: trendline.points }],
    });
    expect(getChartLiveDoc(URI)?.drawings).toEqual([
      { id: 'tl-2', tool: 'trendline', points: trendline.points },
    ]);
    expect(getChartLiveDoc(URI)?.panes).toBeUndefined();
    setChartLiveDoc(URI, null);
    expect(getChartLiveDoc(URI)).toBeNull();
    expect(seen).toEqual([
      `${URI}:1`,
      `${URI}:1`,
      `${URI}:none`,
    ]);
    off();
    setChartLiveDoc(URI, { drawings: [] });
    expect(seen).toHaveLength(3);
    clearChartLiveDoc(URI);
  });

  test('a throwing listener does not block later listeners', () => {
    const seen: string[] = [];
    const offBoom = subscribeChartLiveDoc(() => {
      throw new Error('listener');
    });
    const offOk = subscribeChartLiveDoc((uri) => {
      seen.push(uri);
    });
    setChartLiveDoc(URI, { onChain: [{ id: 'flow' }] });
    expect(seen).toEqual([URI]);
    expect(getChartLiveDoc(URI)?.onChain).toEqual([{ id: 'flow' }]);
    offBoom();
    offOk();
    offOk();
    clearChartLiveDoc(URI);
    expect(seen).toEqual([URI]);
  });

  test('ignores bad uris and non-records without throwing', () => {
    let calls = 0;
    const off = subscribeChartLiveDoc(() => {
      calls += 1;
    });
    expect(() => setChartLiveDoc('', { drawings: [trendline] })).not.toThrow();
    expect(() => setChartLiveDoc(1 as never, { drawings: [trendline] })).not.toThrow();
    expect(getChartLiveDoc('')).toBeNull();
    expect(getChartLiveDoc(1 as never)).toBeNull();
    expect(calls).toBe(0);
    setChartLiveDoc(URI, [] as never);
    expect(getChartLiveDoc(URI)).toEqual({});
    const revoked = Proxy.revocable({ drawings: [trendline] }, {});
    revoked.revoke();
    expect(() => setChartLiveDoc(URI, revoked.proxy)).not.toThrow();
    expect(getChartLiveDoc(URI)).toEqual({});
    expect(subscribeChartLiveDoc(undefined as never)()).toBeUndefined();
    expect(calls).toBe(2);
    off();
    clearChartLiveDoc(URI);
  });

  test('omits fields that throw while copying the rest', () => {
    const badOverlays = new Proxy([1], {
      get() {
        throw new Error('overlays');
      },
    });
    const doc = new Proxy(
      {
        scripts: ['sma'],
        panes: [{ id: 'price', kind: 'price' }],
        overlays: badOverlays,
        onChain: [{ id: 'oc' }],
      },
      {
        get(target, prop, recv) {
          if (prop === 'drawings') throw new Error('drawings');
          return Reflect.get(target, prop, recv);
        },
      },
    );
    setChartLiveDoc(URI, doc);
    const snap = getChartLiveDoc(URI);
    expect(snap?.drawings).toBeUndefined();
    expect(snap?.overlays).toBeUndefined();
    expect(snap?.scripts).toEqual(['sma']);
    expect(snap?.panes).toEqual([{ id: 'price', kind: 'price' }]);
    expect(snap?.onChain).toEqual([{ id: 'oc' }]);
    clearChartLiveDoc(URI);
    expect(getChartLiveDoc('file:///missing.axis.json')).toBeNull();
  });
});

describe('mergeChartDoc', () => {
  test('overlays live arrays and keeps the rest of the parsed chart', () => {
    const parsed = {
      symbol: 'BTC',
      drawings: [{ id: 'saved', tool: 'hline' }],
      scripts: ['disk'],
      panes: [{ id: 'price', kind: 'price' }],
      overlays: [{ id: 'old' }],
      onChain: [{ id: 'old-oc' }],
      scriptIds: ['legacy'],
    };
    const live = {
      drawings: [trendline],
      scripts: ['live-sma'],
      panes: [
        { id: 'price', kind: 'price' },
        { id: 'rsi', kind: 'indicator' },
      ],
      overlays: [{ id: 'vwap' }],
      onChain: [{ id: 'flow' }],
    };
    const merged = mergeChartDoc(parsed, live);
    expect(merged).not.toBe(parsed);
    expect(merged?.symbol).toBe('BTC');
    expect(merged?.scriptIds).toEqual(['legacy']);
    expect(merged?.drawings).toEqual([trendline]);
    expect(merged?.scripts).toEqual(['live-sma']);
    expect(merged?.panes).toHaveLength(2);
    expect(merged?.overlays).toEqual([{ id: 'vwap' }]);
    expect(merged?.onChain).toEqual([{ id: 'flow' }]);
    const drawings = merged?.drawings;
    expect(Array.isArray(drawings)).toBe(true);
    if (Array.isArray(drawings)) drawings.push({ id: 'x' });
    expect(live.drawings).toHaveLength(1);

    const kept = mergeChartDoc(
      { drawings: [{ id: 'saved', tool: 'trendline' }], scripts: ['disk'] },
      { scripts: 'nope', panes: null },
    );
    expect(kept?.drawings).toEqual([{ id: 'saved', tool: 'trendline' }]);
    expect(kept?.scripts).toEqual(['disk']);
    expect(kept?.panes).toBeUndefined();

    const same = { drawings: [] };
    expect(mergeChartDoc(same, null)).toBe(same);
    expect(mergeChartDoc(same, [] as never)).toBe(same);
    expect(mergeChartDoc(null, null)).toBeNull();
    expect(mergeChartDoc(null, 'nope' as never)).toBeNull();

    const onlyLive = mergeChartDoc(null, { drawings: [trendline], overlays: 'skip' });
    expect(onlyLive).toEqual({ drawings: [trendline] });
    expect(mergeChartDoc(null, {})).toEqual({});

    const emptyOver = mergeChartDoc({ drawings: [trendline] }, { drawings: [] });
    expect(emptyOver?.drawings).toEqual([]);
  });

  test('merged unsaved trendline shows up as a Drawings row', () => {
    setChartLiveDoc(URI, {
      drawings: [trendline],
      scripts: ['sma'],
    });
    const live = getChartLiveDoc(URI);
    const merged = mergeChartDoc(
      { scripts: ['disk'], drawings: [], symbol: 'ETH' },
      live,
    );
    const drawings = drawingsSection(merged);
    expect(drawings.count).toBe(1);
    expect(drawings.rows[0]?.detail).toBe('trendline');
    expect(drawings.rows[0]?.label).toBe('tl-1');
    const fromLiveOnly = drawingsSection(mergeChartDoc(null, live));
    expect(fromLiveOnly.count).toBe(1);
    expect(fromLiveOnly.rows[0]?.detail).toBe('trendline');
    clearChartLiveDoc(URI);
  });
});
