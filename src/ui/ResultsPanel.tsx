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
 * AXIS results / export drawer — Events, Strategy, Plots, Metrics, Raw.
 *
 * Reads focused `store.lastRun` (RunResult) via {@link ScriptRunSelect} /
 * `resultsFocusId`. Per-script payloads live in `runResults` so multi-
 * indicator live re-runs do not thrash the drawer. Strategy tab uses
 * `buildStrategyReport` + {@link StrategyReport}. FloatableShell id `results`.
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
import { store, isPanelOpen, setStrategyUi } from '../store';
import type { RunResult } from '../indicators/runner';
import { FloatableShell } from './panels/FloatableShell';
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
import { StrategyReport } from './StrategyReport';
import { ScriptRunSelect } from './ScriptRunSelect';
import { copyToClipboard } from './clipboard';

type TabId = 'events' | 'strategy' | 'plots' | 'metrics' | 'raw';

const TABS: { id: TabId; label: string }[] = [
  { id: 'events', label: 'Events' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'plots', label: 'Plots' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'raw', label: 'Raw' },
];

function isResultsTab(v: unknown): v is TabId {
  return v === 'events' || v === 'strategy' || v === 'plots' || v === 'metrics' || v === 'raw';
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

async function copyText(text: string) {
  return copyToClipboard(text);
}

/** Bottom results drawer bound to the last script run. */
export const ResultsPanel: Component = () => {
  const [tab, setTab] = createSignal<TabId>('events');
  const [copied, setCopied] = createSignal(false);

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
    // Rebuild on history reload / fill-mode — not every live tip path-update
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
    mgr.setTradeMarkers(markers);
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

  const metrics = createMemo(() => {
    const r = result();
    if (!r) return [] as { label: string; value: string }[];
    const m: { label: string; value: string }[] = [];
    if (r.meta?.ms != null) m.push({ label: 'Runtime', value: `${r.meta.ms.toFixed(0)} ms` });
    if (r.meta?.script_name) m.push({ label: 'Script', value: String(r.meta.script_name) });
    m.push({ label: 'Status', value: r.status });
    m.push({ label: 'Events', value: String(r.events?.length ?? 0) });
    m.push({ label: 'Plot series', value: String(plotSummary().length) });
    m.push({ label: 'Bars', value: String(store.bars.length) });
    m.push({ label: 'Engine', value: store.engine });
    m.push({ label: 'Source', value: store.source });
    const rep = report();
    if (rep && rep.stats.trades > 0) {
      m.push({ label: 'Closed trades', value: String(rep.stats.trades) });
      m.push({ label: 'Net P&L', value: formatMoney(rep.stats.totalPnl) });
      m.push({ label: 'Win rate', value: `${rep.stats.winRate.toFixed(1)}%` });
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
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const exportJson = () => {
    const r = result();
    if (!r) return;
    const name = `axis-run-${Date.now()}.json`;
    downloadText(name, rawJson(), 'application/json');
  };

  const exportTradesCsv = () => {
    const rep = report();
    if (!rep?.trades.length) return;
    downloadText(`axis-trades-${Date.now()}.csv`, tradesToCsv(rep.trades), 'text/csv');
  };

  return (
    <Show when={isPanelOpen('results') || store.resultsPanel.open}>
      <FloatableShell
        id="results"
        testId="axis-results"
        headerExtra={
          <div class="flex items-center gap-0.5 flex-wrap min-w-0">
            <ScriptRunSelect testId="axis-results-script" class="mr-1" />
            <For each={TABS}>
              {(t) => (
                <button
                  type="button"
                  class={`sc-btn sc-btn-ghost px-1.5 py-0 text-[0.78em] ${
                    tab() === t.id ? 'text-accent' : ''
                  }`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>
        }
      >
        <div class="flex items-center gap-1 px-2 py-1 border-b border-border-soft flex-shrink-0">
          <Show when={copied()}>
            <span class="text-[0.78em] text-accent-2">Copied</span>
          </Show>
          <div class="flex-1" />
          <button
            class="sc-btn sc-btn-ghost px-2 text-[0.78em]"
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
            class="sc-btn sc-btn-ghost px-2 text-[0.78em]"
            title="Export full run JSON"
            onClick={exportJson}
            disabled={!result()}
          >
            <Icons.fileJson />
            JSON
          </button>
          <button
            class="sc-btn sc-btn-ghost px-2 text-[0.78em]"
            title="Export closed trades CSV"
            onClick={exportTradesCsv}
            disabled={!report()?.trades.length}
          >
            <Icons.fileCsv />
            CSV
          </button>
        </div>

        {/* Body */}
        <div class="flex-1 min-h-0 overflow-auto p-2 text-[0.85em]">
          <Show when={!result()}>
            <div class="text-text-faint uppercase tracking-wider text-[10px] p-3">
              Run a script to populate results
            </div>
          </Show>

          <Show when={result()?.status === 'error'}>
            <div class="text-red p-2 border-2 border-red/40 bg-red/5 font-mono">
              {result()?.error || 'Run error'}
            </div>
          </Show>

          <Show when={result() && tab() === 'events'}>
            <Show
              when={normalizedEvents().length > 0}
              fallback={
                <div class="text-text-faint p-2">No strategy events in this run.</div>
              }
            >
              <ul class="flex flex-col gap-0.5 font-mono">
                <For each={normalizedEvents()}>
                  {(ev) => {
                    const kind = String(ev.type || ev.event || ev.kind || '?');
                    const t = ev.time
                      ? new Date(ev.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
                      : '—';
                    const dir = ev.dir || ev.direction || '';
                    return (
                      <li class="flex gap-2 py-0.5 border-b border-border-soft/60 items-baseline">
                        <span class="text-text-faint w-[118px] flex-shrink-0">{t}</span>
                        <span class="text-accent w-16 flex-shrink-0 truncate">{kind}</span>
                        <span class="text-text-dim w-12 truncate">{String(dir)}</span>
                        <span class="text-text-dim w-16 truncate">{String(ev.id || '')}</span>
                        <span class="text-text flex-1 truncate">
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

          <Show when={result() && tab() === 'plots'}>
            <Show
              when={plotSummary().length > 0}
              fallback={<div class="text-text-faint p-2">No plots in this run.</div>}
            >
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <For each={plotSummary()}>
                  {(p) => (
                    <div class="border-2 border-border bg-bg-elev px-2 py-1.5">
                      <div class="text-text-dim text-[10px] uppercase tracking-wider">● {p.name}</div>
                      <div class="font-mono text-text mt-0.5">
                        {p.pts} pts · last {p.last}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={result() && tab() === 'metrics'}>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <For each={metrics()}>
                {(m) => (
                  <div class="border-2 border-border bg-bg-elev px-2 py-1.5">
                    <div class="text-text-dim text-[10px] uppercase tracking-wider">{m.label}</div>
                    <div class="font-mono text-text mt-0.5 break-all">{m.value}</div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={result() && tab() === 'raw'}>
            <pre class="font-mono text-[10px] text-text-dim whitespace-pre-wrap break-all p-2 bg-bg-base border-2 border-border min-h-full">
              {rawJson()}
            </pre>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};
