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
 * Cached datasets browser — table of bars-cache series with filters,
 * coverage map, and load window (date range + max bars).
 */

import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { Bar } from '../store/types';
import { setStore, persist, setActivePlugin, store } from '../store';
import {
  clearCachedBars,
  countBarsForLoad,
  getCachedBars,
  listCachedSeries,
  type BarLoadWindow,
  type BarsCacheMeta,
} from '../data/bars-cache';
import { listMemoryDatasets } from '../data/dataset-store';
import { buildCoverageMap, type CoverageSegment } from '../data/bars-gaps';
import {
  applyCachedToChart,
  dateInputToEndSec,
  pastDateInputToSec,
  secToDateInput,
} from '../data/data-source-manager';
import {
  DATA_MANAGER_SOURCE_ID,
  setDataManagerSelection,
} from '../data/data-manager-source';
import { defaultStreamForSource } from '../streams/catalog';
import { Icons } from './icons';
import { installFocusTrap } from './focus-trap';
import { announce } from './sr-announce';
import { CompleteMap } from './dsm/CompleteMap';
import { DsmField } from './dsm/Field';
import { fmtDuration, fmtMillis, fmtTime } from './dsm/format';

export interface CachedDatasetsModalProps {
  open: boolean;
  onClose: () => void;
}

type SortKey = 'updated' | 'bars' | 'symbol' | 'span';

const SORT_OPTIONS: readonly { id: SortKey; label: string }[] = [
  { id: 'updated', label: 'Updated' },
  { id: 'bars', label: 'Bars' },
  { id: 'symbol', label: 'Symbol' },
  { id: 'span', label: 'Span' },
];

const LOAD_PRESETS = [
  { id: 'full', label: 'Full', title: 'Full series in cache' },
  { id: '30d', label: '30d', title: 'Last 30 days' },
  { id: '90d', label: '90d', title: 'Last 90 days' },
  { id: '1k', label: '1k', title: 'Newest 1,000 bars' },
  { id: '5k', label: '5k', title: 'Newest 5,000 bars' },
] as const;

type LoadPreset = (typeof LOAD_PRESETS)[number]['id'];

function metaKey(m: BarsCacheMeta): string {
  return m.key || `${m.sourceId}|${m.symbol}|${m.interval}`;
}

function parseMaxBars(raw: string): number | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 1_000_000);
}

