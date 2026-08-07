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
 * Pure formatters for price alerts — safe to unit-test without DOM/store.
 */

import type { Alert, AlertKind } from './types';

const KIND_LABELS: Record<AlertKind, string> = {
  price_cross: 'crosses',
  price_above: 'above',
  price_below: 'below',
  pct_change: 'pct change',
  drawing_touch: 'drawing touch',
  pine_condition: 'pine',
  onchain_tvl_spike: 'TVL spike',
  onchain_event: 'on-chain event',
};

/** Kinds exposed in the Alerts panel create form. */
export const ALERT_KINDS: readonly AlertKind[] = [
  'price_cross',
  'price_above',
  'price_below',
] as const;

/** Short human label for an alert kind. */
export function formatAlertKind(kind: AlertKind | string): string {
  return KIND_LABELS[kind as AlertKind] || String(kind);
}

function formatNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

/**
 * Condition summary for list rows, e.g. `crosses 42,000` or `pct change ±2%`.
 */
export function formatAlertCondition(
  alert: Pick<Alert, 'kind' | 'params'>,
): string {
  const params = alert.params || {};
  const kind = alert.kind;
  const label = formatAlertKind(kind);

  const priceRaw = params.price;
  const price =
    typeof priceRaw === 'number'
      ? priceRaw
      : typeof priceRaw === 'string'
        ? Number(priceRaw)
        : NaN;

  if (kind === 'price_cross' || kind === 'price_above' || kind === 'price_below') {
    if (Number.isFinite(price)) return `${label} ${formatNum(price)}`;
    return `${label} —`;
  }

  if (kind === 'pct_change') {
    const pctRaw = params.pct;
    const pct =
      typeof pctRaw === 'number'
        ? pctRaw
        : typeof pctRaw === 'string'
          ? Number(pctRaw)
          : NaN;
    const dir = typeof params.direction === 'string' ? params.direction : 'both';
    const pctStr = Number.isFinite(pct) ? formatNum(pct) : '—';
    if (dir === 'up') return `${label} ≥+${pctStr}%`;
    if (dir === 'down') return `${label} ≤−${pctStr}%`;
    return `${label} ±${pctStr}%`;
  }

  if (kind === 'drawing_touch') {
    if (Number.isFinite(price)) return `${label} @ ${formatNum(price)}`;
    return label;
  }

  if (kind === 'pine_condition') {
    const op = params.op != null ? String(params.op) : '';
    const thr = params.threshold;
    if (op && thr != null) return `${label} ${op} ${thr}`;
    return label;
  }

  if (kind === 'onchain_tvl_spike' || kind === 'onchain_event') {
    const minRaw = params.minAbsPct;
    const min =
      typeof minRaw === 'number'
        ? minRaw
        : typeof minRaw === 'string'
          ? Number(minRaw)
          : 10;
    const minStr = Number.isFinite(min) ? formatNum(min) : '10';
    const dir = typeof params.direction === 'string' ? params.direction : 'both';
    const protocol =
      params.protocolId != null && String(params.protocolId).trim()
        ? String(params.protocolId).trim()
        : '';
    let dirLabel = '±';
    if (dir === 'up') dirLabel = '≥+';
    else if (dir === 'down') dirLabel = '≤−';
    const base = `${label} ${dirLabel}${minStr}%`;
    if (protocol) return `${base} · ${protocol}`;
    if (kind === 'onchain_event' && params.eventType != null) {
      return `${base} · ${String(params.eventType)}`;
    }
    return base;
  }

  return label;
}

/** Format last-fired epoch ms (or null/undefined) for list rows. */
export function formatLastFired(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts) || ts <= 0) return 'Never';
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
