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
 * AXIS alerts engine — public API.
 *
 * Local-first CRUD + evaluation + webhook/browser delivery.
 * UI (AlertsPanel) is owned elsewhere; this module has no Solid dependency.
 *
 * @module alerts
 */

import {
  applyFired,
  clearPrevPrices,
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  evaluateAlerts as evaluateAlertsPure,
} from './engine';
import {
  clearAlertsStorage,
  loadAlerts,
  removeAlert as storageRemove,
  saveAlerts,
  upsertAlert,
} from './storage';
import { deliverAlert } from './webhook';
import type {
  Alert,
  AlertCreateInput,
  AlertUpdatePatch,
  EvaluateContext,
} from './types';

export type {
  Alert,
  AlertCreateInput,
  AlertKind,
  AlertParams,
  AlertUpdatePatch,
  AlertsStoreV1,
  EvaluateBar,
  EvaluateContext,
  WebhookPayload,
} from './types';

export {
  ALERTS_STORAGE_KEY,
  clearAlertsStorage,
  loadAlerts,
  parseAlert,
  parseAlertsBlob,
  saveAlerts,
} from './storage';

export {
  applyFired,
  becomesTrue,
  clearPrevPrices,
  crossesLevel,
  DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT,
  evaluateOne,
  evaluateOnchainEventAlertsPure,
  eventAbsPct,
  eventMatchesDirection,
  eventMatchesOnchainAlert,
  eventMatchesProtocol,
  getPrevPrice,
  isInCooldown,
  isOnchainTvlEventType,
  normalizeSymbol,
  numParam,
  resolveBasePrice,
  setPrevPrice,
} from './engine';

export type {
  OnchainEvalContext,
  OnchainEvalEvent,
  OnchainEvalFired,
} from './engine';

export {
  buildWebhookPayload,
  deliverAlert,
  fireWebhook,
  notifyBrowserAlert,
} from './webhook';

export {
  ALERT_KINDS,
  formatAlertCondition,
  formatAlertKind,
  formatLastFired,
} from './format';

/** Request browser Notification permission (UI gesture). */
export async function requestNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    return await Notification.requestPermission();
  } catch {
    return Notification.permission || 'denied';
  }
}

/** Current Notification permission without prompting. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * POST a test payload to a webhook URL (manual panel action).
 * Uses the same JSON shape as a real fire when alert meta is provided.
 */
export async function testWebhook(
  url: string,
  opts?: {
    fetchImpl?: typeof fetch;
    payload?: import('./types').WebhookPayload;
  },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const target = (url || '').trim();
  if (!target) return { ok: false, error: 'No webhook URL' };
  try {
    void new URL(target);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  const payload =
    opts?.payload ??
    ({
      alertId: 'test',
      name: 'AXIS webhook test',
      symbol: 'TEST',
      price: 0,
      kind: 'price_cross',
      firedAt: Date.now(),
    } as import('./types').WebhookPayload);
  const fetchImpl = opts?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg || 'Request failed' };
  }
}

/** Generate a unique alert id. */
export function generateAlertId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return `alert_${rand}`;
}

/**
 * Create and persist a new alert.
 * Defaults: `enabled: true`, `notifyBrowser: true`, empty `params` if omitted.
 */
export function createAlert(input: AlertCreateInput): Alert {
  const now = Date.now();
  const alert: Alert = {
    id: input.id ?? generateAlertId(),
    name: input.name,
    enabled: input.enabled !== false,
    symbol: input.symbol,
    kind: input.kind,
    params: { ...(input.params ?? {}) },
    createdAt: input.createdAt ?? now,
  };
  if (input.interval != null) alert.interval = input.interval;
  if (input.webhookUrl != null) alert.webhookUrl = input.webhookUrl;
  if (input.notifyBrowser != null) alert.notifyBrowser = input.notifyBrowser;
  else alert.notifyBrowser = true;
  if (input.cooldownMs != null) alert.cooldownMs = input.cooldownMs;

  upsertAlert(alert);
  return { ...alert, params: { ...alert.params } };
}

/** Direction filter for on-chain TVL spike / drop alerts. */
export type OnchainAlertDirection = 'both' | 'up' | 'down';

/** Input for {@link createOnchainTvlSpikeAlert}. */
export type CreateOnchainTvlSpikeAlertInput = {
  /** Protocol slug (e.g. `aave`). Required. */
  protocolId: string;
  /** Minimum |%| move to fire. Default {@link DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT}. */
  minAbsPct?: number;
  /** `both` (default) | `up` (spike only) | `down` (drop only). */
  direction?: OnchainAlertDirection;
  /** Optional display name; default derived from protocol + threshold. */
  name?: string;
  /**
   * Alert symbol field (list/filter). Defaults to `protocolId`, else `"onchain"`.
   */
  symbol?: string;
  webhookUrl?: string;
  cooldownMs?: number;
  enabled?: boolean;
  notifyBrowser?: boolean;
};

