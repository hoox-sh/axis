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
 * Host → Logs webview. Local `logs.set` only — not axis.webview.v1.
 */

import { filterLogs, type LogRow } from '../../../src/views/logs-messages';

export type { LogRow };

export type LogsViewState = {
  rows: LogRow[];
  runId: string | null;
  status: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Decode `logs.set`. Invalid envelopes return null. */
export function decodeLogsSet(raw: unknown): LogsViewState | null {
  if (!isRecord(raw) || raw.type !== 'logs.set') return null;
  const payload = isRecord(raw.payload) ? raw.payload : raw;
  return {
    rows: filterLogs(payload.rows, 'all'),
    runId: textOrNull(payload.runId),
    status: textOrNull(payload.status),
  };
}

export function encodeLogsReveal(line: number): { type: 'logs.reveal'; line: number } {
  return { type: 'logs.reveal', line };
}

export function encodeLogsReady(ts = Date.now()): {
  type: 'logs.ready';
  payload: Record<string, never>;
  ts: number;
} {
  return { type: 'logs.ready', payload: {}, ts };
}
