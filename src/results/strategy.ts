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
 * Strategy tester — pair entry/exit events into closed trades + summary stats.
 *
 * Ported from legacy `ui/results.js` for the AXIS Solid Results panel.
 * Normalizes via {@link normalizeStrategyEvents}, sorts by time/kind rank, then
 * pairs open positions with exits (`from_entry` preferred over order id).
 *
 * Accepts both Pro API parity events (`kind` / `bar_time` / `direction` / `ohlc`)
 * and legacy UI fields (`type` / `time` / `dir` / `price`). Pass `bars` for
 * price fill when `ohlc` is empty. Close/exit events with explicit **`qty: 0`**
 * (no-fill `strategy.close` telemetry) are dropped in normalize so sole-open
 * pairing cannot invent trades from spam.
 *
 * ## Public API
 *
 * - {@link buildStrategyReport} → `{ trades, stats }`
 * - {@link buildCumulativeEquity} / {@link equityToSvgPolyline} — report UI curve
 * - {@link tradesToCsv} — closed-trade export
 * - Types: {@link StrategyEvent}, {@link ClosedTrade}, {@link StrategyStats}
 *
 * @module results/strategy
 */

import type { Bar } from '../store/types';
import {
  normalizeStrategyEvents,
  resolveExitMatchId,
  strategyEventKindRank,
} from './events';

/** Loose event shape accepted before normalization. */
export interface StrategyEvent {
  time?: number;
  price?: number;
  type?: string;
  event?: string;
  kind?: string;
  id?: string;
  dir?: string;
  direction?: string;
  bar_time?: number;
  bar_index?: number;
  ohlc?: number[];
  /**
   * Filled quantity from the engine. Explicit `0` on close/exit means no fill
   * (`strategy.close` when=false / flat) and is dropped by normalize.
   */
  qty?: number;
  /** strategy.exit from_entry — preferred over exit order id when pairing */
  from_entry?: string;
  entry_id?: string;
  symbol?: string;
  [key: string]: unknown;
}

/** One round-trip trade after entry/exit pairing. */
export interface ClosedTrade {
  id: string;
  dir: string;
  entryTime: number;
  entry: number;
  exitTime: number;
  exit: number;
  pnl: number;
  pnlPct: number;
}

/** Aggregate metrics over {@link ClosedTrade}[]. */
export interface StrategyStats {
  totalPnl: number;
  winRate: number;
  profitFactor: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
  maxDD: number;
  wins: number;
  losses: number;
  trades: number;
}

/**
 * Build closed trades and summary stats from raw engine/strategy events.
 * @param bars - Optional OHLCV for price resolution when events lack price/ohlc
 */
export function buildStrategyReport(
  events: StrategyEvent[] | Record<string, unknown>[],
  bars?: Bar[],
): {
  trades: ClosedTrade[];
  stats: StrategyStats;
} {
  const normalized = normalizeStrategyEvents(events, { bars, includeOrders: true });
  const sorted = normalized.slice().sort((a, b) => {
    const dt = (a.time || 0) - (b.time || 0);
    if (dt !== 0) return dt;
    const ka = String(a.type || a.event || a.kind || '');
    const kb = String(b.type || b.event || b.kind || '');
    return strategyEventKindRank(ka) - strategyEventKindRank(kb);
  });
  const open = new Map<string, { entry: number; time: number; dir: string }>();
  const trades: ClosedTrade[] = [];

  const pushClosed = (
    openId: string,
    o: { entry: number; time: number; dir: string },
    exitTime: number,
    exitPrice: number,
  ) => {
    const pnl = (exitPrice - o.entry) * (o.dir.includes('short') ? -1 : 1);
    const pnlPct = o.entry !== 0 ? pnl / o.entry : 0;
    trades.push({
      id: openId || '_default',
      dir: o.dir,
      entryTime: o.time,
      entry: o.entry,
      exitTime,
      exit: exitPrice,
      pnl,
      pnlPct,
    });
  };

  for (const ev of sorted) {
    const t = ev.time;
    const p = ev.price;
    // Allow pairing even if price missing (use 0) — better to show a trade than drop it
    if (t === undefined || t === null || !Number.isFinite(Number(t))) continue;
    if (p === undefined || p === null || !Number.isFinite(Number(p))) {
      // last resort: skip only if we truly have no price at all
      continue;
    }
    const kind = String(ev.type || ev.event || ev.kind || '').toLowerCase();
    const id = String(ev.id || '_default');
    if (kind.includes('entry') || kind === 'long' || kind === 'short') {
      const dir = String(
        ev.dir || ev.direction || (kind === 'short' ? 'short' : 'long'),
      ).toLowerCase();
      open.set(id, { entry: Number(p), time: Number(t), dir });
    } else if (
      kind.includes('close') ||
      kind.includes('exit') ||
      kind === 'closelong' ||
      kind === 'closeshort'
    ) {
      const isCloseAll =
        kind === 'close_all' || kind.includes('close_all') || kind === 'closeall';
      if (isCloseAll) {
        // strategy.close_all — flatten every open at this bar
        for (const [openId, o] of open) {
          pushClosed(openId, o, Number(t), Number(p));
        }
        open.clear();
        continue;
      }

      // Prefer from_entry / entry_id (strategy.exit), then exit/close id,
      // then sole open trade when only one position is live.
      const matchId = resolveExitMatchId(ev);
      let o = open.get(matchId);
      let closedId = matchId;
      if (!o && matchId !== id) {
        o = open.get(id);
        if (o) closedId = id;
      }
      if (!o && open.size === 1) {
        closedId = open.keys().next().value as string;
        o = open.get(closedId);
      }
      if (o) {
        open.delete(closedId);
        pushClosed(closedId, o, Number(t), Number(p));
      }
    }
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
  const avgTrade = trades.length ? totalPnl / trades.length : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? -grossLoss / losses.length : 0;

  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / Math.max(1, Math.abs(peak) + 1);
    if (dd > maxDD) maxDD = dd;
  }

  return {
    trades,
    stats: {
      totalPnl,
      winRate,
      profitFactor,
      avgTrade,
      avgWin,
      avgLoss,
      maxDD,
      wins: wins.length,
      losses: losses.length,
      trades: trades.length,
    },
  };
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

export function formatNum(n: unknown): string {
  if (n === null || n === undefined) return '—';
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6) return n.toExponential(2);
  return n.toFixed(Math.abs(n) >= 100 ? 2 : 4);
}

