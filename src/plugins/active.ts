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
 * Resolve the **currently selected** source / stream / engine / storage plugins.
 *
 * Reads ids from `store.activePlugins` with fallbacks to `store.source`,
 * `store.live.streamId`, `store.engine`, then catalog defaults
 * (`binance-rest`, `binance-ws`, `server`, `local`).
 *
 * Config merges `store.pluginsConfig['kind:id']` (and bare id) with
 * `store.endpoint` for server engines.
 *
 * @module plugins/active
 */

import { store } from '../store';
import { registry } from './registry';
import { ensureBuiltins } from './bootstrap';
import { pluginKey, type EnginePlugin, type SourcePlugin, type StoragePlugin, type StreamPlugin } from './types';

function pluginConfig(kind: string, id: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return (
    configs[pluginKey(kind as 'source', id)] ||
    configs[id] ||
    {}
  );
}

export function getActiveSourceId(): string {
  return store.activePlugins?.source || store.source || 'binance-rest';
}

export function getActiveStreamId(): string {
  return store.activePlugins?.stream || store.live?.streamId || 'binance-ws';
}

export function getActiveEngineId(): string {
  return store.activePlugins?.engine || store.engine || 'server';
}

export function getActiveStorageId(): string {
  return store.activePlugins?.storage || 'local';
}

export function getActiveSource(): SourcePlugin {
  ensureBuiltins();
  const id = getActiveSourceId();
  const p = registry.getSource(id) || registry.getSource('binance-rest');
  if (!p) throw new Error(`No source plugin registered (wanted ${id})`);
  return p;
}

export function getActiveStream(): StreamPlugin {
  ensureBuiltins();
  const id = getActiveStreamId();
  const p = registry.getStream(id) || registry.getStream('binance-ws');
  if (!p) throw new Error(`No stream plugin registered (wanted ${id})`);
  return p;
}

export function getActiveEngine(): EnginePlugin {
  ensureBuiltins();
  const id = getActiveEngineId();
  const p = registry.getEngine(id) || registry.getEngine('server');
  if (!p) throw new Error(`No engine plugin registered (wanted ${id})`);
  return p;
}

/** Active storage plugin (defaults to local). */
export function getActiveStorage(): StoragePlugin | undefined {
  ensureBuiltins();
  const id = getActiveStorageId();
  return registry.getStorage(id) || registry.getStorage('local');
}

export function getActiveSourceConfig(): Record<string, unknown> {
  return pluginConfig('source', getActiveSourceId());
}

export function getActiveStreamConfig(): Record<string, unknown> {
  return pluginConfig('stream', getActiveStreamId());
}

export function getActiveEngineConfig(): Record<string, unknown> {
  const base = pluginConfig('engine', getActiveEngineId());
  ensureBuiltins();
  const id = getActiveEngineId();
  const engine = registry.getEngine(id);

  // pyne-worker: prefer pluginsConfig / a matching store.endpoint / production default
  // so a leftover Flask localhost URL does not override the edge host.
  if (id === 'pyne-worker') {
    try {
      // Lazy import path avoided — resolve inline to keep active.ts light
      const fromCfg = String(base.endpoint || '').trim();
      const fromStore = String(store.endpoint || '').trim();
      const looksPw = (s: string) => /pyne-worker|pine-worker/i.test(s);
      const endpoint = (
        fromCfg ||
        (looksPw(fromStore) ? fromStore : '') ||
        'https://pyne-worker.cryptolinx.workers.dev'
      ).replace(/\/$/, '');
      return { ...base, endpoint };
    } catch {
      return {
        ...base,
        endpoint: 'https://pyne-worker.cryptolinx.workers.dev',
      };
    }
  }

  // store.endpoint is the Settings field of record — must win over a stale
  // pluginsConfig.endpoint left over from older saves / presets.
  if (store.endpoint && (engine?.configSchema?.endpoint || id === 'server')) {
    return { ...base, endpoint: store.endpoint };
  }
  return base;
}
