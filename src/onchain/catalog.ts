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
 * Built-in on-chain **dataset** plugins (DefiLlama TVL, …).
 *
 * Registration goes through the unified {@link registry}. A local Map mirrors
 * plugins so lookup works even if registry methods were not yet available.
 *
 * @module onchain/catalog
 */

import type { DatasetPlugin } from '../plugins/types';
import { registry } from '../plugins/registry';
import {
  DEFILLAMA_PROVIDER_ID,
  fetchDefiLlamaProtocolTvl,
  searchDefiLlamaProtocols,
} from './defillama';
import { resolveDefiLlamaBaseUrl } from './proxy';
import { normalizeProtocolSlug } from './adapters';
import type {
  DatasetFetchOpts,
  OnchainDataset,
  OnchainInstrument,
} from './types';

export const DEFILLAMA_DATASET_ID = 'defillama-tvl';

/** Local registry mirror — always authoritative for this module's list APIs. */
const localDatasets = new Map<string, DatasetPlugin>();
const localOrder: string[] = [];
let registered = false;

function setLocal(plugin: DatasetPlugin): void {
  const isNew = !localDatasets.has(plugin.id);
  localDatasets.set(plugin.id, plugin);
  if (isNew) localOrder.push(plugin.id);
}

function removeLocal(id: string): boolean {
  if (!localDatasets.has(id)) return false;
  localDatasets.delete(id);
  const i = localOrder.indexOf(id);
  if (i >= 0) localOrder.splice(i, 1);
  return true;
}

/**
 * DefiLlama protocol TVL history dataset plugin.
 * Instrument: `protocolId` (slug) or `symbol` used as slug; metric fixed to `tvl`.
 */
export const defillamaTvlDatasetPlugin: DatasetPlugin = {
  id: DEFILLAMA_DATASET_ID,
  name: 'DefiLlama TVL',
  kind: 'dataset',
  description:
    'Protocol total value locked history from DefiLlama public API (scalar series, daily).',
  version: '1.0.0',
  builtIn: true,
  capabilities: {
    needsNetwork: true,
    needsProxy: true, // browser CORS often blocked
  },
  configSchema: {
    baseUrl: {
      type: 'string',
      default: '',
      label: 'API base URL',
      description:
        'Empty = use AXIS Worker proxy ({endpoint}/api/onchain/llama). Override with https://api.llama.fi or a custom proxy.',
      placeholder: '{endpoint}/api/onchain/llama',
    },
  },
  async fetchDataset(opts: DatasetFetchOpts): Promise<OnchainDataset> {
    const inst = opts?.instrument;
    if (!inst) throw new Error('DefiLlama TVL: instrument is required');

    const slug = normalizeProtocolSlug(
      inst.protocolId || inst.symbol || inst.address || '',
    );
    if (!slug) {
      throw new Error(
        'DefiLlama TVL: instrument.protocolId (or symbol) must be a protocol slug',
      );
    }

    const cfg = opts.config || {};
    // Prefer explicit config.baseUrl; else Worker proxy via store.endpoint
    const baseUrl = resolveDefiLlamaBaseUrl(cfg);

    const ds = await fetchDefiLlamaProtocolTvl(slug, {
      signal: opts.signal,
      baseUrl,
    });

    if (opts.resolution) {
      ds.resolution = opts.resolution;
    }

    if (
      (opts.startTime != null && Number.isFinite(opts.startTime)) ||
      (opts.endTime != null && Number.isFinite(opts.endTime))
    ) {
      const start =
        opts.startTime != null && Number.isFinite(opts.startTime)
          ? opts.startTime!
          : -Infinity;
      const end =
        opts.endTime != null && Number.isFinite(opts.endTime)
          ? opts.endTime!
          : Infinity;
      if (ds.points) {
        ds.points = ds.points.filter((p) => p.time >= start && p.time <= end);
      }
      if (ds.series?.tvl) {
        ds.series = {
          ...ds.series,
          tvl: ds.series.tvl.filter((p) => p.time >= start && p.time <= end),
        };
      }
    }

    if (opts.limit != null && Number.isFinite(opts.limit) && opts.limit > 0) {
      const n = Math.floor(opts.limit);
      if (ds.points && ds.points.length > n) {
        ds.points = ds.points.slice(ds.points.length - n);
      }
      if (ds.series?.tvl && ds.series.tvl.length > n) {
        ds.series = {
          ...ds.series,
          tvl: ds.series.tvl.slice(ds.series.tvl.length - n),
        };
      }
    }

    if (inst.symbol && inst.symbol.trim()) {
      ds.instrument = {
        ...ds.instrument,
        symbol: inst.symbol.trim(),
      };
    }

    return ds;
  },

  async searchInstruments(
    query: string,
    config?: Record<string, unknown>,
  ): Promise<OnchainInstrument[]> {
    const baseUrl = resolveDefiLlamaBaseUrl(config || {});
    const limit =
      typeof config?.limit === 'number' && Number.isFinite(config.limit)
        ? Math.floor(config.limit as number)
        : 20;

    const hits = await searchDefiLlamaProtocols(query, limit, { baseUrl });
    return hits.map((p) => ({
      chainId: 'all',
      protocolId: p.slug,
      metric: 'tvl',
      symbol: `${p.name} TVL`,
    }));
  },
};

