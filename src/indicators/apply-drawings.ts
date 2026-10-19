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
 * Apply stage 5 — Pine drawings (F-25).
 *
 * Atomic replace of script drawings with GC trimming, extracted from
 * `runAndApplyInner`. Skipped when superseded so a stale run cannot wipe
 * fresher drawings.
 *
 * @module indicators/apply-drawings
 */

import { appendLog, store, EDITOR_RUN_KEY } from '../store';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import { getDrawingLayer, ensureScriptPaneLayer } from '../chart/manager-access';
import {
  garbageCollectScriptDrawings,
  normalizeScriptDrawings,
  resolveDrawingLimits,
} from '../chart/pyne-drawings';
import { isRunEpochCurrent } from './run-helpers';
import type { RunResult } from './runner';

export interface DrawingsApplyContext {
  epoch: number;
  indicatorId: string | undefined;
  result: RunResult;
  script: string;
  bars: Array<{ time: number }>;
  overlay: boolean;
  paneId: string;
  silent: boolean;
}

/** Applied script is still present and visible (hide/detach mid-flight). */
export function appliedScriptStillOnChart(indicatorId?: string): boolean {
  if (!indicatorId) return true;
  const applied = store.scripts.find((s) => s.id === indicatorId);
  return !!(applied && applied.visible !== false);
}

export function applyDrawings(ctx: DrawingsApplyContext): void {
  // Pine drawings: atomic replace (no clear→empty→set flash).
  // GC trims each type to indicator()/strategy() max_*_count (default 50).
  // Skip when superseded so a stale run cannot wipe fresher drawings.
  if (isRunEpochCurrent(ctx.epoch) && appliedScriptStillOnChart(ctx.indicatorId)) {
    try {
      const drawings = Array.isArray((ctx.result as RunResult & { drawings?: unknown[] }).drawings)
        ? (ctx.result as RunResult & { drawings?: unknown[] }).drawings
        : undefined;
      const priceLayer = getActiveDrawingLayer() ?? getDrawingLayer();
      if (drawings?.length) {
        const limits = resolveDrawingLimits(
          ctx.script,
          (ctx.result.meta as Record<string, unknown> | undefined) ?? null,
        );
        const barSample = ctx.bars.length ? Number(ctx.bars[ctx.bars.length - 1]!.time) : null;
        const normalized = normalizeScriptDrawings(drawings, barSample);
        const kept = garbageCollectScriptDrawings(normalized, limits);
        // Non-ctx.overlay scripts: force_overlay → price pane; rest → indicator pane Y
        let keptCount = 0;
        if (!ctx.overlay && ctx.paneId !== 'price') {
          const onPrice = kept.filter((d) => d.forceOverlay);
          const onPane = kept.filter((d) => !d.forceOverlay);
          const paneLayer = ensureScriptPaneLayer(ctx.paneId);
          if (paneLayer) {
            keptCount = priceLayer?.setScriptDrawings(onPrice, limits, ctx.indicatorId ?? EDITOR_RUN_KEY) ?? 0;
            keptCount += paneLayer.setScriptDrawings(onPane, limits, ctx.indicatorId ?? EDITOR_RUN_KEY);
          } else {
            // No sub-pane layer — everything goes to the price pane. One call:
            // the layer replaces the owner's drawings, so a second call with a
            // different list would drop the first one (and the count was
            // overwritten rather than added).
            keptCount = priceLayer?.setScriptDrawings(kept, limits, ctx.indicatorId ?? EDITOR_RUN_KEY) ?? 0;
          }
        } else {
          keptCount = priceLayer?.setScriptDrawings(kept, limits, ctx.indicatorId ?? EDITOR_RUN_KEY) ?? 0;
        }
        if (!ctx.silent) {
          const dropped = normalized.length - kept.length;
          if (!priceLayer && kept.length) {
            appendLog(
              'warn',
              `Pine drawings: engine returned ${drawings.length} object(s) but no drawing layer is mounted (load ctx.bars first)`,
              'drawings',
            );
          } else if (normalized.length === 0) {
            const sample = drawings[0] as Record<string, unknown> | undefined;
            const keys = sample && typeof sample === 'object' ? Object.keys(sample).slice(0, 12).join(',') : '';
            appendLog(
              'warn',
              `Pine drawings: ${drawings.length} raw object(s) dropped by normalize (need type/kind + coords; sample keys: ${keys || '—'})`,
              'drawings',
            );
          } else {
            const paneNote =
              !ctx.overlay && ctx.paneId !== 'price'
                ? ` · pane=${ctx.paneId}`
                : '';
            appendLog(
              'ok',
              dropped > 0
                ? `Pine drawings: ${kept.length} object(s) (${dropped} GC'd by max_*_count)${paneNote}`
                : `Pine drawings: ${keptCount || kept.length} object(s)${paneNote}`,
              'drawings',
            );
          }
        }
      } else if (!ctx.silent || Array.isArray(drawings)) {
        // Empty `drawings: []` on a successful run must clear even on ctx.silent
        // live re-runs. Error runs return before this block, so a failed tick
        // keeps the last good gallery. Omit-the-field (`undefined`) still
        // skips clear when ctx.silent.
        priceLayer?.clearScriptDrawings(ctx.indicatorId ?? EDITOR_RUN_KEY);
        if (!ctx.overlay && ctx.paneId !== 'price') {
          try {
            ensureScriptPaneLayer(ctx.paneId)?.clearScriptDrawings(ctx.indicatorId ?? EDITOR_RUN_KEY);
          } catch {
            /* optional */
          }
        }
      }
    } catch {
      /* drawing layer optional in tests */
    }
  }
}
