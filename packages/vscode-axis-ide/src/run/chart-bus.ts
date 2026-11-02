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
 * Minimal host→chart notify bus so RunOrchestrator can paint open panels
 * without importing the custom editor module (keeps unit tests vscode-free).
 *
 * `seriesKey` lets the editor filter panels so a run for one chart does not
 * overwrite another open `*.axis.json` webview.
 *
 * Last successful `chart.full` per seriesKey is retained so a panel that
 * opens / re-handshakes after a run can replay the paint (retainContextWhenHidden
 * is false — hide→show would otherwise wipe run overlays back to mock-only).
 */

import type { ChartFullPayload, HostRunStatusPayload } from '../protocol';

export type ChartFullNotify = {
  type: 'chart.full';
  payload: ChartFullPayload;
  seriesKey: string;
};

export type ChartNotifyMessage =
  | ChartFullNotify
  | { type: 'host.run.status'; payload: HostRunStatusPayload; seriesKey?: string };

export type ChartNotifyHandler = (message: ChartNotifyMessage) => void;

const listeners = new Set<ChartNotifyHandler>();
/** Last chart.full per seriesKey (run paint replay). */
const lastFullBySeries = new Map<string, ChartFullNotify>();

/** Subscribe; returns disposer. Never throws. */
export function subscribeChartNotify(handler: ChartNotifyHandler): { dispose(): void } {
  listeners.add(handler);
  return {
    dispose() {
      listeners.delete(handler);
    },
  };
}

/** Fan-out to all subscribers. Remembers last chart.full per seriesKey. */
export function notifyChart(message: ChartNotifyMessage): void {
  if (message.type === 'chart.full' && message.seriesKey) {
    lastFullBySeries.set(message.seriesKey, message);
  }
  for (const handler of [...listeners]) {
    try {
      handler(message);
    } catch {
      // listener may be disposing
    }
  }
}

/**
 * Last run `chart.full` for a seriesKey, if any.
 * Used by the chart editor after handshake to replay paint.
 */
export function getLastChartFull(seriesKey: string): ChartFullNotify | undefined {
  const key = String(seriesKey ?? '');
  if (!key) return undefined;
  return lastFullBySeries.get(key);
}

/** Test helper — clear listeners + last-full cache. */
export function resetChartBusForTests(): void {
  listeners.clear();
  lastFullBySeries.clear();
}
