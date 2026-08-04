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
 * Strategy event normalization + chart marker / equity helpers.
 *
 * Bridges pyne Pro API / runtime parity payloads into the UI shape used by
 * the strategy tester and Lightweight Charts markers.
 *
 * | Runtime field | UI field |
 * |---------------|----------|
 * | `kind` | `type` |
 * | `direction` | `dir` |
 * | `bar_time` | `time` |
 * | `ohlc[3]` / bar close | `price` |
 *
 * ## No-fill close telemetry
 *
 * Engines may emit a `kind: "close"` event for every `strategy.close(..., when=cond)`
 * evaluation, including when `when` is false or the account is flat. Those
 * payloads carry **`qty: 0`** (no real fill). {@link normalizeStrategyEvents}
 * drops them so the strategy tester, event list, and chart markers stay free
 * of thousands of phantom exits. Events with missing `qty` are kept for
 * older payloads that omit the field on real fills.
 *
 * Also exports {@link eventsToMarkers}, {@link buildEquityCurve}, exit-id
 * matching, and kind rank for stable sort order.
 *
 * @module results/events
 */

import type { Bar } from '../store/types';
import type { StrategyEvent } from './strategy';

export interface NormalizeOptions {
  /** OHLCV bars for price lookup when event.ohlc is empty */
  bars?: Bar[];
  /**
   * When false, drop pending `order` / `cancel` / `cancel_all` (markers path).
   * Default true so the Results event list still shows order telemetry.
   */
  includeOrders?: boolean;
}

/** Align event times with chart bar units (sec vs ms). */
export function alignTimeToBars(t: number, bars?: Bar[]): number {
  if (!bars?.length || !Number.isFinite(t)) return t;
  const sample = bars[0]!.time;
  // Chart bars in ms, event in seconds
  if (sample > 1e12 && t < 1e12) return Math.floor(t * 1000);
  // Chart bars in seconds, event in ms
  if (sample < 1e12 && t > 1e12) return Math.floor(t / 1000);
  return t;
}

function barCloseAt(
  bars: Bar[] | undefined,
  barTime: number | undefined,
  barIndex: number | undefined,
): number | undefined {
  if (!bars?.length) return undefined;
  // Prefer bar_index (pyne always stamps it; more reliable than a broken bar_time)
  if (
    barIndex != null &&
    Number.isFinite(barIndex) &&
    barIndex >= 0 &&
    barIndex < bars.length
  ) {
    const c = bars[barIndex]!.close;
    if (Number.isFinite(c)) return c;
  }
  // bar_time 0 is a missing/placeholder — do not snap every event to the first bar
  if (barTime != null && Number.isFinite(barTime) && barTime !== 0) {
    const aligned = alignTimeToBars(barTime, bars);
    const byTime = bars.find((b) => b.time === aligned);
    if (byTime && Number.isFinite(byTime.close)) return byTime.close;
    // nearest bar within 2× median span
    let best: Bar | undefined;
    let bestD = Infinity;
    for (const b of bars) {
      const d = Math.abs(b.time - aligned);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best && bestD < Math.abs(sampleSpan(bars)) * 2 && Number.isFinite(best.close)) {
      return best.close;
    }
  }
  return undefined;
}

function sampleSpan(bars: Bar[]): number {
  if (bars.length < 2) return bars[0]!.time > 1e12 ? 86_400_000 : 86_400;
  return Math.abs(bars[1]!.time - bars[0]!.time) || 1;
}

/** Coerce a numeric field; reject non-finite and (by default) exact 0. */
function finitePrice(v: unknown, allowZero = false): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (!allowZero && n === 0) return undefined;
  return n;
}

/**
 * Resolve a fill/mark price from a raw strategy event.
 * Prefer explicit fill fields, then OHLC close, then chart bars.
 * Never let a placeholder `price: 0` shadow valid OHLC/bar data.
 */
function resolvePrice(raw: Record<string, unknown>, bars?: Bar[]): number | undefined {
  // Named fill fields (some hosts / future engines)
  for (const key of ['fill_price', 'avg_price', 'avgPrice', 'fillPrice'] as const) {
    const p = finitePrice(raw[key]);
    if (p != null) return p;
  }

  // Explicit price — but skip 0 so we can fall through to ohlc/bars
  const explicit = finitePrice(raw.price);
  if (explicit != null) return explicit;

  const ohlc = raw.ohlc;
  if (Array.isArray(ohlc) && ohlc.length >= 4) {
    // Prefer close (market fill at bar close under process_orders_on_close)
    const close = finitePrice(ohlc[3]);
    if (close != null) return close;
    for (const i of [0, 1, 2]) {
      const v = finitePrice(ohlc[i]);
      if (v != null) return v;
    }
  }

  // Limit/stop as last-resort fill marks (limit orders)
  for (const key of ['limit', 'stop'] as const) {
    const p = finitePrice(raw[key]);
    if (p != null) return p;
  }

  const barTime =
    typeof raw.bar_time === 'number'
      ? raw.bar_time
      : typeof raw.time === 'number'
        ? raw.time
        : raw.bar_time != null
          ? Number(raw.bar_time)
          : raw.time != null
            ? Number(raw.time)
            : undefined;
  const barIndexRaw = raw.bar_index ?? raw.barIndex;
  const barIndex =
    typeof barIndexRaw === 'number'
      ? barIndexRaw
      : barIndexRaw != null && Number.isFinite(Number(barIndexRaw))
        ? Number(barIndexRaw)
        : undefined;
  return barCloseAt(
    bars,
    barTime != null && Number.isFinite(barTime) ? barTime : undefined,
    barIndex,
  );
}

