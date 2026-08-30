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
  formatMoney,
  formatPct,
  tradesToCsv,
  type ClosedTrade,
  type StrategyStats,
} from '../results/strategy';
import { Icons } from './icons';
import { StudioStat } from './studio';
import { EquityChart } from './EquityChart';

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
  /** Slippage: fill at next bar open instead of signal close. */
  slippageNextOpen?: boolean;
  /** Invert long/short marker sides. */
  invertTradeLabels?: boolean;
  /** Exact in-bar circle marks on fill candles. */
  exactOnCandle?: boolean;
  /** Persist strategy UI prefs and re-apply chart markers. */
  onStrategyUiChange?: (patch: {
    slippageNextOpen?: boolean;
    invertTradeLabels?: boolean;
    exactOnCandle?: boolean;
  }) => void;
};

/** Polished strategy tester panel for the Results Strategy tab. */
export const StrategyReport: Component<StrategyReportProps> = (props) => {
  const hasTrades = () => props.trades.length > 0;

  const finalEquity = () => {
    const steps = buildCumulativeEquity(props.trades);
    return steps.length ? steps[steps.length - 1]!.equity : 0;
  };

  const exportCsv = () => {
    if (!props.trades.length) return;
    downloadText(`axis-trades-${Date.now()}.csv`, tradesToCsv(props.trades), 'text/csv');
  };

  const fillHint = () =>
    props.slippageNextOpen
      ? 'Fills at next bar open (slippage)'
      : 'Fills at signal bar close (default)';

  return (
    <div class="ax-stack ax-stack--compact" data-testid="axis-strategy-report">
      {/* Fill / marker options (apply without re-run) */}
      <div
        class="ax-toggle-grid ax-toggle-grid--3"
        data-testid="axis-strategy-fill-opts"
      >
        <label class="ax-toggle" title={fillHint()}>
          <input
            type="checkbox"
            checked={!!props.slippageNextOpen}
            data-testid="axis-strategy-slippage"
            onChange={(e) =>
              props.onStrategyUiChange?.({ slippageNextOpen: e.currentTarget.checked })
            }
          />
          <span>
            <span class="ax-toggle-title">Slippage → next open</span>
            <span class="ax-toggle-hint">{fillHint()}</span>
          </span>
        </label>
        <label class="ax-toggle" title="Long labels above, short below (swap default sides)">
          <input
            type="checkbox"
            checked={!!props.invertTradeLabels}
            data-testid="axis-strategy-invert-labels"
            onChange={(e) =>
              props.onStrategyUiChange?.({ invertTradeLabels: e.currentTarget.checked })
            }
          />
          <span>
            <span class="ax-toggle-title">Invert long/short labels</span>
          </span>
        </label>
        <label class="ax-toggle" title="Circle mark on the fill candle body">
          <input
            type="checkbox"
            checked={props.exactOnCandle !== false}
            data-testid="axis-strategy-exact-marks"
            onChange={(e) =>
              props.onStrategyUiChange?.({ exactOnCandle: e.currentTarget.checked })
            }
          />
          <span>
            <span class="ax-toggle-title">Exact on candle</span>
          </span>
        </label>
      </div>

      <Show
        when={hasTrades()}
        fallback={
          <p class="ax-empty" data-testid="axis-strategy-empty">
            {props.hasEvents
              ? 'Events present but no closed trades yet.'
              : 'No events. Strategy tester pairs entry/close events.'}
          </p>
        }
      >
        <div class="ax-strat-split">
          <div class="ax-strat-col">
            {/* Stats cards */}
            <div class="ax-grid ax-grid--3" data-testid="axis-strategy-stats">
            <StudioStat label="# Trades" value={String(props.stats.trades)} />
            <StudioStat label="Win rate" value={`${props.stats.winRate.toFixed(1)}%`} />
            <StudioStat
              label="Profit factor"
              value={
                Number.isFinite(props.stats.profitFactor)
                  ? props.stats.profitFactor.toFixed(2)
                  : '∞'
              }
            />
            <StudioStat
              label="Net profit"
              value={formatMoney(props.stats.totalPnl)}
              testId="axis-strategy-net"
            />
            <StudioStat
              label="Max DD"
              value={`${(props.stats.maxDD * 100).toFixed(2)}%`}
            />
            <StudioStat
              label="Avg trade"
              value={formatMoney(props.stats.avgTrade)}
            />
          </div>

          {/* Equity curve */}
          <div class="ax-card" data-testid="axis-strategy-equity">
            <div class="ax-toolbar">
              <div class="ax-card-kicker">Equity (cum. PnL)</div>
              <span class="ax-toolbar-spacer" />
              <div class={`ax-mono ${finalEquity() >= 0 ? 'ax-table-pos' : 'ax-table-neg'}`}>
                {formatMoney(finalEquity())}
              </div>
            </div>
            <EquityChart steps={buildCumulativeEquity(props.trades)} />
          </div>
          </div>

          <div class="ax-strat-col">
            {/* Trades table + export */}
            <div class="ax-section">
            <div class="ax-toolbar">
              <h3 class="ax-section-title">Closed trades</h3>
              <span class="ax-toolbar-spacer" />
              <button
                type="button"
                class="ax-btn ax-btn--ghost"
                title="Export closed trades CSV"
                data-testid="axis-strategy-export-csv"
                onClick={exportCsv}
                disabled={!props.trades.length}
              >
                <Icons.fileCsv />
                Export CSV
              </button>
            </div>

            <div class="ax-table-wrap" data-testid="axis-strategy-trades">
              <table class="ax-table ax-table--jump">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Dir</th>
                    <th>Qty</th>
                    <th>Entry time</th>
                    <th>Entry</th>
                    <th>Exit time</th>
                    <th>Exit</th>
                    <th>P&L</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.trades}>
                    {(t) => (
                      <tr
                        title="Jump to entry on chart"
                        onClick={() => props.onJumpToTrade?.(t, 'entry')}
                      >
                        <td>{t.id}</td>
                        <td>{t.dir}</td>
                        <td>
                          {(t.qty ?? 1) % 1 === 0
                            ? String(t.qty ?? 1)
                            : (t.qty ?? 1).toFixed(4)}
                        </td>
                        <td
                          class="ax-table-link"
                          title="Jump to entry"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onJumpToTrade?.(t, 'entry');
                          }}
                        >
                          {formatTradeTime(t.entryTime)}
                        </td>
                        <td>{t.entry.toFixed(2)}</td>
                        <td
                          title="Jump to exit"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onJumpToTrade?.(t, 'exit');
                          }}
                        >
                          {formatTradeTime(t.exitTime)}
                        </td>
                        <td>{t.exit.toFixed(2)}</td>
                        <td class={t.pnl >= 0 ? 'ax-table-pos' : 'ax-table-neg'}>
                          {formatMoney(t.pnl)}
                        </td>
                        <td class={t.pnlPct >= 0 ? 'ax-table-pos' : 'ax-table-neg'}>
                          {formatPct(t.pnlPct)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
