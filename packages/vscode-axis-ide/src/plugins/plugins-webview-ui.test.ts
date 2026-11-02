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
  PROTOCOL_VERSION,
  decodeHostMessage,
  encodePluginsActivate,
  encodePluginsReady,
  normalizePluginCard,
} from '../../webview/plugins/src/protocol';
import {
  PYODIDE_FLAG_WARNING,
  applyPluginsHostMessage,
  filterPluginsByTab,
  formatActiveStatus,
  initialPluginsState,
  isPluginActive,
  isPyodideFlagOff,
  pluginBadges,
  setKindTab,
} from '../../webview/plugins/src/state';

const samplePlugins = [
  {
    id: 'binance-rest',
    name: 'Binance REST',
    kind: 'source',
    builtIn: true,
    description: 'Venue REST klines',
    extra: { role: 'Historical OHLCV', live: false },
  },
  {
    id: 'binance-ws',
    name: 'Binance WS',
    kind: 'stream',
    builtIn: true,
    extra: { role: 'Live bars', live: true },
  },
  {
    id: 'pyodide',
    name: 'Pyodide',
    kind: 'engine',
    builtIn: true,
    description: 'In-process Wasm calculator',
    extra: { role: 'Pine evaluation', pyodide: true, flagOff: true },
  },
  {
    id: 'server',
    name: 'Server (pyne Pro)',
    kind: 'engine',
    builtIn: true,
    extra: { role: 'Pine evaluation' },
  },
  {
    id: 'custom-src',
    name: 'Custom',
    kind: 'source',
    builtIn: false,
    extra: { role: 'Historical OHLCV' },
  },
];

