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
  plugins: PluginCard[];
  active: ActivePluginsMap;
  flags: PluginsFlags;
};

export function initialPluginsState(tab: KindTab = 'all'): PluginsViewState {
  return {
    ready: false,
    tab: isKindTab(tab) ? tab : 'all',
    plugins: [],
    active: {},
    flags: {},
  };
}

export function setKindTab(state: PluginsViewState, tab: unknown): PluginsViewState {
  if (!isKindTab(tab) || tab === state.tab) return state;
  return { ...state, tab };
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

export function kindsToRender(tab: KindTab): readonly PluginKind[] {
  if (tab === 'all') return PLUGIN_KINDS;
  return [tab];
}

export function pluginsForKind(plugins: PluginCard[], kind: PluginKind): PluginCard[] {
  return plugins.filter((p) => p.kind === kind);
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
