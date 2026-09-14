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
 * Pine `alert()` / `alertcondition()` events from an engine run.
 *
 * PYNE interpret returns `alerts: [{ message, freq, bar_index, time, title?,
 * source }]` plus optional `alert_conditions`. This module is pure: parse,
 * match armed book rows, watermark so a full backtest does not spam.
 *
 * @module alerts/pine
 */

import { isInCooldown } from './engine';
import type { Alert } from './types';

/** Pine source that calls `alert(` / `alertcondition(` (same scan PYNE host uses). */
export const PINE_ALERT_CALL_RE = /\balert(?:condition)?\s*\(/;

/** True when a script should export `alert()` / `alertcondition()` firings. */
export function scriptHasPineAlertCalls(source: string | null | undefined): boolean {
  return PINE_ALERT_CALL_RE.test(String(source || ''));
}

export type PineAlertSource = 'alert' | 'alertcondition';

/** One firing from `alert()` or a true `alertcondition()`. */
export type PineAlertEvent = {
  message: string;
  freq?: string;
  bar_index?: number | null;
  time?: number | null;
  title?: string | null;
  source: PineAlertSource;
};

export type PineAlertEvalContext = {
  /** Applied script id this run belongs to (optional match). */
  indicatorId?: string;
  /** Last bar index of the OHLCV window (unix-bar, 0-based). */
  lastBarIndex?: number;
  now?: number;
};

export type PineAlertFired = {
  alert: Alert;
  event: PineAlertEvent;
};

function asFiniteInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function asSource(raw: unknown): PineAlertSource {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (s === 'alertcondition' || s === 'alert_condition' || s === 'condition') {
    return 'alertcondition';
  }
  return 'alert';
}

function pushEvent(out: PineAlertEvent[], ev: PineAlertEvent): void {
  const message = String(ev.message || '').trim();
  if (!message && !ev.title) return;
  out.push({
    message: message || String(ev.title || 'Alert'),
    source: ev.source,
    freq: ev.freq,
    bar_index: ev.bar_index ?? null,
    time: ev.time ?? null,
    title: ev.title ?? null,
  });
}

function parseOneAlert(raw: unknown): PineAlertEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const message =
    o.message != null
      ? String(o.message)
      : o.alert_message != null
        ? String(o.alert_message)
        : '';
  const title = o.title != null && String(o.title).trim() ? String(o.title) : null;
  if (!message.trim() && !title) return null;
  const bar = asFiniteInt(o.bar_index ?? o.barIndex);
  const time = asFiniteInt(o.time ?? o.bar_time ?? o.barTime);
  return {
    message: message.trim() || title || 'Alert',
    freq: o.freq != null ? String(o.freq) : undefined,
    bar_index: bar,
    time,
    title,
    source: asSource(o.source),
  };
}

/** Parse PYNE `alerts` array (or a single object). */
export function parsePineAlertEvents(raw: unknown): PineAlertEvent[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: PineAlertEvent[] = [];
  for (const item of list) {
    const ev = parseOneAlert(item);
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * True `alertcondition()` rows. Only those with `condition === true` become
 * firings (the engine also copies them into `alerts` with source=alertcondition;
 * we keep this as a fallback when `alerts` is empty).
 */
export function parsePineAlertConditions(raw: unknown): PineAlertEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: PineAlertEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.condition !== true && o.condition !== 1) continue;
    const ev = parseOneAlert({ ...o, source: 'alertcondition' });
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Strategy events that carry `alert_message` (strategy.entry/exit/close).
 */
export function pineAlertsFromStrategyEvents(events: unknown): PineAlertEvent[] {
  if (!Array.isArray(events)) return [];
  const out: PineAlertEvent[] = [];
  for (const item of events) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const msg = o.alert_message ?? o.alertMessage;
    if (msg == null || String(msg).trim() === '') continue;
    const bar = asFiniteInt(o.bar_index ?? o.barIndex);
    const time = asFiniteInt(o.time ?? o.bar_time ?? o.barTime);
    pushEvent(out, {
      message: String(msg),
      source: 'alert',
      title: o.id != null ? String(o.id) : null,
      bar_index: bar,
      time,
      freq: 'once_per_bar',
    });
  }
  return out;
}