/**
 * Create and persist an `onchain_tvl_spike` alert for a protocol TVL move.
 *
 * Convenience wrapper over {@link createAlert} with sensible defaults for
 * the on-chain data plane.
 */
export function createOnchainTvlSpikeAlert(
  input: CreateOnchainTvlSpikeAlertInput,
): Alert {
  const protocolId = String(input.protocolId ?? '').trim();
  if (!protocolId) {
    throw new Error('protocolId is required');
  }
  const minAbsPct =
    input.minAbsPct != null && Number.isFinite(input.minAbsPct)
      ? Number(input.minAbsPct)
      : DEFAULT_ONCHAIN_TVL_MIN_ABS_PCT;
  const direction: OnchainAlertDirection =
    input.direction === 'up' || input.direction === 'down' ? input.direction : 'both';
  const symbol = (input.symbol?.trim() || protocolId || 'onchain').toLowerCase();
  const name =
    input.name?.trim() ||
    `${protocolId} TVL spike ±${minAbsPct}%${direction === 'both' ? '' : ` ${direction}`}`;

  return createAlert({
    name,
    symbol,
    kind: 'onchain_tvl_spike',
    params: {
      protocolId,
      minAbsPct,
      direction,
    },
    webhookUrl: input.webhookUrl,
    cooldownMs: input.cooldownMs,
    enabled: input.enabled,
    notifyBrowser: input.notifyBrowser,
  });
}

/**
 * Patch an existing alert by id. Returns the updated alert, or null if missing.
 */
export function updateAlert(id: string, patch: AlertUpdatePatch): Alert | null {
  const list = loadAlerts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return null;
  const prev = list[idx]!;
  const next: Alert = {
    ...prev,
    ...patch,
    id: prev.id,
    createdAt: prev.createdAt,
    params: patch.params != null ? { ...patch.params } : { ...prev.params },
  };
  // Avoid wiping optional fields with explicit undefined from spread of empty patch keys
  if (patch.interval === undefined && prev.interval !== undefined) {
    next.interval = prev.interval;
  }
  list[idx] = next;
  saveAlerts(list);
  return { ...next, params: { ...next.params } };
}

/** Delete an alert by id. Returns true if it existed. */
export function deleteAlert(id: string): boolean {
  return storageRemove(id);
}

/** List all persisted alerts (newest-last; storage order). */
export function listAlerts(): Alert[] {
  return loadAlerts();
}

export type EvaluateAlertsOptions = {
  /** When false, skip webhook + Notification (still updates lastFiredAt). Default true. */
  deliver?: boolean;
  /** Override fetch for webhooks (tests). */
  fetchImpl?: typeof fetch;
  /** Override Notification (tests). */
  NotificationImpl?: typeof Notification;
  /** Evaluation clock (epoch ms). */
  now?: number;
};

/**
 * Evaluate all stored alerts for the given market context.
 *
 * - Fires edge/cross logic via the pure engine
 * - Persists `lastFiredAt` on fired alerts
 * - Optionally delivers webhook + browser notification
 *
 * @returns the alerts that fired (with updated `lastFiredAt`)
 */
export async function evaluateAlerts(
  ctx: EvaluateContext,
  opts: EvaluateAlertsOptions = {},
): Promise<Alert[]> {
  const now = opts.now ?? ctx.time ?? Date.now();
  const deliver = opts.deliver !== false;
  const alerts = loadAlerts();
  const fired = evaluateAlertsPure(alerts, ctx, now);
  if (fired.length === 0) return [];

  const updated = applyFired(alerts, fired, false);
  saveAlerts(updated);

  if (deliver) {
    await Promise.all(
      fired.map((a) =>
        deliverAlert(a, ctx.price, a.lastFiredAt ?? now, {
          fetchImpl: opts.fetchImpl,
          NotificationImpl: opts.NotificationImpl,
        }),
      ),
    );
  }

  return fired;
}

/**
 * Synchronous evaluate against an explicit list (no I/O).
 * Prefer for unit tests and batch replay. Updates engine prevPrice map.
 */
export function evaluateAlertsSync(
  alerts: readonly Alert[],
  ctx: EvaluateContext,
  now?: number,
): Alert[] {
  return evaluateAlertsPure(alerts, ctx, now ?? ctx.time ?? Date.now());
}

/** Reset engine + storage (tests only). */
export function _resetAlertsForTests(): void {
  clearPrevPrices();
  clearAlertsStorage();
}
