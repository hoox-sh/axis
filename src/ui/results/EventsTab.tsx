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
 * Results → Events subpage.
 *
 * Two views over the same run: a chronological `stream` (enriched event list)
 * and `positions` (Open ⇄ Close, pyramiding-aware). Owns its own filter state
 * and the 400-row render cap — a full strategy on 10k bars can carry tens of
 * thousands of events, and mounting them all froze the page.
 *
 * Extracted from `ResultsModal.tsx`; the parent only decides *when* the subpage
 * is visible.
 *
 * @module ui/results/EventsTab
 */

import {
  type JSX,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  untrack,
} from 'solid-js';
import { store } from '../../store';
import type { RunResult } from '../../indicators/runner';
import { formatMoney, type StrategyEvent } from '../../results/strategy';
import { buildPositionViews, type PositionView, type StreamEventView } from '../../results/positions';
import { countEvents, filterEvents, type EventDirFilter } from '../../results/overlay';
import { windowAxisFromMeta } from '../../results/window-axis';
import { getManager } from '../../chart/manager-access';
import { Icons } from '../icons';
import { formatEventTime, formatFillQty, formatPosPrice } from './format';

/** `stream` = classic chronological list, `positions` = Open ⇄ Close. */
type EventsView = 'stream' | 'positions';

/** Props for {@link EventsTab}. */
export interface EventsTabProps {
  /** The current run, or `null` when nothing has run yet. */
  result: () => RunResult | null;
  /** Fill model used to resolve entry/exit prices for the position view. */
  fillMode: () => 'next_open' | 'close';
}

/**
 * A full strategy on 10k bars can carry tens of thousands of events. Rendering
 * every row mounted ~35k DOM nodes and froze the page when Results auto-opened.
 */
const EVENT_PAGE = 400;

