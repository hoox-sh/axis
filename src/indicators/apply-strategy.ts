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
 * Apply stage 4 — strategy markers + report (F-25).
 *
 * Trade markers on the price pane plus the strategy report stats, extracted
 * from `runAndApplyInner`. Called inside the orchestrator's chart fence.
 *
 * @module indicators/apply-strategy
 */

import { appendLog, setStore, store, EDITOR_RUN_KEY } from '../store';
import { normalizeStrategyEvents, eventsToMarkers } from '../results/events';
import { buildStrategyReport } from '../results/strategy';
import type { PaneManager } from '../chart/pane-manager';
import type { RunResult } from './runner';

export interface StrategyApplyContext {
  manager: PaneManager;
  result: RunResult;
  scriptType: string;
  silent: boolean;
  indicatorId: string | undefined;
}

export function applyStrategyMarkers(ctx: StrategyApplyContext): void {
  // Strategy: trade markers on price pane + report stats.
  // Equity curve is rendered in Results → Strategy only (no main-chart equity pane).
  const events = ctx.result.events || [];
  const isStrategy =
    ctx.scriptType === 'strategy' ||
    events.some((e) => {
      const k = String(
        (e as { kind?: string; type?: string }).kind ||
          (e as { type?: string }).type ||
          '',
      ).toLowerCase();
      return (
        k.includes('entry') ||
        k.includes('exit') ||
        k.includes('close') ||
        k === 'order'
      );
    });
  // Hide any leftover main-chart equity pane from older sessions / builds
  try {
    ctx.manager.hideEquityPane?.();
  } catch {
    /* equity pane optional */
  }
  if (events.length) {
    const fillMode = store.strategyUi?.slippageNextOpen ? 'next_open' : 'close';
    const normalized = normalizeStrategyEvents(events, {
      bars: store.bars || [],
      includeOrders: false,
      fillMode,
    });
    const markers = eventsToMarkers(normalized, {
      invertLabels: !!store.strategyUi?.invertTradeLabels,
      exactOnCandle: store.strategyUi?.exactOnCandle !== false,
    });
    // Owner-scoped so removing this strategy clears its long/short labels
    // without relying on a global wipe (and without wiping sibling markers).
    ctx.manager.setTradeMarkers(markers, ctx.indicatorId ?? EDITOR_RUN_KEY);

    const report = buildStrategyReport(events, store.bars || [], { fillMode });
    if (report.trades.length) {
      if (!ctx.silent) {
        const net = Number.isFinite(report.stats.totalPnl) ? report.stats.totalPnl : 0;
        const wr = Number.isFinite(report.stats.winRate) ? report.stats.winRate : 0;
        appendLog(
          'ok',
          `Strategy: ${report.stats.trades} trades · net ${net >= 0 ? '+' : ''}${net.toFixed(2)} · win ${wr.toFixed(0)}% · ${markers.length} markers`,
          'strategy',
        );
        // Surface the Strategy tester tab when this run produced closed trades
        try {
          setStore('resultsPanel', 'open', true);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('axis-results-tab', { detail: { tab: 'strategy' } }),
            );
          }
        } catch {
          /* optional UI hook */
        }
      }
    } else if (!ctx.silent) {
      if (markers.length || isStrategy) {
        appendLog(
          'ok',
          `Strategy events: ${events.length} raw · ${normalized.length} fills · ${markers.length} markers` +
            (report.trades.length === 0
              ? ' · no closed trades yet (need entry+exit pair)'
              : ''),
          'strategy',
        );
      }
    }
  } else if (!ctx.silent) {
    // Interactive run with no strategy events — clear trade markers.
    // Silent live re-runs of pure indicators must NOT wipe another script's
    // strategy markers (multi-indicator live thrash).
    if (isStrategy) {
      appendLog(
        'warn',
        'Strategy run returned 0 events — broker never filled (check entry conditions / bars)',
        'strategy',
      );
    }
    // Clear only this script’s trade markers (indicators must not wipe a
    // sibling strategy’s long/short labels on interactive re-run).
    ctx.manager.setTradeMarkers([], ctx.indicatorId ?? EDITOR_RUN_KEY);
  }
}
