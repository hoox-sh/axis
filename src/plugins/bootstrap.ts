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
 * Register all **built-in** plugins with the unified registry.
 *
 * Idempotent: safe to call from app boot, plugin loader, and active resolvers.
 * Covers sources, streams, engines, storages, on-chain datasets, and the
 * built-in HPO component (not dynamic URL plugins).
 *
 * @module plugins/bootstrap
 */

import { registry } from './registry';
import {
  ensureSourcesRegistered,
  _resetSourceRegistrationFlag,
} from '../sources/catalog';
import {
  ensureStreamsRegistered,
  _resetStreamRegistrationFlag,
} from '../streams/catalog';
import {
  ensureEnginesRegistered,
  _resetEngineRegistrationFlag,
} from '../engines/catalog';
import {
  ensureStoragesRegistered,
  _resetStorageRegistrationFlag,
} from '../storage/catalog';
import {
  ensureOnchainDatasetsRegistered,
  _resetOnchainDatasetRegistrationFlag,
} from '../onchain/catalog';
import { _resetHpoRegistrationFlag, ensureHpoRegistered } from './hpo';

let done = false;

function builtinsHealthy(): boolean {
  return !!(
    registry.getSource('binance-rest') &&
    registry.getStream('binance-ws') &&
    registry.getEngine('server')
  );
}

/** Reset per-catalog idempotency flags so the next ensure* call re-registers. */
function resetCatalogFlags(): void {
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetOnchainDatasetRegistrationFlag();
  _resetHpoRegistrationFlag();
}

/**
 * Ensure built-in source/stream/engine/storage/dataset plugins are registered.
 * Idempotent while the registry still has core plugins. After `registry.clear()`
 * (tests), a later call re-registers even if this module thought it was done.
 */
export function ensureBuiltins(): void {
  if (done && builtinsHealthy()) return;
  if (done && !builtinsHealthy()) {
    resetCatalogFlags();
  }
  ensureSourcesRegistered();
  ensureStreamsRegistered();
  ensureEnginesRegistered();
  ensureStoragesRegistered();
  ensureOnchainDatasetsRegistered();
  ensureHpoRegistered();
  done = true;
}

/** Alias used at app entry (`registerBuiltins()`). */
export function registerBuiltins(): void {
  ensureBuiltins();
}

/**
 * @internal test helper — reset bootstrap + catalog flags.
 * Does not clear the registry; callers that `registry.clear()` should also
 * call this so the next {@link ensureBuiltins} re-registers.
 */
export function _resetBootstrapFlag() {
  done = false;
  resetCatalogFlags();
}
