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
import { orderIndicatorsByPlotDeps } from '../results/plot-sources';
import { applyStrategyPropsToSource } from '../results/strategy-props';
import { detectScriptKind } from './script-meta';

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
 * One `POST /run/batch` for every eligible script on the current bars.
 *
 * Eligible = the backend can express them in one request: no resolved `input.*`
 * overrides (the batch body has no per-script inputs) and a single shared
 * evaluation mode. Engine-owned live mode and non-server engines are excluded
 * outright — they have no bars-in REST route to batch over.
 *
 * @returns id → result for the scripts the backend answered successfully, or
 *   null when batching does not apply / the route is missing. Per-script
 *   failures are simply absent from the map, so the caller falls back for them.
 */
async function runBatchReapply(
  scripts: Indicator[],
  still: () => boolean,
): Promise<Map<string, BatchRunResult> | null> {
  if (scripts.length < 2) return null;
  if (scripts.some((s) => s.inputValues && Object.keys(s.inputValues).length > 0)) {
    return null;
  }
  if (!still()) return null;
  const bars = store.bars;
  if (!Array.isArray(bars) || !bars.length) return null;

  try {
    const [{ runBatch, RUN_BATCH_MAX_SCRIPTS }, active, { isEngineOwnedLive }, catalog] =
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
    const apiKey = String(cfg.apiKey || '').trim();
    if (!catalog.confirmEngineApiKeyTarget(endpoint, apiKey)) return null;

    // One mode must hold for every script: `resolveServerRunMode` downgrades to
    // interpret for profiler / Pine-alert scripts, and a mixed bag would need
    // per-script modes the batch body cannot express.
    const profiler = !!store.profilerEnabled;
    const modeRaw = String(cfg.mode || 'auto');
    const modes = new Set(scripts.map((s) => catalog.resolveServerRunMode(modeRaw, s.code, profiler)));
    if (modes.size !== 1) return null;
    const mode = [...modes][0]!;

    const slice = scripts.slice(0, RUN_BATCH_MAX_SCRIPTS);
    const outcome = await runBatch({
      endpoint,
      apiKey,
      mode,
      bars,
      symbol: store.symbol,
      profiler,
      scripts: slice.map((s) => ({
        id: s.id,
        script: applyStrategyPropsToSource(s.code, s.strategyProps ?? {}),
      })),
    });
    if (!outcome || outcome.error) return null;
    const map = new Map<string, BatchRunResult>();
    for (const entry of outcome.entries) {
      if (entry.ok && entry.result) map.set(entry.id, entry.result);
    }
    return map;
  } catch {
    // Batch is an optimization — any failure falls back to per-script runs.
    return null;
  }
}

/**
 * Silently re-run all (or selected) visible chart scripts on current bars.
 * Safe to call after {@link setDataToChart} with fit/clear — restores overlays.
 *
 * @returns number of scripts that completed without throw
 */
export async function reapplyChartScripts(
  opts?: ReapplyChartScriptsOpts,
): Promise<number> {
  const still = opts?.stillCurrent ?? (() => true);
  if (!still()) return 0;
  if (!Array.isArray(store.bars) || !store.bars.length) return 0;

  const scripts = listReapplicableScripts(opts?.ids);
  if (!scripts.length) return 0;

  const { runAndApply } = await import('./runner');
  // One shared round-trip when the backend supports it; the apply path below is
  // identical either way (a batched result is passed through as
  // `precomputedResult`, so panes / overlays / alerts behave the same).
  const batched = await runBatchReapply(scripts, still);
  let ok = 0;
  for (const ind of scripts) {
    if (!still()) break;
    try {
      const result = await runAndApply(ind.code, ind.id, {
        silent: true,
        openResults: false,
        inputs: ind.inputValues,
        strategyProps: ind.strategyProps,
        ...(batched?.has(ind.id) ? { precomputedResult: batched.get(ind.id) } : {}),
      });
      if (result && result.status !== 'error') ok += 1;
      else if (result?.status === 'error' && opts?.logErrors !== false) {
        try {
          console.warn(
            `[axis] reapply script ${ind.name || ind.id}:`,
            result.error || 'error',
          );
        } catch {
          /* ignore */
        }
      }
    } catch (err: unknown) {
      if (opts?.logErrors !== false) {
        try {
          console.warn(
            `[axis] reapply script ${ind.name || ind.id} failed:`,
            err instanceof Error ? err.message : err,
          );
        } catch {
          /* ignore */
        }
      }
    }
  }
  return ok;
}
