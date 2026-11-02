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
 */

import type { ChartFullPayload, HostRunStatusPayload } from '../protocol';

export type ChartNotifyMessage =
  | { type: 'chart.full'; payload: ChartFullPayload }
  | { type: 'host.run.status'; payload: HostRunStatusPayload };

export type ChartNotifyHandler = (message: ChartNotifyMessage) => void;

const listeners = new Set<ChartNotifyHandler>();

/** Subscribe; returns disposer. Never throws. */
export function subscribeChartNotify(handler: ChartNotifyHandler): { dispose(): void } {
  listeners.add(handler);
  return {
    dispose() {
      listeners.delete(handler);
    },
  };
}

/** Fan-out to all subscribers. Swallows per-listener errors. */
export function notifyChart(message: ChartNotifyMessage): void {
  try {
    for (const handler of [...listeners]) {
      try {
        handler(message);
      } catch {
        // listener may be disposing
      }
    }
  } catch {
    // hostile Set iteration — ignore
  }
}

/** Test helper — clear all listeners. */
export function resetChartBusForTests(): void {
  listeners.clear();
}