/**
 * Map one raw event (parity or legacy) to StrategyEvent for Results / markers.
 */
export function normalizeStrategyEvent(
  raw: Record<string, unknown> | StrategyEvent,
  opts: NormalizeOptions = {},
): StrategyEvent {
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? r.type ?? r.event ?? '').toLowerCase();
  let time: number | undefined =
    typeof r.time === 'number' && Number.isFinite(r.time)
      ? r.time
      : typeof r.bar_time === 'number' && Number.isFinite(r.bar_time)
        ? r.bar_time
        : undefined;
  if (time != null) time = alignTimeToBars(time, opts.bars);
  const dir = String(r.dir ?? r.direction ?? '').toLowerCase() || undefined;
  const price = resolvePrice(r, opts.bars);

  const fromEntry =
    r.from_entry ?? r.fromEntry ?? r.entry_id ?? r.entryId ?? undefined;
  const qty =
    typeof r.qty === 'number' && Number.isFinite(r.qty)
      ? r.qty
      : r.qty != null && Number.isFinite(Number(r.qty))
        ? Number(r.qty)
        : undefined;

  return {
    ...r,
    type: kind || undefined,
    event: kind || undefined,
    kind,
    dir,
    direction: dir,
    time,
    bar_time: typeof r.bar_time === 'number' ? alignTimeToBars(r.bar_time, opts.bars) : time,
    bar_index: typeof r.bar_index === 'number' ? r.bar_index : undefined,
    price,
    qty,
    id: r.id != null ? String(r.id) : undefined,
    // strategy.exit(id, from_entry) — keep entry key for pairing
    from_entry: fromEntry != null ? String(fromEntry) : undefined,
  };
}

/**
 * Engine no-fill close/exit: `strategy.close` / exit evaluated with no position
 * or when=false. Explicit qty ≤ 0 means nothing filled — drop before pairing
 * and markers. Missing qty is *not* treated as no-fill (legacy payloads).
 */
export function isNoFillCloseEvent(ev: StrategyEvent | Record<string, unknown>): boolean {
  const kind = String(
    (ev as StrategyEvent).type ||
      (ev as StrategyEvent).kind ||
      (ev as StrategyEvent).event ||
      '',
  ).toLowerCase();
  const isCloseOrExit =
    kind.includes('close') ||
    kind.includes('exit') ||
    kind === 'closelong' ||
    kind === 'closeshort';
  if (!isCloseOrExit) return false;
  const raw = (ev as Record<string, unknown>).qty;
  if (raw == null || raw === '') return false;
  const qty = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(qty) && qty <= 0;
}

/** Normalize an array of raw events; filters order noise and no-fill closes. */
export function normalizeStrategyEvents(
  events: unknown[] | undefined | null,
  opts: NormalizeOptions = {},
): StrategyEvent[] {
  if (!events?.length) return [];
  const includeOrders = opts.includeOrders !== false;
  const out: StrategyEvent[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const n = normalizeStrategyEvent(ev as Record<string, unknown>, opts);
    const kind = String(n.type || n.kind || '').toLowerCase();
    if (!includeOrders && (kind === 'order' || kind.startsWith('cancel'))) continue;
    // Drop strategy.close/exit telemetry with qty=0 (no real fill) so report,
    // markers, and the Results event list stay free of phantom exits.
    if (isNoFillCloseEvent(n)) continue;
    out.push(n);
  }
  return out;
}

export interface TradeMarker {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  color: string;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  text: string;
}

const COLOR = {
  longEntry: '#5ecf8a',
  shortEntry: '#e8a03a',
  exit: '#e85d4c',
  order: '#8b8e9c',
};

/**
 * Kind rank for same-bar ordering.
 *
 * **Close/exit before entry** — required for position reverses:
 * pyne emits `close` (flatten old) then `entry` (open opposite) on the same
 * bar. Processing entry first opened the new id, then the close matched that
 * new id at the same price → every reverse trade reported PnL 0.
 */
export function strategyEventKindRank(kind: string): number {
  const k = kind.toLowerCase();
  if (k.includes('exit') || k.includes('close')) return 0;
  if (k === 'order' || k.startsWith('cancel')) return 1;
  if (k.includes('entry') || k === 'long' || k === 'short') return 2;
  return 3;
}

