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
 * Load historical OHLCV for a symbol into the Solid store and chart.
 *
 * Resolves the {@link SourcePlugin} by id, calls `fetchHistorical`, normalizes
 * bar times to **unix seconds** (drop partial/invalid OHLCV), then:
 * 1. {@link loadBars} — store + exchange label
 * 2. {@link setDataToChart} — Lightweight Charts candle series (`fit: true`)
 * 3. Optionally {@link startLive} when `store.live.preferAfterLoad` is set
 *
 * Updates the `source` telemetry plane (connecting / open / error) and status bar.
 * Concurrent loads: only the newest request may mutate store/chart/status
 * (stale completions return `false` without clobbering a later load).
 *
 * @module data/load-symbol
 * @returns `true` on success, `false` on unknown source, fetch failure, or stale race
 */

import {
  clampHistoryBars,
  loadBars,
  setStatus,
  store,
  setTelemetryPlane,
  setTelemetryState,
} from '../store';
import { getManager, setDataToChart } from '../chart/manager-access';
import { getSource } from '../sources/catalog';
import { getUploadedFileName } from '../sources/upload-store';
import { classifyTransport } from '../ui/telemetry';
import { defaultStreamForSource } from '../streams/catalog';
import { pluginKey } from '../plugins/types';
import { normalizeHistoricalBars } from './parse-bars';

/**
 * Monotonic generation for in-flight history loads.
 * Incremented at the start of every {@link loadSymbolData}; completions with a
 * lower id are ignored so mid-load symbol switches cannot race into the store.
 */
let loadGeneration = 0;

/** @internal test helper — reset race token between suites */
export function _resetLoadGeneration(): void {
  loadGeneration = 0;
}

/** @internal test helper — current race token */
export function _currentLoadGeneration(): number {
  return loadGeneration;
}

function exchangeForSource(sourceId: string): string {
  switch (sourceId) {
    case 'binance-rest':
      return 'binance';
    case 'okx-rest':
      return 'okx';
    case 'bybit-rest':
      return 'bybit';
    case 'coinbase-rest':
      return 'coinbase';
    case 'mock-walk':
      return 'mock';
    case 'csv-upload':
      return 'upload';
    default:
      return store.exchange;
  }
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown load error';
}

/**
 * Fetch OHLCV via the given historical source and push into chart + store.
 *
 * @param symbol - Ticker (uppercased); defaults to `store.symbol`
 * @param interval - AXIS interval string (`1m`…`1w`); defaults to `store.interval`
 * @param sourceId - Source plugin id; defaults to `store.source`
 */
export async function loadSymbolData(
  symbol: string = store.symbol,
  interval: string = store.interval,
  sourceId: string = store.source,
): Promise<boolean> {
  const sym = String(symbol || '').trim().toUpperCase();
  const iv = String(interval || store.interval || '1d');
  const srcId = String(sourceId || store.source || '');

  // Claim this load as the newest; any prior in-flight work becomes stale.
  const gen = ++loadGeneration;

  const source = getSource(srcId);
  if (!source) {
    // Unknown source: only surface if we are still the active request
    if (gen === loadGeneration) {
      setStatus('error', `Unknown source: ${srcId}`);
      setTelemetryState('source', 'error', { error: `Unknown source: ${srcId}` });
    }
    return false;
  }

  if (!sym) {
    if (gen === loadGeneration) {
      setStatus('error', 'Symbol required');
      setTelemetryState('source', 'error', { error: 'Symbol required' });
    }
    return false;
  }

  const label =
    srcId === 'csv-upload' && getUploadedFileName()
      ? getUploadedFileName()!
      : `${sym} ${iv}`;

  const transport = classifyTransport('source', source.id, source.capabilities);
  setTelemetryPlane('source', {
    id: source.id,
    name: source.name,
    transport,
    state: 'connecting',
    detail: label,
    error: null,
  });
  setStatus('loading', `Loading ${label} via ${source.name}…`);
  const t0 = performance.now();

  const stillCurrent = () => gen === loadGeneration;

  try {
    // Global history depth (Settings) wins over per-source plugin config for limit
    const limit = clampHistoryBars(store.historyBars);
    const configs = store.pluginsConfig || {};
    const sourceCfg =
      configs[pluginKey('source', srcId)] || configs[srcId] || {};

    let raw: unknown;
    try {
      raw = await source.fetchHistorical({
        symbol: sym,
        interval: iv,
        config: {
          ...sourceCfg,
          limit,
        },
      });
    } catch (fetchErr: unknown) {
      // Plugin throw / network fail — rethrow into outer handler with clean message
      throw fetchErr instanceof Error
        ? fetchErr
        : new Error(errMessage(fetchErr));
    }

    if (!stillCurrent()) {
      // Newer load started while we were awaiting the source — drop result
      return false;
    }

    if (raw == null || (Array.isArray(raw) && raw.length === 0)) {
      throw new Error('Source returned no bars');
    }

    const normalized = normalizeHistoricalBars(raw, { limit });
    if (!normalized.length) {
      throw new Error('Source returned no valid bars (empty / partial OHLCV / bad timestamps)');
    }

    if (!stillCurrent()) return false;

    const exchange = exchangeForSource(srcId);

    loadBars(normalized, sym, iv, exchange);
    const manager = getManager();
    if (manager) {
      try {
        setDataToChart(normalized, { fit: true });
      } catch (chartErr: unknown) {
        // Chart paint failure should not leave status as "loading" forever
        console.error('setDataToChart failed:', chartErr);
      }
    }

    if (!stillCurrent()) return false;

    const ms = performance.now() - t0;
    setTelemetryState('source', 'open', {
      latencyMs: ms,
      detail: `${normalized.length} bars · ${label}`,
      error: null,
    });
    setStatus('ready', `Loaded ${normalized.length} bars · ${source.name}`);

    // Optional WSS-first: auto-start paired live stream after successful Load
    if (store.live.preferAfterLoad && !store.live.active) {
      const streamId = store.live.streamId || defaultStreamForSource(srcId);
      try {
        const { startLive } = await import('../streams/multiplex');
        if (stillCurrent()) {
          startLive(streamId, sym, iv);
        }
      } catch {
        /* ignore auto-live failures */
      }
    }
    return stillCurrent();
  } catch (err: unknown) {
    // Stale failure must not overwrite a newer load's telemetry/status
    if (!stillCurrent()) return false;
    const msg = errMessage(err);
    console.error('Load failed:', err);
    setTelemetryState('source', 'error', {
      error: msg,
      latencyMs: performance.now() - t0,
    });
    setStatus('error', `Load failed: ${msg}`);
    return false;
  }
}

/**
 * Force-refetch the current symbol/interval/source and repaint the chart.
 * Always hits the source (unlike topbar Load’s same-symbol skip path).
 */
export async function reloadChart(): Promise<boolean> {
  return loadSymbolData(store.symbol, store.interval, store.source);
}
