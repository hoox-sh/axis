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
import { orderIndicatorsByPlotDeps } from '../results/plot-sources';
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
  let ok = 0;
  for (const ind of scripts) {
    if (!still()) break;
    try {
      const result = await runAndApply(ind.code, ind.id, {
        silent: true,
        openResults: false,
        inputs: ind.inputValues,
        strategyProps: ind.strategyProps,
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
