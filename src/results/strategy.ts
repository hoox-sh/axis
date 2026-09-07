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
  /** Bars held (entry → exit resolved against loaded bars; absent when unknown). */
  barsHeld?: number;
  /** Entry fills that built this trade (pyramiding averages into `entry`). */
  entryFills?: number;
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
  /** Σ wins money PnL (optional — absent in legacy callers). */
  grossProfit?: number;
  /** Σ |losses| money PnL (optional — absent in legacy callers). */
  grossLoss?: number;
  /** Compounded per-trade price return: Π(1 + pnlPct) − 1 (optional). */
  returnPct?: number;
}

/** One entry fill of a position (Open ⇄ Close view, left column). */
export interface PositionFill {
  time: number;
  price: number;
  qty: number;
}

/** One exit fill of a position (right column) with realized P&L. */
export interface PositionCloseFill {
  time: number;
  price: number;
  qty: number;
  /** Money PnL attributed to this close `(exit − avg) × qty × sign`. */
  pnl: number;
  /** Price move vs the cycle's avg entry price. */
  pnlPct: number;
}

/** One position "cycle" for the Open ⇄ Close events view. */
export interface PositionView {
  /** Entry order id (engine id or `_default`). */
  id: string;
  /** 1-based open-cycle for this id (re-opens after a full close). */
  cycle: number;
  dir: 'long' | 'short';
  /** Entry fills — pyramiding appends here; avg price = Σ(p·q)/Σq. */
  opens: PositionFill[];
  /** Exit fills with per-fill P&L. */
  closes: PositionCloseFill[];
  /** Total entered qty (Σ entry fills). */
  totalQty: number;
  /** Qty still open after all closes. */
  openQty: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
  /** Realized P&L (Σ close-fill pnl). */
  realizedPnl: number;
  status: 'open' | 'closed';
  /** First entry fill time. */
  entryTime: number;
  /** Last close fill time (null while open). */
  exitTime: number | null;
}

/** A normalized stream event enriched with position context (Stream view). */
export interface StreamEventView extends StrategyEvent {
  /** Closes: money P&L attributed to this fill. */
  pnl?: number;
  /** Closes: price move vs avg entry. */
  pnlPct?: number;
  /** Entries: position qty after this fill. */
  posQty?: number;
  /** Entries: position avg price after this fill. */
  posAvg?: number;
  /** Entries: fill count so far. */
  fills?: number;
  /** Closes: qty still open after this close. */
  remaining?: number;
  /** Open cycle index (1-based) this event belongs to. */
  cycle?: number;
}

/** Full output of the shared pairing walker. */
export interface StrategyWalk {
  trades: ClosedTrade[];
  stats: StrategyStats;
  positions: PositionView[];
  stream: StreamEventView[];
}

/**
 * JSON-safe stats snapshot persisted in `ResultMeta.stats` (Saved tab).
 * `profitFactor: null` means ∞ (no losing trades) — JSON cannot store Infinity.
 */
export interface StrategyStatsSnapshot {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number | null;
  totalPnl: number;
  returnPct: number;
  maxDD: number;
  avgTrade: number;
  avgWin: number;
  avgLoss: number;
}

