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
 * Strategy report body — stats cards, SVG equity curve, scrollable trades table,
 * CSV export. Fed by {@link buildStrategyReport} from `store.lastRun` events.
 */

import { Component, For, Show, createMemo } from 'solid-js';
import {
  buildCumulativeEquity,
  equityToSvgPolyline,
  formatMoney,
  formatPct,
  tradesToCsv,
  type ClosedTrade,
  type StrategyStats,
} from '../results/strategy';
import { Icons } from './icons';

const EQUITY_W = 480;
const EQUITY_H = 96;
const EQUITY_PAD = 6;

function formatTradeTime(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '—';
  // Accept seconds or milliseconds
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(t);
  }
}

function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type StrategyReportProps = {
  trades: ClosedTrade[];
  stats: StrategyStats;
  /** Jump to entry/exit on the chart (optional). */
  onJumpToTrade?: (trade: ClosedTrade, which: 'entry' | 'exit') => void;
  /** Empty-state hint when events exist but no closed trades. */
  hasEvents?: boolean;
};

/** Polished strategy tester panel for the Results Strategy tab. */
export const StrategyReport: Component<StrategyReportProps> = (props) => {
  const hasTrades = () => props.trades.length > 0;

  const equitySvg = createMemo(() => {
    const steps = buildCumulativeEquity(props.trades);
    const vals = steps.map((s) => s.equity);
    return equityToSvgPolyline(vals, EQUITY_W, EQUITY_H, EQUITY_PAD);
  });

  const finalEquity = () => {
    const steps = buildCumulativeEquity(props.trades);
    return steps.length ? steps[steps.length - 1]!.equity : 0;
  };

  const exportCsv = () => {
    if (!props.trades.length) return;
    downloadText(`axis-trades-${Date.now()}.csv`, tradesToCsv(props.trades), 'text/csv');
  };

  return (
    <Show
      when={hasTrades()}
      fallback={
        <div class="text-text-faint p-2" data-testid="axis-strategy-empty">
          {props.hasEvents
            ? 'Events present but no closed trades yet.'
            : 'No events. Strategy tester pairs entry/close events.'}
        </div>
      }
    >
      <div class="flex flex-col gap-3 min-h-0" data-testid="axis-strategy-report">
        {/* Stats cards */}
        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2" data-testid="axis-strategy-stats">
          <Metric
            label="# Trades"
            value={String(props.stats.trades)}
          />
          <Metric
            label="Win rate"
            value={`${props.stats.winRate.toFixed(1)}%`}
          />
          <Metric
            label="Profit factor"
            value={
              Number.isFinite(props.stats.profitFactor)
                ? props.stats.profitFactor.toFixed(2)
                : '∞'
            }
          />
          <Metric
            label="Net P&L"
            value={formatMoney(props.stats.totalPnl)}
            tone={props.stats.totalPnl >= 0 ? 'pos' : 'neg'}
          />
          <Metric
            label="Max DD"
            value={`${(props.stats.maxDD * 100).toFixed(2)}%`}
            tone="neg"
          />
          <Metric
            label="Avg trade"
            value={formatMoney(props.stats.avgTrade)}
            tone={props.stats.avgTrade >= 0 ? 'pos' : 'neg'}
          />
        </div>

        {/* Equity curve */}
        <div
          class="border-2 border-border bg-bg-elev px-2 py-1.5"
          data-testid="axis-strategy-equity"
        >
          <div class="flex items-center justify-between gap-2 mb-1">
            <div class="text-text-dim text-[10px] uppercase tracking-wider">
              Equity (cum. PnL)
            </div>
            <div
              class={`font-mono text-[10px] tabular-nums ${
                finalEquity() >= 0 ? 'text-accent-2' : 'text-red'
              }`}
            >
              {formatMoney(finalEquity())}
            </div>
          </div>
          <svg
            viewBox={`0 0 ${EQUITY_W} ${EQUITY_H}`}
            class="w-full h-[72px] block"
            preserveAspectRatio="none"
            role="img"
            aria-label="Cumulative PnL equity curve"
          >
            {/* Zero baseline when in range */}
            <Show when={equitySvg().zeroY != null}>
              <line
                x1={EQUITY_PAD}
                x2={EQUITY_W - EQUITY_PAD}
                y1={equitySvg().zeroY!}
                y2={equitySvg().zeroY!}
                stroke="currentColor"
                class="text-border"
                stroke-width="1"
                stroke-dasharray="3 3"
              />
            </Show>
            <polyline
              fill="none"
              stroke="currentColor"
              class={finalEquity() >= 0 ? 'text-accent-2' : 'text-red'}
              stroke-width="1.75"
              stroke-linejoin="round"
              stroke-linecap="round"
              points={equitySvg().points}
            />
          </svg>
        </div>

        {/* Trades table + export */}
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-text-dim text-[10px] uppercase tracking-wider">
            Closed trades
          </span>
          <div class="flex-1" />
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-2 text-[0.78em]"
            title="Export closed trades CSV"
            data-testid="axis-strategy-export-csv"
            onClick={exportCsv}
            disabled={!props.trades.length}
          >
            <Icons.fileCsv />
            Export CSV
          </button>
        </div>

        <div
          class="overflow-auto border-2 border-border max-h-[min(280px,40vh)] min-h-0"
          data-testid="axis-strategy-trades"
        >
          <table class="w-full text-left font-mono text-[10px]">
            <thead class="bg-bg-elev text-text-dim sticky top-0 z-[1]">
              <tr>
                <th class="px-2 py-1">ID</th>
                <th class="px-2 py-1">Dir</th>
                <th class="px-2 py-1">Entry time</th>
                <th class="px-2 py-1">Entry</th>
                <th class="px-2 py-1">Exit time</th>
                <th class="px-2 py-1">Exit</th>
                <th class="px-2 py-1">P&L</th>
                <th class="px-2 py-1">%</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.trades}>
                {(t) => (
                  <tr
                    class="border-t border-border-soft cursor-pointer hover:bg-bg-hover/80 transition-colors"
                    title="Jump to entry on chart"
                    onClick={() => props.onJumpToTrade?.(t, 'entry')}
                  >
                    <td class="px-2 py-0.5 truncate max-w-[72px]">{t.id}</td>
                    <td class="px-2 py-0.5">{t.dir}</td>
                    <td
                      class="px-2 py-0.5 text-accent hover:underline whitespace-nowrap"
                      title="Jump to entry"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onJumpToTrade?.(t, 'entry');
                      }}
                    >
                      {formatTradeTime(t.entryTime)}
                    </td>
                    <td class="px-2 py-0.5 tabular-nums">{t.entry.toFixed(2)}</td>
                    <td
                      class="px-2 py-0.5 hover:underline whitespace-nowrap"
                      title="Jump to exit"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onJumpToTrade?.(t, 'exit');
                      }}
                    >
                      {formatTradeTime(t.exitTime)}
                    </td>
                    <td class="px-2 py-0.5 tabular-nums">{t.exit.toFixed(2)}</td>
                    <td
                      class={`px-2 py-0.5 tabular-nums ${
                        t.pnl >= 0 ? 'text-accent-2' : 'text-red'
                      }`}
                    >
                      {formatMoney(t.pnl)}
                    </td>
                    <td
                      class={`px-2 py-0.5 tabular-nums ${
                        t.pnlPct >= 0 ? 'text-accent-2' : 'text-red'
                      }`}
                    >
                      {formatPct(t.pnlPct)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
};

const Metric: Component<{ label: string; value: string; tone?: 'pos' | 'neg' }> = (props) => (
  <div class="border-2 border-border bg-bg-elev px-2 py-1.5">
    <div class="text-text-dim text-[10px] uppercase tracking-wider">{props.label}</div>
    <div
      class={`font-mono font-semibold mt-0.5 tabular-nums ${
        props.tone === 'pos' ? 'text-accent-2' : props.tone === 'neg' ? 'text-red' : 'text-text'
      }`}
    >
      {props.value}
    </div>
  </div>
);
