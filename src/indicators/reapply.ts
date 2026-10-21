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
 * Re-apply persisted chart scripts after OHLCV reloads / boot.
 *
 * Keeps the chart correct when history is replaced (symbol load, DSM paint,
 * cache fallback): every visible applied script is re-run with its saved
 * inputs and strategy properties, in plot-dependency order.
 *
 * @module indicators/reapply
 */

import { store } from '../store';
import type { Indicator } from '../store/types';
import type { BatchRunResult } from '../engines/batch';
import {
  groupIndicatorsByPlotDepLevel,
  mapWithConcurrencyLimit,
  orderIndicatorsByPlotDeps,
} from '../results/plot-sources';
import { applyStrategyPropsToSource } from '../results/strategy-props';
import { detectScriptKind } from './script-meta';

/** Bounded fan-out for the per-script fallback runs (not the batch route). */
export const REAPPLY_MAX_CONCURRENT = 5;

/** Guard against concurrent reapply passes — only one at a time. */
let reapplyInProgress = false;

/** @internal test helper */
export function _resetReapplyGuardForTests(): void {
  reapplyInProgress = false;
}

/**
 * Endpoints whose backend answered without a batch route. A missing route
 * never appears spontaneously, so once seen it is skipped for the rest of the
 * session — otherwise every reapply would pay a doomed batch round-trip on
 * top of the N single runs it falls back to anyway.
 */
const batchRouteMissing = new Set<string>();

/** @internal test helper */
export function _resetBatchRouteMemoForTests(): void {
  batchRouteMissing.clear();
}

export type ReapplyChartScriptsOpts = {
  /**
   * Abort when a newer load supersedes this one (e.g. load-symbol generation).
   * Return false to stop the loop.
   */
  stillCurrent?: () => boolean;
  /** Only these ids (default: all visible scripts with code). */
  ids?: string[];
  /** Log failures to console (default true). */
  logErrors?: boolean;
};

/**
 * Visible applied scripts that can be re-evaluated (have Pine source).
 */
export function listReapplicableScripts(ids?: string[]): Indicator[] {
  const want = ids?.length ? new Set(ids) : null;
  const list = (store.scripts || []).filter((s) => {
    if (!s?.id || !s.visible) return false;
    if (!String(s.code || '').trim()) return false;
    if (detectScriptKind(s.code) === 'library') return false;
    if (want && !want.has(s.id)) return false;
    return true;
  });
  return orderIndicatorsByPlotDeps(list);
}

/**
 * Shared-bars batch runs for the reapply set.
 *
 * Batchable = no resolved `input.*` overrides (the batch body has no
 * per-script inputs) — those scripts stay on singles, the eligible subset is
 * still batched instead of bailing the whole attempt. One evaluation mode per
 * request: scripts group by `resolveServerRunMode` (a mixed bag batches per
 * mode) and oversized groups split into backend-sized chunks fired together.
 *
 * Engine-owned live mode and non-server engines are excluded outright — they
 * have no bars-in REST route to batch over (engine-owned evaluation ticks
 * per-script sessions over the engine's own store; see `engines/batch.ts`).
 *
 * @returns id → result for the scripts the backend answered successfully, or
 *   null when batching does not apply / the route is missing. Per-script and
 *   per-chunk failures are simply absent from the map, so the caller falls
 *   back for them.
 */
