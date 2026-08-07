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
  type StrategyFillMode,
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
  /** Filled quantity used for money PnL (defaults to 1 when engine omits qty). */
  qty: number;
  /**
   * Money PnL: `(exit − entry) × qty × sign` (short sign −1).
   * Matches pyne broker `(px − avg) * close_qty` for fixed contracts.
   */
  pnl: number;
  /** Fractional move vs entry price (independent of qty). */
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

export interface BuildStrategyReportOptions {
  /**
   * Fill model: `close` (default, signal bar close) or `next_open` (slippage →
   * next bar open). Applied when `bars` are provided.
   */
  fillMode?: StrategyFillMode;
}

function emptyStats(): StrategyStats {
  return {
    totalPnl: 0,
    winRate: 0,
    profitFactor: 0,
    avgTrade: 0,
    avgWin: 0,
    avgLoss: 0,
    maxDD: 0,
    wins: 0,
    losses: 0,
    trades: 0,
  };
}

/**
 * Build closed trades and summary stats from raw engine/strategy events.
 * @param bars - Optional OHLCV for price resolution when events lack price/ohlc
 * @param opts - Fill model prefs (close vs next-open slippage)
 */
export function buildStrategyReport(
  events: StrategyEvent[] | Record<string, unknown>[],
  bars?: Bar[],
  opts: BuildStrategyReportOptions = {},
): {
  trades: ClosedTrade[];
  stats: StrategyStats;
} {
  // Defensive: never throw on garbage engine payloads (runner applies report in UI path)
  if (!Array.isArray(events)) {
    return {
      trades: [],
      stats: emptyStats(),
    };
  }
  const normalized = normalizeStrategyEvents(events, {
    bars,
    includeOrders: true,
    fillMode: opts.fillMode ?? 'close',
  });
  // Same-bar order must follow engine emission order (stable by original index).
  // Pyne reverses emit close(old) then entry(new). Re-ranking entry before close
  // made the close hit the new id at the same price → every flip trade PnL=0.
  const sorted = normalized
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const dt = (a.e.time || 0) - (b.e.time || 0);
      if (dt !== 0) return dt;
      return a.i - b.i;
    })
    .map(({ e }) => e);
  const open = new Map<
    string,
    { entry: number; time: number; dir: string; qty: number }
  >();
  const trades: ClosedTrade[] = [];

  const eventQty = (ev: StrategyEvent, fallback = 1): number => {
    // Prefer engine-filled qty; explicit 0 is no-fill (already filtered on closes).
    const raw = (ev as Record<string, unknown>).qty;
    if (raw == null || raw === '') return fallback;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n === 0) return fallback;
    return Math.abs(n);
  };

  /**
   * Money PnL from prices + size.
   * Engine `profit` is used only when it is a non-zero finite number (some hosts
   * stamp `profit: 0` as a placeholder, which previously zeroed every trade).
   */
  const moneyPnl = (
    o: { entry: number; dir: string; qty: number },
    exitPrice: number,
    closeQty: number,
    engineProfit: unknown,
  ): number => {
    const q = Number.isFinite(closeQty) && closeQty > 0 ? closeQty : o.qty || 1;
    const sign = o.dir.includes('short') ? -1 : 1;
    const fromPrices = (exitPrice - o.entry) * sign * q;

    if (typeof engineProfit === 'number' && Number.isFinite(engineProfit)) {
      // Placeholder zero must not wipe a real price move
      if (engineProfit === 0 && Math.abs(fromPrices) > 1e-12) return fromPrices;
      return engineProfit;
    }
    return fromPrices;
  };

  const pushClosed = (
    openId: string,
    o: { entry: number; time: number; dir: string; qty: number },
    exitTime: number,
    exitPrice: number,
    closeQty: number,
    engineProfit?: unknown,
  ) => {
    const qty = Number.isFinite(closeQty) && closeQty > 0 ? closeQty : o.qty || 1;
    const pnl = moneyPnl(o, exitPrice, qty, engineProfit);
    // Percent is price move (qty-independent) so 10% long is always +0.10
    const priceMove = (exitPrice - o.entry) * (o.dir.includes('short') ? -1 : 1);
    const pnlPct = o.entry !== 0 ? priceMove / o.entry : 0;
    trades.push({
      id: openId || '_default',
      dir: o.dir,
      entryTime: o.time,
      entry: o.entry,
      exitTime,
      exit: exitPrice,
      qty,
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
      const rawDir = String(ev.dir || ev.direction || '').toLowerCase();
      // Guard String(null) → "null" if a caller bypasses normalize
      const dir =
        rawDir && rawDir !== 'null' && rawDir !== 'undefined'
          ? rawDir
          : kind === 'short' || rawDir.includes('short')
            ? 'short'
            : 'long';
      open.set(id, {
        entry: Number(p),
        time: Number(t),
        dir: dir.includes('short') ? 'short' : 'long',
        qty: eventQty(ev, 1),
      });
    } else if (
      kind.includes('close') ||
      kind.includes('exit') ||
      kind === 'closelong' ||
      kind === 'closeshort'
    ) {
      const isCloseAll =
        kind === 'close_all' || kind.includes('close_all') || kind === 'closeall';
      const engineProfit = (ev as Record<string, unknown>).profit;
      if (isCloseAll) {
        // strategy.close_all — flatten every open at this bar
        for (const [openId, o] of open) {
          pushClosed(openId, o, Number(t), Number(p), o.qty, engineProfit);
        }
        open.clear();
        continue;
      }

      // Prefer from_entry / entry_id (strategy.exit), then exit/close id,
      // then sole open trade when only one position is live.
      // Reverse closes often stamp the *new* entry id (pyne) — sole-open and
      // opposite-dir fallback recover the real open position.
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
      // Reverse: close says id=newEntry but direction matches the open we flatten
      if (!o && open.size > 0) {
        const closeDir = String(ev.dir || ev.direction || '').toLowerCase();
        if (closeDir === 'long' || closeDir === 'short') {
          for (const [oid, oo] of open) {
            if (oo.dir === closeDir || (closeDir.includes('short') && oo.dir.includes('short'))) {
              o = oo;
              closedId = oid;
              break;
            }
          }
        }
      }
      if (o) {
        open.delete(closedId);
        // Partial closes: use event qty when smaller than open; else full open qty
        const cq = eventQty(ev, o.qty);
        pushClosed(closedId, o, Number(t), Number(p), cq, engineProfit);
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
  const sign = n >= 0 ? '+' : '';
  const abs = Math.abs(n);
  // Small money PnL (fractional crypto size) — keep more precision so "+0.00" is not a lie
  if (abs > 0 && abs < 0.01) return `${sign}${n.toFixed(4)}`;
  if (abs > 0 && abs < 1) return `${sign}${n.toFixed(3)}`;
  return `${sign}${n.toFixed(2)}`;
}

export function formatNum(n: unknown): string {
  if (n === null || n === undefined) return '—';
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e6) return n.toExponential(2);
  return n.toFixed(Math.abs(n) >= 100 ? 2 : 4);
}

export function tradesToCsv(trades: ClosedTrade[]): string {
  const header = 'id,dir,qty,entry_time,entry,exit_time,exit,pnl,pnl_pct';
  const rows = trades.map((t) =>
    [
      csvCell(t.id),
      csvCell(t.dir),
      t.qty ?? 1,
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
