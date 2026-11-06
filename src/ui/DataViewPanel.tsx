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
 * Data Window — OHLCV + plot series + drawing + on-chain values at the
 * crosshair bar.
 *
 * Rows from `buildDataViewRows` using `store.bars`, `store.crosshair`,
 * last-run series/plot_meta, `store.drawings`, and
 * `onchainManagerState.series`. FloatableShell id `dataview`.
 *
 * The header can **pin** a bar (freeze it while the crosshair moves) and step
 * through bars with prev/next, so values can be read without hovering. Rows
 * copy individually or as TSV.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js';
import { store, isPanelOpen } from '../store';
import { barPlane } from '../stores/bars';
import {
  barIndexAtTime,
  buildDataViewRows,
  mergePlotDisplayOverrides,
  type DataViewPlotMeta,
  type DataViewRow,
} from '../results/dataview';
import type { RunResult } from '../indicators/runner';
import type { Bar } from '../store/types';
import { onchainManagerState } from '../onchain/manager';
import { FloatableShell } from './panels/FloatableShell';
import { Icons } from './icons';
import { copyToClipboard } from './clipboard';
import type { PlotSample } from '../plugins/types';
import { bindSlashToSearch } from './focus-search';

type GroupId = 'bar' | 'ohlcv' | 'plots' | 'drawings' | 'onchain';

const GROUPS: { id: GroupId; label: string; rowGroup: DataViewRow['group'] }[] = [
  { id: 'bar', label: 'Bar', rowGroup: 'meta' },
  { id: 'ohlcv', label: 'OHLCV', rowGroup: 'ohlcv' },
  { id: 'plots', label: 'Plots', rowGroup: 'series' },
  { id: 'drawings', label: 'Drawings', rowGroup: 'drawings' },
  { id: 'onchain', label: 'On-chain', rowGroup: 'onchain' },
];

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(2);
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toPrecision(4);
}

function fmtBarTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return '—';
  const ms = t > 1e12 ? t : t * 1000;
  try {
    return new Date(ms)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(t);
  }
}

