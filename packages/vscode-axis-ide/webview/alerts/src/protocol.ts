// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alerts studio webview ↔ host messages.
 * Snapshot shape comes from alerts-studio-model (no vscode).
 */

import {
  ALERTS_REMOVED,
  ALERTS_TITLE_REQUIRED,
  buildAlertsSnapshot,
  type AlertsSnapshot,
} from '../../../src/views/alerts-studio-model';

export { ALERTS_REMOVED, ALERTS_TITLE_REQUIRED };
export type { AlertsSnapshot };

export function encodeAlertsReady(): { type: 'alerts.ready' } {
  return { type: 'alerts.ready' };
}

export function encodeAlertsAdd(
  title: string,
  condition?: string,
): { type: 'alerts.add'; title: string; condition?: string } {
  const msg: { type: 'alerts.add'; title: string; condition?: string } = {
    type: 'alerts.add',
    title,
  };
  if (condition) msg.condition = condition;
  return msg;
}

export function encodeAlertsToggle(id: string): { type: 'alerts.toggle'; id: string } {
  return { type: 'alerts.toggle', id };
}

export function encodeAlertsRemove(id: string): { type: 'alerts.remove'; id: string } {
  return { type: 'alerts.remove', id };
}

export type HostDecode =
  | { ok: true; type: 'alerts.set'; snapshot: AlertsSnapshot }
  | { ok: true; type: 'alerts.flash'; text: string }
  | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never-throw decode of host postMessage data. */
export function decodeHostMessage(raw: unknown): HostDecode {
  try {
    if (!isRecord(raw)) return { ok: false };
    const type = raw.type;
    if (type === 'alerts.set') {
      const payload = raw.payload;
      const entries = isRecord(payload) ? payload.entries : undefined;
      return { ok: true, type: 'alerts.set', snapshot: buildAlertsSnapshot(entries) };
    }
    if (type === 'alerts.flash') {
      const text = typeof raw.text === 'string' ? raw.text : '';
      return { ok: true, type: 'alerts.flash', text };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
