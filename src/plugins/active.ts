// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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
import {
  pluginKey,
  type EnginePlugin,
  type SourcePlugin,
  type StoragePlugin,
  type StreamPlugin,
} from './types';
import { getEngineApiKey } from '../storage/vault';
import { engineFamilyForText } from './engine-family';
import { buildProviderSession, type ProviderSession } from '../data/provider';
import { getDataManagerSelection } from '../data/data-manager-source';

function pluginConfig(kind: string, id: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  return configs[pluginKey(kind as 'source', id)] || configs[id] || {};
}

/** Selected source id: `activePlugins.source`, then legacy `store.source`, then `binance-rest`. */
export function getActiveSourceId(): string {
  return store.activePlugins?.source || store.source || 'binance-rest';
}

/** Selected stream id: `activePlugins.stream`, then `store.live.streamId`, then `binance-ws`. */
export function getActiveStreamId(): string {
  return store.activePlugins?.stream || store.live?.streamId || 'binance-ws';
}

/** Selected engine id: `activePlugins.engine`, then legacy `store.engine`, then `server`. */
export function getActiveEngineId(): string {
  return store.activePlugins?.engine || store.engine || 'server';
}

/** Selected storage id, defaulting to the built-in `local` library. */
export function getActiveStorageId(): string {
  return store.activePlugins?.storage || 'local';
}

/**
 * Resolve the active source plugin, registering built-ins first. Long-tail
 * `ccxt:<exchange>` ids are routed to the `ccxt-rest` gateway plugin.
 *
 * @returns The registered source plugin (falling back to `binance-rest`)
 * @throws When neither the requested id nor the fallback is registered
 */
export function getActiveSource(): SourcePlugin {
  ensureBuiltins();
  let id = getActiveSourceId();
  // Gateway swap: long-tail ccxt:<exchange> venues use ccxt-rest
  // when gateway is not direct (reads store directly to avoid circular dep).
  if (id.startsWith('ccxt:')) id = 'ccxt-rest';
  const p = registry.getSource(id) || registry.getSource('binance-rest');
  if (!p) throw new Error(`No source plugin registered (wanted ${id})`);
  return p;
}

/**
 * Resolve the active stream plugin, registering built-ins first. Long-tail
 * `ccxt:<exchange>` ids are routed to the `ccxt-ws` gateway plugin.
 *
 * @returns The registered stream plugin (falling back to `binance-ws`)
 * @throws When neither the requested id nor the fallback is registered
 */
export function getActiveStream(): StreamPlugin {
  ensureBuiltins();
  let id = getActiveStreamId();
  // Gateway swap: long-tail ccxt:<exchange> venues use ccxt-ws
  if (id.startsWith('ccxt:')) id = 'ccxt-ws';
  const p = registry.getStream(id) || registry.getStream('binance-ws');
  if (!p) throw new Error(`No stream plugin registered (wanted ${id})`);
  return p;
}

/**
 * Resolve the active engine plugin, registering built-ins first.
 *
 * @returns The registered engine plugin (falling back to `server`)
 * @throws When neither the requested id nor the fallback is registered
 */
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

/** Locked market-data identity (venue + pair + auth). Falls back to plugins. */
export function getActiveProvider(): ProviderSession {
  ensureBuiltins();
  const sourceId = getActiveSourceId();
  const streamId = getActiveStreamId();
  const stored = store.provider;
  if (stored?.sourceId === sourceId && stored?.streamId === streamId) {
    return stored;
  }
  const src = registry.getSource(sourceId);
  const str = registry.getStream(streamId);
  return buildProviderSession(sourceId, streamId, {
    sourceCaps: src?.capabilities,
    streamCaps: str?.capabilities,
    underlyingSourceId:
      sourceId === 'data-manager' ? getDataManagerSelection()?.sourceId : undefined,
    authMode: stored?.authMode,
    credentialId: stored?.credentialId,
    gateway: stored?.gateway,
    market: stored?.market || src?.capabilities?.market,
  });
}

/**
 * Config bag for the active source: `pluginsConfig['source:<id>']`, then the
 * bare id, else an empty object.
 *
 * @returns The stored config (never null)
 */
export function getActiveSourceConfig(): Record<string, unknown> {
  return pluginConfig('source', getActiveSourceId());
}

/**
 * Config bag for the active stream: `pluginsConfig['stream:<id>']`, then the
 * bare id, else an empty object.
 *
 * @returns The stored config (never null)
 */
export function getActiveStreamConfig(): Record<string, unknown> {
  return pluginConfig('stream', getActiveStreamId());
}

/**
 * Effective config for the active engine.
 *
 * Layers, in order: the stored `pluginsConfig` bag, the engine's schema default
 * for `mode`, and the API key restored from the session vault (the durable
 * payload strips every `apiKey`, so a reload would otherwise drop it and
 * key-gated calls would answer 401). The endpoint is then resolved per family:
 * worker engines fall back to the edge default instead of a leftover Flask
 * localhost URL, and for server engines `store.endpoint` is the field of record.
 *
 * @returns The merged config the engine calls should use
 */
export function getActiveEngineConfig(): Record<string, unknown> {
  const base = pluginConfig('engine', getActiveEngineId());
  ensureBuiltins();
  const id = getActiveEngineId();
  const engine = registry.getEngine(id);
  const schemaMode = engine?.configSchema?.['mode']?.default;
  const withMode =
    (base['mode'] == null || base['mode'] === '') && schemaMode != null
      ? { ...base, mode: schemaMode }
      : base;
  // The durable payload strips every `apiKey`, so read the key through the
  // session vault — otherwise a reload drops it and every key-gated call
  // (`/data/*`, authenticated `/run`) answers 401.
  const vaultKey = getEngineApiKey(store.pluginsConfig, id);
  const withKey =
    vaultKey && String(withMode['apiKey'] || '').trim() !== vaultKey
      ? { ...withMode, apiKey: vaultKey }
      : withMode;

  // Worker engines: prefer pluginsConfig / a matching store.endpoint / production
  // default so a leftover Flask localhost URL does not override the edge host.
  if (engine?.family === 'worker') {
    try {
      // Lazy import path avoided — resolve inline to keep active.ts light
      const fromCfg = String(withKey['endpoint'] || '').trim();
      const fromStore = String(store.endpoint || '').trim();
      const looksPw = (s: string) => engineFamilyForText(s) === 'worker';
      const endpoint = (
        fromCfg ||
        (looksPw(fromStore) ? fromStore : '') ||
        'https://pyne-worker.cryptolinx.workers.dev'
      ).replace(/\/$/, '');
      return { ...withKey, endpoint };
    } catch {
      return {
        ...withKey,
        endpoint: 'https://pyne-worker.cryptolinx.workers.dev',
      };
    }
  }

  // store.endpoint is the Settings field of record — must win over a stale
  // pluginsConfig.endpoint left over from older saves / presets.
  if (store.endpoint && (engine?.configSchema?.['endpoint'] || engine?.family === 'server')) {
    return { ...withKey, endpoint: store.endpoint };
  }
  return withKey;
}