function matchesQuery(row: BarsCacheMeta, q: string): boolean {
  if (!q) return true;
  const hay = `${row.symbol} ${row.interval} ${row.sourceId} ${row.key}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof el !== 'object') return false;
  const tag = (el as HTMLElement).tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

function sortRows(list: BarsCacheMeta[], sort: SortKey): BarsCacheMeta[] {
  return list.slice().sort((a, b) => {
    switch (sort) {
      case 'bars':
        return (b.count || 0) - (a.count || 0);
      case 'symbol': {
        const c = a.symbol.localeCompare(b.symbol);
        return c !== 0 ? c : a.interval.localeCompare(b.interval);
      }
      case 'span': {
        const sa = (a.newestSec ?? 0) - (a.oldestSec ?? 0);
        const sb = (b.newestSec ?? 0) - (b.oldestSec ?? 0);
        return sb - sa;
      }
      default:
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    }
  });
}

/** Modal: browse local OHLCV datasets from the Data Source Manager cache. */
export const CachedDatasetsModal: Component<CachedDatasetsModalProps> = (props) => {
  const [rows, setRows] = createSignal<BarsCacheMeta[]>([]);
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [bars, setBars] = createSignal<Bar[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [msg, setMsg] = createSignal('');
  const [pendingDelete, setPendingDelete] = createSignal(false);

  const [query, setQuery] = createSignal('');
  const [filterSource, setFilterSource] = createSignal('');
  const [filterInterval, setFilterInterval] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('updated');

  const [fromDate, setFromDate] = createSignal('');
  const [toDate, setToDate] = createSignal('');
  const [maxBars, setMaxBars] = createSignal('');

  let searchEl: HTMLInputElement | undefined;

  const selected = createMemo(() => {
    const k = selectedKey();
    if (!k) return null;
    return rows().find((r) => metaKey(r) === k) ?? null;
  });

  const sourceOptions = createMemo(() => {
    const set = new Set(rows().map((r) => r.sourceId).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  const intervalOptions = createMemo(() => {
    const set = new Set(rows().map((r) => r.interval).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  });

  const filteredRows = createMemo(() => {
    const q = query().trim();
    const src = filterSource();
    const iv = filterInterval();
    const list = rows().filter((r) => {
      if (src && r.sourceId !== src) return false;
      if (iv && r.interval !== iv) return false;
      if (!matchesQuery(r, q)) return false;
      return true;
    });
    return sortRows(list, sortKey());
  });

  const totalBarsCached = createMemo(() =>
    rows().reduce((n, r) => n + (r.count || 0), 0),
  );

  const filtersActive = createMemo(
    () => !!(query().trim() || filterSource() || filterInterval()),
  );

  const tableState = createMemo(() => {
    if (loading() && !rows().length) return 'loading' as const;
    if (!rows().length) return 'empty' as const;
    if (!filteredRows().length) return 'filtered' as const;
    return 'rows' as const;
  });

  const coverage = createMemo(() => {
    const meta = selected();
    const b = bars();
    if (!meta || !b.length) {
      return {
        segments: [] as CoverageSegment[],
        complete: false,
        barCount: 0,
        expectedBars: 0,
        gaps: 0,
      };
    }
    const from = meta.oldestSec ?? b[0]?.time ?? 0;
    const to = meta.newestSec ?? b[b.length - 1]?.time ?? from;
    const { segments, report } = buildCoverageMap(b, from, to, meta.interval);
    return {
      segments,
      complete: report.complete,
      barCount: report.barCount,
      expectedBars: report.expectedBars,
      gaps: report.gaps.length,
    };
  });

  const loadWindow = createMemo((): BarLoadWindow => {
    const fromSec = pastDateInputToSec(fromDate());
    const toSec = dateInputToEndSec(toDate());
    return {
      fromSec,
      toSec,
      maxBars: parseMaxBars(maxBars()),
    };
  });

  const previewCount = createMemo(() => countBarsForLoad(bars(), loadWindow()));

  const dateBounds = createMemo(() => {
    const meta = selected();
    return {
      min: secToDateInput(meta?.oldestSec ?? null),
      max: secToDateInput(meta?.newestSec ?? null),
    };
  });

  const syncLoadDefaults = (meta: BarsCacheMeta | null) => {
    if (!meta) {
      setFromDate('');
      setToDate('');
      setMaxBars('');
      return;
    }
    setFromDate(secToDateInput(meta.oldestSec));
    setToDate(secToDateInput(meta.newestSec));
    setMaxBars('');
  };

  const clearFilters = () => {
    setQuery('');
    setFilterSource('');
    setFilterInterval('');
  };

  const resetLoadWindow = () => {
    syncLoadDefaults(selected());
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listCachedSeries();
      const byKey = new Map(list.map((r) => [r.key, r] as const));
      for (const m of listMemoryDatasets()) {
        if (byKey.has(m.key)) continue;
        byKey.set(m.key, {
          key: m.key,
          sourceId: m.sourceId,
          symbol: m.symbol,
          interval: m.interval,
          count: m.barCount,
          oldestSec: m.oldestSec,
          newestSec: m.newestSec,
          updatedAt: Date.now(),
        });
      }
      const merged = [...byKey.values()];
      setRows(merged);
      const cur = selectedKey();
      if (cur && !merged.some((r) => metaKey(r) === cur)) {
        const next = merged[0] ? metaKey(merged[0]) : null;
        setSelectedKey(next);
        syncLoadDefaults(merged[0] ?? null);
      } else if (!cur && merged[0]) {
        setSelectedKey(metaKey(merged[0]));
        syncLoadDefaults(merged[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
    setPendingDelete(false);
    setError('');
    setMsg('');
    void refresh();
  });

  createEffect(() => {
    const meta = selected();
    if (!props.open || !meta) {
      setBars([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const b = await getCachedBars(meta.sourceId, meta.symbol, meta.interval);
        if (!cancelled) setBars(b);
      } catch {
        if (!cancelled) setBars([]);
      }
    })();
    onCleanup(() => {
      cancelled = true;
    });
  });

  const selectRow = (row: BarsCacheMeta) => {
    setSelectedKey(metaKey(row));
    syncLoadDefaults(row);
    setPendingDelete(false);
    setError('');
    setMsg('');
  };

  const moveSelection = (dir: 1 | -1) => {
    const list = filteredRows();
    if (!list.length) return;
    const cur = selectedKey();
    const idx = list.findIndex((r) => metaKey(r) === cur);
    const next = Math.min(list.length - 1, Math.max(0, (idx < 0 ? 0 : idx) + dir));
    const row = list[next];
    if (row && next !== idx) selectRow(row);
  };

  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pendingDelete()) {
        setPendingDelete(false);
        return;
      }
      props.onClose();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    if (isTypingTarget(e.target)) return;
    const list = filteredRows();
    if (!list.length) return;
    e.preventDefault();
    const first = list[0];
    const last = list[list.length - 1];
    if (e.key === 'Home' && first) selectRow(first);
    else if (e.key === 'End' && last) selectRow(last);
    else if (e.key === 'ArrowDown') moveSelection(1);
    else moveSelection(-1);
  };

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const onLoad = async () => {
    const meta = selected();
    if (!meta) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const win = loadWindow();
      if (win.fromSec != null && win.toSec != null && win.fromSec > win.toSec) {
        setError('From date must be on or before To date.');
        return;
      }
      const n = countBarsForLoad(bars(), win);
      if (n <= 0) {
        setError('No bars in the selected date range / max bars window.');
        return;
      }

      setDataManagerSelection(meta.sourceId, meta.symbol, meta.interval, win);
      setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
      const streamId = defaultStreamForSource(DATA_MANAGER_SOURCE_ID);
      setActivePlugin('stream', streamId);
      setStore('symbol', meta.symbol);
      setStore('interval', meta.interval);
      persist();
      const ok = await applyCachedToChart(meta.sourceId, meta.symbol, meta.interval, win);
      if (!ok) {
        setError('Could not load bars onto the chart.');
        return;
      }
      const restartLive = !!store.live.active || !!store.live.preferAfterLoad;
      if (restartLive) {
        try {
          const { startLive } = await import('../streams/multiplex');
          startLive(streamId, meta.symbol, meta.interval);
        } catch {
          /* live optional */
        }
      }
      const after = await getCachedBars(meta.sourceId, meta.symbol, meta.interval);
      const parts = [
        `Loaded ${meta.symbol} ${meta.interval}`,
        `${after.length.toLocaleString()} bars in dataset`,
      ];
      if (after.length > n) {
        parts.push(`+${(after.length - n).toLocaleString()} filled to now`);
      }
      if (win.maxBars) parts.push(`max ${win.maxBars.toLocaleString()}`);
      parts.push(`stream ${streamId}`);
      setMsg(parts.join(' · '));
      announce(`Loaded ${n} bars ${meta.symbol} ${meta.interval}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const meta = selected();
    if (!meta) return;
    setBusy(true);
    setError('');
    try {
      await clearCachedBars(meta.sourceId, meta.symbol, meta.interval);
      setMsg('Dataset removed from cache.');
      setPendingDelete(false);
      announce(`Deleted ${meta.symbol} ${meta.interval} dataset`);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: LoadPreset) => {
    const meta = selected();
    if (!meta) return;
    if (preset === 'full') {
      resetLoadWindow();
      return;
    }
    if (preset === '1k') {
      setMaxBars('1000');
      return;
    }
    if (preset === '5k') {
      setMaxBars('5000');
      return;
    }
    const newest = meta.newestSec;
    if (newest == null) return;
    const days = preset === '30d' ? 30 : 90;
    const from = newest - days * 86_400;
    setFromDate(secToDateInput(Math.max(from, meta.oldestSec ?? from)));
    setToDate(secToDateInput(newest));
  };

  const toggleSort = (key: SortKey) => {
    setSortKey(key);
  };

  return (
    <Show when={props.open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop is an intentional click-away dismiss surface for the dialog */}
      <div class="sc-dialog-backdrop" onClick={onBackdrop} role="presentation">
        <div
          class="sc-dialog w-[min(960px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(88vh,820px)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-cached-datasets-title"
          data-testid="axis-cached-datasets-modal"
          tabIndex={-1}
          onKeyDown={onDialogKey}
          ref={(el) => {
            if (!el) return;
            const dispose = installFocusTrap(el, { autoFocus: false });
            queueMicrotask(() => searchEl?.focus());
            onCleanup(dispose);
          }}
        >
          <div class="sc-dialog-accent" />
          <div class="sc-dialog-header">
            <div class="min-w-0">
              <div
                id="axis-cached-datasets-title"
                class="text-[0.95em] font-semibold text-text tracking-tight"
              >
                Dataset manager
              </div>
              <div class="sc-hint truncate">
                Local OHLCV cache · filter, inspect coverage, load a date range or max bars
              </div>
            </div>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="sc-btn sc-btn-ghost sc-btn-sm"
                onClick={() => void refresh()}
                disabled={loading()}
                title="Refresh list"
                aria-label="Refresh dataset list"
              >
                <Icons.refresh />
              </button>
              <button
                type="button"
                class="sc-btn sc-btn-ghost px-2"
                onClick={() => props.onClose()}
                aria-label="Close"
              >
                <Icons.x />
              </button>
            </div>
          </div>

          <div class="sc-dialog-body flex flex-col gap-3.5 min-h-0 overflow-hidden flex-1">
            <Show when={error()}>
              <div
                class="text-[11px] text-red border border-red/40 bg-red/10 px-2 py-1.5 rounded"
                role="alert"
              >
                {error()}
              </div>
            </Show>
            <Show when={msg() && !error()}>
              <div
                class="text-[11px] text-[var(--color-green,#5ecf8a)] border border-[color-mix(in_srgb,var(--color-green,#5ecf8a)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-green,#5ecf8a)_10%,transparent)] px-2 py-1.5 rounded"
                role="status"
              >
                {msg()}
              </div>
            </Show>

            <div
              class="flex flex-wrap items-end gap-2"
              data-testid="axis-cached-datasets-filters"
            >
              <DsmField label="Filter" class="min-w-[10rem] flex-1">
                <input
                  ref={(el) => {
                    searchEl = el;
                  }}
                  type="search"
                  class="sc-input"
                  placeholder="Symbol, source, interval…"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-query"
                  autocomplete="off"
                  spellcheck={false}
                />
              </DsmField>
              <DsmField label="Source" class="w-[8.5rem]">
                <select
                  class="sc-input"
                  value={filterSource()}
                  onChange={(e) => setFilterSource(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-source"
                >
                  <option value="">All sources</option>
                  <For each={sourceOptions()}>{(s) => <option value={s}>{s}</option>}</For>
                </select>
              </DsmField>
              <DsmField label="Interval" class="w-[6.5rem]">
                <select
                  class="sc-input"
                  value={filterInterval()}
                  onChange={(e) => setFilterInterval(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-interval"
                >
                  <option value="">All</option>
                  <For each={intervalOptions()}>{(iv) => <option value={iv}>{iv}</option>}</For>
                </select>
              </DsmField>
              <DsmField label="Sort" class="w-[7.5rem]">
                <select
                  class="sc-input"
                  value={sortKey()}
                  onChange={(e) => setSortKey(e.currentTarget.value as SortKey)}
                  data-testid="axis-cached-datasets-sort"
                >
                  <For each={SORT_OPTIONS}>
                    {(opt) => <option value={opt.id}>{opt.label}</option>}
                  </For>
                </select>
              </DsmField>
              <Show when={filtersActive()}>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost sc-btn-sm self-end"
                  onClick={clearFilters}
                  title="Clear filters"
                >
                  Clear
                </button>
              </Show>
            </div>

            <div class="text-[0.7rem] text-muted flex flex-wrap gap-x-3 gap-y-0.5">
              <span>
                {filteredRows().length}
                {filtersActive() ? ` / ${rows().length}` : ''} dataset
                {filteredRows().length === 1 ? '' : 's'}
              </span>
              <span>{totalBarsCached().toLocaleString()} bars cached</span>
              <Show when={loading()}>
                <span>Refreshing…</span>
              </Show>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3 min-h-0 flex-1">
              <div
                class="border border-border rounded overflow-auto min-h-[12rem] max-h-[min(48vh,380px)]"
                data-testid="axis-cached-datasets-list"
              >
                <Switch>
                  <Match when={tableState() === 'loading'}>
                    <div class="p-3 text-muted text-[0.78rem]">Loading…</div>
                  </Match>
                  <Match when={tableState() === 'empty'}>
                    <div class="p-3 text-muted text-[0.78rem] leading-snug">
                      No downloaded datasets yet. Run a background backfill in the
                      Data Source Manager first.
                    </div>
                  </Match>
                  <Match when={tableState() === 'filtered'}>
                    <div class="p-3 text-muted text-[0.78rem]">
                      No datasets match the current filters.
                    </div>
                  </Match>
                  <Match when={tableState() === 'rows'}>
                    <table class="w-full text-left border-collapse text-[0.78rem]">
                      <thead class="sticky top-0 z-[1] bg-[var(--bg-elevated,var(--color-bg-elevated,var(--bg)))] shadow-[0_1px_0_var(--border)]">
                        <tr class="text-[0.68rem] uppercase tracking-wide text-muted">
                          <th class="px-2 py-1.5 font-medium">
                            <button
                              type="button"
                              class="hover:text-text"
                              onClick={() => toggleSort('symbol')}
                            >
                              Symbol{sortKey() === 'symbol' ? ' ▾' : ''}
                            </button>
                          </th>
                          <th class="px-2 py-1.5 font-medium">TF</th>
                          <th class="px-2 py-1.5 font-medium">Source</th>
                          <th class="px-2 py-1.5 font-medium text-right">
                            <button
                              type="button"
                              class="hover:text-text"
                              onClick={() => toggleSort('bars')}
                            >
                              Bars{sortKey() === 'bars' ? ' ▾' : ''}
                            </button>
                          </th>
                          <th class="px-2 py-1.5 font-medium">
                            <button
                              type="button"
                              class="hover:text-text"
                              onClick={() => toggleSort('span')}
                            >
                              Span{sortKey() === 'span' ? ' ▾' : ''}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border">
                        <For each={filteredRows()}>
                          {(row) => {
                            const k = () => metaKey(row);
                            const active = () => selectedKey() === k();
                            return (
                              <tr
                                class={`cursor-pointer transition-colors ${
                                  active()
                                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
                                    : 'hover:bg-[var(--bg-hover,var(--color-bg-hover))]'
                                }`}
                                onClick={() => selectRow(row)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    selectRow(row);
                                  }
                                }}
                                tabIndex={active() ? 0 : -1}
                                aria-selected={active()}
                                data-testid={`axis-cached-dataset-${k()}`}
                              >
                                <td class="px-2 py-1.5 font-medium whitespace-nowrap">
                                  {row.symbol}
                                </td>
                                <td class="px-2 py-1.5 text-muted whitespace-nowrap">
                                  {row.interval}
                                </td>
                                <td
                                  class="px-2 py-1.5 text-muted truncate max-w-[8rem]"
                                  title={row.sourceId}
                                >
                                  {row.sourceId}
                                </td>
                                <td class="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                  {row.count.toLocaleString()}
                                </td>
                                <td class="px-2 py-1.5 text-muted whitespace-nowrap">
                                  {fmtDuration(row.oldestSec, row.newestSec)}
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </Match>
                </Switch>
              </div>

              <div class="border border-border rounded p-2.5 flex flex-col gap-2.5 min-h-[12rem] overflow-y-auto">
                <Show
                  when={selected()}
                  fallback={
                    <div class="text-muted text-[0.78rem]">
                      Select a dataset to inspect coverage and choose a load window.
                    </div>
                  }
                >
                  {(meta) => {
                    const cov = () => coverage();
                    return (
                      <>
                        <div>
                          <div class="text-[0.88rem] font-semibold">
                            {meta().symbol}{' '}
                            <span class="text-muted font-normal">{meta().interval}</span>
                          </div>
                          <div class="text-[0.72rem] text-muted">{meta().sourceId}</div>
                        </div>

                        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[0.75rem]">
                          <span class="text-muted">Bars</span>
                          <span class="tabular-nums">{meta().count.toLocaleString()}</span>
                          <span class="text-muted">Oldest</span>
                          <span class="tabular-nums">{fmtTime(meta().oldestSec)}</span>
                          <span class="text-muted">Newest</span>
                          <span class="tabular-nums">{fmtTime(meta().newestSec)}</span>
                          <span class="text-muted">Span</span>
                          <span>{fmtDuration(meta().oldestSec, meta().newestSec)}</span>
                          <span class="text-muted">Updated</span>
                          <span class="tabular-nums">{fmtMillis(meta().updatedAt)}</span>
                          <span class="text-muted">Cache key</span>
                          <span class="truncate font-mono text-[0.68rem]" title={meta().key}>
                            {meta().key}
                          </span>
                        </div>

                        <CompleteMap
                          segments={cov().segments}
                          complete={cov().complete}
                          barCount={cov().barCount}
                          expectedBars={cov().expectedBars}
                          gaps={cov().gaps}
                        />

                        <div
                          class="border-t border-border pt-2 flex flex-col gap-2"
                          data-testid="axis-cached-datasets-load-window"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <div class="text-[0.68rem] uppercase tracking-wide text-muted font-medium">
                              Load to chart
                            </div>
                            {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
                            <div class="sc-chip-row" role="group" aria-label="Load window presets">
                              <For each={LOAD_PRESETS}>
                                {(p) => (
                                  <button
                                    type="button"
                                    class="sc-chip"
                                    onClick={() => applyPreset(p.id)}
                                    title={p.title}
                                  >
                                    {p.label}
                                  </button>
                                )}
                              </For>
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <DsmField label="From (UTC)">
                              <input
                                type="date"
                                class="sc-input"
                                value={fromDate()}
                                min={dateBounds().min || undefined}
                                max={dateBounds().max || undefined}
                                onInput={(e) => setFromDate(e.currentTarget.value)}
                                data-testid="axis-cached-datasets-from"
                              />
                            </DsmField>
                            <DsmField label="To (UTC)">
                              <input
                                type="date"
                                class="sc-input"
                                value={toDate()}
                                min={dateBounds().min || undefined}
                                max={dateBounds().max || undefined}
                                onInput={(e) => setToDate(e.currentTarget.value)}
                                data-testid="axis-cached-datasets-to"
                              />
                            </DsmField>
                          </div>

                          <DsmField label="Max bars (optional)">
                            <input
                              type="number"
                              class="sc-input"
                              min={1}
                              step={1}
                              placeholder="All bars in range"
                              value={maxBars()}
                              onInput={(e) => setMaxBars(e.currentTarget.value)}
                              data-testid="axis-cached-datasets-max-bars"
                            />
                          </DsmField>

                          <div
                            class="text-[0.72rem] text-muted"
                            data-testid="axis-cached-datasets-preview-count"
                          >
                            Will load{' '}
                            <strong class="text-text tabular-nums">
                              {previewCount().toLocaleString()}
                            </strong>{' '}
                            of {meta().count.toLocaleString()} cached bars
                            {previewCount() === 0 ? ' — adjust range or max bars' : ''}
                          </div>
                        </div>
                      </>
                    );
                  }}
                </Show>
              </div>
            </div>
          </div>

          <div class="sc-dialog-footer">
            <Show
              when={pendingDelete()}
              fallback={
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost"
                  disabled={!selected() || busy()}
                  onClick={() => setPendingDelete(true)}
                  title="Remove from local cache"
                >
                  <Icons.trash />
                  <span>Delete</span>
                </button>
              }
            >
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-red text-[0.78rem] truncate">Delete this dataset?</span>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost sc-btn-sm"
                  onClick={() => setPendingDelete(false)}
                >
                  No
                </button>
                <button
                  type="button"
                  class="sc-btn sc-btn-ghost sc-btn-sm text-red"
                  disabled={busy()}
                  onClick={() => void onDelete()}
                >
                  Yes, delete
                </button>
              </div>
            </Show>
            <div class="flex-1" />
            <button type="button" class="sc-btn sc-btn-ghost" onClick={() => props.onClose()}>
              Close
            </button>
            <button
              type="button"
              class="sc-btn sc-btn-primary"
              disabled={!selected() || busy() || previewCount() <= 0}
              onClick={() => void onLoad()}
              data-testid="axis-cached-datasets-load"
              aria-busy={busy() || undefined}
            >
              <Icons.download />
              <span>
                {busy()
                  ? 'Loading…'
                  : previewCount() > 0
                    ? `Load ${previewCount().toLocaleString()} bars`
                    : 'Load to chart'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
