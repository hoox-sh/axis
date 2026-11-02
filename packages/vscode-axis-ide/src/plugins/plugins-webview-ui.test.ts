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
import { kindIconSvg, pluginsViewHtml } from '../../webview/plugins/src/render';
import {
  ACTIVATE_FLASH_CLASS,
  ACTIVATE_FLASH_MS,
  COPY_FLASH_MS,
  COPY_ID_LABEL,
  COPIED_LABEL,
  KIND_CHIP_LABELS,
  KIND_MARKS,
  PYODIDE_FLAG_WARNING,
  activeChips,
  applyActivateFlash,
  applyCopiedFlash,
  applyPluginsHostMessage,
  copiedFlash,
  emptyFilterMessage,
  filterCount,
  filterPluginsByQuery,
  filterPluginsByTab,
  formatActiveStatus,
  formatFilterCount,
  formatFilterCountAria,
  initialPluginsState,
  isPluginActive,
  isPyodideFlagOff,
  pluginBadges,
  pluginMatchesQuery,
  setKindTab,
  setSearchQuery,
  tabFromChip,
  visiblePluginsForKind,
  type PluginsViewState,
} from '../../webview/plugins/src/state';
import type { PluginCard } from '../../webview/plugins/src/protocol';

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

describe('plugins webview search + chips', () => {
  const cards = samplePlugins.map((p) => normalizePluginCard(p)).filter((c) => c !== null);

  function readyState(partial: Partial<PluginsViewState> = {}): PluginsViewState {
    return {
      ...initialPluginsState(),
      ready: true,
      plugins: cards,
      active: { source: 'binance-rest', engine: 'server', stream: 'binance-ws', storage: 'local' },
      ...partial,
    };
  }

  test('filter by query: empty = all; name / id / description; case-insensitive', () => {
    expect(filterPluginsByQuery(cards, '').map((c) => c.id)).toEqual(cards.map((c) => c.id));
    expect(filterPluginsByQuery(cards, '   ').length).toBe(cards.length);
    expect(filterPluginsByQuery(cards, null).length).toBe(cards.length);
    expect(filterPluginsByQuery(cards, 'BINANCE').map((c) => c.id)).toEqual(['binance-rest', 'binance-ws']);
    expect(filterPluginsByQuery(cards, 'custom-src').map((c) => c.id)).toEqual(['custom-src']);
    expect(filterPluginsByQuery(cards, 'Venue REST').map((c) => c.id)).toEqual(['binance-rest']);
    expect(filterPluginsByQuery(cards, 'no-such-plugin')).toEqual([]);
    expect(filterPluginsByQuery(cards, 'stream').map((c) => c.id)).toEqual([]);
    expect(filterPluginsByQuery({ length: 1 } as unknown as PluginCard[], 'x')).toEqual([]);

    const copy = cards.slice();
    const filtered = filterPluginsByQuery(cards, '');
    filtered.pop();
    expect(cards.length).toBe(copy.length);

    const rest = cards.find((c) => c.id === 'binance-rest');
    if (!rest) throw new Error('fixture');
    expect(pluginMatchesQuery(rest, '')).toBe(true);
    expect(pluginMatchesQuery(rest, '  ')).toBe(true);
    expect(pluginMatchesQuery(rest, 1)).toBe(true);
    expect(pluginMatchesQuery(rest, 'klines')).toBe(true);
    expect(pluginMatchesQuery(rest, 'binance-rest')).toBe(true);
    expect(pluginMatchesQuery(rest, 'Binance REST')).toBe(true);
    expect(pluginMatchesQuery(rest, 'nope')).toBe(false);

    const weird = { id: 1, name: 2, description: 3, kind: 'source', builtIn: true, extra: {} } as unknown as PluginCard;
    expect(pluginMatchesQuery(weird, 'x')).toBe(false);

    const state = setSearchQuery(readyState(), 'pyodide');
    expect(visiblePluginsForKind(state, 'engine').map((c) => c.id)).toEqual(['pyodide']);
    expect(visiblePluginsForKind(state, 'source')).toEqual([]);
    expect(visiblePluginsForKind(setSearchQuery(state, ''), 'source').map((c) => c.id)).toEqual([
      'binance-rest',
      'custom-src',
    ]);
  });

  test('setSearchQuery is local, identity-stable, and survives plugins.init', () => {
    const start = initialPluginsState();
    expect(setSearchQuery(start, '').query).toBe('');
    expect(setSearchQuery(start, '')).toBe(start);
    expect(setSearchQuery(start, 12).query).toBe('');
    expect(setSearchQuery(start, null)).toBe(start);

    const typed = setSearchQuery(start, 'Pyodide');
    expect(typed).not.toBe(start);
    expect(typed.query).toBe('Pyodide');
    expect(setSearchQuery(typed, 'Pyodide')).toBe(typed);

    const init = decodeHostMessage({
      type: 'plugins.init',
      plugins: samplePlugins,
      active: { source: 'binance-rest' },
    });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const next = applyPluginsHostMessage(typed, init.type, init.payload);
    expect(next.query).toBe('Pyodide');
    expect(next.plugins.length).toBe(5);
  });

  test('chip → tab: active chip kind selects that kind tab', () => {
    expect(KIND_MARKS).toEqual({
      all: 'All',
      source: 'Src',
      stream: 'Stm',
      engine: 'Eng',
      storage: 'Sto',
      dataset: 'Ds',
      component: 'Cmp',
    });
    expect(KIND_CHIP_LABELS.source).toBe('src');
    expect(KIND_CHIP_LABELS.storage).toBe('stor');

    expect(tabFromChip('source')).toBe('source');
    expect(tabFromChip('all')).toBeNull();
    expect(tabFromChip('nope')).toBeNull();
    expect(tabFromChip(null)).toBeNull();
    expect(tabFromChip(1)).toBeNull();

    expect(activeChips({})).toEqual([]);
    expect(activeChips({ source: '  ', engine: '' })).toEqual([]);
    expect(activeChips({ source: undefined })).toEqual([]);

    const chips = activeChips({
      source: 'binance-rest',
      engine: ' server ',
      stream: 'binance-ws',
      storage: 'local',
      dataset: 'onchain',
      component: 'slot',
    });
    expect(chips.map((c) => c.chip)).toEqual(['src', 'stm', 'eng', 'stor', 'ds', 'cmp']);
    expect(chips[0]).toEqual({
      kind: 'source',
      tab: 'source',
      mark: 'Src',
      chip: 'src',
      id: 'binance-rest',
    });

    const jumped = setKindTab(initialPluginsState(), tabFromChip(chips[0]?.kind));
    expect(jumped.tab).toBe('source');
    expect(setKindTab(jumped, tabFromChip('engine')).tab).toBe('engine');
  });

  test('emptyFilterMessage', () => {
    expect(emptyFilterMessage('')).toBe('');
    expect(emptyFilterMessage('  ')).toBe('');
    expect(emptyFilterMessage(null)).toBe('');
    expect(emptyFilterMessage(1)).toBe('');
    expect(emptyFilterMessage('pyodide')).toBe('No plugins match "pyodide".');
  });

  test('pluginsViewHtml: search, kind marks, chips jump via data-tab, copy-id', () => {
    const html = pluginsViewHtml(readyState());
    expect(html).toContain('id="plugins-search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Filter plugins by name, id, or description"');
    expect(html).toContain('aria-label="Sources"');
    expect(html).toContain('>Src<');
    expect(html).toContain('>Stm<');
    expect(html).toContain('>Eng<');
    expect(html).toContain('>Sto<');
    expect(html).toContain('>Ds<');
    expect(html).toContain('>Cmp<');
    expect(html).toContain('data-action="copy-id"');
    expect(html).toContain('Copy id');
    expect(html).toContain('class="plugins-chip"');
    expect(html).toContain('id="chip-source"');
    expect(html).toMatch(/data-tab="source"/);
    expect(html).toContain('binance-rest');
    expect(html).toContain('>src<');
    expect(html).toContain('aria-label="Show Sources, binance-rest"');

    const filtered = pluginsViewHtml(readyState({ query: 'pyodide' }));
    expect(filtered).toContain('value="pyodide"');
    expect(filtered).toContain('data-id="pyodide"');
    expect(filtered).not.toContain('data-id="binance-rest"');
    expect(filtered).not.toContain('data-kind="source"');

    const none = pluginsViewHtml(readyState({ query: 'no-such-plugin' }));
    expect(none).toContain('No plugins match &quot;no-such-plugin&quot;.');

    const escaped = pluginsViewHtml(readyState({ query: '"<x>"' }));
    expect(escaped).toContain('value="&quot;&lt;x&gt;&quot;"');

    const engineMiss = pluginsViewHtml(readyState({ tab: 'engine', query: 'binance' }));
    expect(engineMiss).toContain('No plugins match &quot;binance&quot;.');
    expect(engineMiss).toContain('data-kind="engine"');
    expect(engineMiss).not.toContain('data-id="binance-rest"');

    const idle = pluginsViewHtml(initialPluginsState());
    expect(idle).toContain('Waiting for host catalog');
    expect(idle).toContain('id="plugins-search"');
    expect(idle).not.toContain('class="plugins-chip"');
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

describe('plugins webview copied flash helper', () => {
  test('copiedFlash labels, live text, and 1.2s duration', () => {
    expect(COPY_FLASH_MS).toBe(1200);
    expect(copiedFlash(true)).toEqual({
      label: COPIED_LABEL,
      title: COPIED_LABEL,
      live: COPIED_LABEL,
      ms: 1200,
    });
    expect(copiedFlash(false)).toEqual({
      label: COPY_ID_LABEL,
      title: COPY_ID_LABEL,
      live: '',
      ms: 1200,
    });
    expect(COPIED_LABEL).toBe('Copied');
    expect(COPY_ID_LABEL).toBe('Copy id');
  });

  test('applyCopiedFlash mutates button + aria-live target; never throws', () => {
    const attrs: string[] = [];
    const button = {
      textContent: COPY_ID_LABEL,
      title: COPY_ID_LABEL,
      setAttribute(name: string, value: string) {
        attrs.push(`${name}=${value}`);
        this.title = value;
      },
    };
    const live = { textContent: '' };
    expect(applyCopiedFlash(button, live, true)).toMatchObject({
      label: 'Copied',
      live: 'Copied',
      ms: COPY_FLASH_MS,
    });
    expect(button.textContent).toBe('Copied');
    expect(button.title).toBe('Copied');
    expect(live.textContent).toBe('Copied');
    expect(attrs).toContain('title=Copied');

    applyCopiedFlash(button, live, false);
    expect(button.textContent).toBe('Copy id');
    expect(live.textContent).toBe('');

    expect(() => applyCopiedFlash(null, null, true)).not.toThrow();
    expect(() => applyCopiedFlash(undefined, undefined, false)).not.toThrow();
    const hostile = {
      textContent: '',
      setAttribute() {
        throw new Error('nope');
      },
    };
    expect(applyCopiedFlash(hostile, null, true).label).toBe('Copied');
  });

  test('applyActivateFlash toggles is-flash for 400ms', () => {
    const tokens = new Set<string>();
    const card = {
      classList: {
        add: (c: string) => {
          tokens.add(c);
        },
        remove: (c: string) => {
          tokens.delete(c);
        },
      },
    };
    expect(ACTIVATE_FLASH_MS).toBe(400);
    expect(applyActivateFlash(card, true)).toEqual({ className: ACTIVATE_FLASH_CLASS, ms: 400 });
    expect(tokens.has('is-flash')).toBe(true);
    expect(applyActivateFlash(card, false)).toEqual({ className: '', ms: 400 });
    expect(tokens.has('is-flash')).toBe(false);
    expect(applyActivateFlash(null, true).className).toBe('is-flash');
    expect(applyActivateFlash({ classList: undefined }, true).ms).toBe(400);
    const boom = {
      classList: {
        add() {
          throw new Error('nope');
        },
        remove() {
          throw new Error('nope');
        },
      },
    };
    expect(() => applyActivateFlash(boom, true)).not.toThrow();
  });
});

describe('plugins webview filter count + kind svg', () => {
  const cards = samplePlugins.map((p) => normalizePluginCard(p)).filter((c) => c !== null);

  function readyState(partial: Partial<PluginsViewState> = {}): PluginsViewState {
    return {
      ...initialPluginsState(),
      ready: true,
      plugins: cards,
      active: { source: 'binance-rest', engine: 'server', stream: 'binance-ws', storage: 'local' },
      ...partial,
    };
  }

  test('filter count: filtered / total (tab + query)', () => {
    expect(filterCount(readyState())).toEqual({ filtered: 5, total: 5 });
    expect(filterCount(readyState({ query: 'pyodide' }))).toEqual({ filtered: 1, total: 5 });
    expect(filterCount(readyState({ tab: 'source' }))).toEqual({ filtered: 2, total: 5 });
    expect(filterCount(readyState({ tab: 'source', query: 'custom' }))).toEqual({
      filtered: 1,
      total: 5,
    });
    expect(filterCount(readyState({ tab: 'dataset' }))).toEqual({ filtered: 0, total: 5 });
    expect(filterCount(initialPluginsState())).toEqual({ filtered: 0, total: 0 });
    expect(filterCount(null)).toEqual({ filtered: 0, total: 0 });
    expect(filterCount(undefined)).toEqual({ filtered: 0, total: 0 });
    expect(filterCount({ ...readyState(), plugins: { length: 2 } as unknown as PluginCard[] })).toEqual({
      filtered: 0,
      total: 0,
    });

    expect(formatFilterCount({ filtered: 1, total: 5 })).toBe('1 / 5');
    expect(formatFilterCount(null)).toBe('0 / 0');
    expect(formatFilterCount({ filtered: Number.NaN, total: -3 })).toBe('0 / 0');
    expect(formatFilterCountAria({ filtered: 3, total: 5 })).toBe('3 of 5 plugins');
    expect(formatFilterCountAria(undefined)).toBe('0 of 0 plugins');

    const html = pluginsViewHtml(readyState());
    expect(html).toContain('id="plugins-count"');
    expect(html).toContain('5 / 5');
    expect(html).toContain('aria-label="5 of 5 plugins"');

    const filtered = pluginsViewHtml(readyState({ query: 'pyodide' }));
    expect(filtered).toContain('>1 / 5<');
    expect(filtered).toContain('aria-label="1 of 5 plugins"');

    const sourced = pluginsViewHtml(readyState({ tab: 'source' }));
    expect(sourced).toContain('>2 / 5<');
  });

  test('svg present in HTML: kind icons in tabs and cards', () => {
    const html = pluginsViewHtml(readyState());
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('class="plugins-kind-icon"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="plugins-live"');
    expect(html).toContain('title="Copy id"');
    expect(html).toContain('title="Activate"');
    expect(html).toContain('title="Already active"');

    for (const kind of ['source', 'stream', 'engine', 'storage', 'dataset', 'component'] as const) {
      expect(html).toContain(`data-kind-icon="${kind}"`);
      const icon = kindIconSvg(kind);
      expect(icon).toContain('viewBox="0 0 16 16"');
      expect(icon).toContain(`data-kind-icon="${kind}"`);
      expect(icon).toContain('currentColor');
      expect(html).toContain(icon);
    }

    expect(html).toContain('data-kind-icon="source"');
    expect(html.match(/data-kind-icon="source"/g)?.length).toBeGreaterThanOrEqual(2);

    const idle = pluginsViewHtml(initialPluginsState());
    expect(idle).toContain('data-kind-icon="engine"');
    expect(idle).toContain('>0 / 0<');
  });
});