function timeOfEvent(ev: StrategyEvent): number | undefined {
  if (typeof ev.time === 'number' && Number.isFinite(ev.time)) return ev.time;
  if (typeof ev.bar_time === 'number' && Number.isFinite(ev.bar_time)) return ev.bar_time;
  return undefined;
}

/** Entry id to match on exit/close: prefer from_entry / entry_id (strategy.exit). */
export function resolveExitMatchId(ev: StrategyEvent): string {
  const r = ev as Record<string, unknown>;
  const from =
    r.from_entry ?? r.fromEntry ?? r.entry_id ?? r.entryId ?? r.from_id ?? r.fromId;
  if (from != null && String(from).length) return String(from);
  if (ev.id != null && String(ev.id).length) return String(ev.id);
  return '_default';
}

/**
 * Build LWC series markers from normalized strategy events.
 * Tracks open position dir so exits get a sensible arrow direction.
 *
 * LWC v5 createSeriesMarkers stacks multiple markers on the same bar —
 * keep both same-bar entry and exit (do not collapse by time).
 */
export function eventsToMarkers(events: StrategyEvent[]): TradeMarker[] {
  const openDir = new Map<string, string>();
  const markers: TradeMarker[] = [];

  // Preserve engine order on a bar (close-then-entry for reverses)
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const dt = (timeOfEvent(a.e) || 0) - (timeOfEvent(b.e) || 0);
      if (dt !== 0) return dt;
      return a.i - b.i;
    })
    .map(({ e }) => e);

  for (const ev of sorted) {
    const t = timeOfEvent(ev);
    if (t === undefined || !Number.isFinite(t)) continue;
    const kind = String(ev.type || ev.event || ev.kind || '').toLowerCase();
    const id = String(ev.id || '');
    const dir = String(ev.dir || ev.direction || '').toLowerCase();

    if (kind.includes('entry')) {
      const isShort = dir.includes('short');
      openDir.set(id || '_default', isShort ? 'short' : 'long');
      markers.push({
        time: t,
        position: isShort ? 'aboveBar' : 'belowBar',
        color: isShort ? COLOR.shortEntry : COLOR.longEntry,
        shape: isShort ? 'arrowDown' : 'arrowUp',
        text: id || (isShort ? 'S' : 'L'),
      });
    } else if (kind.includes('close') || kind.includes('exit')) {
      // qty=0 no-fill (normalize usually drops these); never invent exit markers.
      if (isNoFillCloseEvent(ev)) continue;
      // Unpaired close spam without qty: skip when nothing is open.
      if (openDir.size === 0) continue;

      const matchId = resolveExitMatchId(ev);
      const isCloseAll = kind === 'close_all' || kind.includes('close_all') || kind === 'closeall';
      if (isCloseAll) {
        // One exit marker; use first open dir for arrow sense, then clear all
        const firstDir = openDir.values().next().value || dir || 'long';
        const isShort = String(firstDir).includes('short');
        openDir.clear();
        markers.push({
          time: t,
          position: isShort ? 'belowBar' : 'aboveBar',
          color: COLOR.exit,
          shape: isShort ? 'arrowUp' : 'arrowDown',
          text: id || 'X',
        });
      } else {
        let open = openDir.get(matchId);
        if (!open && openDir.size === 1) {
          open = openDir.values().next().value;
          openDir.clear();
        } else if (open) {
          openDir.delete(matchId);
        } else if (!open) {
          open = openDir.get(id || '_default') || openDir.get('_default');
          if (open) openDir.delete(id || '_default');
        }
        // No matching open → skip marker (do not invent long exits when flat)
        if (!open) continue;
        const isShort = String(open).includes('short');
        markers.push({
          time: t,
          position: isShort ? 'belowBar' : 'aboveBar',
          color: COLOR.exit,
          shape: isShort ? 'arrowUp' : 'arrowDown',
          text: id || 'X',
        });
      }
    }
    // pending order / cancel skipped for chart noise
  }

  // Keep all markers (incl. same-bar entry+exit); sort ascending for LWC
  return markers.sort((a, b) => a.time - b.time || a.text.localeCompare(b.text));
}

/**
 * Equity curve from closed trades: initial capital + cumulative PnL at each exit.
 * Same-bar exits are coalesced so LWC area series gets unique times.
 */
export function buildEquityCurve(
  trades: { exitTime: number; pnl: number }[],
  initialCapital = 10_000,
): { time: number; value: number }[] {
  if (!trades.length) return [];
  const sorted = trades.slice().sort((a, b) => a.exitTime - b.exitTime);
  let equity = initialCapital;
  const points: { time: number; value: number }[] = [];
  for (const t of sorted) {
    if (!Number.isFinite(t.exitTime)) continue;
    equity += t.pnl;
    const value = +equity.toFixed(2);
    const last = points[points.length - 1];
    if (last && last.time === t.exitTime) {
      last.value = value;
    } else {
      points.push({ time: t.exitTime, value });
    }
  }
  return points;
}