/** Crosshair-synced OHLCV / plot / drawing / on-chain value inspector. */
export const DataViewPanel: Component = () : JSX.Element => {
  const [pinnedIndex, setPinnedIndex] = createSignal<number | null>(null);
  /** Last bar seen under the crosshair — survives pointer-leave for pin/step. */
  const [lastSeenIndex, setLastSeenIndex] = createSignal<number | null>(null);
  const [query, setQuery] = createSignal('');
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<GroupId>>(new Set());
  const [status, setStatus] = createSignal('');
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);
  let searchInput: HTMLInputElement | undefined;
  let statusTimer: number | undefined;
  let copyTimer: number | undefined;

  const flash = (msg: string) => {
    setStatus(msg);
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => setStatus(''), 2200);
  };

  onMount(() => {
    // `/` focuses the value search while the panel is mounted.
    onCleanup(bindSlashToSearch(() => searchInput));
    onCleanup(() => {
      if (statusTimer) window.clearTimeout(statusTimer);
      if (copyTimer) window.clearTimeout(copyTimer);
    });
  });

  /** Crosshair bar index (explicit index wins over time). */
  const crosshairIndex = createMemo(() => {
    const bars = barPlane.bars as Bar[];
    if (!bars.length) return null;
    const bi = store.crosshair?.barIndex;
    if (bi != null && Number.isFinite(bi)) {
      return Math.max(0, Math.min(bars.length - 1, Math.trunc(bi)));
    }
    const t = store.crosshair?.time;
    if (t != null && Number.isFinite(t)) {
      const idx = barIndexAtTime(bars, t);
      return idx >= 0 ? idx : null;
    }
    return null;
  });

  createEffect(() => {
    const idx = crosshairIndex();
    if (idx != null) setLastSeenIndex(idx);
  });

  /** Pinned bar wins over the live crosshair. */
  const activeIndex = createMemo(() => pinnedIndex() ?? crosshairIndex());
  const activeBar = createMemo(() => {
    const idx = activeIndex();
    const bars = barPlane.bars as Bar[];
    if (idx == null) return null;
    return bars[idx] ?? null;
  });
  const isPinned = () => pinnedIndex() != null;

  // A pinned index belongs to the old symbol / series — drop it on reload.
  createEffect(() => {
    void store.symbol;
    void store.interval;
    void store.chartDataGen;
    setPinnedIndex(null);
    setLastSeenIndex(null);
  });
  // Bars can shrink (reload / window reset); clamp a stale pin away.
  createEffect(() => {
    const len = barPlane.length;
    const pin = pinnedIndex();
    if (pin != null && pin >= len) setPinnedIndex(null);
  });

  const rows = createMemo(() => {
    if (!(isPanelOpen('dataview') || store.dataViewPanel.open)) return [];
    const idx = activeIndex();
    if (idx == null) return [];
    const r = store.lastRun as RunResult | null;
    // Panel `display.*` overrides win over the script's declaration, same rule
    // as the chart apply path — so hiding a plot from the pane also removes it
    // from the Data Window (and vice versa) without re-running. Build a copy:
    // `lastRun.meta.plot_meta` is a read-only store proxy, so assigning into it
    // is a silent no-op.
    const focusPlots = store.scripts.find((s) => s.id === store.resultsFocusId)?.plots;
    const plotMeta = mergePlotDisplayOverrides(
      r?.meta?.plot_meta as Record<string, DataViewPlotMeta> | undefined,
      focusPlots,
    );
    // Depend on drawings so place/drag updates refresh values
    void store.drawings;
    void store.chartDataGen;
    void barPlane.length;
    void store.crosshair?.time;
    void store.crosshair?.barIndex;
    // Touch each on-chain field through the store proxy for fine-grained refresh
    const onchainSeries = onchainManagerState.series.map((s) => ({
      id: s.id,
      label: s.label,
      provider: s.provider,
      providerId: s.providerId,
      visible: s.visible,
      color: s.color,
      points: s.points,
      finality: s.finality,
      lastTvl: s.lastTvl,
      instrument: s.instrument,
      loading: s.loading,
      error: s.error,
    }));
    // Read from the narrow bar plane so the memo does not couple to the
    // monolithic store.bars array.
    const bars = untrack(() => barPlane.bars as Bar[]);
    const bar = bars[idx];
    return buildDataViewRows({
      bars,
      time: bar?.time,
      barIndex: idx,
      symbol: store.symbol,
      interval: store.interval,
      series: (r?.series || {}) as Record<string, PlotSample[]>,
      plotMeta,
      drawings: store.drawings,
      onchainSeries,
    });
  });

  const change = createMemo(() => {
    const idx = activeIndex();
    const bars = barPlane.bars as Bar[];
    if (idx == null || idx <= 0) return null;
    const bar = bars[idx];
    const prev = bars[idx - 1];
    if (!bar || !prev || !Number.isFinite(prev.close) || prev.close === 0) return null;
    const diff = bar.close - prev.close;
    const pct = (diff / prev.close) * 100;
    const sign = diff > 0 ? '+' : '';
    return {
      key: 'change',
      label: 'Change',
      value: `${sign}${fmtNum(diff)} (${sign}${pct.toFixed(2)}%)`,
      tone: diff > 0 ? ('up' as const) : diff < 0 ? ('down' as const) : ('flat' as const),
    };
  });

  const groupRows = (group: DataViewRow['group']) => {
    const q = query().trim().toLowerCase();
    return rows().filter((r) => {
      if (r.group !== group) return false;
      if (!q) return true;
      return `${r.label} ${r.value}`.toLowerCase().includes(q);
    });
  };

  const changeVisible = createMemo(() => {
    const c = change();
    if (!c) return null;
    const q = query().trim().toLowerCase();
    if (q && !`${c.label} ${c.value}`.toLowerCase().includes(q)) return null;
    return c;
  });

  const visibleTotal = createMemo(
    () => GROUPS.reduce((n, g) => n + groupRows(g.rowGroup).length, 0) + (changeVisible() ? 1 : 0),
  );

  const isCollapsed = (id: GroupId) => collapsed().has(id);
  const toggleGroup = (id: GroupId) => {
    const next = new Set(collapsed());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const allRowsForCopy = createMemo(() => {
    const out: { label: string; value: string }[] = [];
    for (const g of GROUPS) {
      for (const r of groupRows(g.rowGroup)) out.push({ label: r.label, value: r.value });
      if (g.id === 'ohlcv') {
        const c = changeVisible();
        if (c) out.push({ label: c.label, value: c.value });
      }
    }
    return out;
  });

  const copyRow = async (row: { key: string; label: string; value: string }) => {
    if (await copyToClipboard(row.value)) {
      setCopiedKey(row.key);
      if (copyTimer) window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(() => setCopiedKey(null), 1200);
      flash(`Copied ${row.label}`);
    }
  };

  const copyAll = async () => {
    const text = allRowsForCopy()
      .map((r) => `${r.label}\t${r.value}`)
      .join('\n');
    if (await copyToClipboard(text)) flash(`Copied ${allRowsForCopy().length} values`);
  };

  const step = (delta: number) => {
    const bars = barPlane.bars as Bar[];
    if (!bars.length) return;
    const base = pinnedIndex() ?? crosshairIndex() ?? lastSeenIndex() ?? bars.length - 1;
    setPinnedIndex(Math.max(0, Math.min(bars.length - 1, base + delta)));
  };

  const togglePin = () => {
    if (isPinned()) {
      setPinnedIndex(null);
      flash('Following crosshair');
      return;
    }
    const idx =
      crosshairIndex() ?? lastSeenIndex() ?? (barPlane.length ? barPlane.length - 1 : null);
    if (idx == null) return;
    setPinnedIndex(idx);
    flash('Bar pinned — step with ← / →');
  };

  const inspectLast = () => {
    if (!barPlane.length) return;
    setPinnedIndex(barPlane.length - 1);
    flash('Inspecting the last bar');
  };

  const resetFilters = () => {
    setQuery('');
    searchInput?.focus();
  };

  const hasAnyValues = createMemo(() =>
    rows().some((r) => r.group === 'series' || r.group === 'drawings' || r.group === 'onchain'),
  );

  return (
    <Show when={isPanelOpen('dataview') || store.dataViewPanel.open}>
      <FloatableShell id="dataview" testId="axis-dataview">
        <div class="ax-dataview flex flex-col flex-1 min-h-0">
          {/* ── Bar context ────────────────────────────────────────── */}
          <div class="ax-dataview-head">
            <div class="ax-dataview-head-row">
              <span class="ax-dataview-symbol" title="Chart symbol">
                {store.symbol || '—'}
              </span>
              <span class="ax-dataview-interval">{store.interval || '—'}</span>
              <span class="ax-dataview-spacer" />
              <button
                type="button"
                class="ax-dataview-icon"
                title="Previous bar"
                aria-label="Previous bar"
                data-testid="axis-dataview-prev"
                disabled={!barPlane.length}
                onClick={() => step(-1)}
              >
                <Icons.chevronDown size={11} class="ax-dataview-chevron is-prev" />
              </button>
              <button
                type="button"
                class="ax-dataview-icon"
                title="Next bar"
                aria-label="Next bar"
                data-testid="axis-dataview-next"
                disabled={!barPlane.length}
                onClick={() => step(1)}
              >
                <Icons.chevronDown size={11} class="ax-dataview-chevron is-next" />
              </button>
              <button
                type="button"
                class="ax-dataview-icon"
                classList={{ 'is-on': isPinned() }}
                title={isPinned() ? 'Unpin — follow the crosshair' : 'Pin this bar'}
                aria-label={isPinned() ? 'Unpin bar' : 'Pin bar'}
                aria-pressed={isPinned()}
                data-testid="axis-dataview-pin"
                onClick={togglePin}
              >
                <Icons.pin size={11} />
              </button>
              <button
                type="button"
                class="ax-dataview-icon"
                title="Copy all values as TSV"
                aria-label="Copy all values"
                data-testid="axis-dataview-copy-all"
                disabled={!allRowsForCopy().length}
                onClick={() => void copyAll()}
              >
                <Icons.copy size={11} />
              </button>
            </div>

            <div class="ax-dataview-time" data-testid="axis-dataview-time">
              {activeBar() ? fmtBarTime(activeBar()?.time) : 'No bar under crosshair'}
              <Show when={activeIndex() != null}>
                <span class="ax-dataview-bar" title="Bar index" data-testid="axis-dataview-bar">
                  #{activeIndex()}
                </span>
              </Show>
              <Show when={isPinned()}>
                <span class="ax-dataview-pin-chip" title="Values are frozen on this bar">
                  pinned
                </span>
              </Show>
            </div>

            <div class="ax-dataview-search">
              <Icons.search size={12} />
              <input
                ref={searchInput}
                type="search"
                class="ax-dataview-search-input"
                placeholder="Filter values…"
                aria-label="Filter data window values"
                data-testid="axis-dataview-search"
                value={query()}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query()) {
                    e.preventDefault();
                    resetFilters();
                  }
                }}
              />
              <span class="ax-dataview-count" title="Visible values">
                {visibleTotal()}
              </span>
              <Show when={query()} fallback={<kbd class="ax-dataview-kbd">/</kbd>}>
                <button
                  type="button"
                  class="ax-dataview-search-clear"
                  title="Clear filter"
                  aria-label="Clear value filter"
                  onClick={resetFilters}
                >
                  <Icons.x size={10} />
                </button>
              </Show>
            </div>

            <Show when={status()}>
              <div class="ax-dataview-status" role="status" aria-live="polite">
                {status()}
              </div>
            </Show>
          </div>

          {/* ── Values ─────────────────────────────────────────────── */}
          <div class="ax-dataview-scroll">
            <Show
              when={barPlane.length > 0}
              fallback={
                <div class="ax-dataview-empty" data-testid="axis-dataview-empty">
                  <span class="ax-dataview-empty-icon">
                    <Icons.dataView size={18} />
                  </span>
                  <p class="ax-dataview-empty-title">No bars loaded</p>
                  <p class="ax-dataview-empty-sub">Load a symbol to inspect OHLCV and series.</p>
                </div>
              }
            >
              <Show
                when={activeIndex() != null}
                fallback={
                  <div class="ax-dataview-empty" data-testid="axis-dataview-empty">
                    <span class="ax-dataview-empty-icon">
                      <Icons.cursor size={18} />
                    </span>
                    <p class="ax-dataview-empty-title">No bar under crosshair</p>
                    <p class="ax-dataview-empty-sub">Hover a candle, or inspect the latest bar.</p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-primary ax-dataview-empty-btn"
                      data-testid="axis-dataview-inspect-last"
                      onClick={inspectLast}
                    >
                      <Icons.pin size={11} /> Inspect last bar
                    </button>
                  </div>
                }
              >
                <For each={GROUPS}>
                  {(g) => {
                    const list = createMemo(() => groupRows(g.rowGroup));
                    return (
                      <Show
                        when={list().length > 0 || (g.id === 'ohlcv' && Boolean(changeVisible()))}
                      >
                        <section class="ax-dataview-section" data-testid={`axis-dataview-${g.id}`}>
                          <button
                            type="button"
                            class="ax-dataview-section-head"
                            aria-expanded={!isCollapsed(g.id)}
                            title={isCollapsed(g.id) ? `Expand ${g.label}` : `Collapse ${g.label}`}
                            onClick={() => toggleGroup(g.id)}
                          >
                            <Icons.chevronDown
                              size={10}
                              class={`ax-dataview-chevron${isCollapsed(g.id) ? '' : ' is-open'}`}
                            />
                            <span>{g.label}</span>
                            <span class="ax-dataview-section-count">
                              {list().length + (g.id === 'ohlcv' && changeVisible() ? 1 : 0)}
                            </span>
                          </button>
                          <Show when={!isCollapsed(g.id)}>
                            <div class="ax-dataview-rows">
                              <For each={list()}>
                                {(row) => (
                                  <DvRow
                                    row={row}
                                    copied={copiedKey() === row.key}
                                    onCopy={() => void copyRow(row)}
                                  />
                                )}
                              </For>
                              <Show when={g.id === 'ohlcv' ? changeVisible() : null}>
                                {(c) => (
                                  <DvRow
                                    row={c()}
                                    copied={copiedKey() === c().key}
                                    onCopy={() => void copyRow(c())}
                                  />
                                )}
                              </Show>
                            </div>
                          </Show>
                        </section>
                      </Show>
                    );
                  }}
                </For>

                <Show when={!hasAnyValues() && !query()}>
                  <div class="ax-dataview-hint">
                    Run a script, place drawings, or attach on-chain series to see values here.
                  </div>
                </Show>
                <Show when={query() && visibleTotal() === 0}>
                  <div class="ax-dataview-empty" data-testid="axis-dataview-no-match">
                    <p class="ax-dataview-empty-title">No values match</p>
                    <button
                      type="button"
                      class="sc-btn sc-btn-ghost ax-dataview-empty-btn"
                      onClick={resetFilters}
                    >
                      Clear filter
                    </button>
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </FloatableShell>
    </Show>
  );
};

const DvRow: Component<{
  row: { key: string; label: string; value: string; color?: string; tone?: 'up' | 'down' | 'flat' };
  copied: boolean;
  onCopy: () => void;
}> = (props) => (
  <div class="ax-dataview-row" data-key={props.row.key}>
    <span class="ax-dataview-label" title={props.row.label}>
      <Show when={props.row.color}>
        <span
          class="ax-dataview-swatch"
          style={{ background: props.row.color }}
          aria-hidden="true"
        />
      </Show>
      <span class="ax-dataview-label-text">{props.row.label}</span>
    </span>
    <span
      class="ax-dataview-value"
      classList={{
        'is-up': props.row.tone === 'up',
        'is-down': props.row.tone === 'down',
        'is-flat': props.row.tone === 'flat',
      }}
      title={props.row.value}
    >
      {props.row.value}
    </span>
    <button
      type="button"
      class="ax-dataview-copy"
      classList={{ 'is-copied': props.copied }}
      title={`Copy ${props.row.label}`}
      aria-label={`Copy ${props.row.label}`}
      onClick={props.onCopy}
    >
      {props.copied ? <Icons.check size={10} /> : <Icons.copy size={10} />}
    </button>
  </div>
);