/** Compact a report into the persisted snapshot (pure, JSON-safe). */
export function strategyStatsSnapshot(stats: StrategyStats): StrategyStatsSnapshot {
  return {
    trades: stats.trades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    profitFactor: Number.isFinite(stats.profitFactor) ? Number(stats.profitFactor.toFixed(4)) : null,
    totalPnl: Number(stats.totalPnl.toFixed(6)),
    returnPct: Number((stats.returnPct ?? 0).toFixed(6)),
    maxDD: Number(stats.maxDD.toFixed(6)),
    avgTrade: Number(stats.avgTrade.toFixed(6)),
    avgWin: Number(stats.avgWin.toFixed(6)),
    avgLoss: Number(stats.avgLoss.toFixed(6)),
  };
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

/** Bars store `time` in unix seconds; events may carry seconds or ms. */
function toBarEpoch(t: number): number {
  return t > 1e12 ? t / 1000 : t;
}

/**
 * Bars held between entry and exit (bisect over loaded bar times).
 * Returns undefined when bars/times cannot resolve both edges.
 */
function barsBetween(bars: Bar[] | undefined, entryTime: number, exitTime: number): number | undefined {
  if (!bars?.length || !Number.isFinite(entryTime) || !Number.isFinite(exitTime)) return undefined;
  const et = toBarEpoch(entryTime);
  const xt = toBarEpoch(exitTime);
  const bisect = (t: number): number => {
    let lo = 0;
    let hi = bars.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const bt = Number(bars[mid]?.time);
      if (!Number.isFinite(bt)) return ans;
      if (bt <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };
  const i0 = bisect(et);
  const i1 = bisect(xt);
  if (i0 < 0 || i1 < i0) return undefined;
  return i1 - i0;
}

/** Mutable open-position cycle used while walking events. */
interface OpenCycle {
  id: string;
  cycle: number;
  dir: 'long' | 'short';
  time: number;
  /** Volume-weighted average entry price so far. */
  entry: number;
  qty: number;
  fills: PositionFill[];
  /** View record being built for this cycle (shared reference). */
  view: PositionView;
}

/**
 * Shared pairing walker: pairs entry/exit events into closed trades, summary
 * stats, per-position cycles (pyramiding-aware), and an enriched event stream.
 *
 * Pyramiding semantics match the pyne broker: additional entries into a live
 * position average into it (`entry = Σ(p·q)/Σq`), closes realize
 * `(exit − avg) × close_qty × sign` and reduce the open qty.
 */
export function walkStrategyEvents(
  events: StrategyEvent[] | Record<string, unknown>[],
  bars?: Bar[],
  opts: BuildStrategyReportOptions = {},
): StrategyWalk {
  const empty: StrategyWalk = { trades: [], stats: emptyStats(), positions: [], stream: [] };
  if (!Array.isArray(events)) return empty;
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

  const open = new Map<string, OpenCycle>();
  const cycleCount = new Map<string, number>();
  const positions: PositionView[] = [];
  const trades: ClosedTrade[] = [];
  const stream: StreamEventView[] = [];

  const eventQty = (ev: StrategyEvent, fallback = 1): number => {
    // Prefer engine-filled qty; explicit 0 is no-fill (already filtered on closes).
    const raw = (ev as Record<string, unknown>).qty;
    if (raw == null || raw === '') return fallback;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n === 0) return fallback;
    return Math.abs(n);
  };

  /** Money PnL for a close fill vs the cycle's avg entry price. */
  const closePnl = (
    cycle: OpenCycle,
    exitPrice: number,
    closeQty: number,
    engineProfit: unknown,
  ): number => {
    const sign = cycle.dir === 'short' ? -1 : 1;
    const fromPrices = (exitPrice - cycle.entry) * sign * closeQty;
    if (typeof engineProfit === 'number' && Number.isFinite(engineProfit)) {
      // Placeholder zero must not wipe a real price move
      if (engineProfit === 0 && Math.abs(fromPrices) > 1e-12) return fromPrices;
      return engineProfit;
    }
    return fromPrices;
  };

  const openEntry = (ev: StrategyEvent, t: number, p: number): void => {
    const kind = String(ev.type || ev.event || ev.kind || '').toLowerCase();
    const rawDir = String(ev.dir || ev.direction || '').toLowerCase();
    // Guard String(null) → "null" if a caller bypasses normalize
    const dir: 'long' | 'short' =
      rawDir && rawDir !== 'null' && rawDir !== 'undefined'
        ? rawDir.includes('short')
          ? 'short'
          : 'long'
        : kind === 'short' || rawDir.includes('short')
          ? 'short'
          : 'long';
    const id = String(ev.id || '_default');
    const q = eventQty(ev, 1);
    let cycle = open.get(id);
    if (cycle) {
      // Pyramiding: average into the live position
      const nextQty = cycle.qty + q;
      cycle.entry = nextQty > 0 ? (cycle.entry * cycle.qty + p * q) / nextQty : p;
      cycle.qty = nextQty;
      cycle.fills.push({ time: t, price: p, qty: q });
      cycle.view.avgPrice = cycle.entry;
      cycle.view.totalQty = nextQty;
      cycle.view.openQty += q;
      // `cycle.fills` IS `view.opens` — push once.
    } else {
      const n = (cycleCount.get(id) ?? 0) + 1;
      cycleCount.set(id, n);
      const view: PositionView = {
        id,
        cycle: n,
        dir,
        opens: [{ time: t, price: p, qty: q }],
        closes: [],
        totalQty: q,
        openQty: q,
        avgPrice: p,
        realizedPnl: 0,
        status: 'open',
        entryTime: t,
        exitTime: null,
      };
      positions.push(view);
      cycle = {
        id,
        cycle: n,
        dir,
        time: t,
        entry: p,
        qty: q,
        fills: view.opens,
        view,
      };
      open.set(id, cycle);
    }
    stream.push({
      ...ev,
      posQty: cycle.qty,
      posAvg: cycle.entry,
      fills: cycle.fills.length,
      cycle: cycle.cycle,
    });
  };

  const closeFill = (
    ev: StrategyEvent,
    cycle: OpenCycle,
    t: number,
    p: number,
    closeQty: number,
    engineProfit: unknown,
  ): void => {
    const sign = cycle.dir === 'short' ? -1 : 1;
    const pnl = closePnl(cycle, p, closeQty, engineProfit);
    const priceMove = (p - cycle.entry) * sign;
    const pnlPct = cycle.entry !== 0 ? priceMove / cycle.entry : 0;
    cycle.view.closes.push({ time: t, price: p, qty: closeQty, pnl, pnlPct });
    cycle.view.realizedPnl += pnl;
    cycle.view.openQty = Math.max(0, cycle.view.openQty - closeQty);
    cycle.qty = Math.max(0, cycle.qty - closeQty);
    trades.push({
      id: cycle.id || '_default',
      dir: cycle.dir,
      entryTime: cycle.time,
      entry: cycle.entry,
      exitTime: t,
      exit: p,
      qty: closeQty,
      pnl,
      pnlPct,
      barsHeld: barsBetween(bars, cycle.time, t),
      entryFills: cycle.fills.length,
    });
    stream.push({ ...ev, pnl, pnlPct, remaining: cycle.view.openQty, cycle: cycle.cycle });
    if (cycle.qty <= 1e-12) {
      cycle.view.status = 'closed';
      cycle.view.exitTime = t;
      open.delete(cycle.id);
    }
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
    const time = Number(t);
    const price = Number(p);
    if (kind.includes('entry') || kind === 'long' || kind === 'short') {
      openEntry(ev, time, price);
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
        const cycles = [...open.values()];
        open.clear();
        for (const cycle of cycles) {
          closeFill(ev, cycle, time, price, cycle.qty, engineProfit);
        }
        continue;
      }

      // Prefer from_entry / entry_id (strategy.exit), then exit/close id,
      // then sole open trade when only one position is live.
      // Reverse closes often stamp the *new* entry id (pyne) — sole-open and
      // opposite-dir fallback recover the real open position.
      const matchId = resolveExitMatchId(ev);
      let cycle = open.get(matchId);
      if (!cycle && matchId !== String(ev.id || '_default')) {
        cycle = open.get(String(ev.id || '_default'));
      }
      if (!cycle && open.size === 1) {
        cycle = open.values().next().value;
      }
      // Reverse: close says id=newEntry but direction matches the open we flatten
      if (!cycle && open.size > 0) {
        const closeDir = String(ev.dir || ev.direction || '').toLowerCase();
        if (closeDir === 'long' || closeDir === 'short') {
          for (const c of open.values()) {
            if (c.dir === (closeDir.includes('short') ? 'short' : 'long')) {
              cycle = c;
              break;
            }
          }
        }
      }
      if (!cycle) continue;
      // Partial closes: use event qty when smaller than open; else full open qty
      const cq = Math.min(eventQty(ev, cycle.qty), cycle.qty);
      closeFill(ev, cycle, time, price, cq, engineProfit);
    } else {
      stream.push({ ...ev });
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

  // Compounded per-trade price return (clamped per leg so a single −101% short
  // leg cannot flip the product's sign).
  let compounded = 1;
  for (const t of trades) {
    compounded *= Math.max(-0.9999, Math.min(10, 1 + t.pnlPct));
  }
  const returnPct = trades.length ? compounded - 1 : 0;

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
      grossProfit,
      grossLoss,
      returnPct,
    },
    positions,
    stream,
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
  const walk = walkStrategyEvents(events, bars, opts);
  return { trades: walk.trades, stats: walk.stats };
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