export function tradesToCsv(trades: ClosedTrade[]): string {
  const header = 'id,dir,entry_time,entry,exit_time,exit,pnl,pnl_pct';
  const rows = trades.map((t) =>
    [
      csvCell(t.id),
      csvCell(t.dir),
      t.entryTime,
      t.entry,
      t.exitTime,
      t.exit,
      t.pnl,
      t.pnlPct,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/** Escape a CSV field when it contains commas, quotes, or newlines. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** One step of cumulative equity after a closed trade. */
export interface EquityStep {
  /** 1-based trade ordinal after this close */
  i: number;
  /** Exit time of the trade (unix seconds or ms as stored) */
  time: number;
  /** Running cumulative PnL */
  equity: number;
  /** Running peak equity */
  peak: number;
  /** Absolute drawdown from peak (peak − equity, ≥ 0) */
  drawdown: number;
  /** Fractional drawdown (same formula as stats.maxDD) */
  drawdownPct: number;
}

/**
 * Walk closed trades in order and produce cumulative PnL + max-DD series.
 * Pure helper for the Strategy report SVG (does not depend on chart capital).
 */
export function buildCumulativeEquity(trades: ClosedTrade[]): EquityStep[] {
  if (!trades.length) return [];
  // Preserve report order (already chronological from buildStrategyReport).
  let equity = 0;
  let peak = 0;
  const out: EquityStep[] = [];
  for (let idx = 0; idx < trades.length; idx++) {
    const t = trades[idx]!;
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const drawdown = Math.max(0, peak - equity);
    const drawdownPct = drawdown / Math.max(1, Math.abs(peak) + 1);
    out.push({
      i: idx + 1,
      time: t.exitTime,
      equity,
      peak,
      drawdown,
      drawdownPct,
    });
  }
  return out;
}

export interface SvgPolylineResult {
  /** SVG `points` attribute value for a polyline */
  points: string;
  min: number;
  max: number;
  /** Zero-line Y in SVG coords, or null when zero is outside range */
  zeroY: number | null;
}

/**
 * Map a numeric series onto an SVG viewBox polyline.
 * Prepends a synthetic origin (0) so a single trade still draws a segment.
 *
 * @param values - Cumulative equity samples (one per closed trade)
 * @param width - SVG width
 * @param height - SVG height
 * @param pad - Inner padding (default 4)
 */
export function equityToSvgPolyline(
  values: number[],
  width: number,
  height: number,
  pad = 4,
): SvgPolylineResult {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const p = Math.max(0, pad);
  // Include baseline 0 so first trade has a rising/falling segment
  const series = values.length ? [0, ...values] : [0];
  let min = Math.min(...series);
  let max = Math.max(...series);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }
  // Flat line: expand range so we still get a centered horizontal
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const innerW = Math.max(1, w - p * 2);
  const innerH = Math.max(1, h - p * 2);
  const n = series.length;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = p + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = p + innerH - ((series[i]! - min) / (max - min)) * innerH;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  let zeroY: number | null = null;
  if (min <= 0 && max >= 0) {
    zeroY = p + innerH - ((0 - min) / (max - min)) * innerH;
  }
  return { points: pts.join(' '), min, max, zeroY };
}

/**
 * Convenience: cumulative equity polyline + optional max-DD absolute series
 * for overlay shading in the report SVG.
 */
export function buildEquitySvgSeries(
  trades: ClosedTrade[],
  width: number,
  height: number,
  pad = 4,
): {
  steps: EquityStep[];
  equity: SvgPolylineResult;
  /** Drawdown as negative values under zero (for optional fill) */
  drawdown: SvgPolylineResult;
} {
  const steps = buildCumulativeEquity(trades);
  const equityVals = steps.map((s) => s.equity);
  const ddVals = steps.map((s) => -s.drawdown);
  return {
    steps,
    equity: equityToSvgPolyline(equityVals, width, height, pad),
    drawdown: equityToSvgPolyline(ddVals, width, height, pad),
  };
}
