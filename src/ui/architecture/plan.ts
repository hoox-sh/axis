// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AXIS architecture plan — measure a source × stream × engine × storage
 * × dataset wiring against compose-recipe predefinitions.
 *
 * Plugin ids come from the live catalogs (`sources/`, `streams/`, `engines/`,
 * `storage/`, `onchain/`). Naming follows preset drift: an exact match keeps
 * the predefinition name; each divergence adds a signed counter.
 *
 * @module ui/architecture/plan
 */

import type { PluginBase, PluginCapabilities } from '../../plugins/types';
import { pluginKey } from '../../plugins/types';
import { listSources } from '../../sources/catalog';
import { listStreams } from '../../streams/catalog';
import { listEngines } from '../../engines/catalog';
import { listStorages } from '../../storage/catalog';
import { listDatasets } from '../../onchain/catalog';
import type { ActivePlugins } from '../../store/types';

export type SlotKind = 'source' | 'stream' | 'engine' | 'storage' | 'dataset';

export interface AxisPlugin {
  id: string;
  name: string;
  kind: SlotKind;
  description: string;
  capabilities: PluginCapabilities;
}

export interface SlotMeta {
  kind: SlotKind;
  label: string;
  /** Required method(s) on the contract, per plugins/types. */
  contract: string;
  role: string;
  /** Optional slots may be set to `null` — a reduced plan. */
  optional: boolean;
}

export const SLOTS: SlotMeta[] = [
  {
    kind: 'source',
    label: 'Source',
    contract: 'fetchHistorical',
    role: 'Historical OHLCV',
    optional: false,
  },
  {
    kind: 'stream',
    label: 'Stream',
    contract: 'start → stop',
    role: 'Live bars',
    optional: true,
  },
  {
    kind: 'engine',
    label: 'Engine',
    contract: 'isReady + run',
    role: 'Pine evaluation',
    optional: false,
  },
  {
    kind: 'storage',
    label: 'Storage',
    contract: 'list / read / write / remove',
    role: 'Script library',
    optional: false,
  },
  {
    kind: 'dataset',
    label: 'Dataset',
    contract: 'fetchDataset',
    role: 'On-chain / alternate series',
    optional: true,
  },
];

/** A wiring of every slot. `null` means the optional slot is switched off. */
export type AxisConfig = Record<SlotKind, string | null>;

export interface Predefinition {
  id: string;
  name: string;
  tagline: string;
  config: AxisConfig;
}

/**
 * Predefinitions derived from compose recipes in
 * `docs/enduser/getting-started/compose-recipes.mdx`.
 */
export const PREDEFINITIONS: Predefinition[] = [
  {
    id: 'offline-lab',
    name: 'Offline Lab',
    tagline: 'No network at all — synthetic bars, in-browser Pine.',
    config: {
      source: 'mock-walk',
      stream: 'mock-poll',
      engine: 'pyodide',
      storage: 'local',
      dataset: null,
    },
  },
  {
    id: 'live-crypto',
    name: 'Live Crypto',
    tagline: 'Binance history plus live klines against the server engine.',
    config: {
      source: 'binance-rest',
      stream: 'binance-ws',
      engine: 'server',
      storage: 'local',
      dataset: null,
    },
  },
  {
    id: 'csv-desk',
    name: 'CSV Desk',
    tagline: 'Uploaded tape, no live feed — airgap Pine or the server engine.',
    config: {
      source: 'csv-upload',
      stream: null,
      engine: 'pyodide',
      storage: 'local',
      dataset: null,
    },
  },
  {
    id: 'on-chain',
    name: 'On-Chain',
    tagline: 'DEX pool OHLCV with a TVL dataset overlay.',
    config: {
      source: 'geckoterminal-ohlcv',
      stream: 'mock-poll',
      engine: 'server',
      storage: 'cloud',
      dataset: 'defillama-tvl',
    },
  },
  {
    id: 'team-cloud',
    name: 'Team Cloud',
    tagline: 'Live venue data with a git-backed shared script library.',
    config: {
      source: 'binance-rest',
      stream: 'binance-ws',
      engine: 'server',
      storage: 'git',
      dataset: null,
    },
  },
];

export type DriftKind = 'added' | 'removed' | 'swapped';

export interface SlotDrift {
  kind: SlotKind;
  label: string;
  drift: DriftKind;
  from: AxisPlugin | null;
  to: AxisPlugin | null;
}

export interface PlanState {
  base: Predefinition;
  pristine: boolean;
  drifts: SlotDrift[];
  added: number;
  removed: number;
  swapped: number;
  /** e.g. `Offline Lab`, `Offline Lab +2`, `Offline Lab +1 −1`. */
  planName: string;
  requirements: {
    fullyOffline: boolean;
    needsNetwork: boolean;
    needsAuth: boolean;
    needsProxy: boolean;
  };
}

