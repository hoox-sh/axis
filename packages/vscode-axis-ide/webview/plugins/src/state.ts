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

/**
 * Pure Plugins studio reducer + presenters (no DOM).
 */

import {
  HOST_TO_VIEW,
  KIND_TABS,
  PLUGIN_KINDS,
  isKindTab,
  isPluginKind,
  normalizeActive,
  normalizeFlags,
  normalizePlugins,
  type ActivePluginsMap,
  type KindTab,
  type PluginCard,
  type PluginExtra,
  type PluginKind,
  type PluginsFlags,
} from './protocol';

export const PYODIDE_ID = 'pyodide';
export const PYODIDE_FLAG_WARNING = 'axis.engine.allowPyodide off';

export const KIND_LABELS: Record<KindTab, string> = {
  all: 'All',
  source: 'Sources',
  stream: 'Streams',
  engine: 'Engines',
  storage: 'Storage',
  dataset: 'Datasets',
  component: 'Components',
};

/** Compact marks for tabs / section headers (codicon-free). */
export const KIND_MARKS: Record<KindTab, string> = {
  all: 'All',
  source: 'Src',
  stream: 'Stm',
  engine: 'Eng',
  storage: 'Sto',
  dataset: 'Ds',
  component: 'Cmp',
};

/** Lowercase chip prefixes (click `src binance-rest` → Sources). */
export const KIND_CHIP_LABELS: Record<PluginKind, string> = {
  source: 'src',
  stream: 'stm',
  engine: 'eng',
  storage: 'stor',
  dataset: 'ds',
  component: 'cmp',
};

export type ActiveChip = {
  kind: PluginKind;
  tab: PluginKind;
  mark: string;
  chip: string;
  id: string;
};

export const KIND_ROLE_FALLBACK: Record<PluginKind, string> = {
  source: 'Historical OHLCV',
  stream: 'Live bars',
  engine: 'Pine evaluation',
  storage: 'Script library',
  dataset: 'On-chain / alternate series',
  component: 'UI slot (no Solid mount)',
};

export const EMPTY_KIND_COPY: Record<PluginKind, string> = {
  source: 'No source plugins in the registry.',
  stream: 'No stream plugins in the registry.',
  engine: 'No engine plugins in the registry.',
  storage: 'No storage plugins in the registry.',
  dataset: 'No dataset plugins in the registry.',
  component: 'No component plugins in the registry.',
};

export type PluginBadge = {
  text: string;
  tone: 'active' | 'muted' | 'warn';
};

export type ExtraFact = { key: string; value: string };

export type PluginsViewState = {
  ready: boolean;
  tab: KindTab;
  query: string;
  plugins: PluginCard[];
  active: ActivePluginsMap;
  flags: PluginsFlags;
};

export function initialPluginsState(tab: KindTab = 'all'): PluginsViewState {
  return {
    ready: false,
    tab: isKindTab(tab) ? tab : 'all',
    query: '',
    plugins: [],
    active: {},
    flags: {},
  };
}

export function setKindTab(state: PluginsViewState, tab: unknown): PluginsViewState {
  if (!isKindTab(tab) || tab === state.tab) return state;
  return { ...state, tab };
}

/** Local search string (host protocol is unchanged). Non-strings become empty. */
export function setSearchQuery(state: PluginsViewState, query: unknown): PluginsViewState {
  const next = typeof query === 'string' ? query : '';
  if (next === state.query) return state;
  return { ...state, query: next };
}

/** Map an active-chip kind (or `data-tab`) onto the kind tab. */
export function tabFromChip(raw: unknown): KindTab | null {
  return isPluginKind(raw) ? raw : null;
}

export function emptyFilterMessage(query: unknown): string {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return '';
  return `No plugins match "${q}".`;
}

export const COPY_FLASH_MS = 1200;
export const ACTIVATE_FLASH_MS = 400;
export const COPY_ID_LABEL = 'Copy id';
export const COPIED_LABEL = 'Copied';
export const ACTIVATE_FLASH_CLASS = 'is-flash';

export type CopyFlash = {
  label: string;
  title: string;
  live: string;
  ms: number;
};

export type FilterCount = {
  filtered: number;
  total: number;
};

function finiteCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Visible cards (tab + query) over catalog size. */
export function filterCount(state: PluginsViewState | null | undefined): FilterCount {
  try {
    const plugins = state && Array.isArray(state.plugins) ? state.plugins : [];
    const total = plugins.length;
    const tab = state && isKindTab(state.tab) ? state.tab : 'all';
    const query = state && typeof state.query === 'string' ? state.query : '';
    const filtered = filterPluginsByQuery(filterPluginsByTab(plugins, tab), query).length;
    return { filtered, total };
  } catch {
    return { filtered: 0, total: 0 };
  }
}

export function formatFilterCount(count: { filtered?: unknown; total?: unknown } | null | undefined): string {
  return `${finiteCount(count?.filtered)} / ${finiteCount(count?.total)}`;
}

export function formatFilterCountAria(
  count: { filtered?: unknown; total?: unknown } | null | undefined,
): string {
  return `${finiteCount(count?.filtered)} of ${finiteCount(count?.total)} plugins`;
}

export function copiedFlash(on: boolean): CopyFlash {
  if (on) {
    return { label: COPIED_LABEL, title: COPIED_LABEL, live: COPIED_LABEL, ms: COPY_FLASH_MS };
  }
  return { label: COPY_ID_LABEL, title: COPY_ID_LABEL, live: '', ms: COPY_FLASH_MS };
}

export type FlashTextTarget = {
  textContent: string | null;
  title?: string;
  setAttribute?: (name: string, value: string) => void;
};

/** Copy-id micro-feedback: button label + polite live region. Never throws. */
export function applyCopiedFlash(
  button: FlashTextTarget | null | undefined,
  live: FlashTextTarget | null | undefined,
  on: boolean,
): CopyFlash {
  const flash = copiedFlash(on === true);
  try {
    if (button) {
      button.textContent = flash.label;
      button.title = flash.title;
      if (typeof button.setAttribute === 'function') {
        button.setAttribute('title', flash.title);
      }
    }
    if (live) live.textContent = flash.live;
  } catch {
    // hostile targets
  }
  return flash;
}

export type ClassListLike = {
  add: (token: string) => void;
  remove: (token: string) => void;
};

/** Activate micro-feedback: `is-flash` class for `ACTIVATE_FLASH_MS`. Never throws. */
export function applyActivateFlash(
  card: { classList?: ClassListLike } | null | undefined,
  on: boolean,
): { className: string; ms: number } {
  const className = on === true ? ACTIVATE_FLASH_CLASS : '';
  try {
    if (card?.classList) {
      if (on === true) card.classList.add(ACTIVATE_FLASH_CLASS);
      else card.classList.remove(ACTIVATE_FLASH_CLASS);
    }
  } catch {
    // hostile targets
  }
  return { className, ms: ACTIVATE_FLASH_MS };
}

/**
 * Apply one decoded host message. Unknown types and hostile payloads leave
 * state unchanged (never throw).
 */
export function applyPluginsHostMessage(
  state: PluginsViewState,
  type: string,
  payload: Record<string, unknown>,
): PluginsViewState {
  try {
    if (type === HOST_TO_VIEW.Init) {
      if (!('plugins' in payload) || !Array.isArray(payload.plugins)) {
        return state;
      }
      return {
        ...state,
        ready: true,
        plugins: normalizePlugins(payload.plugins),
        active: normalizeActive(payload.active),
        flags: normalizeFlags(payload.flags),
      };
    }
    if (type === HOST_TO_VIEW.State) {
      const next: PluginsViewState = { ...state, ready: true };
      if ('active' in payload) next.active = normalizeActive(payload.active);
      if ('flags' in payload) next.flags = normalizeFlags(payload.flags);
      if ('plugins' in payload && Array.isArray(payload.plugins)) {
        next.plugins = normalizePlugins(payload.plugins);
      }
      return next;
    }
    return state;
  } catch {
    return state;
  }
}

export function filterPluginsByTab(plugins: PluginCard[], tab: KindTab): PluginCard[] {
  if (tab === 'all') return plugins.slice();
  return plugins.filter((p) => p.kind === tab);
}

/** Empty / whitespace query matches every card (name, id, description). */
export function pluginMatchesQuery(card: PluginCard, query: unknown): boolean {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return true;
  const name = typeof card.name === 'string' ? card.name : '';
  const id = typeof card.id === 'string' ? card.id : '';
  const description = typeof card.description === 'string' ? card.description : '';
  return (
    name.toLowerCase().includes(q) ||
    id.toLowerCase().includes(q) ||
    description.toLowerCase().includes(q)
  );
}

