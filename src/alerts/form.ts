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
 * Pure Alerts-panel form validation → {@link AlertCreateInput}.
 *
 * @module alerts/form
 */

import { isAllowedWebhookUrl } from './webhook';
import { DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT } from './engine';
import { formatAlertKind } from './format';
import { PINE_COMPARE_OPS, type PineCompareOp } from './indicator';
import type { AlertCreateInput, AlertKind, AlertParams } from './types';

export type PctDirection = 'both' | 'up' | 'down';
export type OnchainDirection = 'both' | 'up' | 'down';

/** Draft fields collected by the Alerts panel create form. */
export type AlertFormDraft = {
  name: string;
  symbol: string;
  kind: AlertKind;
  /** Fallback symbol when the draft symbol is empty (active chart). */
  chartSymbol: string;
  interval?: string;
  bindInterval?: boolean;
  price: string;
  pct: string;
  pctDirection: PctDirection;
  drawingId: string;
  drawingPrices: number[];
  tolerance: string;
  indicatorId: string;
  indicatorName: string;
  plotKey: string;
  op: string;
  threshold: string;
  /** `alert` | `alertcondition` | `any` for {@link pine_alert}. */
  pineSource?: string;
  pineTitle?: string;
  protocolId: string;
  minAbsPct: string;
  direction: OnchainDirection;
  webhookUrl: string;
  l2WebhookUrl: string;
  notifyBrowser: boolean;
  cooldownSec: string;
};

export type AlertFormOk = { ok: true; input: AlertCreateInput };
export type AlertFormErr = { ok: false; error: string };
export type AlertFormResult = AlertFormOk | AlertFormErr;

export function isPriceKind(k: AlertKind): boolean {
  return k === 'price_cross' || k === 'price_above' || k === 'price_below';
}

export function isOnchainKind(k: AlertKind): boolean {
  return k === 'onchain_tvl_spike' || k === 'onchain_event';
}

export function isPctKind(k: AlertKind): boolean {
  return k === 'pct_change';
}

export function isDrawingKind(k: AlertKind): boolean {
  return k === 'drawing_touch';
}

export function isIndicatorKind(k: AlertKind): boolean {
  return k === 'pine_condition' || k === 'pine_alert';
}

export function isPineAlertKind(k: AlertKind): boolean {
  return k === 'pine_alert';
}

export function isPlotConditionKind(k: AlertKind): boolean {
  return k === 'pine_condition';
}

function parsePositiveNumber(raw: string, label: string): { ok: true; value: number } | AlertFormErr {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: `Enter a valid ${label} greater than 0.` };
  }
  return { ok: true, value: n };
}