describe('plugins webview protocol', () => {
  test('encodePluginsActivate payload includes kind and id', () => {
    const msg = encodePluginsActivate('engine', 'pyodide', 42);
    expect(msg).not.toBeNull();
    if (!msg) return;
    expect(msg.v).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe('plugins.activate');
    expect(msg.kind).toBe('engine');
    expect(msg.id).toBe('pyodide');
    expect(msg.payload).toEqual({ kind: 'engine', id: 'pyodide' });
    expect(msg.ts).toBe(42);
  });

  test('encodePluginsActivate rejects bad kind or empty id', () => {
    expect(encodePluginsActivate('nope', 'x')).toBeNull();
    expect(encodePluginsActivate('source', '  ')).toBeNull();
    expect(encodePluginsActivate('source', null)).toBeNull();
  });

  test('encodePluginsReady is plugins.ready', () => {
    const msg = encodePluginsReady(1);
    expect(msg.type).toBe('plugins.ready');
    expect(msg.payload).toEqual({});
  });

  test('decodeHostMessage accepts envelope plugins.init', () => {
    const decoded = decodeHostMessage({
      v: PROTOCOL_VERSION,
      type: 'plugins.init',
      payload: { plugins: samplePlugins, active: { source: 'binance-rest' }, flags: { allowPyodide: false } },
      ts: 1,
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.type).toBe('plugins.init');
    expect(Array.isArray(decoded.payload.plugins)).toBe(true);
  });

  test('decodeHostMessage accepts flat plugins.state JSON', () => {
    const decoded = decodeHostMessage({
      type: 'plugins.state',
      active: { engine: 'server' },
      flags: { allowPyodide: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.type).toBe('plugins.state');
    expect((decoded.payload.active as { engine?: string }).engine).toBe('server');
  });

  test('ignore bad messages (never throw)', () => {
    expect(decodeHostMessage(null).ok).toBe(false);
    expect(decodeHostMessage('plugins.init').ok).toBe(false);
    expect(decodeHostMessage({ type: 'plugins.ready' }).ok).toBe(false);
    expect(decodeHostMessage({ v: 2, type: 'plugins.init', payload: {}, ts: 1 }).ok).toBe(false);
    expect(decodeHostMessage({ type: 'plugins.init', ts: Number.NaN }).ok).toBe(false);
    expect(() => decodeHostMessage(undefined)).not.toThrow();
  });
});

describe('plugins webview tab filter + state', () => {
  const cards = samplePlugins.map((p) => normalizePluginCard(p)).filter((c) => c !== null);

  test('tab filter All vs one kind', () => {
    expect(filterPluginsByTab(cards, 'all').length).toBe(cards.length);
    expect(filterPluginsByTab(cards, 'source').map((c) => c.id)).toEqual([
      'binance-rest',
      'custom-src',
    ]);
    expect(filterPluginsByTab(cards, 'engine').every((c) => c.kind === 'engine')).toBe(true);
    expect(filterPluginsByTab(cards, 'dataset')).toEqual([]);
  });

  test('setKindTab ignores unknown values', () => {
    const start = initialPluginsState();
    expect(setKindTab(start, 'engine').tab).toBe('engine');
    expect(setKindTab(start, 'nope').tab).toBe('all');
  });

  test('plugins.init then plugins.state updates active without dropping catalog', () => {
    let state = initialPluginsState();
    const init = decodeHostMessage({
      type: 'plugins.init',
      plugins: samplePlugins,
      active: { source: 'binance-rest', engine: 'server', stream: 'binance-ws', storage: 'local' },
      flags: { allowPyodide: false },
    });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    state = applyPluginsHostMessage(state, init.type, init.payload);
    expect(state.ready).toBe(true);
    expect(state.plugins.length).toBe(5);
    expect(formatActiveStatus(state.active)).toBe(
      'Active · src binance-rest · eng server · stm binance-ws · stor local',
    );

    const next = decodeHostMessage({
      type: 'plugins.state',
      active: { source: 'custom-src', engine: 'pyodide', stream: 'binance-ws', storage: 'local' },
      flags: { allowPyodide: false },
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    state = applyPluginsHostMessage(state, next.type, next.payload);
    expect(state.plugins.length).toBe(5);
    expect(state.active.source).toBe('custom-src');
    expect(state.active.engine).toBe('pyodide');
  });

  test('malformed init plugins array is ignored', () => {
    const start = initialPluginsState();
    const next = applyPluginsHostMessage(start, 'plugins.init', {
      plugins: { not: 'array' },
      active: { source: 'x' },
    });
    expect(next).toEqual(start);
  });
});

describe('plugins webview active badge logic', () => {
  const pyodide = normalizePluginCard(samplePlugins[2]);
  const server = normalizePluginCard(samplePlugins[3]);
  const custom = normalizePluginCard(samplePlugins[4]);
  if (!pyodide || !server || !custom) throw new Error('fixture');

  test('Active badge only on the selected id for that kind', () => {
    const active = { engine: 'server', source: 'binance-rest' };
    expect(isPluginActive(server, active)).toBe(true);
    expect(isPluginActive(pyodide, active)).toBe(false);
    expect(pluginBadges(server, active, {}).some((b) => b.text === 'Active')).toBe(true);
    expect(pluginBadges(pyodide, active, {}).some((b) => b.text === 'Active')).toBe(false);
  });

  test('Built-in vs Dynamic badges', () => {
    const badges = pluginBadges(custom, {}, {});
    expect(badges.some((b) => b.text === 'Dynamic')).toBe(true);
    expect(badges.some((b) => b.text === 'Built-in')).toBe(false);
    expect(pluginBadges(server, {}, {}).some((b) => b.text === 'Built-in')).toBe(true);
  });

  test('pyodide Flag off + warning when extra.flagOff or allowPyodide===false', () => {
    expect(isPyodideFlagOff(pyodide, {})).toBe(true);
    expect(isPyodideFlagOff(server, { allowPyodide: false })).toBe(false);

    const fromExtra = pluginBadges(pyodide, {}, { allowPyodide: true });
    expect(fromExtra.some((b) => b.text === 'Flag off')).toBe(true);
    expect(fromExtra.some((b) => b.text === PYODIDE_FLAG_WARNING)).toBe(true);

    const ungated = normalizePluginCard({
      id: 'pyodide',
      name: 'Pyodide',
      kind: 'engine',
      builtIn: true,
    });
    if (!ungated) throw new Error('fixture');
    expect(isPyodideFlagOff(ungated, { allowPyodide: false })).toBe(true);
    expect(isPyodideFlagOff(ungated, { allowPyodide: true })).toBe(false);
    expect(isPyodideFlagOff(ungated, {})).toBe(false);
  });
});