export function filterPluginsByQuery(plugins: PluginCard[], query: unknown): PluginCard[] {
  if (!Array.isArray(plugins)) return [];
  const q = typeof query === 'string' ? query : '';
  if (!q.trim()) return plugins.slice();
  return plugins.filter((p) => pluginMatchesQuery(p, q));
}

export function kindsToRender(tab: KindTab): readonly PluginKind[] {
  if (tab === 'all') return PLUGIN_KINDS;
  return [tab];
}

export function pluginsForKind(plugins: PluginCard[], kind: PluginKind): PluginCard[] {
  return plugins.filter((p) => p.kind === kind);
}

export function visiblePluginsForKind(state: PluginsViewState, kind: PluginKind): PluginCard[] {
  return filterPluginsByQuery(pluginsForKind(state.plugins, kind), state.query);
}

export function activeChips(active: ActivePluginsMap): ActiveChip[] {
  const out: ActiveChip[] = [];
  for (const kind of PLUGIN_KINDS) {
    const id = active[kind];
    if (typeof id !== 'string') continue;
    const trimmed = id.trim();
    if (!trimmed) continue;
    out.push({
      kind,
      tab: kind,
      mark: KIND_MARKS[kind],
      chip: KIND_CHIP_LABELS[kind],
      id: trimmed,
    });
  }
  return out;
}

export function isPluginActive(card: PluginCard, active: ActivePluginsMap): boolean {
  return active[card.kind] === card.id;
}

/** Pyodide calculator gated by `axis.engine.allowPyodide` (still activatable). */
export function isPyodideFlagOff(card: PluginCard, flags: PluginsFlags): boolean {
  if (card.id !== PYODIDE_ID) return false;
  if (card.extra.flagOff === true) return true;
  return flags.allowPyodide === false;
}

export function pluginBadges(
  card: PluginCard,
  active: ActivePluginsMap,
  flags: PluginsFlags,
): PluginBadge[] {
  const badges: PluginBadge[] = [];
  if (isPluginActive(card, active)) {
    badges.push({ text: 'Active', tone: 'active' });
  }
  badges.push(
    card.builtIn
      ? { text: 'Built-in', tone: 'muted' }
      : { text: 'Dynamic', tone: 'muted' },
  );
  if (isPyodideFlagOff(card, flags)) {
    badges.push({ text: 'Flag off', tone: 'warn' });
    badges.push({ text: PYODIDE_FLAG_WARNING, tone: 'warn' });
  }
  return badges;
}

function factValue(value: string | boolean): string | null {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  const t = value.trim();
  return t ? t : null;
}

const EXTRA_FACT_KEYS: readonly { key: keyof PluginExtra; label: string }[] = [
  { key: 'role', label: 'role' },
  { key: 'live', label: 'live' },
  { key: 'pyodide', label: 'pyodide' },
  { key: 'storage', label: 'storage' },
  { key: 'onChain', label: 'on-chain' },
  { key: 'noSolid', label: 'no-solid' },
];

export function extraFacts(extra: PluginExtra): ExtraFact[] {
  const out: ExtraFact[] = [];
  for (const { key, label } of EXTRA_FACT_KEYS) {
    const raw = extra[key];
    if (raw === undefined || typeof raw === 'boolean' && key === 'flagOff') continue;
    if (typeof raw === 'string' || typeof raw === 'boolean') {
      const value = factValue(raw);
      if (value) out.push({ key: label, value });
    }
  }
  return out;
}

export function kindRole(kind: PluginKind, cards: PluginCard[]): string {
  for (const card of cards) {
    const role = card.extra.role?.trim();
    if (role) return role;
  }
  return KIND_ROLE_FALLBACK[kind];
}

export function formatActiveStatus(active: ActivePluginsMap): string {
  const dash = '—';
  const src = active.source?.trim() || dash;
  const eng = active.engine?.trim() || dash;
  const stm = active.stream?.trim() || dash;
  const stor = active.storage?.trim() || dash;
  return `Active · src ${src} · eng ${eng} · stm ${stm} · stor ${stor}`;
}

export function tabFromPersisted(raw: unknown): KindTab {
  if (isKindTab(raw)) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && isKindTab((raw as { tab?: unknown }).tab)) {
    return (raw as { tab: KindTab }).tab;
  }
  return 'all';
}

export { KIND_TABS, PLUGIN_KINDS };
