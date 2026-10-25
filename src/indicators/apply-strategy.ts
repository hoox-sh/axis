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
import {
  normalizeStrategyEvents,
  eventsToMarkers,
  type TradeMarker,
} from '../results/events';
import { buildStrategyReport } from '../results/strategy';
import type { PaneManager } from '../chart/pane-manager';
import type { Bar } from '../store/types';
import type { RunResult } from './runner';

export interface StrategyApplyContext {
  manager: PaneManager;
  result: RunResult;
  scriptType: string;
  silent: boolean;
  indicatorId: string | undefined;
  /**
   * The bars the engine evaluated.
   *
   * The strategy events carry a `bar_index` relative to that window, and the
   * chart window slides (it drops its head on every new bar). Resolving the
   * fills against the live `store.bars` would land every marker one bar
   * early and compute the PnL from the wrong bars.
   */
  bars?: Bar[];
}

/** Pure strategy-marker payload. Chart mutations happen in {@link applyStrategyMarkers}. */
export type StrategyMarkerPlan = {
  owner: string;
  isStrategy: boolean;
  eventsLength: number;
  markers: TradeMarker[];
  merge: boolean;
  normalizedLength: number;
  report: ReturnType<typeof buildStrategyReport> | null;
};

function scriptLooksLikeStrategy(
  scriptType: string,
  events: readonly unknown[],
): boolean {
  if (scriptType === 'strategy') return true;
  return events.some((e) => {
    const k = String(
      (e as { kind?: string; type?: string }).kind ||
        (e as { type?: string }).type ||
        '',
    ).toLowerCase();
    return k.includes('entry') || k.includes('exit') || k.includes('close') || k === 'order';
  });
}

/**
 * Build trade markers and the strategy report without touching the chart.
 * A throw here aborts the apply transaction before plot `setData`.
 */
export function buildStrategyMarkerPlan(
  ctx: Omit<StrategyApplyContext, 'manager'>,
): StrategyMarkerPlan {
  const events = ctx.result.events || [];
  const bars = ctx.bars?.length ? ctx.bars : store.bars || [];
  const owner = ctx.indicatorId ?? EDITOR_RUN_KEY;
  const isStrategy = scriptLooksLikeStrategy(ctx.scriptType, events);
  if (!events.length) {
    return {
      owner,
      isStrategy,
      eventsLength: 0,
      markers: [],
      merge: !!ctx.silent,
      normalizedLength: 0,
      report: null,
    };
  }
  const fillMode = store.strategyUi?.slippageNextOpen ? 'next_open' : 'close';
  const normalized = normalizeStrategyEvents(events, {
    bars,
    includeOrders: false,
    fillMode,
  });
  const markers = eventsToMarkers(normalized, {
    invertLabels: !!store.strategyUi?.invertTradeLabels,
    exactOnCandle: store.strategyUi?.exactOnCandle !== false,
  });
  return {
    owner,
    isStrategy,
    eventsLength: events.length,
    markers,
    merge: !!ctx.silent,
    normalizedLength: normalized.length,
    report: buildStrategyReport(events, bars, { fillMode }),
  };
}

function logStrategyPlan(ctx: StrategyApplyContext, plan: StrategyMarkerPlan): void {
  if (ctx.silent) return;
  const report = plan.report;
  if (report?.trades.length) {
    const net = Number.isFinite(report.stats.totalPnl) ? report.stats.totalPnl : 0;
    const wr = Number.isFinite(report.stats.winRate) ? report.stats.winRate : 0;
    appendLog(
      'ok',
      `Strategy: ${report.stats.trades} trades · net ${net >= 0 ? '+' : ''}${net.toFixed(2)} · win ${wr.toFixed(0)}% · ${plan.markers.length} markers`,
      'strategy',
    );
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
    return;
  }
  if (plan.markers.length || plan.isStrategy) {
    appendLog(
      'ok',
      `Strategy events: ${plan.eventsLength} raw · ${plan.normalizedLength} fills · ${plan.markers.length} markers` +
        (!report?.trades.length ? ' · no closed trades yet (need entry+exit pair)' : ''),
      'strategy',
    );
  }
}

export function applyStrategyMarkers(
  ctx: StrategyApplyContext,
  plan?: StrategyMarkerPlan,
): void {
  // Strategy: trade markers on price pane + report stats.
  // Equity curve is rendered in Results → Strategy only (no main-chart equity pane).
  const built = plan ?? buildStrategyMarkerPlan(ctx);
  try {
    ctx.manager.hideEquityPane?.();
  } catch {
    /* equity pane optional */
  }
  if (built.eventsLength) {
    // Owner-scoped so removing this strategy clears its long/short labels
    // without relying on a global wipe (and without wiping sibling markers).
    // On silent live re-runs, merge with existing markers so entry/exit labels
    // from prior evaluations persist across forming ticks instead of being
    // wiped and only re-painted on the next bar close.
    ctx.manager.setTradeMarkers(built.markers, built.owner, {
      merge: built.merge,
    });
    logStrategyPlan(ctx, built);
  } else if (!ctx.silent) {
    // Interactive run with no strategy events — clear trade markers.
    // Silent live re-runs of pure indicators must NOT wipe another script's
    // strategy markers (multi-indicator live thrash).
    if (built.isStrategy) {
      appendLog(
        'warn',
        'Strategy run returned 0 events — broker never filled (check entry conditions / bars)',
        'strategy',
      );
    }
    ctx.manager.setTradeMarkers([], built.owner);
  }
}