function parseNonNegativeNumber(
  raw: string,
  label: string,
): { ok: true; value: number } | AlertFormErr {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative number.` };
  }
  return { ok: true, value: n };
}

function optionalWebhook(raw: string, label: string): { ok: true; url?: string } | AlertFormErr {
  const url = raw.trim();
  if (!url) return { ok: true };
  if (!isAllowedWebhookUrl(url)) {
    return {
      ok: false,
      error: `${label} must be https, with no credentials or private/loopback host.`,
    };
  }
  return { ok: true, url };
}

function parseCooldownMs(raw: string): { ok: true; cooldownMs?: number } | AlertFormErr {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true };
  const sec = Number(trimmed);
  if (!Number.isFinite(sec) || sec < 0) {
    return { ok: false, error: 'Cooldown must be a non-negative number of seconds.' };
  }
  if (sec === 0) return { ok: true };
  return { ok: true, cooldownMs: Math.round(sec * 1000) };
}

function pineOp(raw: string): PineCompareOp {
  const op = raw.trim();
  return (PINE_COMPARE_OPS as readonly string[]).includes(op)
    ? (op as PineCompareOp)
    : '>';
}

/**
 * Validate a create-form draft and produce {@link AlertCreateInput}.
 */
export function buildAlertFromDraft(draft: AlertFormDraft): AlertFormResult {
  const kind = draft.kind;
  const cooldown = parseCooldownMs(draft.cooldownSec);
  if (!cooldown.ok) return cooldown;
  const webhook = optionalWebhook(draft.webhookUrl, 'Webhook URL');
  if (!webhook.ok) return webhook;
  const l2 = optionalWebhook(draft.l2WebhookUrl, 'L2 webhook URL');
  if (!l2.ok) return l2;

  const intervalBound = draft.bindInterval ? (draft.interval || '').trim() : '';
  const interval = intervalBound || undefined;

  const base = {
    webhookUrl: webhook.url,
    l2WebhookUrl: l2.url,
    notifyBrowser: draft.notifyBrowser !== false,
    cooldownMs: cooldown.cooldownMs,
    interval,
    enabled: true,
  };

  if (isOnchainKind(kind)) {
    const pid = draft.protocolId.trim();
    if (!pid) return { ok: false, error: 'Enter a protocol id (e.g. aave).' };
    const pctRaw = draft.minAbsPct.trim() || String(DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT);
    const pct = Number(pctRaw);
    if (!Number.isFinite(pct) || pct <= 0) {
      return { ok: false, error: 'minAbsPct must be a number greater than 0.' };
    }
    const dir: OnchainDirection =
      draft.direction === 'up' || draft.direction === 'down' ? draft.direction : 'both';
    const sym = (draft.symbol.trim() || pid || 'onchain').toLowerCase();
    const dirMark = dir === 'both' ? '±' : dir === 'up' ? '≥+' : '≤−';
    const name =
      draft.name.trim() || `${pid} ${formatAlertKind(kind)} ${dirMark}${pct}%`;
    const params: AlertParams = { protocolId: pid, minAbsPct: pct, direction: dir };
    return {
      ok: true,
      input: { ...base, name, symbol: sym, kind, params },
    };
  }

  const chart = (draft.chartSymbol || 'BTCUSDT').toUpperCase();
  const sym = (draft.symbol.trim() || chart).toUpperCase();

  if (isPriceKind(kind)) {
    const p = parsePositiveNumber(draft.price, 'price');
    if (!p.ok) return p;
    const name = draft.name.trim() || `${sym} ${formatAlertKind(kind)} ${p.value}`;
    return {
      ok: true,
      input: { ...base, name, symbol: sym, kind, params: { price: p.value } },
    };
  }

  if (isPctKind(kind)) {
    const pct = parsePositiveNumber(draft.pct, 'percent');
    if (!pct.ok) return pct;
    const dir: PctDirection =
      draft.pctDirection === 'up' || draft.pctDirection === 'down'
        ? draft.pctDirection
        : 'both';
    const dirMark = dir === 'both' ? '±' : dir === 'up' ? '≥+' : '≤−';
    const name = draft.name.trim() || `${sym} ${dirMark}${pct.value}%`;
    return {
      ok: true,
      input: {
        ...base,
        name,
        symbol: sym,
        kind: 'pct_change',
        params: { pct: pct.value, direction: dir },
      },
    };
  }

  if (isDrawingKind(kind)) {
    const prices = (draft.drawingPrices || []).filter((n) => Number.isFinite(n));
    if (!draft.drawingId.trim() && prices.length === 0) {
      const fallback = parsePositiveNumber(draft.price, 'drawing price');
      if (!fallback.ok) {
        return { ok: false, error: 'Pick a drawing or enter a price level.' };
      }
      prices.push(fallback.value);
    }
    if (prices.length === 0) {
      return { ok: false, error: 'That drawing has no price levels (vertical lines cannot alert).' };
    }
    let tolerance = 0;
    if (draft.tolerance.trim()) {
      const t = parseNonNegativeNumber(draft.tolerance, 'Tolerance');
      if (!t.ok) return t;
      tolerance = t.value;
    }
    const firstPrice = prices[0];
    const name =
      draft.name.trim() ||
      (firstPrice != null
        ? `${sym} drawing @ ${firstPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}`
        : `${sym} drawing`);
    const params: AlertParams = {
      prices,
      price: firstPrice,
      tolerance,
    };
    if (draft.drawingId.trim()) params.drawingId = draft.drawingId.trim();
    return {
      ok: true,
      input: { ...base, name, symbol: sym, kind: 'drawing_touch', params },
    };
  }

  if (isPineAlertKind(kind)) {
    const sourceRaw = (draft.pineSource || 'any').trim().toLowerCase();
    const source =
      sourceRaw === 'alertcondition' || sourceRaw === 'alert' ? sourceRaw : 'any';
    const title = (draft.pineTitle || '').trim();
    const indicatorId = draft.indicatorId.trim();
    const indName = draft.indicatorName.trim() || 'script';
    let auto = `${indName} `;
    if (source === 'alertcondition') auto += title ? `alertcondition ${title}` : 'alertcondition()';
    else if (source === 'alert') auto += 'alert()';
    else auto += 'alert() / alertcondition()';
    const params: AlertParams = { source };
    if (indicatorId) params.indicatorId = indicatorId;
    if (title) params.title = title;
    return {
      ok: true,
      input: {
        ...base,
        name: draft.name.trim() || auto,
        symbol: sym,
        kind: 'pine_alert',
        params,
      },
    };
  }

  if (isPlotConditionKind(kind)) {
    const indicatorId = draft.indicatorId.trim();
    const plotKey = draft.plotKey.trim();
    if (!indicatorId) return { ok: false, error: 'Pick an applied indicator.' };
    if (!plotKey) return { ok: false, error: 'Pick a plot to watch.' };
    const thr = Number(draft.threshold);
    if (!Number.isFinite(thr)) {
      return { ok: false, error: 'Enter a numeric threshold for the plot condition.' };
    }
    const op = pineOp(draft.op);
    const indName = draft.indicatorName.trim() || 'indicator';
    const name = draft.name.trim() || `${indName} ${plotKey} ${op} ${thr}`;
    return {
      ok: true,
      input: {
        ...base,
        name,
        symbol: sym,
        kind: 'pine_condition',
        params: { indicatorId, plotKey, op, threshold: thr },
      },
    };
  }

  return { ok: false, error: `Unsupported alert kind: ${kind}` };
}
