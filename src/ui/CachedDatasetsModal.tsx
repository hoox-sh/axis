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
 * Cached datasets browser — lists bars-cache series with details and a
 * data-complete map (coverage timeline with gaps).
 */

import {
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { Bar } from '../store/types';
import { setStore, persist, setActivePlugin } from '../store';
import {
  clearCachedBars,
  getCachedBars,
  listCachedSeries,
  type BarsCacheMeta,
} from '../data/bars-cache';
import { buildCoverageMap, type CoverageSegment } from '../data/bars-gaps';
import {
  applyCachedToChart,
} from '../data/data-source-manager';
import {
  DATA_MANAGER_SOURCE_ID,
  setDataManagerSelection,
} from '../data/data-manager-source';
import { Icons } from './icons';

export interface CachedDatasetsModalProps {
  open: boolean;
  onClose: () => void;
}

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
  return `${months}mo`;
}

function metaKey(m: BarsCacheMeta): string {
  return m.key || `${m.sourceId}|${m.symbol}|${m.interval}`;
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
          {props.barCount}
          {props.expectedBars > 0 ? ` / ~${props.expectedBars}` : ''} bars
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
          fallback={
            <div class="flex-1 bg-[var(--border)]" title="No data" />
          }
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

  const selected = () => {
    const k = selectedKey();
    if (!k) return null;
    return rows().find((r) => metaKey(r) === k) ?? null;
  };

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

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await listCachedSeries();
      setRows(list);
      const cur = selectedKey();
      if (cur && !list.some((r) => metaKey(r) === cur)) {
        setSelectedKey(list[0] ? metaKey(list[0]) : null);
      } else if (!cur && list[0]) {
        setSelectedKey(metaKey(list[0]));
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
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

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
      setDataManagerSelection(meta.sourceId, meta.symbol, meta.interval);
      setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
      setStore('symbol', meta.symbol);
      setStore('interval', meta.interval);
      persist();
      const ok = await applyCachedToChart(meta.sourceId, meta.symbol, meta.interval);
      if (!ok) {
        setError('Could not load bars onto the chart.');
      } else {
        setMsg(`Loaded ${meta.symbol} ${meta.interval} from cache.`);
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

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4 backdrop-blur-[2px]"
        onClick={onBackdrop}
        role="presentation"
      >
        <div
          class="sc-dialog w-[min(720px,calc(100vw-24px))] max-h-[min(88vh,720px)] flex flex-col"
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
                Cached datasets
              </div>
              <div class="sc-hint truncate">
                Local OHLCV from Data Source Manager · select to inspect coverage
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

          <div class="sc-dialog-body flex flex-col gap-3 min-h-0 overflow-hidden flex-1">
            <Show when={error()}>
              <div class="text-[11px] text-red border border-red/40 bg-red/10 px-2 py-1.5" role="alert">
                {error()}
              </div>
            </Show>
            <Show when={msg() && !error()}>
              <div class="text-[11px] text-muted">{msg()}</div>
            </Show>

            <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 min-h-0 flex-1">
              {/* List */}
              <div
                class="border border-[var(--border)] rounded overflow-y-auto min-h-[10rem] max-h-[min(50vh,360px)]"
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
                    <ul class="m-0 p-0 list-none divide-y divide-[var(--border)]">
                      <For each={rows()}>
                        {(row) => {
                          const k = () => metaKey(row);
                          const active = () => selectedKey() === k();
                          return (
                            <li>
                              <button
                                type="button"
                                class={`w-full text-left px-2.5 py-2 transition-colors ${
                                  active()
                                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
                                    : 'hover:bg-[var(--bg-hover,var(--color-bg-hover))]'
                                }`}
                                onClick={() => setSelectedKey(k())}
                                data-testid={`axis-cached-dataset-${k()}`}
                                aria-current={active() ? 'true' : undefined}
                              >
                                <div class="font-medium text-[0.82rem] truncate">
                                  {row.symbol} · {row.interval}
                                </div>
                                <div class="text-[0.7rem] text-muted truncate">
                                  {row.sourceId} · {row.count.toLocaleString()} bars ·{' '}
                                  {fmtDuration(row.oldestSec, row.newestSec)}
                                </div>
                              </button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </div>

              {/* Details */}
              <div class="border border-[var(--border)] rounded p-2.5 flex flex-col gap-2.5 min-h-[10rem] overflow-y-auto">
                <Show
                  when={selected()}
                  fallback={
                    <div class="text-muted text-[0.78rem]">
                      Select a dataset to see details and the complete map.
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
                          <span>{meta().count.toLocaleString()}</span>
                          <span class="text-muted">Oldest</span>
                          <span>{fmtTime(meta().oldestSec)}</span>
                          <span class="text-muted">Newest</span>
                          <span>{fmtTime(meta().newestSec)}</span>
                          <span class="text-muted">Span</span>
                          <span>{fmtDuration(meta().oldestSec, meta().newestSec)}</span>
                          <span class="text-muted">Updated</span>
                          <span>
                            {meta().updatedAt
                              ? new Date(meta().updatedAt).toISOString().slice(0, 16).replace('T', ' ')
                              : '—'}
                          </span>
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
              disabled={!selected() || busy()}
              onClick={() => void onLoad()}
              data-testid="axis-cached-datasets-load"
            >
              <Icons.download />
              <span>{busy() ? 'Loading…' : 'Load to chart'}</span>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
