// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bottom 26px instrument strip — Live + HUD capsules + truncated status +
 * optional strategy PnL from `store.lastRun`.
 *
 * Classic fixed footer chrome (no FloatableShell title bar). Visibility is
 * gated by panel chrome `statusbar` (topbar **Status** / command palette).
 *
 * Bar readouts: left is the chart window (click to edit the Rolling window
 * display count); right is the DSM dataset depth (click opens the Dataset
 * manager modal, not the DSM panel).
 *
 * @module ui/StatusBar
 */

import {
  type Component,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import {
  store,
  isPanelOpen,
  setStore,
  persist,
  clampRollingWindowBars,
  ROLLING_WINDOW_MIN,
  ROLLING_WINDOW_MAX,
} from '../store';
import { Icons } from './icons';
import type { RunResult } from '../indicators/runner';
import { buildStrategyReport, formatMoney } from '../results/strategy';
import { ConnectionHud } from './ConnectionHud';
import { HooxLoader } from './HooxLoader';
import { CachedDatasetsModal } from './CachedDatasetsModal';
import { peekDataset, subscribeDatasets } from '../data/dataset-store';
import { formatBarCount } from './bar-count';

/**
 * Bars in the active Data Source Manager dataset (memory mirror).
 *
 * The chart holds only the rolling window (Settings → Rolling window) while
 * the DSM dataset can grow up to Settings → Historical bars via deep backfill
 * (`DSM_MAX_BARS_PER_JOB` is 50k), so `{store.bars.length}`
 * alone understates how much data actually exists. Falls back to the chart
 * count whenever the mirror is cold, so the strip is never blank.
 */
function useDatasetBarCount(): () => number {
  const [count, setCount] = createSignal(0);
  const read = () => {
    const mirrored = peekDataset(store.source, store.symbol, store.interval);
    const next = mirrored?.length ?? 0;
    setCount((prev) => (prev === next ? prev : next));
  };
  const off = subscribeDatasets(read);
  // Store-driven changes (symbol / interval / source switch) also matter.
  createMemo(() => {
    store.source;
    store.symbol;
    store.interval;
    read();
  });
  onCleanup(off);
  return count;
}

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
  const datasetBars = useDatasetBarCount();
  const color = () => STATUS_COLORS[store.status] || 'text-text-dim';
  const [editingChart, setEditingChart] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [datasetsOpen, setDatasetsOpen] = createSignal(false);
  let inputEl: HTMLInputElement | undefined;

  const beginEdit = () => {
    setDraft(String(store.bars.length));
    setEditingChart(true);
    queueMicrotask(() => inputEl?.select());
  };

  const commitEdit = () => {
    if (!editingChart()) return;
    setEditingChart(false);
    const raw = Number(String(draft()).trim());
    if (!Number.isFinite(raw) || raw <= 0) return;
    const next = clampRollingWindowBars(Math.floor(raw));
    void (async () => {
      try {
        setStore('rollingWindowBars', next);
        persist();
        const { applyCachedToChart } = await import(
          '../data/data-source-manager'
        );
        const ok = await applyCachedToChart(
          store.source,
          store.symbol,
          store.interval,
          { maxBars: next },
        );
        if (!ok && store.bars.length > next) {
          // No dataset to slice from — trim the painted window in place.
          const { loadBars } = await import('../store');
          const { getManager, setDataToChart } = await import(
            '../chart/manager-access'
          );
          const trimmed = store.bars.slice(store.bars.length - next);
          loadBars(trimmed, store.symbol, store.interval, store.exchange);
          const manager = getManager();
          if (manager) {
            try {
              setDataToChart(trimmed, { fit: false });
            } catch {
              /* paint is best-effort */
            }
          }
        }
      } catch {
        /* edit apply is best-effort */
      }
    })();
  };

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
          <Show
            when={editingChart()}
            fallback={
              <button
                type="button"
                class="hover:text-accent tabular-nums"
                title={`Chart bars — click to edit display count (Rolling window, ${ROLLING_WINDOW_MIN}–${ROLLING_WINDOW_MAX})`}
                data-testid="axis-statusbar-bars"
                onClick={beginEdit}
              >
                {store.bars.length} bars
              </button>
            }
          >
            <input
              ref={(el) => {
                inputEl = el;
              }}
              type="number"
              class="sc-input h-5 w-20 px-1 py-0 text-[11px] font-mono tabular-nums"
              min={ROLLING_WINDOW_MIN}
              max={ROLLING_WINDOW_MAX}
              step={100}
              value={draft()}
              aria-label="Chart bars to display (Rolling window)"
              data-testid="axis-statusbar-bars-input"
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingChart(false);
                }
              }}
              onBlur={() => commitEdit()}
            />
          </Show>
          <Show when={datasetBars() > 0 && datasetBars() !== store.bars.length}>
            <button
              type="button"
              class="hover:text-accent tabular-nums"
              title="Bars in the Data Source Manager dataset — click to open the Dataset manager"
              data-testid="axis-statusbar-dataset"
              onClick={() => setDatasetsOpen(true)}
            >
              · dataset {formatBarCount(datasetBars())}
            </button>
          </Show>
          <span>· {store.scripts.length} scripts · {store.panes.length} panes</span>
        </span>
        <CachedDatasetsModal
          open={datasetsOpen()}
          onClose={() => setDatasetsOpen(false)}
        />
      </div>
    </Show>
  );
};
