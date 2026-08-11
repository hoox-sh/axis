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
 * Status pane — Connection HUD + status message + optional strategy PnL.
 *
 * FloatableShell id `statusbar` (title **Status**). Close via panel chrome or
 * topbar; re-open from topbar **Status** or command palette.
 *
 * @module ui/StatusBar
 */

import { Component, Show, createMemo } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { Icons } from './icons';
import type { RunResult } from '../indicators/runner';
import { buildStrategyReport, formatMoney } from '../results/strategy';
import { ConnectionHud } from './ConnectionHud';
import { HooxLoader } from './HooxLoader';
import { FloatableShell } from './panels/FloatableShell';

const PANEL_ID = 'statusbar' as const;

const STATUS_COLORS: Record<string, string> = {
  ready: 'text-accent-2',
  loading: 'text-orange',
  running: 'text-accent',
  error: 'text-red',
  connected: 'text-accent-2',
  disconnected: 'text-text-faint',
};

/** Dockable status / HUD strip. */
export const StatusBar: Component = () => {
  const color = () => STATUS_COLORS[store.status] || 'text-text-dim';

  const strategySummary = createMemo(() => {
    const r = store.lastRun as RunResult | null;
    if (!r?.events?.length) return null;
    const rep = buildStrategyReport(r.events as never[], store.bars);
    if (!rep.stats.trades) return null;
    return rep.stats;
  });

  return (
    <Show when={isPanelOpen(PANEL_ID)}>
      <FloatableShell
        id={PANEL_ID}
        title="Status"
        testId="axis-statusbar"
        class="min-h-0"
      >
        <div
          class="flex items-center gap-[var(--ui-gap-sm)] px-2.5 py-0.5 bg-bg-panel text-[0.85em] text-text-dim min-h-[var(--ui-statusbar-min-h)] h-full overflow-x-auto"
          role="status"
        >
          <ConnectionHud />

          <span class="flex-1 min-w-2" />

          <span
            class={`flex items-center gap-1.5 min-w-0 max-w-[42vw] ${color()}`}
            data-testid="axis-status-message"
          >
            {(store.status === 'running' || store.status === 'loading') && (
              <HooxLoader size="xs" class="flex-shrink-0" />
            )}
            {store.status === 'error' && <Icons.alert class="text-red flex-shrink-0" />}
            {store.status === 'ready' && (
              <Icons.activity class="text-accent-2 flex-shrink-0" />
            )}
            <span class="truncate">{store.statusMessage}</span>
          </span>

          <Show when={strategySummary()}>
            {(stats) => (
              <span
                class={`text-[0.85em] font-mono tracking-tight tabular-nums flex-shrink-0 ${
                  stats().totalPnl >= 0 ? 'text-accent-2' : 'text-red'
                }`}
                title="Closed trades from last run"
              >
                {stats().trades} trades · {formatMoney(stats().totalPnl)}
              </span>
            )}
          </Show>

          <span class="text-text-faint font-mono text-[10px] tracking-tight flex-shrink-0 tabular-nums">
            {store.bars.length} bars · {store.scripts.length} ind · {store.panes.length} panes
          </span>
        </div>
      </FloatableShell>
    </Show>
  );
};