/** Events subpage: stream/positions views, filters, and jump-to-fill. */
export function EventsTab(props: EventsTabProps): JSX.Element {
  // ── Views ────────────────────────────────────────────────────────────
  const [eventsView, setEventsView] = createSignal<EventsView>('stream');

  const positionData = createMemo(() => {
    const r = props.result();
    if (!r) return null;
    void store.chartDataGen;
    void store.strategyUi?.slippageNextOpen;
    const bars = untrack(() => store.bars || []);
    return buildPositionViews((r.events || []) as StrategyEvent[], bars, {
      fillMode: props.fillMode(),
      axis: windowAxisFromMeta(r.meta),
    });
  });

  const streamEvents = createMemo<StreamEventView[]>(() => positionData()?.stream ?? []);

  // ── Filters ──────────────────────────────────────────────────────────
  const [eventQuery, setEventQuery] = createSignal('');
  const [eventDir, setEventDir] = createSignal<EventDirFilter>('all');
  const [eventSide, setEventSide] = createSignal<'all' | 'entries' | 'exits'>('all');

  const eventCounts = createMemo(() => countEvents(streamEvents()));

  const visibleEvents = createMemo(() =>
    filterEvents(streamEvents(), {
      query: eventQuery(),
      dir: eventDir(),
      closesOnly: eventSide() === 'all' ? null : eventSide() === 'exits',
    }),
  );

  const [eventPages, setEventPages] = createSignal(1);
  createEffect(() => {
    eventQuery();
    eventDir();
    eventSide();
    props.result()?.meta?.run_id;
    setEventPages(1);
  });
  const renderedEvents = createMemo(() => {
    const all = visibleEvents();
    const cap = eventPages() * EVENT_PAGE;
    if (all.length <= cap) return all;
    return all.slice(all.length - cap);
  });
  const hiddenEventCount = createMemo(() =>
    Math.max(0, visibleEvents().length - renderedEvents().length),
  );

  const eventFiltersActive = () =>
    Boolean(eventQuery().trim()) || eventDir() !== 'all' || eventSide() !== 'all';

  const resetEventFilters = () => {
    setEventQuery('');
    setEventDir('all');
    setEventSide('all');
  };

  /** Scroll the chart to a fill; events may carry epoch ms, the chart wants s. */
  const jumpToTime = (t: number) => {
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return;
    getManager()?.scrollToTime(n > 1e12 ? n / 1000 : n);
  };

  return (
    <Show
      when={streamEvents().length > 0}
      fallback={<div class="ax-empty axis-empty-state">No strategy events.</div>}
    >
      <div class="ax-stack ax-stack--compact" data-testid="axis-events-views">
        <div class="ax-toolbar">
          <span class="ax-card-kicker">View</span>
          {/* biome-ignore lint/a11y/useSemanticElements: bordered inline-flex switch; <fieldset> default styles would break the toolbar layout */}
          <div
            class="ax-view-switch"
            role="group"
            aria-label="Events view"
            data-testid="axis-events-view-switch"
          >
            <button
              type="button"
              class={`ax-view-switch-btn${eventsView() === 'stream' ? ' is-on' : ''}`}
              aria-pressed={eventsView() === 'stream'}
              title="Chronological event stream with fill details"
              data-testid="axis-events-view-stream"
              onClick={() => setEventsView('stream')}
            >
              Stream
            </button>
            <button
              type="button"
              class={`ax-view-switch-btn${eventsView() === 'positions' ? ' is-on' : ''}`}
              aria-pressed={eventsView() === 'positions'}
              title="Open ⇄ Close — entries left, exits right (pyramiding-aware)"
              data-testid="axis-events-view-positions"
              onClick={() => setEventsView('positions')}
            >
              Open ⇄ Close
            </button>
          </div>
          <span class="ax-toolbar-spacer" />
          <span class="ax-plot-meta" data-testid="axis-events-counts">
            {visibleEvents().length}
            {eventFiltersActive() ? ` / ${streamEvents().length}` : ''} event
            {streamEvents().length === 1 ? '' : 's'}
            {' · '}
            {positionData()?.positions.length ?? 0} position
            {(positionData()?.positions.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>

        <div class="ax-toolbar ax-results-filterbar">
          <label class="ax-results-search">
            <Icons.search size={12} />
            <input
              type="search"
              class="ax-results-search-input"
              placeholder="Filter events…"
              aria-label="Filter events"
              value={eventQuery()}
              onInput={(e) => setEventQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && eventFiltersActive()) {
                  e.preventDefault();
                  // Keep the overlay open: without this the
                  // window-level Escape closes the dialog too.
                  e.stopPropagation();
                  resetEventFilters();
                }
              }}
              data-testid="axis-events-query"
              autocomplete="off"
              spellcheck={false}
            />
          </label>
          {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
          <div class="ax-results-chips" role="group" aria-label="Event side">
            <button
              type="button"
              class="ax-results-chip"
              classList={{ 'is-on': eventSide() === 'all' }}
              aria-pressed={eventSide() === 'all'}
              data-testid="axis-events-side-all"
              onClick={() => setEventSide('all')}
            >
              All
              <span class="ax-results-chip-n">{eventCounts().all}</span>
            </button>
            <button
              type="button"
              class="ax-results-chip"
              classList={{ 'is-on': eventSide() === 'entries' }}
              aria-pressed={eventSide() === 'entries'}
              data-testid="axis-events-side-entries"
              onClick={() => setEventSide('entries')}
            >
              Entries
              <span class="ax-results-chip-n">{eventCounts().entries}</span>
            </button>
            <button
              type="button"
              class="ax-results-chip"
              classList={{ 'is-on': eventSide() === 'exits' }}
              aria-pressed={eventSide() === 'exits'}
              data-testid="axis-events-side-exits"
              onClick={() => setEventSide('exits')}
            >
              Exits
              <span class="ax-results-chip-n">{eventCounts().exits}</span>
            </button>
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
          <div class="ax-results-chips" role="group" aria-label="Event direction">
            <For each={['all', 'long', 'short'] as EventDirFilter[]}>
              {(d) => (
                <button
                  type="button"
                  class="ax-results-chip"
                  classList={{ 'is-on': eventDir() === d }}
                  aria-pressed={eventDir() === d}
                  data-testid={`axis-events-dir-${d}`}
                  onClick={() => setEventDir(d)}
                >
                  {d === 'all' ? 'Both' : d}
                  <Show when={d !== 'all'}>
                    <span class="ax-results-chip-n">
                      {d === 'long' ? eventCounts().long : eventCounts().short}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
          <Show when={eventFiltersActive()}>
            <button
              type="button"
              class="ax-results-chip is-reset"
              title="Reset event filters"
              data-testid="axis-events-reset"
              onClick={resetEventFilters}
            >
              <Icons.x size={10} /> Reset
            </button>
          </Show>
        </div>

        {/* Stream — classic chronological list, enriched */}
        <Show when={eventsView() === 'stream'}>
          <Show
            when={visibleEvents().length > 0}
            fallback={
              <div
                class="ax-empty axis-empty-state"
                data-testid="axis-events-no-match"
              >
                No events match the current filters.
              </div>
            }
          >
            <Show when={hiddenEventCount() > 0}>
              <button
                type="button"
                class="ax-results-chip"
                data-testid="axis-events-show-earlier"
                onClick={() => setEventPages((n) => n + 1)}
              >
                Show {Math.min(EVENT_PAGE, hiddenEventCount())} earlier events
              </button>
            </Show>
            <ul class="ax-list ax-event-list" data-testid="axis-events-stream">
              <For each={renderedEvents()}>
                {(ev) => {
                  const kind = String(ev.type || ev.event || ev.kind || '?');
                  const dir = String(ev.dir || ev.direction || '');
                  const dirClass =
                    dir.toLowerCase() === 'long'
                      ? 'ax-event-dir ax-event-dir--long'
                      : dir.toLowerCase() === 'short'
                        ? 'ax-event-dir ax-event-dir--short'
                        : 'ax-event-dir ax-event-dir--flat';
                  const isClose =
                    kind.toLowerCase().includes('close') ||
                    kind.toLowerCase().includes('exit');
                  const fromEntry =
                    typeof ev.from_entry === 'string' ? ev.from_entry : '';
                  return (
                    <li class="ax-row ax-event-row">
                      <span class="ax-mono ax-event-time">
                        {formatEventTime(ev.time)}
                      </span>
                      <span class="ax-event-kind">{kind}</span>
                      <Show when={dir}>
                        <span class={dirClass}>{dir}</span>
                      </Show>
                      <span
                        class="ax-event-id"
                        title={`Order id: ${String(ev.id || '')}`}
                      >
                        {String(ev.id || '')}
                      </span>
                      <Show when={fromEntry}>
                        <span
                          class="ax-event-from"
                          title={`from_entry: ${fromEntry}`}
                        >
                          ← {fromEntry}
                        </span>
                      </Show>
                      <Show
                        when={isClose}
                        fallback={
                          <Show
                            when={ev.fills != null}
                            fallback={<span class="ax-event-qty" />}
                          >
                            <span
                              class="ax-event-qty"
                              title={`Position qty ${formatFillQty(ev.posQty ?? 0)} · avg ${formatPosPrice(ev.posAvg ?? 0)}`}
                            >
                              #{ev.fills} · ×{formatFillQty(ev.posQty ?? 0)}
                            </span>
                          </Show>
                        }
                      >
                        <span
                          class="ax-event-qty"
                          title={`Qty still open after this close: ${formatFillQty(ev.remaining ?? 0)}`}
                        >
                          left ×{formatFillQty(ev.remaining ?? 0)}
                        </span>
                      </Show>
                      <span class="ax-mono ax-event-price">
                        {ev.price !== undefined && ev.price !== null
                          ? Number(ev.price).toFixed(2)
                          : '—'}
                      </span>
                      <Show when={isClose && ev.pnl != null}>
                        <span
                          class={`ax-event-pnl ${
                            (ev.pnl ?? 0) >= 0 ? 'ax-table-pos' : 'ax-table-neg'
                          }`}
                        >
                          {formatMoney(ev.pnl ?? 0)}
                        </span>
                      </Show>
                      <Show when={isClose && ev.pnl == null}>
                        <span class="ax-event-pnl ax-event-pnl--none">—</span>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>

        {/* Open ⇄ Close — per-position two-column grid */}
        <Show when={eventsView() === 'positions'}>
          <div class="ax-pos-grid" data-testid="axis-events-positions">
            <For
              each={(positionData()?.positions ?? []).slice(
                -eventPages() * EVENT_PAGE,
              )}
            >
              {(p: PositionView) => (
                <div
                  class={`ax-pos-row is-${p.dir}${p.status === 'open' ? ' is-open' : ''}`}
                  data-testid="axis-events-position-row"
                >
                  {/* LEFT — opens */}
                  <div class="ax-pos-cell ax-pos-cell--open">
                    <div class="ax-pos-head">
                      <span
                        class={`ax-event-dir ${
                          p.dir === 'long'
                            ? 'ax-event-dir--long'
                            : 'ax-event-dir--short'
                        }`}
                      >
                        {p.dir}
                      </span>
                      <span class="ax-pos-id" title={`Entry id: ${p.id}`}>
                        {p.id}
                        {p.cycle > 1 ? ` #${p.cycle}` : ''}
                      </span>
                      <span class="ax-toolbar-spacer" />
                      <span
                        class="ax-pos-avg ax-mono"
                        title={`${p.opens.length} entry fill${p.opens.length === 1 ? '' : 's'} · total ${formatFillQty(p.totalQty)}`}
                      >
                        {p.opens.length}× @ {formatPosPrice(p.avgPrice)}
                      </span>
                    </div>
                    <ul class="ax-pos-fills">
                      <For each={p.opens}>
                        {(f) => (
                          <li>
                            <button
                              type="button"
                              class="ax-pos-fill"
                              title="Jump to entry fill"
                              onClick={() => jumpToTime(f.time)}
                            >
                              <span class="ax-mono ax-pos-fill-time">
                                {formatEventTime(f.time)}
                              </span>
                              <span class="ax-mono">
                                @ {formatPosPrice(f.price)}
                              </span>
                              <span class="ax-mono">× {formatFillQty(f.qty)}</span>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>

                  {/* RIGHT — closes */}
                  <div class="ax-pos-cell ax-pos-cell--close">
                    <Show
                      when={p.closes.length > 0}
                      fallback={
                        <div class="ax-pos-open" title="No exit fills yet">
                          — open · {formatFillQty(p.openQty)} left —
                        </div>
                      }
                    >
                      <ul class="ax-pos-fills">
                        <For each={p.closes}>
                          {(c) => (
                            <li>
                              <button
                                type="button"
                                class="ax-pos-fill"
                                title="Jump to exit fill"
                                onClick={() => jumpToTime(c.time)}
                              >
                                <span class="ax-mono ax-pos-fill-time">
                                  {formatEventTime(c.time)}
                                </span>
                                <span class="ax-mono">
                                  @ {formatPosPrice(c.price)}
                                </span>
                                <span class="ax-mono">
                                  × {formatFillQty(c.qty)}
                                </span>
                                <span
                                  class={`ax-mono ax-pos-fill-pnl ${
                                    c.pnl >= 0 ? 'ax-table-pos' : 'ax-table-neg'
                                  }`}
                                >
                                  {formatMoney(c.pnl)}
                                </span>
                              </button>
                            </li>
                          )}
                        </For>
                      </ul>
                      <div class="ax-pos-summary">
                        <span class="ax-chip ax-chip--tag">Closed</span>
                        <Show when={p.openQty > 1e-9}>
                          <span class="ax-pos-remaining">
                            partial · {formatFillQty(p.openQty)} left
                          </span>
                        </Show>
                        <span class="ax-toolbar-spacer" />
                        <span
                          class={`ax-mono ${
                            p.realizedPnl >= 0 ? 'ax-table-pos' : 'ax-table-neg'
                          }`}
                        >
                          {formatMoney(p.realizedPnl)}
                        </span>
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