/** Merge alerts + true conditions + strategy alert_message from a run payload. */
export function collectPineAlertEvents(result: {
  alerts?: unknown;
  alert_conditions?: unknown;
  events?: unknown;
  meta?: Record<string, unknown> | null;
}): PineAlertEvent[] {
  const fromMetaAlerts =
    result.meta && typeof result.meta === 'object' ? result.meta.alerts : undefined;
  const fromMetaCond =
    result.meta && typeof result.meta === 'object'
      ? result.meta.alert_conditions
      : undefined;
  const fired = [
    ...parsePineAlertEvents(result.alerts ?? fromMetaAlerts),
    ...parsePineAlertConditions(result.alert_conditions ?? fromMetaCond),
    ...pineAlertsFromStrategyEvents(result.events),
  ];
  // Dedupe identical source+title+message+bar_index (engine may double-emit
  // alertcondition into both `alerts` and `alert_conditions`).
  const seen = new Set<string>();
  const out: PineAlertEvent[] = [];
  for (const ev of fired) {
    const key = `${ev.source}|${ev.title || ''}|${ev.message}|${ev.bar_index ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

function wantSource(alert: Alert): 'alert' | 'alertcondition' | 'any' {
  const raw = alert.params?.source != null ? String(alert.params.source).trim().toLowerCase() : '';
  if (raw === 'alertcondition' || raw === 'alert_condition') return 'alertcondition';
  if (raw === 'any' || raw === '*') return 'any';
  if (raw === 'alert') return 'alert';
  if (alert.kind === 'pine_alert') return 'any';
  return 'alert';
}

/** True when this book row is armed against Pine `alert()` / `alertcondition()`. */
export function isPineScriptAlert(alert: Alert): boolean {
  if (!alert.enabled) return false;
  if (alert.kind === 'pine_alert') return true;
  if (alert.kind !== 'pine_condition') return false;
  const src = alert.params?.source != null ? String(alert.params.source).trim().toLowerCase() : '';
  return src === 'alert' || src === 'alertcondition' || src === 'any' || src === '*';
}

export function eventMatchesPineAlert(
  alert: Alert,
  event: PineAlertEvent,
  ctx: PineAlertEvalContext = {},
): boolean {
  if (!isPineScriptAlert(alert)) return false;
  const wantId =
    alert.params?.indicatorId != null ? String(alert.params.indicatorId).trim() : '';
  if (wantId && ctx.indicatorId && wantId !== ctx.indicatorId) return false;
  const want = wantSource(alert);
  if (want !== 'any' && event.source !== want) return false;
  const title =
    alert.params?.title != null ? String(alert.params.title).trim() : '';
  if (title) {
    const evTitle = (event.title || '').trim();
    if (evTitle) {
      if (evTitle !== title) return false;
    } else if (event.message.trim() !== title) {
      return false;
    }
  }
  return true;
}

function eventBarIndex(event: PineAlertEvent): number | null {
  return event.bar_index != null && Number.isFinite(event.bar_index)
    ? event.bar_index
    : null;
}

/**
 * Evaluate armed Pine script alerts against a run's events (pure).
 *
 * Historical dump guard: only events on the **last bar** of the window fire,
 * and only when `bar_index > params.lastBarIndex` (watermark). The first
 * evaluate after create fires the current last bar once, then advances the
 * watermark so live re-runs of the same bar do not repeat.
 */
export function evaluatePineAlertEventsPure(
  alerts: readonly Alert[],
  events: readonly PineAlertEvent[],
  ctx: PineAlertEvalContext = {},
): PineAlertFired[] {
  const now = ctx.now ?? Date.now();
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  if (!Array.isArray(events) || events.length === 0) return [];

  let lastBar = ctx.lastBarIndex;
  if (lastBar == null || !Number.isFinite(lastBar)) {
    let max = -1;
    for (const e of events) {
      const b = eventBarIndex(e);
      if (b != null && b > max) max = b;
    }
    lastBar = max >= 0 ? max : undefined;
  }

  const fired: PineAlertFired[] = [];
  for (const alert of alerts) {
    if (!isPineScriptAlert(alert)) continue;
    if (isInCooldown(alert, now)) continue;

    const watermark = asFiniteInt(alert.params?.lastBarIndex);
    let best: PineAlertEvent | null = null;
    for (const ev of events) {
      if (!eventMatchesPineAlert(alert, ev, ctx)) continue;
      const bi = eventBarIndex(ev);
      if (lastBar != null && bi != null && bi < lastBar) continue;
      if (watermark != null && bi != null && bi <= watermark) continue;
      best = ev;
    }
    if (!best) continue;

    const nextBar = eventBarIndex(best) ?? lastBar ?? watermark ?? 0;
    fired.push({
      alert: {
        ...alert,
        params: {
          ...alert.params,
          lastBarIndex: nextBar,
          lastMessage: best.message,
        },
        lastFiredAt: now,
      },
      event: best,
    });
  }
  return fired;
}

/** Unique alertcondition titles from a run (panel picker). */
export function listPineAlertTitles(events: readonly PineAlertEvent[]): {
  source: PineAlertSource;
  title: string;
}[] {
  const seen = new Set<string>();
  const out: { source: PineAlertSource; title: string }[] = [];
  for (const ev of events) {
    const title = (ev.title || '').trim();
    if (!title) continue;
    const key = `${ev.source}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: ev.source, title });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}
