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
 * Bottom 26px instrument strip — Live + HUD capsules + truncated status +
 * optional strategy PnL from `store.lastRun`.
 *
 * Classic fixed footer chrome (no FloatableShell title bar). Visibility is
 * gated by panel chrome `statusbar` (topbar **Status** / command palette).
 *
 * @module ui/StatusBar
 */

import { type Component, Show, createMemo, untrack } from 'solid-js';
import { store, isPanelOpen, setDataSourcePanelOpen } from '../store';
import { Icons } from './icons';
import type { RunResult } from '../indicators/runner';
import { buildStrategyReport, formatMoney } from '../results/strategy';
import { ConnectionHud } from './ConnectionHud';
import { McpHud } from './McpHud';
import { HooxLoader } from './HooxLoader';

const STATUS_COLORS: Record<string, string> = {
  ready: 'text-accent-2',
  loading: 'text-orange',
  running: 'text-accent',
  error: 'text-red',
  connected: 'text-accent-2',
  disconnected: 'text-text-faint',
};

/** Fixed footer chrome under the workspace (when Status pane is open). */
export const StatusBar: Component = () => {
  const color = () => STATUS_COLORS[store.status] || 'text-text-dim';

  const strategySummary = createMemo(() => {
    const r = store.lastRun as RunResult | null;
    if (!r?.events?.length) return null;
    // Recompute on history reload / fill-mode prefs — not on every live tick path-update
    void store.chartDataGen;
    void store.strategyUi?.slippageNextOpen;
    const bars = untrack(() => store.bars);
    const rep = buildStrategyReport(r.events as never[], bars, {
      fillMode: store.strategyUi?.slippageNextOpen ? 'next_open' : 'close',
    });
    if (!rep.stats.trades) return null;
    return rep.stats;
  });

  return (
    <Show when={isPanelOpen('statusbar')}>
      <div
        class="axis-statusbar flex-shrink-0"
        data-testid="axis-statusbar"
        role="status"
      >
        <ConnectionHud />
        <McpHud />

        <span
          class={`flex items-center gap-1.5 min-w-0 max-w-[28vw] text-[11px] ${color()}`}
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

        <span class="flex-1 min-w-2" />

        <Show when={strategySummary()}>
          {(stats) => (
            <span
              class={`text-[11px] font-mono tracking-tight tabular-nums flex-shrink-0 ${
                stats().totalPnl >= 0 ? 'text-accent-2' : 'text-red'
              }`}
              title="Closed trades from last run"
            >
              {stats().trades} · {formatMoney(stats().totalPnl)}
            </span>
          )}
        </Show>

        <span class="text-text-faint font-mono text-[11px] tracking-tight flex-shrink-0 tabular-nums inline-flex items-center gap-1">
          <button
            type="button"
            class="hover:text-accent tabular-nums"
            title="Open Data Source Manager"
            data-testid="axis-statusbar-bars"
            onClick={() => setDataSourcePanelOpen(true)}
          >
            {store.bars.length} bars
          </button>
          <span>· {store.scripts.length} ind · {store.panes.length} panes</span>
        </span>
      </div>
    </Show>
  );
};
