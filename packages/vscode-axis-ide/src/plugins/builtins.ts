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
 * Minimal builtin id lists copied from AXIS PWA catalogs (no Solid).
 *
 * Sources: `src/engines/catalog.ts`, `src/sources/catalog.ts`,
 * `src/streams/catalog.ts`, `src/storage/catalog.ts`, `src/onchain/catalog.ts`,
 * `src/plugins/hpo.ts` / `src/plugins/types.ts` kinds.
 */

import type { PluginDescriptor, PluginKind } from './types';

/** Builtin calculation engines (`src/engines/catalog.ts` BUILTIN_ENGINES). */
export const BUILTIN_ENGINE_IDS = ['server', 'pyne-worker', 'pyodide'] as const;

/** Builtin historical sources (`src/sources/catalog.ts` BUILTIN_SOURCES). */
export const BUILTIN_SOURCE_IDS = [
  'binance-rest',
  'okx-rest',
  'bybit-rest',
  'coinbase-rest',
  'kraken-rest',
  'mexc-rest',
  'geckoterminal-ohlcv',
  'ccxt-rest',
  'mock-walk',
  'csv-upload',
  'data-manager',
] as const;

/** Builtin live streams (`src/streams/catalog.ts` BUILTIN_STREAMS). */
export const BUILTIN_STREAM_IDS = [
  'binance-ws',
  'okx-ws',
  'bybit-ws',
  'coinbase-ws',
  'kraken-ws',
  'mexc-ws',
  'ccxt-ws',
  'mock-poll',
] as const;

/** Builtin storage backends (`src/storage/catalog.ts`). */
export const BUILTIN_STORAGE_IDS = ['local', 'cloud', 'git'] as const;

/** Builtin on-chain datasets (`src/onchain/catalog.ts`). */
export const BUILTIN_DATASET_IDS = ['defillama-tvl'] as const;

/** Builtin component plugins (`src/plugins/hpo.ts`). */
export const BUILTIN_COMPONENT_IDS = ['hyperparameter-optimisation'] as const;

function desc(
  kind: PluginKind,
  id: string,
  name: string,
  description?: string,
): PluginDescriptor {
  return { id, name, kind, builtIn: true, description };
}

/** Full builtin descriptors in stable UI order (engines + sources first for acceptance). */
export const BUILTIN_PLUGIN_DESCRIPTORS: readonly PluginDescriptor[] = [
  desc('engine', 'server', 'Server (pyne Pro)', 'WebSocket /run + POST /run'),
  desc('engine', 'pyne-worker', 'pyne-worker', 'HOOX edge Pine evaluator'),
  desc('engine', 'pyodide', 'Pyodide', 'In-process Wasm calculator (flag-gated)'),

  desc('source', 'binance-rest', 'Binance REST'),
  desc('source', 'okx-rest', 'OKX REST'),
  desc('source', 'bybit-rest', 'Bybit REST'),
  desc('source', 'coinbase-rest', 'Coinbase REST'),
  desc('source', 'kraken-rest', 'Kraken REST'),
  desc('source', 'mexc-rest', 'MEXC REST'),
  desc('source', 'geckoterminal-ohlcv', 'GeckoTerminal OHLCV'),
  desc('source', 'ccxt-rest', 'CCXT REST'),
  desc('source', 'mock-walk', 'Mock walk'),
  desc('source', 'csv-upload', 'CSV upload'),
  desc('source', 'data-manager', 'Data Source Manager'),

  desc('stream', 'binance-ws', 'Binance WS'),
  desc('stream', 'okx-ws', 'OKX WS'),
  desc('stream', 'bybit-ws', 'Bybit WS'),
  desc('stream', 'coinbase-ws', 'Coinbase WS'),
  desc('stream', 'kraken-ws', 'Kraken WS'),
  desc('stream', 'mexc-ws', 'MEXC WS'),
  desc('stream', 'ccxt-ws', 'CCXT WS'),
  desc('stream', 'mock-poll', 'Mock poll'),

  desc('storage', 'local', 'Local'),
  desc('storage', 'cloud', 'Cloud (Worker scripts)'),
  desc('storage', 'git', 'Git'),

  desc('dataset', 'defillama-tvl', 'DefiLlama TVL'),

  desc(
    'component',
    'hyperparameter-optimisation',
    'Hyperparameter Optimisation',
    'TreeView / WebviewView contribution only (no Solid mount)',
  ),
];

/** Builtin ids for one kind. */
export function builtinIdsForKind(kind: PluginKind): readonly string[] {
  switch (kind) {
    case 'engine':
      return BUILTIN_ENGINE_IDS;
    case 'source':
      return BUILTIN_SOURCE_IDS;
    case 'stream':
      return BUILTIN_STREAM_IDS;
    case 'storage':
      return BUILTIN_STORAGE_IDS;
    case 'dataset':
      return BUILTIN_DATASET_IDS;
    case 'component':
      return BUILTIN_COMPONENT_IDS;
    default:
      return [];
  }
}
