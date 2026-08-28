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
 * Replaces the docked Results panel. Six restyled subpages (Events,
 * Strategy, Optimise, Plots, Metrics, Raw) share one studio canvas bound
 * to `store.lastRun` / `runResults`. Opens when `store.resultsPanel.open`
 * is set (auto for strategies, Topbar toggle, command palette).
 *
 * @module ui/ResultsModal
 */

import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import {
  store,
  setStore,
  setStrategyUi,
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
import { StudioStat, StudioTabs } from './studio';
import { StrategyReport } from './StrategyReport';
import { ScriptRunSelect } from './ScriptRunSelect';
import { HpoPanel } from './HpoPanel';
import { copyToClipboard } from './clipboard';
import { installFocusTrap } from './focus-trap';

type TabId = 'events' | 'strategy' | 'optimise' | 'plots' | 'metrics' | 'raw';

const TABS: { id: TabId; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'optimise', label: 'Optimise' },
  { id: 'plots', label: 'Plots' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
];

function isResultsTab(v: unknown): v is TabId {
  return (
    v === 'events' ||
    v === 'strategy' ||
    v === 'optimise' ||
    v === 'plots' ||
    v === 'metrics' ||
    v === 'raw'
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

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) close();
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
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
        data-testid="axis-results-backdrop"
      >
        <div
          class="ax-page"
          style={{ '--ax-canvas-pad': '1.5rem' } as unknown as string}
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-results-title"
          data-testid="axis-results"
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
                <ScriptRunSelect testId="axis-results-script" class="ax-results-script" />
                <Show when={copied()}>
                  <span class="ax-hint ax-hint--accent">Copied</span>
                </Show>
                <button
                  class="ax-btn ax-btn--ghost"
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
                </button>
                <button
                  class="ax-btn ax-btn--ghost"
                  title="Export full run JSON"
                  onClick={exportJson}
                  disabled={!result()}
                >
                  <Icons.fileJson />
                  JSON
                </button>
                <button
                  class="ax-btn ax-btn--ghost"
                  title="Export closed trades CSV"
                  onClick={exportTradesCsv}
                  disabled={!report()?.trades.length}
                >
                  <Icons.fileCsv />
                  CSV
                </button>
                <button
                  class="ax-btn ax-btn--ghost ax-btn--icon"
                  aria-label="Close"
                  title="Close"
                  onClick={close}
                >
                  <Icons.x />
                </button>
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
                <div class="ax-page-canvas ax-page-canvas--wide" data-testid="axis-results-body">
                  {/* Empty / error states */}
                  <Show when={!result()}>
                    <div class="ax-empty">Run a script to populate results.</div>
                  </Show>
                  <Show when={result()?.status === 'error'}>
                    <div class="ax-error border border-[color-mix(in_srgb,var(--color-red)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-red)_8%,transparent)] p-2 rounded-[var(--radius-surface)]">
                      {result()?.error || 'Run error'}
                    </div>
                  </Show>

                  {/* Events */}
                  <Show when={result() && tab() === 'events'}>
                    <Show
                      when={normalizedEvents().length > 0}
                      fallback={<div class="ax-empty">No strategy events in this run.</div>}
                    >
                      <ul class="ax-list">
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
                                <span class="ax-mono text-text-faint w-[118px] flex-shrink-0">{t}</span>
                                <span class="ax-event-kind">{kind}</span>
                                <Show when={dir}>
                                  <span class={dirClass}>{dir}</span>
                                </Show>
                                <span class="text-text-dim w-16 truncate">{String(ev.id || '')}</span>
                                <span class="text-text flex-1 truncate text-right ax-mono">
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
                    <pre class="ax-code" data-testid="axis-results-raw">{rawJson()}</pre>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