function asPlugin(p: PluginBase): AxisPlugin | null {
  if (
    p.kind !== 'source' &&
    p.kind !== 'stream' &&
    p.kind !== 'engine' &&
    p.kind !== 'storage' &&
    p.kind !== 'dataset'
  ) {
    return null;
  }
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    description: p.description || '',
    capabilities: p.capabilities || {},
  };
}

/** Live catalog for one slot (built-ins + URL plugins). */
export function pluginsFor(kind: SlotKind): AxisPlugin[] {
  const raw: PluginBase[] =
    kind === 'source'
      ? listSources()
      : kind === 'stream'
        ? listStreams()
        : kind === 'engine'
          ? listEngines()
          : kind === 'storage'
            ? listStorages()
            : listDatasets();
  return raw.map(asPlugin).filter((p): p is AxisPlugin => p !== null);
}

export function getPlugin(kind: SlotKind, id: string | null): AxisPlugin | null {
  if (!id) return null;
  return pluginsFor(kind).find((p) => p.id === id) ?? null;
}

export function findPredefinition(id: string): Predefinition | null {
  return PREDEFINITIONS.find((p) => p.id === id) ?? null;
}

export function configsEqual(a: AxisConfig, b: AxisConfig): boolean {
  return SLOTS.every((s) => a[s.kind] === b[s.kind]);
}

/** Exact predefinition match for a wiring, if one exists. */
export function matchPredefinition(config: AxisConfig): Predefinition | null {
  return PREDEFINITIONS.find((p) => configsEqual(p.config, config)) ?? null;
}

function emptyToNull(id: string | null | undefined): string | null {
  if (id == null) return null;
  const t = String(id).trim();
  return t ? t : null;
}

/**
 * Read the current Solid store selection as an {@link AxisConfig}.
 * Empty / missing optional slots become `null`.
 */
export function configFromActive(
  plugins: Partial<ActivePlugins> | null | undefined,
  extras?: { source?: string; engine?: string; streamId?: string },
): AxisConfig {
  return {
    source: emptyToNull(plugins?.source || extras?.source) || 'binance-rest',
    stream: emptyToNull(plugins?.stream || extras?.streamId),
    engine: emptyToNull(plugins?.engine || extras?.engine) || 'server',
    storage: emptyToNull(plugins?.storage) || 'local',
    dataset: emptyToNull(plugins?.dataset),
  };
}

/**
 * Measure a wiring against a base predefinition.
 *
 * If the wiring lands exactly on a different predefinition, that one takes
 * over as the base so the label snaps back to a clean name.
 */
export function derivePlan(config: AxisConfig, baseId: string): PlanState {
  const exact = matchPredefinition(config);
  const base = exact ?? findPredefinition(baseId) ?? PREDEFINITIONS[0]!;

  const drifts: SlotDrift[] = [];
  for (const slot of SLOTS) {
    const from = base.config[slot.kind];
    const to = config[slot.kind];
    if (from === to) continue;

    const drift: DriftKind = from === null ? 'added' : to === null ? 'removed' : 'swapped';
    drifts.push({
      kind: slot.kind,
      label: slot.label,
      drift,
      from: getPlugin(slot.kind, from),
      to: getPlugin(slot.kind, to),
    });
  }

  const added = drifts.filter((d) => d.drift === 'added').length;
  const removed = drifts.filter((d) => d.drift === 'removed').length;
  const swapped = drifts.filter((d) => d.drift === 'swapped').length;

  const gained = added + swapped;
  const suffix = [gained > 0 ? `+${gained}` : '', removed > 0 ? `−${removed}` : '']
    .filter(Boolean)
    .join(' ');

  const active = SLOTS.map((s) => getPlugin(s.kind, config[s.kind])).filter(
    (p): p is AxisPlugin => p !== null,
  );

  return {
    base,
    pristine: drifts.length === 0,
    drifts,
    added,
    removed,
    swapped,
    planName: suffix ? `${base.name} ${suffix}` : base.name,
    requirements: {
      fullyOffline: active.length > 0 && active.every((p) => !!p.capabilities.offline),
      needsNetwork: active.some((p) => !!p.capabilities.needsNetwork),
      needsAuth: active.some((p) => !!p.capabilities.needsAuth),
      needsProxy: active.some((p) => !!p.capabilities.needsProxy),
    },
  };
}

/**
 * The patch AXIS commits on Apply — flat `source` / `engine` / `live.streamId`
 * plus `activePlugins` ids (not a `kind:id → true` map).
 */
export function toStorePatch(config: AxisConfig) {
  const active: Record<string, true> = {};
  for (const slot of SLOTS) {
    const id = config[slot.kind];
    if (id) active[pluginKey(slot.kind, id)] = true;
  }

  return {
    source: config.source,
    engine: config.engine,
    live: { streamId: config.stream, enabled: config.stream !== null },
    activePlugins: {
      source: config.source || 'binance-rest',
      stream: config.stream || '',
      engine: config.engine || 'server',
      storage: config.storage || 'local',
      dataset: config.dataset || '',
    },
    /** Registry keys that would be marked active (`kind:id`). */
    keys: active,
  };
}

export { pluginKey };
