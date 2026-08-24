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
 * Data Window — OHLCV + plot series + drawing + on-chain values at the
 * crosshair bar.
 *
 * Rows from `buildDataViewRows` using `store.bars`, `store.crosshair`,
 * last-run series/plot_meta, `store.drawings`, and
 * `onchainManagerState.series`. FloatableShell id `dataview`.
 */

import { Component, For, Show, createMemo } from 'solid-js';
import { store, isPanelOpen } from '../store';
import { buildDataViewRows } from '../results/dataview';
import type { RunResult } from '../indicators/runner';
import { onchainManagerState } from '../onchain/manager';
import { FloatableShell } from './panels/FloatableShell';
import type { PlotSample } from '../plugins/types';

/** Crosshair-synced OHLCV / plot / drawing / on-chain value inspector. */
export const DataViewPanel: Component = () => {
  const rows = createMemo(() => {
    const r = store.lastRun as RunResult | null;
    const plotMeta = (r?.meta?.plot_meta || {}) as Record<
      string,
      { title?: string; color?: string | null; kind?: string }
    >;
    // Depend on drawings so place/drag updates refresh values
    void store.drawings;
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
    return buildDataViewRows({
      bars: store.bars,
      time: store.crosshair?.time,
      barIndex: store.crosshair?.barIndex,
      symbol: store.symbol,
      interval: store.interval,
      series: (r?.series || {}) as Record<string, PlotSample[]>,
      plotMeta,
      drawings: store.drawings,
      onchainSeries,
    });
  });

  const metaRows = createMemo(() => rows().filter((x) => x.group === 'meta'));
  const ohlcvRows = createMemo(() => rows().filter((x) => x.group === 'ohlcv'));
  const seriesRows = createMemo(() => rows().filter((x) => x.group === 'series'));
  const drawingRows = createMemo(() => rows().filter((x) => x.group === 'drawings'));
  const onchainRows = createMemo(() => rows().filter((x) => x.group === 'onchain'));

  return (
    <Show when={isPanelOpen('dataview') || store.dataViewPanel.open}>
      <FloatableShell id="dataview" testId="axis-dataview">
        <div class="flex-1 overflow-y-auto min-h-0 text-[0.85em]">
          <Show
            when={store.bars.length > 0}
            fallback={
              <div class="p-2.5 text-text-faint italic">Load data to inspect bars.</div>
            }
          >
            <Section label="Bar">
              <For each={metaRows()}>{(row) => <Row row={row} />}</For>
            </Section>
            <Section label="OHLCV">
              <For each={ohlcvRows()}>{(row) => <Row row={row} />}</For>
            </Section>
            <Show when={seriesRows().length > 0}>
              <Section label="Plots">
                <For each={seriesRows()}>{(row) => <Row row={row} />}</For>
              </Section>
            </Show>
            <Show when={drawingRows().length > 0}>
              <Section label="Drawings">
                <For each={drawingRows()}>{(row) => <Row row={row} />}</For>
              </Section>
            </Show>
            <Show when={onchainRows().length > 0}>
              <Section label="On-Chain">
                <For each={onchainRows()}>{(row) => <Row row={row} />}</For>
              </Section>
            </Show>
            <Show
              when={
                seriesRows().length === 0 &&
                drawingRows().length === 0 &&
                onchainRows().length === 0
              }
            >
              <div class="px-2.5 py-2 text-text-faint text-[0.9em]">
                Run a script, place drawings, or attach on-chain series to see values here.
              </div>
            </Show>
          </Show>
        </div>
      </FloatableShell>
    </Show>
  );
};

const Section: Component<{ label: string; children: any }> = (props) => (
  <div class="border-b border-border-soft last:border-0">
    <div class="px-2.5 pt-1.5 pb-0.5 text-[0.78em] uppercase tracking-wider text-text-faint font-semibold">
      {props.label}
    </div>
    <div class="pb-1">{props.children}</div>
  </div>
);

const Row: Component<{
  row: { key: string; label: string; value: string; color?: string };
}> = (props) => (
  <div class="flex items-center justify-between gap-2 px-2.5 py-0.5 hover:bg-bg-hover/60">
    <span class="flex items-center gap-1.5 text-text-dim min-w-0 truncate">
      <Show when={props.row.color}>
        <span
          class="inline-block w-2 h-2 flex-shrink-0 border border-border"
          style={{ background: props.row.color }}
        />
      </Show>
      {props.row.label}
    </span>
    <span class="font-mono text-text tabular-nums flex-shrink-0">{props.row.value}</span>
  </div>
);