export const BUILTIN_DATASETS: DatasetPlugin[] = [defillamaTvlDatasetPlugin];

/**
 * Idempotent registration of built-in dataset plugins.
 * Fills the local Map and calls `registry.registerDataset`.
 */
export function ensureOnchainDatasetsRegistered(): void {
  if (registered) return;
  registered = true;

  for (const p of BUILTIN_DATASETS) {
    setLocal(p);
  }

  const reg = registry as {
    registerDataset?: (p: DatasetPlugin) => unknown;
    getDataset?: (id: string) => DatasetPlugin | undefined;
    register?: (p: unknown) => unknown;
  };

  for (const p of BUILTIN_DATASETS) {
    try {
      if (typeof reg.registerDataset === 'function') {
        if (!reg.getDataset?.(p.id)) {
          reg.registerDataset(p);
        }
      } else if (typeof reg.register === 'function') {
        try {
          reg.register(p);
        } catch {
          /* registry not ready for dataset kind */
        }
      }
    } catch {
      /* ignore registry errors */
    }
  }
}

/** Look up a dataset plugin by id (ensures built-ins). */
export function getDatasetPlugin(id: string): DatasetPlugin | undefined {
  ensureOnchainDatasetsRegistered();
  return localDatasets.get(id) ?? registry.getDataset?.(id);
}

/** Alias matching sources/streams catalog naming. */
export function getDataset(id: string): DatasetPlugin | undefined {
  return getDatasetPlugin(id);
}

/** All registered dataset plugins in registration order. */
export function listDatasetPlugins(): DatasetPlugin[] {
  ensureOnchainDatasetsRegistered();
  if (localOrder.length) {
    return localOrder.map((id) => localDatasets.get(id)!).filter(Boolean);
  }
  return registry.listDatasets?.() ?? [];
}

/** Alias matching sources/streams catalog naming. */
export function listDatasets(): DatasetPlugin[] {
  return listDatasetPlugins();
}

/** Register a runtime (dynamic) dataset plugin. */
export function registerDynamicDataset(plugin: DatasetPlugin): void {
  ensureOnchainDatasetsRegistered();
  if (!plugin?.id || plugin.kind !== 'dataset') {
    throw new Error('Invalid dataset plugin: id and kind "dataset" required');
  }
  if (typeof plugin.fetchDataset !== 'function') {
    throw new Error('Dataset plugin must implement fetchDataset');
  }
  const p: DatasetPlugin = { ...plugin, builtIn: plugin.builtIn ?? false };
  setLocal(p);

  try {
    registry.registerDataset(p);
  } catch {
    /* local only if registry rejects */
  }
}

/** Unregister a dynamic dataset (built-ins blocked unless forced). */
export function unregisterDynamicDataset(
  id: string,
  opts?: { allowBuiltIn?: boolean },
): boolean {
  ensureOnchainDatasetsRegistered();
  const existing = localDatasets.get(id) ?? registry.getDataset?.(id);
  if (!existing) return false;
  if (existing.builtIn && !opts?.allowBuiltIn) return false;
  removeLocal(id);

  try {
    return registry.unregisterDataset(id, opts);
  } catch {
    return true; // local remove succeeded
  }
}

/** Provider id constant re-export for convenience. */
export { DEFILLAMA_PROVIDER_ID };

/** @internal test helper */
export function _resetOnchainDatasetRegistrationFlag(): void {
  registered = false;
  localDatasets.clear();
  localOrder.length = 0;
}

/** @internal test helper (alias used by older stubs) */
export function _resetOnchainCatalogForTests(): void {
  _resetOnchainDatasetRegistrationFlag();
}
