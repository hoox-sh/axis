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
 * Glue between the on-chain events plane and the alerts engine.
 *
 * Call {@link evaluateOnchainEventAlerts} after TVL-spike events are loaded
 * (or whenever the events plane changes) to fire matching
 * `onchain_tvl_spike` / `onchain_event` alerts via the same webhook +
 * browser-notification paths as price alerts.
 *
 * @module onchain/alerts-bridge
 */

import {
  deliverAlert,
  evaluateOnchainEventAlertsPure,
  loadAlerts,
  saveAlerts,
  type Alert,
  type EvaluateAlertsOptions,
  type OnchainEvalContext,
  type OnchainEvalEvent,
} from '../alerts/index';
import type { EventPoint } from './types';

export type EvaluateOnchainEventAlertsOpts = OnchainEvalContext &
  Pick<EvaluateAlertsOptions, 'deliver' | 'fetchImpl' | 'NotificationImpl' | 'now'>;

/**
 * Map manager {@link EventPoint}s into the minimal shape the alerts engine
 * understands (identity for well-formed points).
 */
export function toOnchainEvalEvents(
  events: readonly EventPoint[] | null | undefined,
): OnchainEvalEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const out: OnchainEvalEvent[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const time = Number(e.time);
    if (!Number.isFinite(time)) continue;
    const type = String(e.type || '').trim();
    if (!type) continue;
    const next: OnchainEvalEvent = { time, type };
    if (e.title != null && String(e.title)) next.title = String(e.title);
    if (e.severity != null) next.severity = String(e.severity);
    if (e.price != null && Number.isFinite(Number(e.price))) {
      next.price = Number(e.price);
    }
    if (e.payload && typeof e.payload === 'object') {
      next.payload = e.payload;
    }
    out.push(next);
  }
  return out;
}

function eventAbsPctOrZero(event: OnchainEvalEvent): number {
  const p = event.payload;
  if (p && typeof p.absPct === 'number' && Number.isFinite(p.absPct)) {
    return p.absPct;
  }
  if (p && typeof p.pctChange === 'number' && Number.isFinite(p.pctChange)) {
    return Math.abs(p.pctChange);
  }
  return 0;
}

/**
 * Evaluate stored on-chain alerts against a batch of events.
 *
 * - Pure match/cooldown/watermark via {@link evaluateOnchainEventAlertsPure}
 * - Persists `lastFiredAt` + `params.lastEventTime` on fires
 * - Optionally delivers webhook + browser Notification (default on)
 *
 * Safe to call fire-and-forget from the manager after
 * {@link loadTvlSpikeEventsFromAttachment} / {@link setOnchainEvents}.
 *
 * @returns alerts that fired (with updated timestamps)
 */
export async function evaluateOnchainEventAlerts(
  events: readonly EventPoint[] | OnchainEvalEvent[] | null | undefined,
  opts: EvaluateOnchainEventAlertsOpts = {},
): Promise<Alert[]> {
  const evalEvents = toOnchainEvalEvents(events as EventPoint[]);
  if (evalEvents.length === 0) return [];

  const now = opts.now ?? Date.now();
  const deliver = opts.deliver !== false;
  const alerts = loadAlerts();
  const results = evaluateOnchainEventAlertsPure(alerts, evalEvents, {
    protocolId: opts.protocolId,
    now,
  });
  if (results.length === 0) return [];

  const firedAlerts = results.map((r) => r.alert);
  const byId = new Map(firedAlerts.map((a) => [a.id, a]));
  const updated = alerts.map((a) => {
    const f = byId.get(a.id);
    if (!f) return { ...a, params: { ...a.params } };
    return {
      ...a,
      params: { ...f.params },
      lastFiredAt: f.lastFiredAt,
    };
  });
  saveAlerts(updated);

  if (deliver) {
    await Promise.all(
      results.map((r) => {
        const price =
          r.event.price != null && Number.isFinite(r.event.price)
            ? r.event.price
            : eventAbsPctOrZero(r.event);
        return deliverAlert(r.alert, price, r.alert.lastFiredAt ?? now, {
          fetchImpl: opts.fetchImpl,
          NotificationImpl: opts.NotificationImpl,
        });
      }),
    );
  }

  return firedAlerts;
}

/**
 * Fire-and-forget helper for manager/UI: evaluate alerts after events load.
 * Swallows errors so chart/manager paths never throw on alert delivery.
 */
export function notifyOnchainEventsLoaded(
  events: readonly EventPoint[] | null | undefined,
  opts?: Pick<EvaluateOnchainEventAlertsOpts, 'protocolId' | 'now' | 'deliver'>,
): void {
  void evaluateOnchainEventAlerts(events, opts).catch(() => {
    /* delivery / storage failures must not break events plane */
  });
}
