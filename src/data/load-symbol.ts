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
  chartWindowLimit,
  clampHistoryBars,
  loadBars,
  setStatus,
  store,
  setTelemetryPlane,
  setTelemetryState,
} from '../store';
import { getManager, setDataToChart } from '../chart/manager-access';
import {
  _resetChartReadinessForTests,
  beginChartReadiness,
  failChartReadiness,
  noteChartScriptSettled,
  revealChart,
  setChartReadinessPhase,
  settleAllChartScripts,
} from '../chart/readiness';
import { getSource, sourcePageLimit } from '../sources/catalog';
import { providerDatasetLock } from './provider';
import { getUploadedFileName } from '../sources/upload-store';
import { classifyTransport } from '../ui/telemetry';
import { defaultStreamForSource } from '../streams/catalog';
import { pluginKey } from '../plugins/types';
import { normalizeHistoricalBars } from './parse-bars';
import { announce, announceError } from '../ui/sr-announce';
import type { Bar } from '../store/types';
import { exchangeForSource, normalizeLoadSymbol } from './symbol-exchange';
import { isEngineOwnedLive } from '../engines/ownership';
import { getDataSeriesBars } from '../engines/data-sessions';
import { getActiveEngineConfig } from '../plugins/active';
import { fillBarsTowardNow, fillInternalGaps } from './expand-cache';
import { errMessage } from '../utils/errors';

export { exchangeForSource, normalizeLoadSymbol };

/**
 * After OHLCV for generation G is on the chart: apply scripts (if any), then
 * reveal. Live restart stays the caller's job so engine-owned / DSM / venue
 * paths keep their existing order.
 *
 * Per-script `onSettled` advances the splash `k/n` caption; `settleAll` fills
 * any ids skipped when the pass was superseded mid-loop so the overlay cannot
 * trap on one slow or failed script.
 */
async function settleReadinessAfterBars(
  gen: number,
  stillCurrent: () => boolean,
  identity: { symbol: string; interval: string; source: string },
): Promise<void> {
  if (!stillCurrent()) return;
  // PR-C: drop old engine sessions / wire before scripts evaluate on G.
  try {
    const { bindChartEngineForGeneration } = await import('../chart/engine-bind');
    if (stillCurrent()) await bindChartEngineForGeneration(gen, identity);
  } catch {
    /* bind is best-effort — scripts + reveal still proceed */
  }
  if (!stillCurrent()) return;
  try {
    const { listReapplicableScripts, reapplyChartScripts } = await import(
      '../indicators/reapply'
    );
    const scripts = listReapplicableScripts();
    const n = scripts.length;
    if (n > 0 && stillCurrent()) {
      setChartReadinessPhase(gen, 'applying-scripts', { scriptsTotal: n });
      try {
        if (stillCurrent()) {
          await reapplyChartScripts({
            stillCurrent,
            force: true,
            onSettled: (id, _ok) => {
              if (stillCurrent()) noteChartScriptSettled(gen, id);
            },
          });
        }
      } catch {
        /* per-script failures still settle — do not trap the overlay */
      }
      if (stillCurrent()) settleAllChartScripts(gen);
    }
  } catch {
    /* reapply import / list failure — still reveal so the chart is usable */
  }
  if (stillCurrent()) revealChart(gen);
}

/**
 * Monotonic generation for in-flight history loads.
 * Incremented at the start of every {@link loadSymbolData}; completions with a
 * lower id are ignored so mid-load symbol switches cannot race into the store.
 */
let loadGeneration = 0;
/** Abort controller for the active history fetch (cancelled on newer load). */
let loadAbort: AbortController | null = null;

/** @internal test helper — invalidate in-flight loads between suites */
export function _resetLoadGeneration(): void {
  // Advance (never zero): stale stillCurrent closures captured by background
  // announcements must not re-arm when a later suite reclaims generation 1.
  loadGeneration += 1;
  try {
    loadAbort?.abort();
  } catch {
    /* ignore */
  }
  loadAbort = null;
  _resetChartReadinessForTests();
}

/** @internal test helper — current race token */
export function _currentLoadGeneration(): number {
  return loadGeneration;
}

/** One sentence for the status row and toast. Raw text stays on telemetry. */
function loadErrorSentence(msg: string): string {
  const flat = String(msg || '').replace(/\s+/g, ' ').trim();
  if (/unexpected token|not valid json|<!doctype|<html/i.test(flat)) {
    return 'Venue returned a page, not market data.';
  }
  if (/failed to fetch|network error|cors/i.test(flat)) {
    return 'Venue unreachable.';
  }
  const line = (flat.split(/\s+at\s+/)[0] || flat).replace(/^load failed:\s*/i, '');
  return line.slice(0, 140) || 'The venue did not return candles.';
}

