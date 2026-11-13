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
 * AXIS results — fullscreen studio overlay.
 *
 * Replaces the docked Results panel. Six restyled subpages (Events,
 * Strategy, Plots, Metrics, Raw, Saved) share one studio canvas
 * bound to `store.lastRun` / `runResults`. Opens when
 * `store.resultsPanel.open` is set (auto for strategies, Topbar toggle,
 * command palette).
 *
 * @module ui/ResultsModal
 */

import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { store, setStore, setStrategyUi, setLastRun, appendLog } from '../store';
import type { RunResult } from '../indicators/runner';
import {
  buildStrategyReport,
  formatMoney,
  formatNum,
  tradesToCsv,
  type ClosedTrade,
  type StrategyEvent,
} from '../results/strategy';
import { eventsToMarkers, normalizeStrategyEvents } from '../results/events';
import { summarizeSeries } from '../results/overlay';
import { downloadText } from './results/format';
import { Sparkline } from './results/Sparkline';
import { EventsTab } from './results/EventsTab';
import { SavedTab } from './results/SavedTab';
import { windowAxisFromMeta } from '../results/window-axis';
import { getManager } from '../chart/manager-access';
import { Icons } from './icons';
import { Spinner } from './Spinner';
import { StudioButton, StudioFooter, StudioJson, StudioStat, StudioTabs } from './studio';
import { StrategyReport } from './StrategyReport';
import { ScriptRunSelect } from './ScriptRunSelect';
import { copyToClipboard } from './clipboard';
import { installFocusTrap } from './focus-trap';
import {
  listRunResults,
  loadRunResult,
  supportsRunResults,
  type ResultMeta,
  type StoredRunResult,
} from '../storage/service';
import { getActiveStorageId } from '../plugins/active';

type TabId = 'events' | 'strategy' | 'plots' | 'metrics' | 'raw' | 'saved';

const TABS: { id: TabId; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'plots', label: 'Plots' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
  { id: 'saved', label: 'Saved' },
];

function isResultsTab(v: unknown): v is TabId {
  return (
    v === 'events' ||
    v === 'strategy' ||
    v === 'plots' ||
    v === 'metrics' ||
    v === 'raw' ||
    v === 'saved'
  );
}

