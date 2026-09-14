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
 * Glue: engine run → Pine `alert()` / `alertcondition()` → alerts book.
 *
 * Call {@link evaluatePineAlertsFromRun} after a successful strategy /
 * indicator apply. Failures are swallowed so a webhook error cannot break Run.
 *
 * @module alerts/pine-bridge
 */

import { deliverAlert } from './webhook';
import { loadAlerts, saveAlerts } from './storage';
import {
  collectPineAlertEvents,
  evaluatePineAlertEventsPure,
  type PineAlertEvalContext,
} from './pine';
import type { Alert } from './types';

export type EvaluatePineAlertsOpts = PineAlertEvalContext & {
  deliver?: boolean;
  fetchImpl?: typeof fetch;
  NotificationImpl?: typeof Notification;
  symbol?: string;
  price?: number;
};

/**
 * Evaluate stored Pine script alerts against a run payload.
 * @returns alerts that fired (with updated lastFiredAt / lastBarIndex)
 */
export async function evaluatePineAlertsFromRun(
  result: {
    alerts?: unknown;
    alert_conditions?: unknown;
    events?: unknown;
    meta?: Record<string, unknown> | null;
  } | null | undefined,
  opts: EvaluatePineAlertsOpts = {},
): Promise<Alert[]> {
  if (!result) return [];
  const events = collectPineAlertEvents(result);
  if (events.length === 0) return [];

  const now = opts.now ?? Date.now();
  const deliver = opts.deliver !== false;
  const alerts = loadAlerts();
  const results = evaluatePineAlertEventsPure(alerts, events, {
    indicatorId: opts.indicatorId,
    lastBarIndex: opts.lastBarIndex,
    now,
  });
  if (results.length === 0) return [];

  const byId = new Map(results.map((r) => [r.alert.id, r.alert]));
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

  const price =
    opts.price != null && Number.isFinite(opts.price) ? opts.price : 0;

  if (deliver) {
    await Promise.all(
      results.map((r) =>
        deliverAlert(r.alert, price, r.alert.lastFiredAt ?? now, {
          fetchImpl: opts.fetchImpl,
          NotificationImpl: opts.NotificationImpl,
          message: r.event.message,
        }),
      ),
    );
  }

  return results.map((r) => r.alert);
}

/**
 * Fire-and-forget from the indicator runner. Never throws.
 */
export function notifyPineAlertsFromRun(
  result: {
    alerts?: unknown;
    alert_conditions?: unknown;
    events?: unknown;
    meta?: Record<string, unknown> | null;
  } | null | undefined,
  opts?: EvaluatePineAlertsOpts,
): void {
  void evaluatePineAlertsFromRun(result, opts).catch(() => {
    /* delivery / storage must not break Run */
  });
}
