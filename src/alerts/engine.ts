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
 * Pure alert evaluation against last price / bars.
 *
 * No Solid, no DOM, no network — side effects (webhook, Notification,
 * persistence) live in the public API layer ({@link ../index}).
 *
 * ## Cross tracking
 * `price_cross` needs a previous price. Callers may pass `ctx.prevPrice`;
 * otherwise the engine remembers the last evaluated price per symbol via
 * {@link getPrevPrice} / {@link setPrevPrice}.
 *
 * @module alerts/engine
 */

import type { Alert, EvaluateContext } from './types';

/** Per-symbol last evaluated price (for cross detection across ticks). */
const prevPriceBySymbol = new Map<string, number>();

/** Normalize symbol for matching (trim + upper). */
export function normalizeSymbol(symbol: string): string {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

/** Read last evaluated price for a symbol (undefined if never evaluated). */
export function getPrevPrice(symbol: string): number | undefined {
  return prevPriceBySymbol.get(normalizeSymbol(symbol));
}

/** Store last evaluated price for a symbol. */
export function setPrevPrice(symbol: string, price: number): void {
  if (!Number.isFinite(price)) return;
  prevPriceBySymbol.set(normalizeSymbol(symbol), price);
}

/** Clear cross-tracking state (tests / full reset). */
export function clearPrevPrices(): void {
  prevPriceBySymbol.clear();
}

/**
 * Coerce a params field to a finite number, or `null` if missing/invalid.
 */
export function numParam(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Whether cooldown still blocks a fire.
 * @returns true if the alert must not fire yet
 */
export function isInCooldown(alert: Alert, now: number): boolean {
  const cd = alert.cooldownMs;
  if (cd == null || cd <= 0) return false;
  if (alert.lastFiredAt == null) return false;
  return now - alert.lastFiredAt < cd;
}

/**
 * True when price path from `prev` → `price` crosses `level`
 * (either direction). Touching exactly after being off-level counts.
 * Requires a defined previous price; first tick never crosses.
 */
export function crossesLevel(prev: number, price: number, level: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(price) || !Number.isFinite(level)) {
    return false;
  }
  if (prev === price) return false;
  // Strict cross: was on one side (or equal) and moved to the other side (or equal from opposite)
  const wasBelow = prev < level;
  const wasAbove = prev > level;
  const nowBelow = price < level;
  const nowAbove = price > level;
  const nowEqual = price === level;

  if (wasBelow && (nowAbove || nowEqual)) return true;
  if (wasAbove && (nowBelow || nowEqual)) return true;
  // Was exactly on level: only fire if we leave and ... no — classic TV "crossing" fires when
  // moving through the level. Starting ON the level does not re-fire until we leave and re-cross.
  if (prev === level) return false;
  return false;
}

/**
 * Edge-triggered: condition becomes true (or stays true with no prev).
 * Used for price_above / price_below.
 */
export function becomesTrue(
  nowTrue: boolean,
  wasTrue: boolean | undefined,
): boolean {
  if (!nowTrue) return false;
  // First sample with condition already true → fire once
  if (wasTrue === undefined) return true;
  return !wasTrue && nowTrue;
}

function symbolMatches(alert: Alert, ctx: EvaluateContext): boolean {
  return normalizeSymbol(alert.symbol) === normalizeSymbol(ctx.symbol);
}

function intervalMatches(alert: Alert, ctx: EvaluateContext): boolean {
  if (!alert.interval) return true;
  if (ctx.interval == null || ctx.interval === '') return true;
  return String(alert.interval) === String(ctx.interval);
}

/**
 * Resolve base price for pct_change: explicit params.basePrice, else first bar close,
 * else previous bar close, else prevPrice.
 */
export function resolveBasePrice(
  params: Record<string, unknown>,
  ctx: EvaluateContext,
  prevPrice: number | undefined,
): number | null {
  const explicit = numParam(params, 'basePrice');
  if (explicit != null) return explicit;
  const bars = ctx.bars;
  if (bars && bars.length >= 1) {
    // Prefer session open (first bar) when multiple bars; else sole bar open
    if (bars.length >= 2) {
      const first = bars[0]?.close;
      if (typeof first === 'number' && Number.isFinite(first) && first !== 0) return first;
    }
    const lastOpen = bars[bars.length - 1]?.open;
    if (typeof lastOpen === 'number' && Number.isFinite(lastOpen) && lastOpen !== 0) {
      return lastOpen;
    }
  }
  if (prevPrice != null && Number.isFinite(prevPrice) && prevPrice !== 0) return prevPrice;
  return null;
}

/**
 * Evaluate a single alert against context.
 * Pure: does not mutate alert or engine maps.
 *
 * @param prevPrice previous price for cross / edge detection
 * @param now evaluation epoch ms
 */
export function evaluateOne(
  alert: Alert,
  ctx: EvaluateContext,
  prevPrice: number | undefined,
  now: number,
): boolean {
  if (!alert.enabled) return false;
  if (!symbolMatches(alert, ctx)) return false;
  if (!intervalMatches(alert, ctx)) return false;
  if (isInCooldown(alert, now)) return false;
  if (!Number.isFinite(ctx.price)) return false;

  const price = ctx.price;
  const params = alert.params ?? {};

  switch (alert.kind) {
    case 'price_cross': {
      const level = numParam(params, 'price');
      if (level == null) return false;
      if (prevPrice == null) return false;
      return crossesLevel(prevPrice, price, level);
    }
    case 'price_above': {
      const level = numParam(params, 'price');
      if (level == null) return false;
      const nowTrue = price > level;
      const wasTrue = prevPrice == null ? undefined : prevPrice > level;
      return becomesTrue(nowTrue, wasTrue);
    }
    case 'price_below': {
      const level = numParam(params, 'price');
      if (level == null) return false;
      const nowTrue = price < level;
      const wasTrue = prevPrice == null ? undefined : prevPrice < level;
      return becomesTrue(nowTrue, wasTrue);
    }
    case 'pct_change': {
      const pct = numParam(params, 'pct');
      if (pct == null || pct < 0) return false;
      const base = resolveBasePrice(params, ctx, prevPrice);
      if (base == null || base === 0) return false;
      const changePct = ((price - base) / Math.abs(base)) * 100;
      const direction = (params.direction as string | undefined) ?? 'both';
      let condition = false;
      if (direction === 'up') condition = changePct >= pct;
      else if (direction === 'down') condition = changePct <= -pct;
      else condition = Math.abs(changePct) >= pct;

      // Edge-trigger on condition using a synthetic "was true" from last fire is
      // handled by cooldown; for first entry use edge vs prev change when possible.
      if (prevPrice == null) return condition;
      const prevChange = ((prevPrice - base) / Math.abs(base)) * 100;
      let wasTrue = false;
      if (direction === 'up') wasTrue = prevChange >= pct;
      else if (direction === 'down') wasTrue = prevChange <= -pct;
      else wasTrue = Math.abs(prevChange) >= pct;
      return becomesTrue(condition, wasTrue);
    }
    case 'drawing_touch': {
      const tolerance = numParam(params, 'tolerance') ?? 0;
      const levels: number[] = [];
      const single = numParam(params, 'price');
      if (single != null) levels.push(single);
      const multi = params.prices;
      if (Array.isArray(multi)) {
        for (const p of multi) {
          if (typeof p === 'number' && Number.isFinite(p)) levels.push(p);
          else if (typeof p === 'string' && p.trim() !== '') {
            const n = Number(p);
            if (Number.isFinite(n)) levels.push(n);
          }
        }
      }
      if (levels.length === 0) return false;

      const touches = (level: number): boolean => {
        // Current price within tolerance of level
        if (Math.abs(price - level) <= tolerance) return true;
        // Bar high/low envelope when bars provided (last bar)
        const bars = ctx.bars;
        if (bars && bars.length > 0) {
          const b = bars[bars.length - 1]!;
          const lo = Math.min(b.low, b.high) - tolerance;
          const hi = Math.max(b.low, b.high) + tolerance;
          if (level >= lo && level <= hi) return true;
        }
        // Path cross through level since prev
        if (prevPrice != null && crossesLevel(prevPrice, price, level)) return true;
        return false;
      };

      const nowTouch = levels.some(touches);
      if (!nowTouch) return false;
      // Edge: if prevPrice also "touched" all the same way without bars, skip re-fire
      // unless we just arrived. When prev was already within tolerance of any level, treat as wasTrue.
      if (prevPrice == null) return true;
      const wasTouch = levels.some((level) => Math.abs(prevPrice - level) <= tolerance);
      return becomesTrue(true, wasTouch);
    }
    case 'pine_condition': {
      // External runner sets params.condition each tick, or value/op/threshold.
      if (typeof params.condition === 'boolean') {
        const nowTrue = params.condition === true;
        // Pine conditions are usually edge-set by the runner; fire while true
        // once until cooldown. Without prev state on the boolean, fire when true
        // and not in cooldown (cooldown already checked).
        // Prefer edge via params.prevCondition when provided.
        if (typeof params.prevCondition === 'boolean') {
          return becomesTrue(nowTrue, params.prevCondition);
        }
        return nowTrue;
      }
      const value = numParam(params, 'value');
      const threshold = numParam(params, 'threshold');
      if (value == null || threshold == null) return false;
      const op = String(params.op ?? '>');
      let nowTrue = false;
      switch (op) {
        case '>':
          nowTrue = value > threshold;
          break;
        case '>=':
          nowTrue = value >= threshold;
          break;
        case '<':
          nowTrue = value < threshold;
          break;
        case '<=':
          nowTrue = value <= threshold;
          break;
        case '==':
        case '=':
          nowTrue = value === threshold;
          break;
        case '!=':
          nowTrue = value !== threshold;
          break;
        case 'cross':
        case 'crosses': {
          const prevVal = numParam(params, 'prevValue');
          if (prevVal == null) return false;
          return crossesLevel(prevVal, value, threshold);
        }
        default:
          return false;
      }
      const prevValue = numParam(params, 'prevValue');
      if (prevValue == null) return nowTrue;
      let wasTrue = false;
      switch (op) {
        case '>':
          wasTrue = prevValue > threshold;
          break;
        case '>=':
          wasTrue = prevValue >= threshold;
          break;
        case '<':
          wasTrue = prevValue < threshold;
          break;
        case '<=':
          wasTrue = prevValue <= threshold;
          break;
        case '==':
        case '=':
          wasTrue = prevValue === threshold;
          break;
        case '!=':
          wasTrue = prevValue !== threshold;
          break;
      }
      return becomesTrue(nowTrue, wasTrue);
    }
    default:
      return false;
  }
}

/**
 * Evaluate all alerts; pure regarding storage/network.
 *
 * Updates the internal prevPrice map for `ctx.symbol` after evaluation
 * (so successive calls get correct cross detection). Pass `ctx.prevPrice`
 * to override the map for this call without reading it first.
 *
 * @returns alerts that fired (shallow copies with `lastFiredAt` set to `now`)
 */
export function evaluateAlerts(
  alerts: readonly Alert[],
  ctx: EvaluateContext,
  now: number = ctx.time ?? Date.now(),
): Alert[] {
  const sym = normalizeSymbol(ctx.symbol);
  const prev =
    ctx.prevPrice !== undefined ? ctx.prevPrice : prevPriceBySymbol.get(sym);

  const fired: Alert[] = [];
  for (const alert of alerts) {
    if (evaluateOne(alert, ctx, prev, now)) {
      fired.push({
        ...alert,
        params: { ...alert.params },
        lastFiredAt: now,
      });
    }
  }

  // Advance cross-tracking after all alerts see the same prev
  if (Number.isFinite(ctx.price) && sym) {
    prevPriceBySymbol.set(sym, ctx.price);
  }

  return fired;
}

/**
 * Apply fired results onto a mutable alert list (update lastFiredAt by id).
 * Returns a new array (does not mutate input items unless `mutate` is true).
 */
export function applyFired(
  alerts: readonly Alert[],
  fired: readonly Alert[],
  mutate = false,
): Alert[] {
  if (fired.length === 0) {
    return mutate ? (alerts as Alert[]) : alerts.map((a) => ({ ...a, params: { ...a.params } }));
  }
  const byId = new Map(fired.map((f) => [f.id, f.lastFiredAt]));
  if (mutate) {
    for (const a of alerts as Alert[]) {
      const t = byId.get(a.id);
      if (t != null) a.lastFiredAt = t;
    }
    return alerts as Alert[];
  }
  return alerts.map((a) => {
    const t = byId.get(a.id);
    if (t == null) return { ...a, params: { ...a.params } };
    return { ...a, params: { ...a.params }, lastFiredAt: t };
  });
}
