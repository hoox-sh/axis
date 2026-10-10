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

/** localStorage key for persisted cross-tracking prices (F6: no re-fire on reload). */
const PREV_PRICE_LS_KEY = 'axis.alerts.prevPrices.v1';

/** Cap persisted symbols (keeps the blob tiny). */
const PREV_PRICE_MAX = 100;

/** Default minimum ms between fires for alerts created without `cooldownMs` (F6). */
export const DEFAULT_ALERT_COOLDOWN_MS = 60_000;

let prevPricesRestored = false;

function restorePrevPrices(): void {
  if (prevPricesRestored) return;
  prevPricesRestored = true;
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) return;
    const raw = localStorage.getItem(PREV_PRICE_LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        prevPriceBySymbol.set(normalizeSymbol(k), v);
      }
    }
  } catch {
    /* corrupt / unavailable — start fresh */
  }
}

function persistPrevPrices(): void {
  try {
    if (typeof localStorage === 'undefined' || localStorage == null) return;
    const entries = Array.from(prevPriceBySymbol.entries()).slice(-PREV_PRICE_MAX);
    const obj: Record<string, number> = {};
    for (const [k, v] of entries) obj[k] = v;
    localStorage.setItem(PREV_PRICE_LS_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode — cross-tracking stays memory-only */
  }
}

/** Normalize symbol for matching (trim + upper). */
export function normalizeSymbol(symbol: string): string {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

/** Read last evaluated price for a symbol (undefined if never evaluated). */
export function getPrevPrice(symbol: string): number | undefined {
  restorePrevPrices();
  return prevPriceBySymbol.get(normalizeSymbol(symbol));
}

/** Store last evaluated price for a symbol. */
export function setPrevPrice(symbol: string, price: number): void {
  if (!Number.isFinite(price)) return;
  restorePrevPrices();
  prevPriceBySymbol.set(normalizeSymbol(symbol), price);
  persistPrevPrices();
}

/** Clear cross-tracking state (tests / full reset). */
export function clearPrevPrices(): void {
  prevPriceBySymbol.clear();
  prevPricesRestored = true;
  try {
    if (typeof localStorage !== 'undefined' && localStorage != null) {
      localStorage.removeItem(PREV_PRICE_LS_KEY);
    }
  } catch {
    /* ignore */
  }
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

/** Relative tolerance for float price equality (≈ 1e-12 of the magnitude). */
const REL_EPS = 1e-12;

/**
 * Float-safe equality for prices / plot values. Exact `===` misses levels that
 * differ only by rounding (e.g. a computed drawing level vs a tick).
 */
export function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= REL_EPS * scale;
}

/**
 * True when price path from `prev` → `price` crosses `level`
 * (either direction). Touching exactly after being off-level counts.
 * Starting on the level does not fire until the price leaves and re-crosses.
 * Requires a defined previous price; first tick never crosses.
 */
export function crossesLevel(prev: number, price: number, level: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(price) || !Number.isFinite(level)) {
    return false;
  }
  if (approxEqual(prev, price)) return false;
  // Equality uses the float-safe comparison so rounding never flips a side.
  const prevOn = approxEqual(prev, level);
  const nowOn = approxEqual(price, level);
  const wasBelow = !prevOn && prev < level;
  const wasAbove = !prevOn && prev > level;
  const nowBelow = !nowOn && price < level;
  const nowAbove = !nowOn && price > level;

  if (wasBelow && (nowAbove || nowOn)) return true;
  if (wasAbove && (nowBelow || nowOn)) return true;
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
      const drawingId =
        params.drawingId != null && String(params.drawingId).trim()
          ? String(params.drawingId).trim()
          : '';
      if (drawingId && ctx.drawingPricesById) {
        const live = ctx.drawingPricesById[drawingId];
        if (Array.isArray(live)) {
          for (const p of live) {
            if (typeof p === 'number' && Number.isFinite(p)) levels.push(p);
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
      let value = numParam(params, 'value');
      let prevValue = numParam(params, 'prevValue');
      const threshold = numParam(params, 'threshold');
      if (value == null && ctx.plotSamples) {
        const ind =
          params.indicatorId != null ? String(params.indicatorId).trim() : '';
        const plot = params.plotKey != null ? String(params.plotKey).trim() : '';
        if (ind && plot) {
          const sample = ctx.plotSamples[`${ind}:${plot}`];
          if (sample && Number.isFinite(sample.value)) {
            value = sample.value;
            if (
              prevValue == null &&
              sample.prevValue != null &&
              Number.isFinite(sample.prevValue)
            ) {
              prevValue = sample.prevValue;
            }
          }
        }
      }
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
          nowTrue = approxEqual(value, threshold);
          break;
        case '!=':
          nowTrue = !approxEqual(value, threshold);
          break;
        case 'cross':
        case 'crosses': {
          if (prevValue == null) return false;
          return crossesLevel(prevValue, value, threshold);
        }
        default:
          return false;
      }
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
          wasTrue = approxEqual(prevValue, threshold);
          break;
        case '!=':
          wasTrue = !approxEqual(prevValue, threshold);
          break;
      }
      return becomesTrue(nowTrue, wasTrue);
    }
    // On-chain kinds are evaluated against event batches via
    // {@link evaluateOnchainEventAlertsPure}, not price ticks.
    case 'onchain_tvl_spike':
    case 'onchain_event':
      return false;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// On-chain TVL / event alerts (batch evaluation — not price ticks)
// ---------------------------------------------------------------------------

/** Default |pct| threshold when alert.params.minAbsPct is omitted. */
export const DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT = 10;

/**
 * Minimal event shape for on-chain alert evaluation (mirrors EventPoint
 * without importing the on-chain module — keeps alerts pure).
 */
export type OnchainEvalEvent = {
  time: number;
  type: string;
  title?: string;
  severity?: string;
  price?: number;
  payload?: Record<string, unknown>;
};

/** Context for batch on-chain alert evaluation. */
export type OnchainEvalContext = {
  /** Protocol id from the attachment / instrument (matched to params.protocolId). */
  protocolId?: string;
  /** Evaluation clock (epoch ms). Default Date.now(). */
  now?: number;
};

/** Result of a pure on-chain batch evaluation. */
export type OnchainEvalFired = {
  alert: Alert;
  /** Event that caused the fire (most recent match). */
  event: OnchainEvalEvent;
};

function normalizeId(s: string | undefined | null): string {
  return String(s || '')
    .trim()
    .toLowerCase();
}

/** True for synthetic TVL spike/drop event types. */
export function isOnchainTvlEventType(type: string): boolean {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  return t === 'tvl_spike' || t === 'tvl_drop';
}

/**
 * Resolve absolute % change from an event payload (`absPct` or `|pctChange|`).
 */
export function eventAbsPct(event: OnchainEvalEvent): number | null {
  const p = event.payload;
  if (!p || typeof p !== 'object') return null;
  const abs = p.absPct;
  if (typeof abs === 'number' && Number.isFinite(abs)) return Math.abs(abs);
  if (typeof abs === 'string' && abs.trim() !== '') {
    const n = Number(abs);
    if (Number.isFinite(n)) return Math.abs(n);
  }
  const pct = p.pctChange;
  if (typeof pct === 'number' && Number.isFinite(pct)) return Math.abs(pct);
  if (typeof pct === 'string' && pct.trim() !== '') {
    const n = Number(pct);
    if (Number.isFinite(n)) return Math.abs(n);
  }
  return null;
}

/**
 * Whether event direction matches alert params.direction.
 * `up` → tvl_spike (or positive pctChange); `down` → tvl_drop; `both` → either.
 */
export function eventMatchesDirection(
  event: OnchainEvalEvent,
  direction: string | undefined,
): boolean {
  const dir = (direction || 'both').toLowerCase();
  if (dir === 'both' || dir === '') return true;
  const type = String(event.type || '')
    .trim()
    .toLowerCase();
  if (dir === 'up') {
    if (type === 'tvl_spike') return true;
    if (type === 'tvl_drop') return false;
    const pct = event.payload?.pctChange;
    if (typeof pct === 'number') return pct >= 0;
    return true;
  }
  if (dir === 'down') {
    if (type === 'tvl_drop') return true;
    if (type === 'tvl_spike') return false;
    const pct = event.payload?.pctChange;
    if (typeof pct === 'number') return pct < 0;
    return true;
  }
  return true;
}

/**
 * Protocol filter: when alert.params.protocolId is set, it must match
 * ctx.protocolId or event.payload.protocolId (case-insensitive).
 * Unset protocolId matches any.
 */
export function eventMatchesProtocol(
  alert: Alert,
  event: OnchainEvalEvent,
  ctx: OnchainEvalContext,
): boolean {
  const want = normalizeId(
    alert.params?.protocolId != null
      ? String(alert.params.protocolId)
      : '',
  );
  if (!want) return true;
  const fromCtx = normalizeId(ctx.protocolId);
  if (fromCtx === want) return true;
  const fromPayload =
    event.payload && event.payload.protocolId != null
      ? normalizeId(String(event.payload.protocolId))
      : '';
  return fromPayload === want;
}

/**
 * Pure predicate: does this single event satisfy an on-chain alert?
 * Does not check cooldown or lastEventTime watermark.
 */
export function eventMatchesOnchainAlert(
  alert: Alert,
  event: OnchainEvalEvent,
  ctx: OnchainEvalContext = {},
): boolean {
  if (!alert.enabled) return false;
  if (alert.kind !== 'onchain_tvl_spike' && alert.kind !== 'onchain_event') {
    return false;
  }
  if (!event || !Number.isFinite(Number(event.time))) return false;
  const type = String(event.type || '').trim();
  if (!type) return false;

  if (!eventMatchesProtocol(alert, event, ctx)) return false;

  if (alert.kind === 'onchain_tvl_spike') {
    if (!isOnchainTvlEventType(type)) return false;
    if (!eventMatchesDirection(event, alert.params?.direction as string | undefined)) {
      return false;
    }
    const minAbs =
      numParam(alert.params ?? {}, 'minAbsPct') ?? DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT;
    if (minAbs < 0) return false;
    const abs = eventAbsPct(event);
    if (abs == null) return false;
    return abs >= minAbs;
  }

  // onchain_event — optional type filter + optional minAbsPct when payload has %
  const wantType =
    alert.params?.eventType != null
      ? String(alert.params.eventType).trim().toLowerCase()
      : '';
  if (wantType && type.toLowerCase() !== wantType) return false;
  if (!eventMatchesDirection(event, alert.params?.direction as string | undefined)) {
    return false;
  }
  const minAbs = numParam(alert.params ?? {}, 'minAbsPct');
  if (minAbs != null && minAbs > 0) {
    const abs = eventAbsPct(event);
    if (abs == null || abs < minAbs) return false;
  }
  return true;
}

/** Params key: per-protocol watermark map `{ [protocolKey]: unixSec }`. */
export const ONCHAIN_WATERMARK_MAP_KEY = 'lastEventTimeByProtocol';

/** Map key used for a legacy single `lastEventTime` (applies to every protocol). */
const LEGACY_WATERMARK_KEY = '*';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Per-protocol watermark (unix seconds) for an on-chain alert, or `null`.
 * Uses the per-protocol map when present; otherwise falls back to the legacy
 * `params.lastEventTime` (kept so pre-existing alerts still behave).
 */
export function onchainWatermark(alert: Alert, protocolKey: string): number | null {
  const map = alert.params?.[ONCHAIN_WATERMARK_MAP_KEY];
  if (isRecord(map)) {
    const exact = map[protocolKey];
    if (typeof exact === 'number' && Number.isFinite(exact)) return exact;
    const wildcard = map[LEGACY_WATERMARK_KEY];
    if (typeof wildcard === 'number' && Number.isFinite(wildcard)) return wildcard;
    return null;
  }
  return numParam(alert.params ?? {}, 'lastEventTime');
}

/** Protocol key for an event: batch context first, then `payload.protocolId`. */
export function onchainEventProtocolKey(
  event: OnchainEvalEvent,
  ctx: OnchainEvalContext,
): string {
  const fromCtx = normalizeId(ctx.protocolId);
  if (fromCtx) return fromCtx;
  return event.payload && event.payload.protocolId != null
    ? normalizeId(String(event.payload.protocolId))
    : '';
}

/**
 * Evaluate on-chain alerts against a batch of events (pure).
 *
 * For each matching enabled alert (not in cooldown), fires at most once per
 * batch on the **most recent** matching event beyond the watermark of its
 * protocol. Watermarks are kept per protocol (`params.lastEventTimeByProtocol`)
 * so one protocol's events cannot hide another protocol's older events.
 * Matched protocols are consumed; `params.lastEventTime` mirrors the fire.
 *
 * @returns shallow alert copies with `lastFiredAt` and updated watermarks
 *   plus the event that triggered each fire.
 */
export function evaluateOnchainEventAlertsPure(
  alerts: readonly Alert[],
  events: readonly OnchainEvalEvent[],
  ctx: OnchainEvalContext = {},
): OnchainEvalFired[] {
  const now = ctx.now ?? Date.now();
  if (!Array.isArray(events) || events.length === 0) return [];
  if (!Array.isArray(alerts) || alerts.length === 0) return [];

  const sorted = events
    .filter((e) => e && Number.isFinite(Number(e.time)))
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));

  const fired: OnchainEvalFired[] = [];

  for (const alert of alerts) {
    if (!alert.enabled) continue;
    if (alert.kind !== 'onchain_tvl_spike' && alert.kind !== 'onchain_event') {
      continue;
    }
    if (isInCooldown(alert, now)) continue;

    // Latest matching event per protocol key beyond that key's watermark.
    const latestByKey = new Map<string, OnchainEvalEvent>();
    for (const ev of sorted) {
      const key = onchainEventProtocolKey(ev, ctx);
      const watermark = onchainWatermark(alert, key);
      if (watermark != null && Number(ev.time) <= watermark) continue;
      if (!eventMatchesOnchainAlert(alert, ev, ctx)) continue;
      latestByKey.set(key, ev); // ascending sort → last match per key is most recent
    }
    if (latestByKey.size === 0) continue;

    let best: OnchainEvalEvent | null = null;
    for (const ev of latestByKey.values()) {
      if (!best || Number(ev.time) > Number(best.time)) best = ev;
    }
    if (!best) continue;

    const prevMap: Record<string, unknown> = isRecord(alert.params?.[ONCHAIN_WATERMARK_MAP_KEY])
      ? { ...(alert.params[ONCHAIN_WATERMARK_MAP_KEY] as Record<string, unknown>) }
      : {};
    if (!isRecord(alert.params?.[ONCHAIN_WATERMARK_MAP_KEY])) {
      // Migrate legacy single watermark so other protocols keep their floor.
      const legacy = numParam(alert.params ?? {}, 'lastEventTime');
      if (legacy != null) prevMap[LEGACY_WATERMARK_KEY] = legacy;
    }
    for (const [key, ev] of latestByKey) {
      prevMap[key] = Number(ev.time);
    }

    fired.push({
      alert: {
        ...alert,
        params: {
          ...alert.params,
          [ONCHAIN_WATERMARK_MAP_KEY]: prevMap,
          lastEventTime: Number(best.time),
        },
        lastFiredAt: now,
      },
      event: best,
    });
  }

  return fired;
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
  restorePrevPrices();
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
    persistPrevPrices();
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
