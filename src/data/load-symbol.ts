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
 * 2. {@link setDataToChart} — full chart refresh (`fit: true`): OHLCV, clear
 *    markers / Pine drawings / indicator overlays, re-sync **per-symbol** user drawings
 * 3. Restart live stream when already active, or start when `preferAfterLoad`
 * 4. Silently re-run visible indicators on the new bars
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
import { getCachedBars } from './bars-cache';
import { announce, announceError } from '../ui/sr-announce';

/**
 * Monotonic generation for in-flight history loads.
 * Incremented at the start of every {@link loadSymbolData}; completions with a
 * lower id are ignored so mid-load symbol switches cannot race into the store.
 */
let loadGeneration = 0;
/** Abort controller for the active history fetch (cancelled on newer load). */
let loadAbort: AbortController | null = null;

/** @internal test helper — reset race token between suites */
export function _resetLoadGeneration(): void {
  loadGeneration = 0;
  try {
    loadAbort?.abort();
  } catch {
    /* ignore */
  }
  loadAbort = null;
}

/** @internal test helper — current race token */
export function _currentLoadGeneration(): number {
  return loadGeneration;
}

function exchangeForSource(sourceId: string): string {
  const venue = store.provider?.sourceId === sourceId
    ? store.provider.venue
    : undefined;
  if (venue && venue !== 'generic' && venue !== 'cache') return venue;
  switch (sourceId) {
    case 'binance-rest':
      return 'binance';
    case 'okx-rest':
      return 'okx';
    case 'bybit-rest':
      return 'bybit';
    case 'coinbase-rest':
      return 'coinbase';
    case 'kraken-rest':
      return 'kraken';
    case 'mock-walk':
      return 'mock';
    case 'csv-upload':
      return 'upload';
    case 'data-manager':
      return store.provider?.venue && store.provider.venue !== 'cache'
        ? store.provider.venue
        : 'cache';
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
 * Normalize a ticker for {@link loadSymbolData} / history fetch.
 *
 * CEX tickers are uppercased. DEX pool symbols (`network:0x…`, `network/…`,
 * Solana base58, or any `sourceId === 'geckoterminal-ohlcv'`) keep mixed case
 * because addresses are case-sensitive on some chains.
 */
export function normalizeLoadSymbol(
  symbol: string,
  sourceId?: string | null,
): string {
  const rawSym = String(symbol || '').trim();
  const srcId = String(sourceId || '');
  if (
    srcId === 'geckoterminal-ohlcv' ||
    rawSym.includes(':') ||
    rawSym.includes('/')
  ) {
    return rawSym;
  }
  return rawSym.toUpperCase();
}

/**
 * Fetch OHLCV via the given historical source and push into chart + store.
 *
 * @param symbol - Ticker (uppercased for CEX; case preserved for DEX pools);
 *   defaults to `store.symbol`
 * @param interval - AXIS interval string (`1m`…`1w`); defaults to `store.interval`
 * @param sourceId - Source plugin id; defaults to `store.source`
 */
export async function loadSymbolData(
  symbol: string = store.symbol,
  interval: string = store.interval,
  sourceId: string = store.source,
): Promise<boolean> {
  // DEX pool symbols (network:0x… / base58) are case-sensitive — do not force upper.
  const srcId = String(sourceId || store.source || '');
  const sym = normalizeLoadSymbol(symbol, srcId);
  const iv = String(interval || store.interval || '1d');

  // Claim this load as the newest; abort prior network + ignore stale completions.
  const gen = ++loadGeneration;
  try {
    loadAbort?.abort();
  } catch {
    /* ignore */
  }
  loadAbort = new AbortController();
  const signal = loadAbort.signal;

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

  // Full refresh: pause live during history fetch so old-symbol ticks cannot
  // race into store.bars / chart while the new series is loading. Restart after
  // success when live was on or preferAfterLoad is set.
  const wasLive = !!store.live.active;
  const restartLiveAfter = wasLive || !!store.live.preferAfterLoad;
  if (wasLive) {
    try {
      const { stopLive } = await import('../streams/multiplex');
      if (stillCurrent()) stopLive({ reason: 'restart' });
    } catch {
      /* ignore */
    }
  }

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
        signal,
      });
    } catch (fetchErr: unknown) {
      // Aborted by a newer load — silent success (caller no longer needs us)
      if (
        signal.aborted ||
        (fetchErr instanceof Error && fetchErr.name === 'AbortError') ||
        !stillCurrent()
      ) {
        return false;
      }
      // Plugin throw / network fail — rethrow into outer handler with clean message
      throw fetchErr instanceof Error
        ? fetchErr
        : new Error(errMessage(fetchErr));
    }

    if (!stillCurrent() || signal.aborted) {
      // Newer load started while we were awaiting the source — drop result
      return false;
    }

    // normalizeHistoricalBars never throws; unwraps envelopes + drops bad rows
    const normalized = normalizeHistoricalBars(raw, { limit });
    if (!normalized.length) {
      throw new Error(
        raw == null || (Array.isArray(raw) && raw.length === 0)
          ? 'Source returned no bars'
          : 'Source returned no valid bars (empty / partial OHLCV / bad timestamps)',
      );
    }

    if (!stillCurrent()) return false;

    const exchange = exchangeForSource(srcId);

    loadBars(normalized, sym, iv, exchange);
    const manager = getManager();
    if (manager) {
      try {
        // fit:true → full chart refresh (markers, Pine drawings, overlays, per-symbol user drawings)
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
    announce(`Loaded ${normalized.length} bars ${sym} ${iv}`);

    // Restart / auto-start live on the new ticker after a full history paint
    if (restartLiveAfter) {
      const streamId = store.live.streamId || defaultStreamForSource(srcId);
      try {
        const { startLive } = await import('../streams/multiplex');
        if (stillCurrent()) {
          startLive(streamId, sym, iv);
        }
      } catch {
        /* ignore live restart failures */
      }
    }

    // Re-apply visible indicators/strategies on the new OHLCV (silent)
    if (stillCurrent()) {
      try {
        const { reapplyChartScripts } = await import('../indicators/reapply');
        await reapplyChartScripts({ stillCurrent });
      } catch {
        /* re-run optional — user can re-run manually */
      }
    }

    return stillCurrent();
  } catch (err: unknown) {
    // Stale failure must not overwrite a newer load's telemetry/status
    if (!stillCurrent()) return false;

    // Offline / network fail: restore last DSM/venue series from bars-cache when warm
    try {
      const cached = await getCachedBars(srcId, sym, iv);
      if (cached.length && stillCurrent()) {
        const exchange = exchangeForSource(srcId);
        loadBars(cached, sym, iv, exchange);
        const manager = getManager();
        if (manager) {
          try {
            setDataToChart(cached, { fit: true });
          } catch (chartErr: unknown) {
            console.error('setDataToChart failed (cached fallback):', chartErr);
          }
        }
        if (!stillCurrent()) return false;
        const ms = performance.now() - t0;
        setTelemetryState('source', 'degraded', {
          latencyMs: ms,
          detail: `cached ${cached.length} bars · ${label}`,
          error: null,
        });
        setStatus(
          'ready',
          `Offline · ${cached.length} cached bars · ${source.name}`,
        );
        announce(`Offline cached ${cached.length} bars ${sym} ${iv}`);
        // Do not auto-start live on offline cache (no reliable venue stream)
        if (stillCurrent()) {
          try {
            const { reapplyChartScripts } = await import('../indicators/reapply');
            await reapplyChartScripts({ stillCurrent });
          } catch {
            /* re-run optional */
          }
        }
        return stillCurrent();
      }
    } catch {
      /* cache miss / IDB unavailable — fall through to hard error */
    }

    const msg = errMessage(err);
    console.error('Load failed:', err);
    setTelemetryState('source', 'error', {
      error: msg,
      latencyMs: performance.now() - t0,
    });
    setStatus('error', `Load failed: ${msg}`);
    announceError(`Load failed: ${msg}`);
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
