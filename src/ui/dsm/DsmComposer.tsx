// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backfill job composer — symbol / source / interval / target date form
 * with date presets and a live span · bars · pages estimate.
 *
 * Shared by the floatable DSM panel (collapsible) and the studio Data page
 * (always visible). The form only enqueues jobs; the fetch walk lives in
 * {@link module:data/data-source-manager}.
 *
 * @module ui/dsm/DsmComposer
 */

import { type Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { store } from '../../store';
import { listSources, sourcePageLimit } from '../../sources/catalog';
import { WATCHLIST_INTERVALS } from '../../data/watchlist-tickers';
import {
  DSM_MAX_BARS_PER_JOB,
  DSM_MAX_PAGES,
  startBackfill,
  defaultPastDateInput,
  pastDateInputToSec,
} from '../../data/data-source-manager';
import { DATA_MANAGER_SOURCE_ID } from '../../data/data-manager-source';
import { normalizeLoadSymbol } from '../../data/symbol-exchange';
import { Icons } from '../icons';
import { announce } from '../sr-announce';
import { ScField } from '../Field';
import {
  BACKFILL_PRESETS,
  dateInputDaysAgo,
  estimateBackfill,
  presetDaysForDate,
} from './estimate';

/** Host options for the backfill form: test-id prefix, lifecycle callbacks, and message sink. */
export interface DsmComposerProps {
  /** Test-id prefix for every control (panel and page coexist in the DOM). */
  testIdPrefix?: string;
  /** Called after a job was enqueued (the panel folds the form away). */
  onStarted?: (jobId: string) => void;
  /** Close (X) affordance; omit on surfaces where the form is always shown. */
  onCloseRequest?: () => void;
  /**
   * Success sink. When given, start confirmations are surfaced by the host
   * (the panel's sticky message area); otherwise rendered inside the form.
   */
  onNotify?: (msg: string) => void;
}

/**
 * Backfill composer shared by the DSM panel and the studio Data page; it only
 * enqueues jobs — the fetch walk lives in the data-source manager.
 */
export const DsmComposer: Component<DsmComposerProps> = (props): JSX.Element => {
  const tid = (suffix: string) => `${props.testIdPrefix ?? 'axis-datasource'}-${suffix}`;

  const [symbol, setSymbol] = createSignal(store.symbol || 'BTCUSDT');
  const [symbolDirty, setSymbolDirty] = createSignal(false);
  const [sourceId, setSourceId] = createSignal(store.source || 'binance-rest');
  const [interval, setInterval] = createSignal(store.interval || '1d');
  const [intervalDirty, setIntervalDirty] = createSignal(false);
  const [otherProvider, setOtherProvider] = createSignal(false);
  const [pastDate, setPastDate] = createSignal(defaultPastDateInput());
  const [applyWhenComplete, setApplyWhenComplete] = createSignal(false);
  const [formError, setFormError] = createSignal('');
  const [formMsg, setFormMsg] = createSignal('');

  const sources = () => listSources().filter((s) => s.id !== DATA_MANAGER_SOURCE_ID);

  // Inherit chart venue / symbol / interval unless the user overrode them.
  createEffect(() => {
    if (otherProvider()) return;
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
  });
  createEffect(() => {
    if (symbolDirty()) return;
    const next = String(store.symbol || 'BTCUSDT')
      .trim()
      .toUpperCase();
    if (next) setSymbol(next);
  });
  createEffect(() => {
    if (intervalDirty()) return;
    const next = String(store.interval || '1d').trim();
    if (next) setInterval(next);
  });

  const estimate = createMemo(() =>
    estimateBackfill({
      fromSec: pastDateInputToSec(pastDate()),
      nowSec: Math.floor(Date.now() / 1000),
      interval: interval(),
      pageLimit: sourcePageLimit(sourceId()),
      maxBars: DSM_MAX_BARS_PER_JOB,
      maxPages: DSM_MAX_PAGES,
    }),
  );

  const activePreset = createMemo(() => {
    const days = presetDaysForDate(pastDate());
    if (days == null) return null;
    return BACKFILL_PRESETS.find((p) => p.days === days)?.id ?? null;
  });

  const onStart = (e?: Event) => {
    e?.preventDefault();
    setFormError('');
    setFormMsg('');
    const from = pastDateInputToSec(pastDate());
    if (from == null) {
      setFormError('Enter a valid past date (YYYY-MM-DD).');
      return;
    }
    if (from > Math.floor(Date.now() / 1000)) {
      setFormError('Pick a UTC date in the past.');
      return;
    }
    // `normalizeLoadSymbol` keeps the case for DEX pool symbols (base58 /
    // `network:0x…`); uppercasing here destroyed the pool address before the
    // request was even built.
    const sym = normalizeLoadSymbol(symbol().trim() || store.symbol || '', sourceId());
    if (!sym) {
      setFormError('Symbol required.');
      return;
    }
    const id = startBackfill({
      sourceId: sourceId(),
      symbol: sym,
      interval: interval(),
      targetFromSec: from,
      applyWhenComplete: applyWhenComplete(),
    });
    const msg = `Started background job ${id.slice(0, 12)}…`;
    if (props.onNotify) props.onNotify(msg);
    else setFormMsg(msg);
    announce(`Started background backfill ${sym} ${interval()}`);
    props.onStarted?.(id);
  };

  /** Reset the form to the chart's venue / symbol / interval. */
  const useChartSettings = () => {
    setOtherProvider(false);
    setSymbolDirty(false);
    setIntervalDirty(false);
    setSymbol(String(store.symbol || 'BTCUSDT').toUpperCase());
    setInterval(store.interval || '1d');
    const src = store.source || 'binance-rest';
    if (src !== DATA_MANAGER_SOURCE_ID) setSourceId(src);
    announce('Using chart settings');
  };

  const applyPreset = (days: number) => {
    setPastDate(dateInputDaysAgo(days));
  };

  return (
    <form class="ax-dsm-form" onSubmit={onStart} data-testid={tid('form')}>
      <div class="ax-dsm-form-head">
        <span class="ax-dsm-form-title">New job</span>
        <span class="ax-dsm-form-sub">
          {symbol()} · {interval()} · {sourceId()}
        </span>
        <span class="ax-dsm-spacer" />
        <Show when={props.onCloseRequest}>
          <button
            type="button"
            class="ax-dsm-icon"
            title="Close form"
            aria-label="Close new-job form"
            onClick={() => props.onCloseRequest?.()}
          >
            <Icons.x size={11} />
          </button>
        </Show>
      </div>

      <div class="ax-dsm-with-action">
        <ScField label="Symbol" class="flex-1">
          <input
            type="text"
            class="sc-input"
            value={symbol()}
            onInput={(e) => {
              setSymbolDirty(true);
              setSymbol(e.currentTarget.value.toUpperCase());
            }}
            autocomplete="off"
            spellcheck={false}
            data-testid={tid('symbol')}
          />
        </ScField>
        <button
          type="button"
          class="ax-dsm-mini"
          title="Use the chart symbol, source, and interval"
          data-testid={tid('use-chart')}
          onClick={useChartSettings}
        >
          <Icons.refresh size={10} /> Chart
        </button>
      </div>

      <label class="ax-dsm-check">
        <input
          type="checkbox"
          checked={otherProvider()}
          onChange={(e) => setOtherProvider(e.currentTarget.checked)}
          data-testid={tid('other-provider')}
        />
        <span>Backfill a different source than the chart</span>
      </label>

      <ScField label="Source / exchange">
        <select
          class="sc-input"
          value={sourceId()}
          disabled={!otherProvider()}
          onChange={(e) => setSourceId(e.currentTarget.value)}
          data-testid={tid('source')}
        >
          <For each={sources()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
        </select>
      </ScField>

      <div class="ax-dsm-grid-2">
        <ScField label="Timeframe">
          <select
            class="sc-input"
            value={interval()}
            onChange={(e) => {
              setIntervalDirty(true);
              setInterval(e.currentTarget.value);
            }}
            data-testid={tid('interval')}
          >
            <For each={[...WATCHLIST_INTERVALS]}>{(iv) => <option value={iv}>{iv}</option>}</For>
          </select>
        </ScField>
        <ScField label="Accumulate to (UTC)">
          <input
            type="date"
            class="sc-input"
            value={pastDate()}
            onInput={(e) => setPastDate(e.currentTarget.value)}
            data-testid={tid('past-date')}
          />
        </ScField>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: chip row; fieldset default styles break the compact toolbar */}
      <div class="ax-dsm-presets" role="group" aria-label="Backfill presets">
        <For each={BACKFILL_PRESETS}>
          {(p) => (
            <button
              type="button"
              class="ax-dsm-chip"
              classList={{ 'is-active': activePreset() === p.id }}
              aria-pressed={activePreset() === p.id}
              title={`Accumulate to ${dateInputDaysAgo(p.days)} UTC`}
              data-testid={tid(`preset-${p.id}`)}
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </button>
          )}
        </For>
      </div>

      <div
        class="ax-dsm-estimate"
        classList={{ 'is-capped': estimate().capped }}
        data-testid={tid('estimate')}
        aria-live="polite"
      >
        <div class="ax-dsm-stat" title="Clock time from that UTC date through now">
          <span class="ax-dsm-stat-label">Span</span>
          <span class="ax-dsm-stat-value">{estimate().spanLabel}</span>
        </div>
        <div
          class="ax-dsm-stat"
          title={`Dense ${interval()} bars from that date through now, including the current bar`}
        >
          <span class="ax-dsm-stat-label">Bars</span>
          <span class="ax-dsm-stat-value">{estimate().barsLabel}</span>
        </div>
        <div
          class="ax-dsm-stat"
          title={`Venue requests at ${estimate().pageLimit.toLocaleString()} bars each`}
        >
          <span class="ax-dsm-stat-label">Pages</span>
          <span class="ax-dsm-stat-value">{estimate().pagesLabel}</span>
        </div>
      </div>
      <Show when={estimate().note}>
        <p class="ax-dsm-note" data-testid={tid('estimate-note')}>
          {estimate().note}
        </p>
      </Show>

      <label class="ax-dsm-check">
        <input
          type="checkbox"
          checked={applyWhenComplete()}
          onChange={(e) => setApplyWhenComplete(e.currentTarget.checked)}
          data-testid={tid('apply-when-done')}
        />
        <span>Apply to chart when complete</span>
      </label>

      <button type="submit" class="sc-btn sc-btn-primary ax-dsm-start" data-testid={tid('start')}>
        <Icons.play size={12} />
        <span>Start background backfill</span>
      </button>

      <Show when={formError()}>
        <div class="ax-dsm-error" role="alert">
          {formError()}
        </div>
      </Show>
      <Show when={formMsg() && !formError()}>
        <div class="ax-dsm-msg" role="status" aria-live="polite">
          {formMsg()}
        </div>
      </Show>
    </form>
  );
};
