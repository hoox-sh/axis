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
 * Commit an architecture wiring to the Solid store.
 *
 * Source / engine / storage go through {@link setActivePlugin}. Stream `null`
 * clears the live slot and stops an active multiplex. Dataset is optional on
 * `activePlugins` and opens the on-chain panel when set.
 *
 * @module ui/architecture/apply
 */

import { batch } from 'solid-js';
import {
  persist,
  setActivePlugin,
  setOnchainPanelOpen,
  setStatus,
  setStore,
  store,
} from '../../store';
import { preloadPyodide } from '../../engines/catalog';
import { stopLive } from '../../streams/multiplex';
import { loadSymbolData } from '../../data/load-symbol';
import { getUploadedFileName } from '../../sources/upload-store';
import { derivePlan, toStorePatch, type AxisConfig } from './plan';

export interface ApplyArchitectureResult {
  planName: string;
  patch: ReturnType<typeof toStorePatch>;
  sourceChanged: boolean;
  needsCsvPick: boolean;
}

/**
 * Apply `config` (measured against `baseId`) to the running AXIS store.
 * Returns the derived plan name and the store-shaped patch for callers/tests.
 */
export function applyArchitecture(
  config: AxisConfig,
  baseId: string,
): ApplyArchitectureResult {
  const plan = derivePlan(config, baseId);
  const patch = toStorePatch(config);
  const prevSource = store.source;
  const prevStream = store.live?.streamId || store.activePlugins?.stream || '';
  const nextSource = config.source || prevSource;

  batch(() => {
    if (config.source) setActivePlugin('source', config.source);
    if (config.engine) setActivePlugin('engine', config.engine);
    if (config.storage) setActivePlugin('storage', config.storage);

    if (config.stream) {
      if (store.live.active && prevStream && prevStream !== config.stream) {
        stopLive();
      }
      setActivePlugin('stream', config.stream);
    } else {
      if (store.live.active) stopLive();
      setStore('activePlugins', 'stream', '');
      setStore('live', 'streamId', '');
    }

    setStore('activePlugins', 'dataset', config.dataset || '');
  });

  persist();

  if (config.dataset) setOnchainPanelOpen(true);
  if (
    config.engine === 'pyodide' &&
    typeof document !== 'undefined' &&
    typeof document.querySelector === 'function' &&
    typeof document.head?.appendChild === 'function'
  ) {
    void preloadPyodide();
  }

  const sourceChanged = !!config.source && config.source !== prevSource;
  const skipAutoload = new Set(['csv-upload', 'geckoterminal-ohlcv', 'data-manager']);
  if (sourceChanged && !skipAutoload.has(nextSource)) {
    void loadSymbolData(store.symbol, store.interval, nextSource).catch(() => {
      /* apply already committed; Load from the topbar retries */
    });
  }

  setStatus('ready', `Architecture · ${plan.planName}`);

  return {
    planName: plan.planName,
    patch,
    sourceChanged,
    needsCsvPick: nextSource === 'csv-upload' && !getUploadedFileName(),
  };
}
