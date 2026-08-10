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
  Component,
  For,
  Show,
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

export interface CachedDatasetsModalProps {
  open: boolean;
  onClose: () => void;
}

type SortKey = 'updated' | 'bars' | 'symbol' | 'span';

function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(sec);
  }
}

function fmtDuration(fromSec: number | null, toSec: number | null): string {
  if (fromSec == null || toSec == null || toSec < fromSec) return '—';
  const days = Math.max(0, Math.round((toSec - fromSec) / 86_400));
  if (days < 2) {
    const hours = Math.max(0, Math.round((toSec - fromSec) / 3_600));
    return `${hours}h`;
  }
  if (days < 60) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months}mo`;
  const years = Math.round(days / 365);
  return `${years}y`;
}

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

/** Horizontal coverage strip: green = data, red = gap. */
const CompleteMap: Component<{
  segments: CoverageSegment[];
  complete: boolean;
  barCount: number;
  expectedBars: number;
  gaps: number;
}> = (props) => {
  return (
    <div class="flex flex-col gap-1" data-testid="axis-complete-map">
      <div class="flex items-center justify-between text-[0.72rem] text-muted">
        <span>Data complete map</span>
        <span>
          {props.complete
            ? 'Full coverage'
            : props.gaps > 0
              ? `${props.gaps} gap${props.gaps === 1 ? '' : 's'}`
              : 'Partial'}
          {' · '}
          {props.barCount.toLocaleString()}
          {props.expectedBars > 0 ? ` / ~${props.expectedBars.toLocaleString()}` : ''} bars
        </span>
      </div>
      <div
        class="h-4 rounded overflow-hidden flex border border-[var(--border)]"
        role="img"
        aria-label={
          props.complete
            ? 'Complete coverage'
            : `Coverage map with ${props.gaps} gaps`
        }
      >
        <Show
          when={props.segments.length}
          fallback={<div class="flex-1 bg-[var(--border)]" title="No data" />}
        >
          <For each={props.segments}>
            {(seg) => (
              <div
                class="h-full min-w-[2px]"
                style={{
                  flex: `${Math.max(seg.weight, 0.005)} 0 0`,
                  background:
                    seg.kind === 'data'
                      ? 'color-mix(in srgb, var(--color-green, #5ecf8a) 75%, transparent)'
                      : 'color-mix(in srgb, var(--color-red, #e85d4c) 70%, transparent)',
                }}
                title={`${seg.kind === 'data' ? 'Data' : 'Gap'}: ${fmtTime(seg.fromSec)} → ${fmtTime(seg.toSec)}`}
              />
            )}
          </For>
        </Show>
      </div>
      <div class="flex gap-3 text-[0.68rem] text-muted">
        <span class="inline-flex items-center gap-1">
          <span
            class="inline-block w-2.5 h-2.5 rounded-sm"
            style={{
              background:
                'color-mix(in srgb, var(--color-green, #5ecf8a) 75%, transparent)',
            }}
          />
          Data
        </span>
        <span class="inline-flex items-center gap-1">
          <span
            class="inline-block w-2.5 h-2.5 rounded-sm"
            style={{
              background:
                'color-mix(in srgb, var(--color-red, #e85d4c) 70%, transparent)',
            }}
          />
          Gap
        </span>
      </div>
    </div>
  );
};

/** Modal: browse local OHLCV datasets from the Data Source Manager cache. */
export const CachedDatasetsModal: Component<CachedDatasetsModalProps> = (props) => {
  const [rows, setRows] = createSignal<BarsCacheMeta[]>([]);
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const [bars, setBars] = createSignal<Bar[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [msg, setMsg] = createSignal('');

  // Table filters
  const [query, setQuery] = createSignal('');
  const [filterSource, setFilterSource] = createSignal('');
  const [filterInterval, setFilterInterval] = createSignal('');
  const [sortKey, setSortKey] = createSignal<SortKey>('updated');

  // Load window
  const [fromDate, setFromDate] = createSignal('');
  const [toDate, setToDate] = createSignal('');
  const [maxBars, setMaxBars] = createSignal('');

  const selected = () => {
    const k = selectedKey();
    if (!k) return null;
    return rows().find((r) => metaKey(r) === k) ?? null;
  };

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
    const sort = sortKey();
    let list = rows().filter((r) => {
      if (src && r.sourceId !== src) return false;
      if (iv && r.interval !== iv) return false;
      if (!matchesQuery(r, q)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
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
        case 'updated':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    });
    return list;
  });

  const totalBarsCached = createMemo(() =>
    rows().reduce((n, r) => n + (r.count || 0), 0),
  );

  const filtersActive = createMemo(
    () => !!(query().trim() || filterSource() || filterInterval()),
  );

  const coverage = () => {
    const meta = selected();
    const b = bars();
    if (!meta || !b.length) {
      return {
        segments: [] as CoverageSegment[],
        complete: false,
        barCount: 0,
        expectedBars: 0,
        gaps: 0,
        oldest: null as number | null,
        newest: null as number | null,
      };
    }
    const from = meta.oldestSec ?? b[0]!.time;
    const to = meta.newestSec ?? b[b.length - 1]!.time;
    const { segments, report } = buildCoverageMap(b, from, to, meta.interval);
    return {
      segments,
      complete: report.complete,
      barCount: report.barCount,
      expectedBars: report.expectedBars,
      gaps: report.gaps.length,
      oldest: report.oldestSec,
      newest: report.newestSec,
    };
  };

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
      setRows(list);
      const cur = selectedKey();
      if (cur && !list.some((r) => metaKey(r) === cur)) {
        const next = list[0] ? metaKey(list[0]) : null;
        setSelectedKey(next);
        syncLoadDefaults(list[0] ?? null);
      } else if (!cur && list[0]) {
        setSelectedKey(metaKey(list[0]));
        syncLoadDefaults(list[0]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (!props.open) return;
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

  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = filteredRows();
      if (!list.length) return;
      const cur = selectedKey();
      const idx = list.findIndex((r) => metaKey(r) === cur);
      let next = idx;
      if (e.key === 'ArrowDown') next = Math.min(list.length - 1, Math.max(0, idx) + 1);
      else next = Math.max(0, (idx < 0 ? 0 : idx) - 1);
      if (next !== idx && list[next]) {
        e.preventDefault();
        selectRow(list[next]!);
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  const selectRow = (row: BarsCacheMeta) => {
    setSelectedKey(metaKey(row));
    syncLoadDefaults(row);
    setError('');
    setMsg('');
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
      // Validate date range when both set
      if (
        win.fromSec != null &&
        win.toSec != null &&
        win.fromSec > win.toSec
      ) {
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
      // Venue stream for live candles (not mock-poll)
      const streamId = defaultStreamForSource(DATA_MANAGER_SOURCE_ID);
      setActivePlugin('stream', streamId);
      setStore('symbol', meta.symbol);
      setStore('interval', meta.interval);
      persist();
      const ok = await applyCachedToChart(
        meta.sourceId,
        meta.symbol,
        meta.interval,
        win,
      );
      if (!ok) {
        setError('Could not load bars onto the chart.');
      } else {
        // Restart live on the venue stream when already live / prefer-after-load
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
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const meta = selected();
    if (!meta) return;
    if (!confirm(`Delete cached ${meta.symbol} ${meta.interval} (${meta.sourceId})?`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await clearCachedBars(meta.sourceId, meta.symbol, meta.interval);
      setMsg('Dataset removed from cache.');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: 'full' | '1k' | '5k' | '30d' | '90d') => {
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

  return (
    <Show when={props.open}>
      <div
        class="sc-dialog-backdrop"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(960px,calc(100vw-2*var(--ui-dialog-margin)))] max-h-[min(88vh,820px)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="axis-cached-datasets-title"
          data-testid="axis-cached-datasets-modal"
          tabIndex={-1}
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
              <div class="text-[11px] text-muted">{msg()}</div>
            </Show>

            {/* Filter bar */}
            <div
              class="flex flex-wrap items-end gap-2"
              data-testid="axis-cached-datasets-filters"
            >
              <label class="flex flex-col gap-0.5 min-w-[10rem] flex-1">
                <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                  Filter
                </span>
                <input
                  type="search"
                  class="sc-input"
                  placeholder="Symbol, source, interval…"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-query"
                  autocomplete="off"
                  spellcheck={false}
                />
              </label>
              <label class="flex flex-col gap-0.5 w-[8.5rem]">
                <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                  Source
                </span>
                <select
                  class="sc-input"
                  value={filterSource()}
                  onChange={(e) => setFilterSource(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-source"
                >
                  <option value="">All sources</option>
                  <For each={sourceOptions()}>
                    {(s) => <option value={s}>{s}</option>}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-0.5 w-[6.5rem]">
                <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                  Interval
                </span>
                <select
                  class="sc-input"
                  value={filterInterval()}
                  onChange={(e) => setFilterInterval(e.currentTarget.value)}
                  data-testid="axis-cached-datasets-filter-interval"
                >
                  <option value="">All</option>
                  <For each={intervalOptions()}>
                    {(iv) => <option value={iv}>{iv}</option>}
                  </For>
                </select>
              </label>
              <label class="flex flex-col gap-0.5 w-[7.5rem]">
                <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                  Sort
                </span>
                <select
                  class="sc-input"
                  value={sortKey()}
                  onChange={(e) => setSortKey(e.currentTarget.value as SortKey)}
                  data-testid="axis-cached-datasets-sort"
                >
                  <option value="updated">Updated</option>
                  <option value="bars">Bars</option>
                  <option value="symbol">Symbol</option>
                  <option value="span">Span</option>
                </select>
              </label>
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
              {/* Table */}
              <div
                class="border border-[var(--border)] rounded overflow-auto min-h-[12rem] max-h-[min(48vh,380px)]"
                data-testid="axis-cached-datasets-list"
              >
                <Show
                  when={!loading() || rows().length}
                  fallback={
                    <div class="p-3 text-muted text-[0.78rem]">Loading…</div>
                  }
                >
                  <Show
                    when={rows().length}
                    fallback={
                      <div class="p-3 text-muted text-[0.78rem] leading-snug">
                        No downloaded datasets yet. Run a background backfill in
                        the Data Source Manager first.
                      </div>
                    }
                  >
                    <Show
                      when={filteredRows().length}
                      fallback={
                        <div class="p-3 text-muted text-[0.78rem]">
                          No datasets match the current filters.
                        </div>
                      }
                    >
                      <table class="w-full text-left border-collapse text-[0.78rem]">
                        <thead class="sticky top-0 z-[1] bg-[var(--bg-elevated,var(--color-bg-elevated,var(--bg)))] shadow-[0_1px_0_var(--border)]">
                          <tr class="text-[0.68rem] uppercase tracking-wide text-muted">
                            <th class="px-2 py-1.5 font-medium">Symbol</th>
                            <th class="px-2 py-1.5 font-medium">TF</th>
                            <th class="px-2 py-1.5 font-medium">Source</th>
                            <th class="px-2 py-1.5 font-medium text-right">Bars</th>
                            <th class="px-2 py-1.5 font-medium">Span</th>
                          </tr>
                        </thead>
                        <tbody class="divide-y divide-[var(--border)]">
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
                                  data-testid={`axis-cached-dataset-${k()}`}
                                  aria-selected={active()}
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
                    </Show>
                  </Show>
                </Show>
              </div>

              {/* Details + load window */}
              <div class="border border-[var(--border)] rounded p-2.5 flex flex-col gap-2.5 min-h-[12rem] overflow-y-auto">
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
                          <span class="tabular-nums">
                            {meta().updatedAt
                              ? new Date(meta().updatedAt)
                                  .toISOString()
                                  .slice(0, 16)
                                  .replace('T', ' ')
                              : '—'}
                          </span>
                          <span class="text-muted">Cache key</span>
                          <span
                            class="truncate font-mono text-[0.68rem]"
                            title={meta().key}
                          >
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
                          class="border-t border-[var(--border)] pt-2 flex flex-col gap-2"
                          data-testid="axis-cached-datasets-load-window"
                        >
                          <div class="flex items-center justify-between gap-2">
                            <div class="text-[0.72rem] uppercase tracking-wide text-muted font-medium">
                              Load to chart
                            </div>
                            <div class="flex flex-wrap gap-1">
                              <button
                                type="button"
                                class="sc-btn sc-btn-ghost sc-btn-sm text-[0.68rem]"
                                onClick={() => applyPreset('full')}
                                title="Full series in cache"
                              >
                                Full
                              </button>
                              <button
                                type="button"
                                class="sc-btn sc-btn-ghost sc-btn-sm text-[0.68rem]"
                                onClick={() => applyPreset('30d')}
                              >
                                30d
                              </button>
                              <button
                                type="button"
                                class="sc-btn sc-btn-ghost sc-btn-sm text-[0.68rem]"
                                onClick={() => applyPreset('90d')}
                              >
                                90d
                              </button>
                              <button
                                type="button"
                                class="sc-btn sc-btn-ghost sc-btn-sm text-[0.68rem]"
                                onClick={() => applyPreset('1k')}
                              >
                                1k
                              </button>
                              <button
                                type="button"
                                class="sc-btn sc-btn-ghost sc-btn-sm text-[0.68rem]"
                                onClick={() => applyPreset('5k')}
                              >
                                5k
                              </button>
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            <label class="flex flex-col gap-0.5">
                              <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                                From (UTC)
                              </span>
                              <input
                                type="date"
                                class="sc-input"
                                value={fromDate()}
                                min={dateBounds().min || undefined}
                                max={dateBounds().max || undefined}
                                onInput={(e) => setFromDate(e.currentTarget.value)}
                                data-testid="axis-cached-datasets-from"
                              />
                            </label>
                            <label class="flex flex-col gap-0.5">
                              <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                                To (UTC)
                              </span>
                              <input
                                type="date"
                                class="sc-input"
                                value={toDate()}
                                min={dateBounds().min || undefined}
                                max={dateBounds().max || undefined}
                                onInput={(e) => setToDate(e.currentTarget.value)}
                                data-testid="axis-cached-datasets-to"
                              />
                            </label>
                          </div>

                          <label class="flex flex-col gap-0.5">
                            <span class="text-muted text-[0.68rem] uppercase tracking-wide">
                              Max bars (optional)
                            </span>
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
                          </label>

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
            <button
              type="button"
              class="sc-btn sc-btn-ghost"
              disabled={!selected() || busy()}
              onClick={() => void onDelete()}
              title="Remove from local cache"
            >
              <Icons.trash />
              <span>Delete</span>
            </button>
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