async function runBatchReapply(
  scripts: Indicator[],
  still: () => boolean,
): Promise<Map<string, BatchRunResult> | null> {
  if (scripts.length < 2) return null;
  // Only scripts without resolved input overrides can share one request.
  const batchable = scripts.filter((s) => !s.inputValues || Object.keys(s.inputValues).length === 0);
  if (batchable.length < 2) return null;
  if (!still()) return null;
  const bars = store.bars;
  if (!Array.isArray(bars) || !bars.length) return null;

  try {
    const [{ runBatch, RUN_BATCH_MAX_SCRIPTS, splitBatchScripts }, active, { isEngineOwnedLive }, catalog] =
      await Promise.all([
        import('../engines/batch'),
        import('../plugins/active'),
        import('../engines/ownership'),
        import('../engines/catalog'),
      ]);
    if (isEngineOwnedLive()) return null;
    if (active.getActiveEngine().id !== 'server') return null;

    const cfg = active.getActiveEngineConfig() || {};
    const endpoint = String(cfg.endpoint || store.endpoint || '')
      .trim()
      .replace(/\/$/, '');
    if (!endpoint) return null;
    // Known-missing route: skip the doomed round-trip, go straight to singles.
    if (batchRouteMissing.has(endpoint)) return null;
    const apiKey = String(cfg.apiKey || '').trim();
    if (!catalog.confirmEngineApiKeyTarget(endpoint, apiKey)) return null;

    // One mode must hold per request: `resolveServerRunMode` downgrades to
    // interpret for profiler / Pine-alert scripts. Mixed bags batch per mode
    // instead of skipping batching entirely.
    const profiler = !!store.profilerEnabled;
    const modeRaw = String(cfg.mode || 'auto');
    const byMode = new Map<string, Indicator[]>();
    for (const s of batchable) {
      const mode = catalog.resolveServerRunMode(modeRaw, s.code, profiler);
      const list = byMode.get(mode);
      if (list) list.push(s);
      else byMode.set(mode, [s]);
    }
    // A lone script costs the same batched as single — leave it to singles.
    const chunks: { mode: string; scripts: Indicator[] }[] = [];
    for (const [mode, group] of byMode) {
      if (group.length < 2) continue;
      for (const slice of splitBatchScripts(group, RUN_BATCH_MAX_SCRIPTS)) {
        chunks.push({ mode, scripts: slice });
      }
    }
    if (!chunks.length || !still()) return null;

    // Chunks fan out together; a failed chunk only costs its own request —
    // its scripts fall back to singles below, never batch+N-singles twice
    // for the same script.
    const settled = await Promise.all(
      chunks.map((chunk) =>
        runBatch({
          endpoint,
          apiKey,
          mode: chunk.mode,
          bars,
          symbol: store.symbol,
          profiler,
          scripts: chunk.scripts.map((s) => ({
            id: s.id,
            script: applyStrategyPropsToSource(s.code, s.strategyProps ?? {}),
          })),
        }).catch(() => ({
          entries: [],
          allOk: false,
          dataSource: null,
          error: 'batch request failed',
        })),
      ),
    );
    const map = new Map<string, BatchRunResult>();
    for (const outcome of settled) {
      // Null with valid input means the route is missing — remember it so the
      // next reapply skips straight to singles.
      if (!outcome) {
        batchRouteMissing.add(endpoint);
        continue;
      }
      if (outcome.error) continue;
      for (const entry of outcome.entries) {
        if (entry.ok && entry.result) map.set(entry.id, entry.result);
      }
    }
    return map.size ? map : null;
  } catch {
    // Batch is an optimization — any failure falls back to per-script runs.
    return null;
  }
}

/**
 * Silently re-run all (or selected) visible chart scripts on current bars.
 * Safe to call after {@link setDataToChart} with fit/clear — restores overlays.
 *
 * Independent scripts evaluate concurrently (bounded); producers of plot
 * sources still complete before their consumers. One shared run epoch covers
 * the whole pass so members do not supersede each other.
 *
 * @returns number of scripts that completed without throw
 */
export async function reapplyChartScripts(
  opts?: ReapplyChartScriptsOpts,
): Promise<number> {
  const still = opts?.stillCurrent ?? (() => true);
  if (!still()) return 0;
  // Only one reapply pass at a time — multiple call sites (load-symbol,
  // DSM, store, MCP) can fire during a single load. A later call supersedes
  // the earlier one via `stillCurrent`, so skip if one is already in flight.
  if (reapplyInProgress) return 0;
  reapplyInProgress = true;
  try {
    if (!Array.isArray(store.bars) || !store.bars.length) return 0;

    const scripts = listReapplicableScripts(opts?.ids);
    if (!scripts.length) return 0;

    const { runAndApply, beginRunEpoch } = await import('./runner');
    // One shared round-trip when the backend supports it; the apply path below is
    // identical either way (a batched result is passed through as
    // `precomputedResult`, so panes / overlays / alerts behave the same).
    const batched = await runBatchReapply(scripts, still);
    // One shared epoch for the pass: members run concurrently without
    // invalidating each other's chart apply (a newer interactive Run still
    // supersedes the whole pass, as before).
    const epoch = beginRunEpoch();
    const warn = (ind: Indicator, detail: unknown): void => {
      if (opts?.logErrors === false) return;
      try {
        console.warn(`[axis] reapply script ${ind.name || ind.id}:`, detail);
      } catch {
        /* ignore */
      }
    };
    const runOne = async (ind: Indicator): Promise<boolean> => {
      if (!still()) return false;
      try {
        const result = await runAndApply(ind.code, ind.id, {
          silent: true,
          openResults: false,
          inputs: ind.inputValues,
          strategyProps: ind.strategyProps,
          epoch,
          ...(batched?.has(ind.id) ? { precomputedResult: batched.get(ind.id) } : {}),
        });
        if (result && result.status !== 'error') return true;
        if (result?.status === 'error') warn(ind, result.error || 'error');
        return false;
      } catch (err: unknown) {
        warn(ind, err instanceof Error ? err.message : err);
        return false;
      }
    };
    let ok = 0;
    // Producers of plot sources (cross-indicator input.source) run in earlier
    // levels; independent scripts inside a level run together, bounded.
    for (const level of groupIndicatorsByPlotDepLevel(scripts)) {
      if (!still()) break;
      const done = await mapWithConcurrencyLimit(level, REAPPLY_MAX_CONCURRENT, runOne);
      for (const d of done) if (d) ok += 1;
    }
    return ok;
  } finally {
    reapplyInProgress = false;
  }
}
