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
 * AXIS results — fullscreen studio overlay.
 *
 * Replaces the docked Results panel. Seven restyled subpages (Events,
 * Strategy, Optimise, Plots, Metrics, Raw, Saved) share one studio canvas
 * bound to `store.lastRun` / `runResults`. Opens when
 * `store.resultsPanel.open` is set (auto for strategies, Topbar toggle,
 * command palette).
 *
 * @module ui/ResultsModal
 */

import {
  Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import {
  store,
  setStore,
  setStrategyUi,
  setLastRun,
  appendLog,
} from '../store';
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
import { getManager } from '../chart/manager-access';
import { Icons } from './icons';
import { StudioButton, StudioFooter, StudioHint, StudioJson, StudioStat, StudioTabs } from './studio';
import { StrategyReport } from './StrategyReport';
import { ScriptRunSelect } from './ScriptRunSelect';
import { HpoPanel } from './HpoPanel';
import { copyToClipboard } from './clipboard';
import { installFocusTrap } from './focus-trap';
import {
  listRunResults,
  loadRunResult,
  removeRunResult,
  supportsRunResults,
  type ResultMeta,
  type StoredRunResult,
} from '../storage/service';
import { getActiveStorageId } from '../plugins/active';
import { MAX_RESULTS_PER_SCRIPT } from '../storage/local';

type TabId =
  | 'events'
  | 'strategy'
  | 'optimise'
  | 'plots'
  | 'metrics'
  | 'raw'
  | 'saved';

const TABS: { id: TabId; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'optimise', label: 'Optimise' },
  { id: 'plots', label: 'Plots' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
  { id: 'saved', label: 'Saved' },
];

function isResultsTab(v: unknown): v is TabId {
  return (
    v === 'events' ||
    v === 'strategy' ||
    v === 'optimise' ||
    v === 'plots' ||
    v === 'metrics' ||
    v === 'raw' ||
    v === 'saved'
  );
}

function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Compact sparkline for a numeric series (used in the Plots subpage). */
function Sparkline(props: { data: (number | null)[]; positive?: boolean }) {
  const W = 100;
  const H = 34;
  const PAD = 3;
  const path = () => {
    const vals = props.data.filter((v): v is number => v != null) as number[];
    if (vals.length < 2) return '';
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const n = vals.length;
    return vals
      .map((v, i) => {
        const x = PAD + (i / (n - 1)) * (W - PAD * 2);
        const y = PAD + (H - PAD * 2) - ((v - min) / (max - min)) * (H - PAD * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="ax-spark" preserveAspectRatio="none" aria-hidden="true">
      <path
        d={path()}
        fill="none"
        class={props.positive ? 'ax-spark-pos' : 'ax-spark-neg'}
      />
    </svg>
  );
}

/** Format a `ResultMeta.startedAt` epoch ms as `2026-08-29 12:34:56` (local). */
function formatSavedAt(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a run duration for the saved-runs row (e.g. `"234 ms"`, `"1.2s"`). */
function formatSavedDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}m ${rem.toFixed(0)}s`;
}

/** Default label for a saved-run row when `meta.label` is missing. */
function defaultSavedLabel(run: ResultMeta): string {
  const kind = run.scriptKind ?? 'run';
  const at = formatSavedAt(run.startedAt);
  // "Strategy @ 2026-08-29 12:34:56"
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} @ ${at}`;
}

/** Extract symbol/timeframe strings from `ResultMeta.inputs` (engine-fed). */
function savedRunMarket(run: ResultMeta): { symbol: string; timeframe: string } {
  const inputs = run.inputs ?? {};
  const symbol = String(
    (inputs as Record<string, unknown>).symbol ??
      (inputs as Record<string, unknown>).ticker ??
      '',
  ).trim();
  const timeframe = String(
    (inputs as Record<string, unknown>).timeframe ??
      (inputs as Record<string, unknown>).interval ??
      '',
  ).trim();
  return { symbol, timeframe };
}

interface SavedStatsSummary {
  trades?: number;
  winRate?: number;
  totalPnl?: number;
}

function readSavedStats(raw: unknown): SavedStatsSummary {
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const out: SavedStatsSummary = {};
  if (typeof v.trades === 'number') out.trades = v.trades;
  if (typeof v.winRate === 'number') out.winRate = v.winRate;
  if (typeof v.totalPnl === 'number') out.totalPnl = v.totalPnl;
  return out;
}

/** Fullscreen results studio overlay. */
export const ResultsModal: Component = () => {
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
    const bars = untrack(() => store.bars || []);
    return buildStrategyReport((r.events || []) as StrategyEvent[], bars, {
      fillMode: fillMode(),
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

  const plotSummary = createMemo(() => {
    const r = result();
    if (!r) return [] as { name: string; pts: number; last: string }[];
    const out: { name: string; pts: number; last: string }[] = [];
    const series = r.series || {};
    const keys = Object.keys(series).filter((k) => !k.startsWith('__'));
    if (keys.length) {
      for (const k of keys) {
        const arr = series[k] as (number | null)[];
        const nonNull = arr?.filter((v) => v != null) ?? [];
        const last = [...(arr || [])].reverse().find((v) => v != null);
        out.push({ name: k, pts: nonNull.length, last: formatNum(last) });
      }
    } else if (r.plots?.length) {
      const nonNull = r.plots.filter((v) => v != null).length;
      const last = [...r.plots].reverse().find((v) => v != null);
      out.push({ name: 'plot_0', pts: nonNull, last: formatNum(last) });
    }
    return out;
  });

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
      m.push({ label: 'Profit factor', value: Number.isFinite(rep.stats.profitFactor) ? rep.stats.profitFactor.toFixed(2) : '∞' });
      m.push({ label: 'Max DD', value: `${(rep.stats.maxDD * 100).toFixed(2)}%` });
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

  const restoreSavedRun = async (run: ResultMeta) => {
    if (!supportsRunResults()) return;
    try {
      const stored: StoredRunResult | null = await loadRunResult(
        run.scriptId,
        run.runId,
      );
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

  const deleteSavedRun = async (run: ResultMeta) => {
    // Confirmation prompt (AC: destructive delete requires explicit consent).
    const label = run.label || `${run.scriptKind ?? 'run'} @ ${formatSavedAt(run.startedAt)}`;
    const ok =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete saved run "${label}"? This cannot be undone.`,
          );
    if (!ok) return;
    try {
      await removeRunResult(run.scriptId, run.runId);
      reloadSavedRuns();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog('warn', `Failed to delete run ${run.runId}: ${msg}`, 'library');
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

  const flashCopied = async (text: string) => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
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
    onCleanup(() => window.removeEventListener('keydown', onKey));
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
                <h2 id="axis-results-title" class="ax-page-title">Results</h2>
                <p class="ax-page-purpose">
                  Inspect the last script run — events, strategy performance, plots, and raw payload.
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
                      <Icons.loader class="animate-spin" />
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
                  {/* Empty / error states — skip Optimise / Saved, which have their own empty copy. */}
                  <Show when={!result() && tab() !== 'optimise' && tab() !== 'saved'}>
                    <div class="ax-empty">Run a script to populate results.</div>
                  </Show>
                  <Show when={result()?.status === 'error'}>
                    <div class="ax-callout">
                      {result()?.error || 'Run error'}
                    </div>
                  </Show>

                  {/* Events */}
                  <Show when={result() && tab() === 'events'}>
                    <Show
                      when={normalizedEvents().length > 0}
                      fallback={<div class="ax-empty">No strategy events in this run.</div>}
                    >
                      <ul class="ax-list ax-event-list">
                        <For each={normalizedEvents()}>
                          {(ev) => {
                            const kind = String(ev.type || ev.event || ev.kind || '?');
                            const t = ev.time
                              ? new Date(ev.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
                              : '—';
                            const dir = String(ev.dir || ev.direction || '');
                            const dirClass =
                              dir.toLowerCase() === 'long'
                                ? 'ax-event-dir ax-event-dir--long'
                                : dir.toLowerCase() === 'short'
                                  ? 'ax-event-dir ax-event-dir--short'
                                  : 'ax-event-dir ax-event-dir--flat';
                            return (
                              <li class="ax-row ax-event-row">
                                <span class="ax-mono ax-event-time">{t}</span>
                                <span class="ax-event-kind">{kind}</span>
                                <Show when={dir}>
                                  <span class={dirClass}>{dir}</span>
                                </Show>
                                <span class="ax-event-id">{String(ev.id || '')}</span>
                                <span class="ax-mono ax-event-price">
                                  {ev.price !== undefined && ev.price !== null
                                    ? Number(ev.price).toFixed(2)
                                    : '—'}
                                </span>
                              </li>
                            );
                          }}
                        </For>
                      </ul>
                    </Show>
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
                      hasEvents={normalizedEvents().length > 0 || (result()?.events?.length ?? 0) > 0}
                      onJumpToTrade={jumpToTrade}
                      slippageNextOpen={!!store.strategyUi?.slippageNextOpen}
                      invertTradeLabels={!!store.strategyUi?.invertTradeLabels}
                      exactOnCandle={store.strategyUi?.exactOnCandle !== false}
                      onStrategyUiChange={(patch) => {
                        setStrategyUi(patch);
                        reapplyTradeMarkers();
                      }}
                    />
                  </Show>

                  {/* Optimise */}
                  <Show when={tab() === 'optimise'}>
                    <HpoPanel />
                  </Show>

                  {/* Plots */}
                  <Show when={result() && tab() === 'plots'}>
                    <Show
                      when={plotSeries().length > 0}
                      fallback={<div class="ax-empty">No plots in this run.</div>}
                    >
                      <div class="ax-grid ax-grid--2">
                        <For each={plotSeries()}>
                          {(p) => {
                            const vals = p.data.filter((v): v is number => v != null) as number[];
                            const first = vals[0] ?? 0;
                            const last = vals[vals.length - 1] ?? 0;
                            const positive = last >= first;
                            return (
                              <div class="ax-card ax-plot-card">
                                <div class="ax-plot-head">
                                  <span class="ax-card-kicker">● {p.name}</span>
                                  <span class="ax-plot-meta">
                                    {p.data.filter((v) => v != null).length} pts · last{' '}
                                    {formatNum(last)}
                                  </span>
                                </div>
                                <Sparkline data={p.data} positive={positive} />
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
                    <Show
                      when={supportsRunResults()}
                      fallback={
                        <div class="ax-empty">
                          Saved runs are unavailable on the current storage engine
                          ({storageEngineId()}). Switch to a backend that supports
                          <code class="ax-mono"> saveResult</code> to use this tab.
                        </div>
                      }
                    >
                      <div class="ax-stack ax-stack--compact" data-testid="axis-results-saved">
                        <div class="ax-toolbar">
                          <span class="ax-card-kicker">Storage</span>
                          <span class="ax-mono">{storageEngineId()}</span>
                          <span class="ax-toolbar-spacer" />
                          <button
                            type="button"
                            class="ax-btn ax-btn--ghost"
                            title="Refresh saved runs"
                            data-testid="axis-results-saved-refresh"
                            onClick={reloadSavedRuns}
                          >
                            <Icons.refresh class={savedRunsResource.loading ? 'animate-spin' : ''} />
                            Refresh
                          </button>
                        </div>

                        <Show when={savedRunsResource.loading && savedRuns().length === 0}>
                          <div class="ax-empty">
                            <Icons.loader class="animate-spin" />
                            Loading saved runs…
                          </div>
                        </Show>

                        <Show when={savedRunsError()}>
                          <div class="ax-callout" data-testid="axis-results-saved-error">
                            <div>Failed to list saved runs</div>
                            <StudioHint>{savedRunsError()}</StudioHint>
                            <button
                              type="button"
                              class="ax-btn ax-btn--ghost"
                              onClick={reloadSavedRuns}
                            >
                              <Icons.refresh />
                              Retry
                            </button>
                          </div>
                        </Show>

                        <Show when={!savedRunsResource.loading && !savedRunsError() && savedRuns().length === 0}>
                          <div class="ax-empty" data-testid="axis-results-saved-empty">
                            <div>
                              No saved runs yet
                              <Show when={savedRunsScriptId()}>
                                {' '}for <code class="ax-mono">{savedRunsScriptId()}</code>
                              </Show>
                              . Run a strategy to persist the first result.
                            </div>
                            <p class="ax-hint">
                              Stored in <span class="ax-mono">{storageEngineId()}</span>; FIFO cap
                              {' '}
                              <span class="ax-mono">{MAX_RESULTS_PER_SCRIPT}</span>
                              {' '}
                              runs per script.
                            </p>
                          </div>
                        </Show>

                        <Show when={savedRuns().length > 0}>
                          <ul class="ax-list ax-list--entity" data-testid="axis-results-saved-list">
                            <For each={savedRuns()}>
                              {(run) => {
                                const market = savedRunMarket(run);
                                const stats = readSavedStats(run.stats);
                                return (
                                  <li class="ax-row" data-testid="axis-results-saved-row">
                                    <div class="ax-entity">
                                      <div class="ax-entity-body">
                                        <div class="ax-entity-head">
                                          <span class="ax-card-title">
                                            {run.label || defaultSavedLabel(run)}
                                          </span>
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
                                        <p class="ax-hint">
                                          <span class="ax-mono">{formatSavedAt(run.startedAt)}</span>
                                          {' · '}
                                          {formatSavedDuration(run.durationMs)}
                                          <Show when={stats.trades} keyed>
                                            {(trades) => <> · {trades} trades</>}
                                          </Show>
                                          <Show when={stats.winRate} keyed>
                                            {(winRate) => <> · {winRate.toFixed(1)}% win</>}
                                          </Show>
                                          <Show when={stats.totalPnl} keyed>
                                            {(totalPnl) => (
                                              <>
                                                {' · '}
                                                <span class={totalPnl >= 0 ? 'ax-table-pos' : 'ax-table-neg'}>
                                                  P&amp;L {formatMoney(totalPnl)}
                                                </span>
                                              </>
                                            )}
                                          </Show>
                                        </p>
                                      </div>
                                      <div class="ax-entity-actions">
                                        <button
                                          type="button"
                                          class="ax-btn ax-btn--ghost"
                                          title="Restore this run into the in-memory Results view"
                                          data-testid="axis-results-saved-restore"
                                          onClick={() => void restoreSavedRun(run)}
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
                            {savedRuns().length} run{savedRuns().length === 1 ? '' : 's'} ·
                            FIFO cap <span class="ax-mono">{MAX_RESULTS_PER_SCRIPT}</span>
                          </p>
                        </Show>
                      </div>
                    </Show>
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