/** Fullscreen results studio overlay. */
export const ResultsModal: Component = (): JSX.Element => {
  const [tab, setTab] = createSignal<TabId>('events');
  const [copied, setCopied] = createSignal(false);

  const close = () => setStore('resultsPanel', 'open', false);

  // Runner dispatches this when a strategy closes trades so the Strategy tab is visible
  onMount(() => {
    const onTab = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string }>).detail;
      if (isResultsTab(detail?.tab)) setTab(detail.tab);
    };
    window.addEventListener('axis-results-tab', onTab);
    onCleanup(() => window.removeEventListener('axis-results-tab', onTab));
  });

  const result = () => store.lastRun as RunResult | null;

  const fillMode = () =>
    store.strategyUi?.slippageNextOpen ? ('next_open' as const) : ('close' as const);

  const report = createMemo(() => {
    const r = result();
    if (!r) return null;
    void store.chartDataGen;
    void store.strategyUi?.slippageNextOpen;
    void store.strategyUi?.commission;
    const bars = untrack(() => store.bars || []);
    return buildStrategyReport((r.events || []) as StrategyEvent[], bars, {
      fillMode: fillMode(),
      axis: windowAxisFromMeta(r.meta),
      commission: store.strategyUi?.commission ?? null,
    });
  });

  const normalizedEvents = createMemo(() => {
    const r = result();
    if (!r) return [] as StrategyEvent[];
    void store.chartDataGen;
    void store.strategyUi?.slippageNextOpen;
    const bars = untrack(() => store.bars || []);
    return normalizeStrategyEvents((r.events || []) as StrategyEvent[], {
      bars,
      includeOrders: true,
      fillMode: fillMode(),
      axis: windowAxisFromMeta(r.meta),
    });
  });

  /** Re-paint chart trade markers when strategy UI prefs change (no re-run). */
  const reapplyTradeMarkers = () => {
    const r = result();
    const mgr = getManager();
    if (!r?.events?.length || !mgr) return;
    const normalized = normalizeStrategyEvents((r.events || []) as StrategyEvent[], {
      bars: store.bars || [],
      includeOrders: false,
      fillMode: fillMode(),
      axis: windowAxisFromMeta(r.meta),
    });
    const markers = eventsToMarkers(normalized, {
      invertLabels: !!store.strategyUi?.invertTradeLabels,
      exactOnCandle: store.strategyUi?.exactOnCandle !== false,
    });
    const owner = store.resultsFocusId || undefined;
    mgr.setTradeMarkers(markers, owner);
  };

  function jumpToTrade(trade: ClosedTrade, which: 'entry' | 'exit' = 'entry') {
    const t = which === 'exit' ? trade.exitTime : trade.entryTime;
    getManager()?.scrollToTime(t);
  }

  const plotSeries = createMemo(() => {
    const r = result();
    if (!r) return [] as { name: string; data: (number | null)[] }[];
    const series = r.series || {};
    const keys = Object.keys(series).filter((k) => !k.startsWith('__'));
    if (keys.length) {
      return keys.map((k) => ({ name: k, data: (series[k] as (number | null)[]) ?? [] }));
    }
    if (r.plots?.length) {
      return [{ name: 'plot_0', data: (r.plots as (number | null)[]) ?? [] }];
    }
    return [];
  });

  const metrics = createMemo(() => {
    const r = result();
    if (!r) return [] as { label: string; value: string }[];
    const m: { label: string; value: string }[] = [];
    if (r.meta?.ms != null) m.push({ label: 'Runtime', value: `${r.meta.ms.toFixed(0)} ms` });
    if (r.meta?.script_name) m.push({ label: 'Script', value: String(r.meta.script_name) });
    const kind = String(
      (r.meta as { script_type?: string } | undefined)?.script_type ||
        (r.meta as { kind?: string } | undefined)?.kind ||
        '',
    );
    if (kind) m.push({ label: 'Type', value: kind });
    m.push({ label: 'Status', value: r.status });
    m.push({ label: 'Events', value: String(r.events?.length ?? 0) });
    const totalPts = plotSeries().reduce(
      (acc, p) => acc + p.data.filter((v) => v != null).length,
      0,
    );
    m.push({ label: 'Plot points', value: String(totalPts) });
    m.push({ label: 'Bars', value: String(store.bars.length) });
    m.push({ label: 'Engine', value: store.engine });
    m.push({ label: 'Source', value: store.source });
    const rep = report();
    if (rep && rep.stats.trades > 0) {
      m.push({ label: 'Closed trades', value: String(rep.stats.trades) });
      m.push({ label: 'Net P&L', value: formatMoney(rep.stats.totalPnl) });
      m.push({ label: 'Win rate', value: `${rep.stats.winRate.toFixed(1)}%` });
      m.push({
        label: 'Profit factor',
        value: Number.isFinite(rep.stats.profitFactor) ? rep.stats.profitFactor.toFixed(2) : '∞',
      });
      m.push({ label: 'Max DD', value: formatMoney(-(rep.stats.maxDrawdown ?? 0)) });
    }
    if (r.error) m.push({ label: 'Error', value: r.error });
    return m;
  });

  const rawJson = createMemo(() => {
    const r = result();
    if (!r) return '';
    try {
      return JSON.stringify(r, null, 2);
    } catch {
      return String(r);
    }
  });

  // ── Saved runs tab (storage-backed) ───────────────────────────────────
  //
  // Lists previously persisted `RunResult`s for the focused script. The list
  // is driven by `listRunResults(scriptId)` from the storage service; it
  // re-fetches whenever:
  //   • the focused script changes (`store.resultsFocusId`)
  //   • the active storage engine changes (`store.activePlugins.storage`)
  //   • the modal opens
  //   • a new run completes (`store.lastRunMs` change — proxy for `setLastRun`)
  //   • the user clicks the badge / refresh button (manual `savedRunsTick++`)
  //
  // When the active plugin does not implement `saveResult`, the resource is
  // short-circuited to an empty array so the tab / badge disappear cleanly.

  /** Script id used to key `saveResult` — mirrors what `setLastRun()` persists. */
  const savedRunsScriptId = createMemo<string | null>(() => {
    const focus = store.resultsFocusId;
    if (focus && String(focus).trim()) return String(focus);
    const r = store.lastRun;
    if (r && typeof r === 'object') {
      const meta = (r as { meta?: { script_id?: string } }).meta;
      if (meta?.script_id) return String(meta.script_id);
    }
    return null;
  });

  /** Bumped by hand to force a re-fetch of the saved-runs resource. */
  const [savedRunsTick, setSavedRunsTick] = createSignal(0);

  const [savedRunsResource] = createResource<
    ResultMeta[],
    {
      scriptId: string | null;
      tick: number;
      supports: boolean;
      storageId: string;
      open: boolean;
      lastRunMs: number | null;
    }
  >(
    () => ({
      // Subscribe inside the source so Solid tracks each dep and refetches.
      scriptId: savedRunsScriptId(),
      tick: savedRunsTick(),
      supports: supportsRunResults(),
      storageId: getActiveStorageId(),
      open: !!store.resultsPanel.open,
      lastRunMs: store.lastRunMs,
    }),
    async (src) => {
      if (!src.supports || !src.open || !src.scriptId) return [] as ResultMeta[];
      try {
        const list = await listRunResults(src.scriptId);
        return Array.isArray(list) ? list : [];
      } catch (err) {
        // Surface to the resource consumer as `state === 'errored'`; never throw.
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  );

  /** Defensive copy of the saved-runs list (safe to sort/filter in templates). */
  const savedRuns = createMemo<ResultMeta[]>(() => {
    if (savedRunsResource.state === 'errored') return [];
    return savedRunsResource() ?? [];
  });

  const savedRunsError = createMemo<string | null>(() => {
    if (savedRunsResource.state !== 'errored') return null;
    const e = savedRunsResource.error;
    return e instanceof Error ? e.message : String(e);
  });

  const reloadSavedRuns = () => setSavedRunsTick((n) => n + 1);

  /** Load a persisted run back into the in-memory view and switch subpage. */
  const restoreSavedRun = async (run: ResultMeta) => {
    if (!supportsRunResults()) return;
    try {
      const stored: StoredRunResult | null = await loadRunResult(run.scriptId, run.runId);
      if (!stored) return;
      // Push the loaded payload back into the store; skip persistence since
      // the run is already on disk.
      setLastRun(stored.result, {
        scriptId: run.scriptId,
        focus: true,
        persistence: 'skip',
      });
      // Switch to the Strategy tab for strategy runs (matches what the
      // runner dispatches on a fresh close), otherwise fall back to Events.
      const isStrategy =
        stored.result?.events?.length ||
        run.scriptKind === 'strategy' ||
        run.scriptKind === 'indicator';
      setTab(isStrategy ? 'strategy' : 'events');
      reloadSavedRuns();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog('warn', `Failed to restore run ${run.runId}: ${msg}`, 'library');
    }
  };

  /** Active storage engine id — shown in the badge tooltip and empty state. */
  const storageEngineId = () => getActiveStorageId();

  /** Open the Saved tab from any UI control (badge click, etc.). */
  const openSavedTab = () => {
    if (!supportsRunResults()) return;
    setTab('saved');
    reloadSavedRuns();
  };

  /** Tracked so unmount clears the pending reset (E17). */
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const flashCopied = async (text: string) => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      if (copiedTimer !== undefined) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copiedTimer = undefined;
        setCopied(false);
      }, 1200);
    }
  };

  const exportJson = () => {
    const r = result();
    if (!r) return;
    downloadText(`axis-run-${Date.now()}.json`, rawJson(), 'application/json');
  };

  const exportTradesCsv = () => {
    const rep = report();
    if (!rep?.trades.length) return;
    downloadText(`axis-trades-${Date.now()}.csv`, tradesToCsv(rep.trades), 'text/csv');
  };

  const onKey = (e: KeyboardEvent) => {
    if (!store.resultsPanel.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      window.removeEventListener('keydown', onKey);
      if (copiedTimer !== undefined) {
        clearTimeout(copiedTimer);
        copiedTimer = undefined;
      }
    });
  });

  return (
    <Show when={store.resultsPanel.open}>
      <div
        class="ax-page-backdrop ax-page-backdrop--front"
        role="presentation"
        data-testid="axis-results-backdrop"
      >
        <div
          class="ax-page ax-page--results"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-results-title"
          data-testid="axis-results"
          data-studio-page="results"
          tabIndex={-1}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: true });
            onCleanup(dispose);
          }}
        >
          <div class="ax-page-main">
            <header class="ax-page-header">
              <div>
                <p class="ax-page-kicker">AXIS Studio · Run</p>
                <h2 id="axis-results-title" class="ax-page-title">
                  Results
                </h2>
                <p class="ax-page-purpose">
                  Inspect the last script run — events, strategy performance, plots, and raw
                  payload.
                </p>
              </div>
              <div class="ax-page-header-actions">
                <label
                  class="ax-toggle ax-results-autotoggle"
                  title="Automatically open this panel when a strategy() script finishes running"
                >
                  <input
                    type="checkbox"
                    checked={store.resultsAutoOpen}
                    onChange={(e) => setStore('resultsAutoOpen', e.currentTarget.checked)}
                  />
                  <span>
                    <span class="ax-toggle-title">Auto-open on strategies</span>
                  </span>
                </label>
                <ScriptRunSelect testId="axis-results-script" variant="studio" />
                <Show when={supportsRunResults()}>
                  <div class="ax-inline" data-testid="axis-results-saved-badge-row">
                    <button
                      type="button"
                      class="ax-chip"
                      data-testid="axis-results-saved-badge"
                      title={`Saved runs · storage: ${storageEngineId()}`}
                      aria-label={`Open saved runs (${savedRuns().length})`}
                      onClick={openSavedTab}
                    >
                      <Icons.database />
                      {savedRuns().length} saved
                    </button>
                    <Show when={savedRunsResource.loading}>
                      <Spinner />
                    </Show>
                  </div>
                </Show>
                <StudioButton
                  variant="ghost"
                  class="ax-btn--icon"
                  ariaLabel="Close"
                  title="Close"
                  testId="axis-results-close"
                  onClick={close}
                >
                  <Icons.x />
                </StudioButton>
              </div>
            </header>

            <StudioTabs
              tabs={TABS}
              value={tab()}
              onChange={(id) => setTab(id as TabId)}
              ariaLabel="Results sections"
              idPrefix="axis-results"
              testId="axis-results-tabs"
            />

            <div class="ax-page-body">
              <div class="ax-page-stack">
                <div class="ax-page-canvas" data-testid="axis-results-body">
                  {/* Empty / error states — skip Saved, which has its own empty copy. */}
                  <Show when={!result() && tab() !== 'saved'}>
                    <div class="ax-empty axis-empty-state">Run a script to populate results.</div>
                  </Show>
                  <Show when={result()?.status === 'error'}>
                    <div class="ax-callout">{result()?.error || 'Run error'}</div>
                  </Show>

                  {/* Events */}
                  <Show when={result() && tab() === 'events'}>
                    <EventsTab result={result} fillMode={fillMode} />
                  </Show>

                  {/* Strategy */}
                  <Show when={result() && tab() === 'strategy'}>
                    <StrategyReport
                      trades={report()?.trades ?? []}
                      stats={
                        report()?.stats ?? {
                          totalPnl: 0,
                          winRate: 0,
                          profitFactor: 0,
                          avgTrade: 0,
                          avgWin: 0,
                          avgLoss: 0,
                          maxDD: 0,
                          wins: 0,
                          losses: 0,
                          trades: 0,
                        }
                      }
                      hasEvents={
                        normalizedEvents().length > 0 || (result()?.events?.length ?? 0) > 0
                      }
                      onJumpToTrade={jumpToTrade}
                      slippageNextOpen={!!store.strategyUi?.slippageNextOpen}
                      invertTradeLabels={!!store.strategyUi?.invertTradeLabels}
                      exactOnCandle={store.strategyUi?.exactOnCandle !== false}
                      commission={store.strategyUi?.commission ?? null}
                      onStrategyUiChange={(patch) => {
                        setStrategyUi(patch);
                        reapplyTradeMarkers();
                      }}
                    />
                  </Show>

                  {/* Plots */}
                  <Show when={result() && tab() === 'plots'}>
                    <Show
                      when={plotSeries().length > 0}
                      fallback={<div class="ax-empty axis-empty-state">No plots.</div>}
                    >
                      <div class="ax-grid ax-grid--2">
                        <For each={plotSeries()}>
                          {(p) => {
                            const s = () => summarizeSeries(p.data);
                            const positive = () => (s().change ?? 0) >= 0;
                            return (
                              <div class="ax-card ax-plot-card">
                                <div class="ax-plot-head">
                                  <span class="ax-card-kicker">● {p.name}</span>
                                  <span class="ax-plot-meta">
                                    {s().count} pts · last {formatNum(s().last ?? undefined)}
                                  </span>
                                </div>
                                <Sparkline data={p.data} positive={positive()} />
                                <div class="ax-plot-stats">
                                  <span class="ax-plot-stat">
                                    <span class="ax-plot-stat-k">min</span>
                                    {formatNum(s().min ?? undefined)}
                                  </span>
                                  <span class="ax-plot-stat">
                                    <span class="ax-plot-stat-k">max</span>
                                    {formatNum(s().max ?? undefined)}
                                  </span>
                                  <span
                                    class="ax-plot-stat"
                                    classList={{
                                      'ax-table-pos': positive(),
                                      'ax-table-neg': !positive(),
                                    }}
                                  >
                                    <span class="ax-plot-stat-k">Δ</span>
                                    <span>
                                      {s().changePct != null
                                        ? `${(s().changePct ?? 0) >= 0 ? '+' : ''}${(
                                            s().changePct ?? 0
                                          ).toFixed(2)}%`
                                        : '—'}
                                    </span>
                                  </span>{' '}
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </Show>

                  {/* Metrics */}
                  <Show when={result() && tab() === 'metrics'}>
                    <div class="ax-stack ax-stack--compact">
                      <div class="ax-metrics-status">
                        <span
                          class={`ax-status ax-status--${
                            result()?.status === 'error' ? 'down' : 'healthy'
                          }`}
                        >
                          {result()?.status === 'error' ? 'Failed' : 'Completed'}
                        </span>
                        <Show when={result()?.meta?.script_name}>
                          <span class="ax-metrics-script">{result()?.meta?.script_name}</span>
                        </Show>
                      </div>
                      <div class="ax-grid ax-grid--4">
                        <For each={metrics()}>
                          {(m) => <StudioStat label={m.label} value={m.value} />}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* Raw */}
                  <Show when={result() && tab() === 'raw'}>
                    <StudioJson value={result()} testId="axis-results-raw" />
                  </Show>

                  {/* Saved runs (storage-backed) — only when the active plugin
                      supports `saveResult`. Otherwise the tab is effectively
                      hidden because `supportsRunResults()` is false and we
                      render an explicit notice. */}
                  <Show when={tab() === 'saved'}>
                    <SavedTab
                      runs={savedRuns}
                      loading={savedRunsResource.loading}
                      error={savedRunsError}
                      scriptId={savedRunsScriptId}
                      storageId={storageEngineId()}
                      supports={supportsRunResults()}
                      onRefresh={reloadSavedRuns}
                      onRestore={restoreSavedRun}
                    />
                  </Show>
                </div>
                <StudioFooter
                  status={(() => {
                    const r = result();
                    if (!r) return 'No run yet';
                    const ms = r.meta?.ms;
                    return `${r.meta?.script_name || 'run'} · ${r.status || '—'} · ${
                      typeof ms === 'number' ? `${Math.round(ms)} ms` : '—'
                    }`;
                  })()}
                >
                  <Show when={copied()}>
                    <span class="ax-hint ax-hint--accent">Copied</span>
                  </Show>
                  <StudioButton
                    variant="ghost"
                    title="Copy current tab"
                    onClick={() => {
                      const r = result();
                      if (!r) return;
                      if (tab() === 'raw') flashCopied(rawJson());
                      else if (tab() === 'strategy') {
                        const rep = report();
                        flashCopied(rep ? tradesToCsv(rep.trades) : '');
                      } else flashCopied(rawJson());
                    }}
                  >
                    <Icons.copy />
                    Copy
                  </StudioButton>
                  <StudioButton
                    variant="ghost"
                    title="Export full run JSON"
                    onClick={exportJson}
                    disabled={!result()}
                  >
                    <Icons.fileJson />
                    JSON
                  </StudioButton>
                  <StudioButton
                    variant="ghost"
                    title="Export closed trades CSV"
                    onClick={exportTradesCsv}
                    disabled={!report()?.trades.length}
                  >
                    <Icons.fileCsv />
                    CSV
                  </StudioButton>
                </StudioFooter>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