function chartLock(): { market: string; authMode: string } {
  return providerDatasetLock(store.provider);
}

/** Close cache/engine newest → now via venue before live appends the forming bar. */
async function closeTailToNow(
  bars: Bar[],
  srcId: string,
  sym: string,
  iv: string,
  signal?: AbortSignal,
): Promise<Bar[]> {
  if (!bars.length) return bars;
  try {
    const tail = await fillBarsTowardNow(bars, srcId, sym, iv, { signal });
    const filled = tail.bars.length ? tail.bars : bars;
    const holes = await fillInternalGaps(filled, srcId, sym, iv, { signal });
    return holes.bars.length ? holes.bars : filled;
  } catch {
    return bars;
  }
}

/**
 * Fetch OHLCV via the given historical source and push into chart + store.
 *
 * **DSM-first** (default): paints from the DatasetStore instantly, then
 * auto-completes the dataset in the background (validate → sliced backfill →
 * progressive repaint). Falls back to the direct venue fetch when nothing is
 * cached, seeding the store on success.
 *
 * @param symbol - Ticker (uppercased for CEX; case preserved for DEX pools);
 *   defaults to `store.symbol`
 * @param interval - AXIS interval string (`1m`…`1w`); defaults to `store.interval`
 * @param sourceId - Source plugin id; defaults to `store.source`
 * @param opts - `preferDataset: false` forces the venue fetch (Reload button)
 *   and merges the result into the dataset store.
 */
