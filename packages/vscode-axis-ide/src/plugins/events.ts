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
 * Tiny in-process bus for active-plugin changes (chart HUD / run path).
 * Never throws.
 */

import type { ActivePluginsV1 } from './types';

const PLUGIN_HUD_KEYS = ['source', 'stream', 'engine', 'storage'] as const;

export type ChartPluginIds = {
  source?: string;
  stream?: string;
  engine?: string;
  storage?: string;
};

export type ActivePluginsListener = (active: ActivePluginsV1) => void;

const listeners = new Set<ActivePluginsListener>();

/** Subscribe; returns disposer. Never throws. */
export function subscribeActivePlugins(
  fn: ActivePluginsListener,
): { dispose(): void } {
  listeners.add(fn);
  return {
    dispose() {
      listeners.delete(fn);
    },
  };
}

/** Fan-out to subscribers. Never throws. */
export function notifyActivePlugins(active: ActivePluginsV1): void {
  for (const fn of [...listeners]) {
    try {
      fn(active);
    } catch {
      // listener may be disposing
    }
  }
}

/**
 * Pick HUD plugin ids (source/stream/engine/storage). Unknown keys ignored.
 * Never throws.
 */
export function chartPluginsFromActive(active: ActivePluginsV1): ChartPluginIds {
  const out: ChartPluginIds = {};
  if (active == null || typeof active !== 'object' || Array.isArray(active)) {
    return out;
  }
  const rec = active as Record<string, unknown>;
  for (const key of PLUGIN_HUD_KEYS) {
    try {
      const v = rec[key];
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (trimmed) out[key] = trimmed;
    } catch {
      // hostile getter on this kind
    }
  }
  return out;
}

/** Test helper — clear listeners. */
export function resetActivePluginsEventsForTests(): void {
  listeners.clear();
}
