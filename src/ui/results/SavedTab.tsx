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
 * Results → Saved runs subpage.
 *
 * Lists the runs the active storage engine persisted for the focused script,
 * with search, sort, multi-select delete, and restore. The parent owns the
 * `listRunResults` resource (the header badge shows its count); this subpage
 * owns everything the list itself does.
 *
 * Extracted from `ResultsModal.tsx`.
 *
 * @module ui/results/SavedTab
 */

import { type JSX, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { appendLog } from '../../store';
import { formatMoney } from '../../results/strategy';
import { sortSavedRuns, SAVED_SORTS, type SavedSort } from '../../results/overlay';
import { removeRunResult, type ResultMeta } from '../../storage/service';
import { MAX_RESULTS_PER_SCRIPT } from '../../storage/local';
import { Icons } from '../icons';
import { Spinner } from '../Spinner';
import { StudioHint } from '../studio';
import { confirmDestructive } from '../confirm-destructive';
import {
  defaultSavedLabel,
  formatSavedAt,
  formatSavedDuration,
  formatSavedPct,
  formatSavedPf,
  readSavedStats,
  savedRunMarket,
} from './format';

/** Props for {@link SavedTab}. */
export interface SavedTabProps {
  /** Saved-run metadata for the focused script (already loaded by the parent). */
  runs: () => ResultMeta[];
  /** True while the parent's resource is fetching. */
  loading: boolean;
  /** Load error message, or `null`. */
  error: () => string | null;
  /** Script id the list is keyed on, or `null` when no script is focused. */
  scriptId: () => string | null;
  /** Active storage engine id — shown in the toolbar and empty state. */
  storageId: string;
  /** Whether the active engine implements `saveResult`. */
  supports: boolean;
  /** Force a re-fetch of the list. */
  onRefresh: () => void;
  /** Load a saved run back into the in-memory Results view. */
  onRestore: (run: ResultMeta) => void | Promise<void>;
}

/** Saved-runs list: search, sort, multi-select delete, restore. */
export function SavedTab(props: SavedTabProps): JSX.Element {
  // ── Sort, search, and multi-select ───────────────────────────────────
  const [savedSort, setSavedSort] = createSignal<SavedSort>('newest');
  const [savedQuery, setSavedQuery] = createSignal('');
  const [selectedRuns, setSelectedRuns] = createSignal<Set<string>>(new Set<string>());

  const visibleSavedRuns = createMemo(() => sortSavedRuns(props.runs(), savedSort(), savedQuery()));

  const runKey = (run: ResultMeta) => `${run.scriptId}\u0000${run.runId}`;

  const isRunSelected = (run: ResultMeta) => selectedRuns().has(runKey(run));

  const toggleRun = (run: ResultMeta) => {
    setSelectedRuns((prev) => {
      const next = new Set(prev);
      const key = runKey(run);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allVisibleSelected = () => {
    const rows = visibleSavedRuns();
    return rows.length > 0 && rows.every((r) => selectedRuns().has(runKey(r)));
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected()) {
      setSelectedRuns(new Set<string>());
      return;
    }
    setSelectedRuns(new Set(visibleSavedRuns().map(runKey)));
  };

  /** Drop selections that are no longer in the list (after reload/delete). */
  createEffect(() => {
    const present = new Set(props.runs().map(runKey));
    setSelectedRuns((prev) => {
      if (!prev.size) return prev;
      const next = new Set([...prev].filter((k) => present.has(k)));
      return next.size === prev.size ? prev : next;
    });
  });

  const deleteSelectedRuns = async () => {
    const keys = selectedRuns();
    if (!keys.size) return;
    const rows = props.runs().filter((r) => keys.has(runKey(r)));
    if (!rows.length) return;
    const ok = confirmDestructive(
      `Delete ${rows.length} saved run${rows.length === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    let failed = 0;
    for (const run of rows) {
      try {
        await removeRunResult(run.scriptId, run.runId);
      } catch {
        failed += 1;
      }
    }
    setSelectedRuns(new Set<string>());
    props.onRefresh();
    if (failed) {
      appendLog('warn', `Failed to delete ${failed} saved run(s)`, 'library');
    }
  };

  const deleteSavedRun = async (run: ResultMeta) => {
    // Confirmation prompt (AC: destructive delete requires explicit consent).
    const label = run.label || `${run.scriptKind ?? 'run'} @ ${formatSavedAt(run.startedAt)}`;
    const ok = confirmDestructive(`Delete saved run "${label}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await removeRunResult(run.scriptId, run.runId);
      props.onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog('warn', `Failed to delete run ${run.runId}: ${msg}`, 'library');
    }
  };

  return (
    <Show
      when={props.supports}
      fallback={
        <div class="ax-empty">
          Saved runs are unavailable on the current storage engine ({props.storageId}). Switch to a
          backend that supports
          <code class="ax-mono"> saveResult</code> to use this tab.
        </div>
      }
    >
      <div
        class="ax-stack ax-stack--compact"
        data-testid="axis-results-saved"
        data-script-id={props.scriptId() ?? ''}
      >
        <div class="ax-toolbar">
          <span class="ax-card-kicker">Storage</span>
          <span class="ax-mono">{props.storageId}</span>
          <span class="ax-toolbar-spacer" />
          <Show when={props.runs().length > 0}>
            <label class="ax-results-search">
              <Icons.search size={12} />
              <input
                type="search"
                class="ax-results-search-input"
                placeholder="Search runs…"
                aria-label="Search saved runs"
                value={savedQuery()}
                onInput={(e) => setSavedQuery(e.currentTarget.value)}
                data-testid="axis-results-saved-query"
                autocomplete="off"
                spellcheck={false}
              />
            </label>
            <label class="ax-results-sort">
              <span class="ax-results-sort-label">Sort</span>
              <select
                class="ax-results-sort-select"
                aria-label="Sort saved runs"
                value={savedSort()}
                onChange={(e) => setSavedSort(e.currentTarget.value as SavedSort)}
                data-testid="axis-results-saved-sort"
              >
                <For each={SAVED_SORTS}>{(s) => <option value={s.id}>{s.label}</option>}</For>
              </select>
            </label>
          </Show>
          <button
            type="button"
            class="ax-btn ax-btn--ghost"
            title="Refresh saved runs"
            data-testid="axis-results-saved-refresh"
            onClick={props.onRefresh}
          >
            <Icons.refresh class={props.loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <Show when={props.runs().length > 0}>
          <div class="ax-toolbar ax-results-selectbar">
            <label class="ax-results-selectall">
              <input
                type="checkbox"
                checked={allVisibleSelected()}
                ref={(el) => {
                  createEffect(() => {
                    el.indeterminate = selectedRuns().size > 0 && !allVisibleSelected();
                  });
                }}
                onChange={toggleSelectAll}
                data-testid="axis-results-saved-selectall"
              />
              <span>
                {selectedRuns().size > 0 ? `${selectedRuns().size} selected` : 'Select all'}
              </span>
            </label>
            <span class="ax-toolbar-spacer" />
            <Show when={selectedRuns().size > 0}>
              <button
                type="button"
                class="ax-btn ax-btn--ghost ax-btn--danger"
                title="Delete the selected saved runs"
                data-testid="axis-results-saved-delete-selected"
                onClick={() => void deleteSelectedRuns()}
              >
                <Icons.trash />
                Delete {selectedRuns().size}
              </button>
            </Show>
            <Show when={savedQuery().trim()}>
              <span class="ax-plot-meta">
                {visibleSavedRuns().length} of {props.runs().length}
              </span>
            </Show>
          </div>
        </Show>

        <Show when={props.loading && props.runs().length === 0}>
          <div class="ax-empty">
            <Spinner />
            Loading saved runs…
          </div>
        </Show>

        <Show when={props.error()}>
          <div class="ax-callout" data-testid="axis-results-saved-error">
            <div>Failed to list saved runs</div>
            <StudioHint>{props.error()}</StudioHint>
            <button type="button" class="ax-btn ax-btn--ghost" onClick={props.onRefresh}>
              <Icons.refresh />
              Retry
            </button>
          </div>
        </Show>

        <Show when={!props.loading && !props.error() && props.runs().length === 0}>
          <div class="ax-empty axis-empty-state" data-testid="axis-results-saved-empty">
            <div>
              No saved runs
              <Show when={props.scriptId()}>
                {' '}
                for <code class="ax-mono">{props.scriptId()}</code>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.runs().length > 0 && visibleSavedRuns().length === 0}>
          <div class="ax-empty axis-empty-state" data-testid="axis-results-saved-no-match">
            No saved runs match “{savedQuery()}”.
          </div>
        </Show>

        <Show when={visibleSavedRuns().length > 0}>
          <ul class="ax-list ax-list--entity" data-testid="axis-results-saved-list">
            <For each={visibleSavedRuns()}>
              {(run) => {
                const market = savedRunMarket(run);
                const stats = readSavedStats(run.stats);
                return (
                  <li
                    class="ax-row ax-results-saved-row"
                    classList={{ 'is-selected': isRunSelected(run) }}
                    data-testid="axis-results-saved-row"
                  >
                    <label class="ax-results-rowcheck" title="Select this run">
                      <input
                        type="checkbox"
                        checked={isRunSelected(run)}
                        onChange={() => toggleRun(run)}
                        aria-label={`Select ${run.label || defaultSavedLabel(run)}`}
                        data-testid="axis-results-saved-rowcheck"
                      />
                    </label>
                    <div class="ax-entity">
                      <div class="ax-entity-body">
                        <div class="ax-entity-head">
                          <span class="ax-card-title">{run.label || defaultSavedLabel(run)}</span>
                          <span
                            class={`ax-chip ax-chip--tag${
                              run.scriptKind === 'strategy' ? ' is-on' : ''
                            }`}
                            title={`Script kind: ${run.scriptKind ?? 'unknown'}`}
                          >
                            {run.scriptKind ?? 'unknown'}
                          </span>
                          <Show when={market.symbol || market.timeframe}>
                            <span class="ax-card-kicker">
                              {market.symbol}
                              {market.symbol && market.timeframe ? ' · ' : ''}
                              {market.timeframe}
                            </span>
                          </Show>
                        </div>

                        {/* Rich strategy stats (snapshot persisted at save time) */}
                        <Show when={stats.trades != null}>
                          <div class="ax-saved-stats" data-testid="axis-results-saved-stats">
                            <span class="ax-saved-stat" title="Closed trades">
                              <span class="ax-saved-stat-k">Trades</span>
                              <span class="ax-saved-stat-v">{stats.trades}</span>
                            </span>
                            <span class="ax-saved-stat" title="Wins / losses">
                              <span class="ax-saved-stat-k">W / L</span>
                              <span class="ax-saved-stat-v">
                                {stats.wins ?? '—'} / {stats.losses ?? '—'}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Win rate">
                              <span class="ax-saved-stat-k">Win %</span>
                              <span class="ax-saved-stat-v">
                                {stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : '—'}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Profit factor (∞ = no losses)">
                              <span class="ax-saved-stat-k">PF</span>
                              <span class="ax-saved-stat-v">
                                {formatSavedPf(stats.profitFactor)}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Net money P&L">
                              <span class="ax-saved-stat-k">Net P&L</span>
                              <span
                                class={`ax-saved-stat-v ${
                                  (stats.totalPnl ?? 0) >= 0 ? 'ax-table-pos' : 'ax-table-neg'
                                }`}
                              >
                                {formatMoney(stats.totalPnl ?? 0)}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Compounded per-trade price return">
                              <span class="ax-saved-stat-k">Return %</span>
                              <span
                                class={`ax-saved-stat-v ${
                                  (stats.returnPct ?? 0) >= 0 ? 'ax-table-pos' : 'ax-table-neg'
                                }`}
                              >
                                {formatSavedPct(stats.returnPct)}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Max drawdown">
                              <span class="ax-saved-stat-k">Max DD</span>
                              <span
                                class="ax-saved-stat-v"
                                classList={{
                                  'ax-table-neg': (stats.maxDD ?? 0) > 0.00005,
                                }}
                              >
                                {stats.maxDD != null
                                  ? stats.maxDD > 0.00005
                                    ? `−${(stats.maxDD * 100).toFixed(2)}%`
                                    : '0.00%'
                                  : '—'}
                              </span>
                            </span>
                            <span class="ax-saved-stat" title="Average trade P&L">
                              <span class="ax-saved-stat-k">Avg trade</span>
                              <span class="ax-saved-stat-v">
                                {formatMoney(stats.avgTrade ?? 0)}
                              </span>
                            </span>
                          </div>
                        </Show>

                        <p class="ax-hint">
                          <span class="ax-mono">{formatSavedAt(run.startedAt)}</span>
                          {' · '}
                          {formatSavedDuration(run.durationMs)}
                        </p>
                      </div>
                      <div class="ax-entity-actions">
                        <button
                          type="button"
                          class="ax-btn ax-btn--ghost"
                          title="Restore this run into the in-memory Results view"
                          data-testid="axis-results-saved-restore"
                          onClick={() => void props.onRestore(run)}
                        >
                          <Icons.check />
                          Restore
                        </button>
                        <button
                          type="button"
                          class="ax-btn ax-btn--ghost ax-btn--danger"
                          title="Delete this saved run (irreversible)"
                          data-testid="axis-results-saved-delete"
                          onClick={() => void deleteSavedRun(run)}
                        >
                          <Icons.trash />
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
          <p class="ax-hint">
            {visibleSavedRuns().length}
            {visibleSavedRuns().length !== props.runs().length
              ? ` of ${props.runs().length}`
              : ''}{' '}
            run{props.runs().length === 1 ? '' : 's'} · FIFO cap{' '}
            <span class="ax-mono">{MAX_RESULTS_PER_SCRIPT}</span>
          </p>
        </Show>
      </div>
    </Show>
  );
}