export async function loadSymbolData(
  symbol: string = store.symbol,
  interval: string = store.interval,
  sourceId: string = store.source,
  opts?: { preferDataset?: boolean },
): Promise<boolean> {
  // DEX pool symbols (network:0x… / base58) are case-sensitive — do not force upper.
  const srcId = String(sourceId || store.source || '');
  const sym = normalizeLoadSymbol(symbol, srcId);
  const iv = String(interval || store.interval || '1d');

  // Another source takes the chart — stop dataset progressive repaints for the
  // previous key (CSV upload / venue load) so a pending repaint cannot
  // overwrite the new series.
  try {
    const { stopProgressiveRepaint } = await import('./dsm-orchestrator');
    stopProgressiveRepaint();
  } catch {
    /* repaint stop is best-effort */
  }

  // Claim this load as the newest; abort prior network + ignore stale completions.
  const gen = ++loadGeneration;
  beginChartReadiness(gen, { symbol: sym, interval: iv, source: srcId });
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
      failChartReadiness(gen, 'Unknown data source.');
      setStatus('error', `Unknown source: ${srcId}`);
      setTelemetryState('source', 'error', { error: `Unknown source: ${srcId}` });
    }
    return false;
  }

  if (!sym) {
    if (gen === loadGeneration) {
      failChartReadiness(gen, 'Symbol required.');
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

  // ── Engine-owned live mode: the engine's feed paints the chart ──
  // In every-tick Pro mode the engine's store owns the series. The Data
  // Manager must not compete: no dataset paint, no venue backfill, no local
  // persistence. The chart reads the engine's bars into memory only.
  if (isEngineOwnedLive()) {
    const cfg = getActiveEngineConfig() || {};
    const endpoint = String(cfg['endpoint'] || '');
    const apiKey = String(cfg['apiKey'] || '');
    // No engine endpoint configured (e.g. a local-only engine plugin): skip
    // the engine read and fall through to the venue fetch below instead of
    // paying a failed relative-URL fetch on every load.
    if (endpoint) {
      try {
        // The engine read uses the same window the chart holds — one number
        // for both, so the chart can never show more bars than the engine
        // evaluated.
        const limit = chartWindowLimit();
        const engineBars = await getDataSeriesBars(
          endpoint,
          apiKey,
          { exchange: exchangeForSource(srcId), symbol: sym, interval: iv },
          limit,
          signal,
        );
        if (!stillCurrent()) return false;
        if (engineBars.length) {
          const bars = await closeTailToNow(engineBars, srcId, sym, iv, signal);
          if (!stillCurrent()) return false;
          const view = loadBars(bars, sym, iv, exchangeForSource(srcId));
          const manager = getManager();
          if (manager) setDataToChart(view, { fit: true });
          setTelemetryState('source', 'open', {
            latencyMs: performance.now() - t0,
            detail: `${view.length} bars · ${label} (engine)`,
            error: null,
          });
          setStatus('ready', `Loaded ${view.length} bars · ${source.name} (engine)`, {
            toast: false,
            source: 'data',
          });
          announce(`Loaded ${view.length} bars ${sym} ${iv}`);
          await settleReadinessAfterBars(gen, stillCurrent, { symbol: sym, interval: iv, source: srcId });
          if (restartLiveAfter && stillCurrent()) {
            const streamId = store.live.streamId || defaultStreamForSource(srcId);
            try {
              const { startLive } = await import('../streams/multiplex');
              if (stillCurrent()) startLive(streamId, sym, iv);
            } catch {
              /* ignore live restart failures */
            }
          }
          return stillCurrent();
        }
        // No engine bars yet — fall through to the venue fetch so the chart is
        // never empty; the engine's store is still the live source of truth.
      } catch {
        /* fall through to the venue fetch */
      }
    }
  }

  // ── Data Manager: resolve the venue dataset key (never `data-manager|…`) ──
  // Empty cache auto-starts DSM: paint at the rolling window, keep filling to
  // Settings → Historical bars in the background. Never surface "No cached
  // dataset" for a cold symbol switch.
  if (srcId === 'data-manager') {
    try {
      const {
        paintDataset,
        ensureDatasetComplete,
        announceDatasetPaint,
        coldStartDataset,
      } = await import('./dsm-orchestrator');
      const {
        resolveDataManagerBars,
        resolveDataManagerVenueSource,
        setDataManagerSelection,
        DATA_MANAGER_SOURCE_ID,
      } = await import('./data-manager-source');

      let venueSrc = resolveDataManagerVenueSource(
        store.live?.streamId || store.activePlugins?.stream || '',
      );
      let cached: Bar[] = [];
      if (opts?.preferDataset !== false) {
        try {
          const resolved = await resolveDataManagerBars(sym, iv);
          if (resolved?.bars?.length) {
            venueSrc = resolved.sourceId || venueSrc;
            cached = resolved.bars;
            try {
              setDataManagerSelection(
                venueSrc,
                resolved.symbol || sym,
                resolved.interval || iv,
              );
            } catch {
              /* selection stick is best-effort */
            }
          }
        } catch {
          cached = [];
        }
      }
      if (!stillCurrent()) return false;

      if (cached.length) {
        const filled = await closeTailToNow(cached, venueSrc, sym, iv, signal);
        if (!stillCurrent()) return false;
        if (filled.length && filled.length !== cached.length) {
          try {
            const { putDatasetBars } = await import('./dataset-store');
            await putDatasetBars(venueSrc, sym, iv, filled, chartLock());
          } catch {
            /* persist is best-effort */
          }
        }
        const painted = await paintDataset(sym, iv, venueSrc, {
          stillCurrent,
          bars: filled.length ? filled : cached,
        });
        if (painted?.length) {
          if (!stillCurrent()) return false;
          const bars = painted;
          const ms = performance.now() - t0;
          setTelemetryState('source', 'open', {
            latencyMs: ms,
            detail: `${bars.length} bars · ${label} (dataset)`,
            error: null,
          });
          announceDatasetPaint(bars, sym, iv);
          void ensureDatasetComplete(sym, iv, venueSrc, { stillCurrent });
          await settleReadinessAfterBars(gen, stillCurrent, {
            symbol: sym,
            interval: iv,
            source: DATA_MANAGER_SOURCE_ID,
          });
          if (restartLiveAfter && stillCurrent()) {
            const streamId =
              store.live.streamId || defaultStreamForSource(DATA_MANAGER_SOURCE_ID);
            try {
              const { startLive } = await import('../streams/multiplex');
              if (stillCurrent()) startLive(streamId, sym, iv);
            } catch {
              /* ignore live restart failures */
            }
          }
          return stillCurrent();
        }
      }

      // Cold cache (or Reload with empty cache): DSM walk → apply at rolling
      // window → continue to historyBars in background.
      const cold = await coldStartDataset(sym, iv, venueSrc, {
        stillCurrent,
        signal,
      });
      if (!stillCurrent()) return false;
      if (cold && cold.painted > 0) {
        const ms = performance.now() - t0;
        setTelemetryState('source', 'open', {
          latencyMs: ms,
          detail: `${cold.painted} bars · ${label} (DSM)`,
          error: null,
        });
        setStatus(
          'ready',
          `Loaded ${cold.painted} bars · DSM filling to ${clampHistoryBars(store.historyBars)}`,
          { toast: false, source: 'dsm' },
        );
        announce(`Loaded ${cold.painted} bars ${sym} ${iv}`);
        await settleReadinessAfterBars(gen, stillCurrent, {
          symbol: sym,
          interval: iv,
          source: DATA_MANAGER_SOURCE_ID,
        });
        if (restartLiveAfter && stillCurrent()) {
          const streamId =
            store.live.streamId || defaultStreamForSource(DATA_MANAGER_SOURCE_ID);
          try {
            const { startLive } = await import('../streams/multiplex');
            if (stillCurrent()) startLive(streamId, sym, iv);
          } catch {
            /* ignore live restart failures */
          }
        }
        return stillCurrent();
      }
      // DSM returned nothing — fall through to a hard error below rather than
      // the old "Open Dataset manager" dead-end.
    } catch (dsmErr: unknown) {
      console.warn('[load-symbol] data-manager load failed; falling through', dsmErr);
    }
  }

  // ── DSM-first: paint from the dataset store, complete in background ──
  // Best-effort: any failure (import / IDB / repair) falls through to the
  // direct venue fetch below instead of rejecting into an unhandled error.
  if (opts?.preferDataset !== false && srcId !== 'csv-upload' && srcId !== 'data-manager') {
    try {
      const { paintDataset, ensureDatasetComplete, announceDatasetPaint } = await import(
        './dsm-orchestrator'
      );
      const { getDataset } = await import('./dataset-store');
      let cached: Bar[] = [];
      try {
        cached = await getDataset(srcId, sym, iv, chartLock());
      } catch {
        cached = [];
      }
      if (!stillCurrent()) return false;
      const filled = cached.length ? await closeTailToNow(cached, srcId, sym, iv, signal) : [];
      if (!stillCurrent()) return false;
      if (filled.length && filled.length !== cached.length) {
        // Persist the venue work: the closed tail / filled holes are real
        // bars, and throwing them away means the next load fetches them again.
        try {
          const { putDatasetBars } = await import('./dataset-store');
          await putDatasetBars(srcId, sym, iv, filled, chartLock());
        } catch {
          /* persist is best-effort */
        }
      }
      const painted = await paintDataset(sym, iv, srcId, {
        stillCurrent,
        ...(filled.length ? { bars: filled } : {}),
      });
      if (painted?.length) {
        if (!stillCurrent()) return false;
        const bars = painted;
        const ms = performance.now() - t0;
        setTelemetryState('source', 'open', {
          latencyMs: ms,
          detail: `${bars.length} bars · ${label} (dataset)`,
          error: null,
        });
        announceDatasetPaint(bars, sym, iv);
        // Auto-complete: validate + sliced backfill + progressive repaints.
        // Guarded by stillCurrent — a stale background job must not overwrite
        // the status of a newer load (or a newer error).
        void ensureDatasetComplete(sym, iv, srcId, { stillCurrent });
        await settleReadinessAfterBars(gen, stillCurrent, { symbol: sym, interval: iv, source: srcId });
        if (restartLiveAfter && stillCurrent()) {
          const streamId = store.live.streamId || defaultStreamForSource(srcId);
          try {
            const { startLive } = await import('../streams/multiplex');
            if (stillCurrent()) startLive(streamId, sym, iv);
          } catch {
            /* ignore live restart failures */
          }
        }
        return stillCurrent();
      }
    } catch (dsmErr: unknown) {
      console.warn('[load-symbol] dataset-first paint failed; falling back to venue fetch', dsmErr);
    }
  }

  try {
    // Data Manager never fetches itself — cold-start above is the path. If it
    // produced no bars (venue down / aborted), fail cleanly without the old
    // "Open Dataset manager" dead-end.
    if (srcId === 'data-manager') {
      throw new Error(
        'Dataset backfill returned no bars yet. Check the Data panel job or try Reload.',
      );
    }

    // Dataset target (Settings → Historical bars) wins over per-source plugin
    // config. Venues cap a single response (e.g. Binance 1000), so walk back
    // page-by-page until the target is covered — a single first page is what
    // left Reload stuck at 1000 bars.
    const target = clampHistoryBars(store.historyBars);
    const pageSize = Math.max(1, sourcePageLimit(srcId));
    const configs = store.pluginsConfig || {};
    const sourceCfg =
      configs[pluginKey('source', srcId)] || configs[srcId] || {};

    const fetchPage = async (args: {
      endTime?: number;
      limit: number;
    }): Promise<unknown> => {
      try {
        return await source.fetchHistorical({
          symbol: sym,
          interval: iv,
          config: {
            ...sourceCfg,
            limit: args.limit,
          },
          ...(args.endTime != null ? { endTime: args.endTime } : {}),
          signal,
        });
      } catch (fetchErr: unknown) {
        // Aborted by a newer load — silent success (caller no longer needs us)
        if (
          signal.aborted ||
          (fetchErr instanceof Error && fetchErr.name === 'AbortError') ||
          !stillCurrent()
        ) {
          // Signal the walker to stop quietly via a sentinel throw.
          throw new DOMException('Aborted', 'AbortError');
        }
        // Plugin throw / network fail — rethrow into outer handler with clean message
        throw fetchErr instanceof Error
          ? fetchErr
          : new Error(errMessage(fetchErr, 'Unknown load error'));
      }
    };

    // First page carries the full clamped target in config (back-compat: the
    // loader passes Settings through; venues clamp per-request internally).
    let raw: unknown;
    try {
      raw = await fetchPage({ limit: target });
    } catch (fetchErr: unknown) {
      if (
        signal.aborted ||
        (fetchErr instanceof Error && fetchErr.name === 'AbortError') ||
        !stillCurrent()
      ) {
        return false;
      }
      throw fetchErr instanceof Error
        ? fetchErr
        : new Error(errMessage(fetchErr, 'Unknown load error'));
    }

    if (!stillCurrent() || signal.aborted) {
      // Newer load started while we were awaiting the source — drop result
      return false;
    }

    // normalizeHistoricalBars never throws; unwraps envelopes + drops bad rows
    const first = normalizeHistoricalBars(raw, { limit: target });
    if (!first.length) {
      throw new Error(
        raw == null || (Array.isArray(raw) && raw.length === 0)
          ? 'Source returned no bars'
          : 'Source returned no valid bars (empty / partial OHLCV / bad timestamps)',
      );
    }

    // Walk older pages until the dataset target is covered. Bounded so a
    // 100k-bar depth on a 300-bar venue does not block the chart: the DSM
    // background job (ensureDatasetComplete + progressive repaint below)
    // finishes the tail.
    const MAX_SYNC_PAGES = 12;
    const byTime = new Map<number, (typeof first)[number]>();
    for (const b of first) byTime.set(b.time, b);
    let prevOldest = first[0]!.time;
    let pages = 1;
    while (byTime.size < target && pages < MAX_SYNC_PAGES) {
      if (!stillCurrent() || signal.aborted) return false;
      let oldest = Number.POSITIVE_INFINITY;
      for (const t of byTime.keys()) if (t < oldest) oldest = t;
      if (!Number.isFinite(oldest)) break;
      let page: typeof first;
      try {
        const pageRaw = await fetchPage({
          endTime: oldest - 1,
          limit: Math.min(pageSize, target),
        });
        page = normalizeHistoricalBars(pageRaw, {
          limit: Math.min(pageSize, target),
        });
      } catch (pageErr: unknown) {
        if (
          signal.aborted ||
          (pageErr instanceof Error && pageErr.name === 'AbortError') ||
          !stillCurrent()
        ) {
          return false;
        }
        // Page failure mid-walk: keep what we have, DSM completes the rest.
        break;
      }
      if (!page.length) break;
      const rawOldest = page[0]!.time;
      // Stalled cursor (venue ignored endTime / repeated page) — stop.
      if (rawOldest >= prevOldest) {
        // Still merge — a repeated page adds nothing new, so break after.
        let grew = false;
        for (const b of page) {
          if (!byTime.has(b.time)) {
            byTime.set(b.time, b);
            grew = true;
          }
        }
        pages += 1;
        void grew;
        break;
      }
      prevOldest = rawOldest;
      for (const b of page) {
        if (!byTime.has(b.time)) byTime.set(b.time, b);
      }
      pages += 1;
      if (rawOldest >= oldest) break;
    }

    const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
    const full = merged.length > target ? merged.slice(merged.length - target) : merged;
    if (!full.length) {
      throw new Error('Source returned no valid bars (empty / partial OHLCV / bad timestamps)');
    }
    // The chart window (newest N, period-anchored) is enforced by `loadBars`;
    // pass the full dataset so the anchor can reach past the base window.
    if (!stillCurrent()) return false;

    const exchange = exchangeForSource(srcId);

    const painted = loadBars(full, sym, iv, exchange);
    const manager = getManager();
    if (manager) {
      try {
        // fit:true → full chart refresh (markers, Pine drawings, overlays, per-symbol user drawings)
        setDataToChart(painted, { fit: true });
      } catch (chartErr: unknown) {
        // Chart paint failure should not leave status as "loading" forever
        console.error('setDataToChart failed:', chartErr);
      }
    }

    // Seed / merge the FULL fetched window into the dataset store
    // (conflict-resolved) so the next load paints instantly and the DSM can
    // complete the series. Subscribe progressive repaints first so background
    // slices extend the chart instead of stranding it at the sync pages.
    try {
      const { seedDatasetFromBars, ensureDatasetComplete, startProgressiveStream } = await import(
        './dsm-orchestrator'
      );
      seedDatasetFromBars(srcId, sym, iv, full);
      if (stillCurrent()) startProgressiveStream(sym, iv, srcId);
      // First pages are on the chart — DSM walks the rest in the background.
      void ensureDatasetComplete(sym, iv, srcId, { stillCurrent });
    } catch {
      /* seeding / background complete is best-effort */
    }

    if (!stillCurrent()) return false;

    const ms = performance.now() - t0;
    const datasetNote = full.length > painted.length ? ` (dataset ${full.length})` : '';
    setTelemetryState('source', 'open', {
      latencyMs: ms,
      detail: `${painted.length} bars · ${label}${datasetNote}`,
      error: null,
    });
    setStatus('ready', `Loaded ${painted.length} bars · ${source.name}${datasetNote}`, {
      toast: false,
      source: 'data',
    });
    announce(`Loaded ${painted.length} bars ${sym} ${iv}`);

    // Scripts settle under the splash, then reveal, then live (G-tagged).
    await settleReadinessAfterBars(gen, stillCurrent, { symbol: sym, interval: iv, source: srcId });

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

    return stillCurrent();
  } catch (err: unknown) {
    // Stale failure must not overwrite a newer load's telemetry/status
    if (!stillCurrent()) return false;

    // Offline / network fail: restore last DSM/venue series from the dataset
    // store when warm (honours the active persistence sink). Chart shows the
    // rolling window; the full cache stays in the dataset store.
    try {
      const { getDataset } = await import('./dataset-store');
      let cached: Bar[] = [];
      if (srcId === 'data-manager') {
        try {
          const { resolveDataManagerBars } = await import('./data-manager-source');
          const resolved = await resolveDataManagerBars(sym, iv);
          cached = resolved?.bars ?? [];
        } catch {
          cached = [];
        }
      } else {
        cached = await getDataset(srcId, sym, iv, chartLock());
      }
      if (cached.length && stillCurrent()) {
        const exchange = exchangeForSource(srcId);
        const view = loadBars(cached, sym, iv, exchange);
        const manager = getManager();
        if (manager) {
          try {
            setDataToChart(view, { fit: true });
          } catch (chartErr: unknown) {
            console.error('setDataToChart failed (cached fallback):', chartErr);
          }
        }
        if (!stillCurrent()) return false;
        const ms = performance.now() - t0;
        setTelemetryState('source', 'degraded', {
          latencyMs: ms,
          detail: `cached ${view.length} bars · ${label}`,
          error: null,
        });
        setStatus(
          'ready',
          `Offline · ${view.length} cached bars · ${source.name}`,
        );
        announce(`Offline cached ${view.length} bars ${sym} ${iv}`);
        // Do not auto-start live on offline cache (no reliable venue stream)
        await settleReadinessAfterBars(gen, stillCurrent, { symbol: sym, interval: iv, source: srcId });
        return stillCurrent();
      }
    } catch {
      /* cache miss / IDB unavailable — fall through to hard error */
    }

    const msg = errMessage(err, 'Unknown load error');
    console.error('Load failed:', err);
    setTelemetryState('source', 'error', {
      error: msg,
      latencyMs: performance.now() - t0,
    });
    const sentence = loadErrorSentence(msg);
    // Chart notice + status row carry the failure. Raw text stays on telemetry.
    failChartReadiness(gen, sentence);
    setStatus('error', sentence, { toast: false, source: 'data' });
    announceError(sentence);
    return false;
  }
}

/**
 * Force-refetch the current symbol/interval/source from the venue and repaint
 * the chart. Bypasses the dataset-first paint (Reload escape hatch) but still
 * merges the fresh bars into the dataset store.
 */
export async function reloadChart(): Promise<boolean> {
  return loadSymbolData(store.symbol, store.interval, store.source, {
    preferDataset: false,
  });
}
