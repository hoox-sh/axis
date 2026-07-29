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
 * Data Window — OHLCV + plot series values at the crosshair bar.
 */

import { Component, For, Show, createMemo } from 'solid-js';
import { store, setDataViewPanelOpen } from '../store';
import { buildDataViewRows } from '../results/dataview';
import type { RunResult } from '../indicators/runner';
import { Icons } from './icons';

export const DataViewPanel: Component = () => {
  const rows = createMemo(() => {
    const r = store.lastRun as RunResult | null;
    const plotMeta = (r?.meta?.plot_meta || {}) as Record<
      string,
      { title?: string; color?: string | null; kind?: string }
    >;
    return buildDataViewRows({
      bars: store.bars,
      time: store.crosshair?.time,
      barIndex: store.crosshair?.barIndex,
      symbol: store.symbol,
      interval: store.interval,
      series: (r?.series || {}) as Record<string, (number | null)[]>,
      plotMeta,
    });
  });

  const metaRows = createMemo(() => rows().filter((x) => x.group === 'meta'));
  const ohlcvRows = createMemo(() => rows().filter((x) => x.group === 'ohlcv'));
  const seriesRows = createMemo(() => rows().filter((x) => x.group === 'series'));

  return (
    <Show when={store.dataViewPanel.open}>
      <aside
        class="absolute top-2 right-2 z-30 flex flex-col bg-bg-panel/95 border-2 border-border shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-sm max-h-[min(420px,70vh)] w-[220px] pointer-events-auto"
        data-testid="axis-dataview"
        aria-label="Data window"
      >
        <div class="flex items-center justify-between px-2 py-1.5 border-b-2 border-border text-[10px] text-text-dim uppercase tracking-wider font-semibold flex-shrink-0">
          <span>Data window</span>
          <button
            type="button"
            class="sc-btn sc-btn-ghost px-1.5"
            title="Close data window"
            aria-label="Close data window"
            onClick={() => setDataViewPanelOpen(false)}
          >
            <Icons.x size={12} />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto min-h-0 text-[11px]">
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
            <Show when={seriesRows().length === 0}>
              <div class="px-2.5 py-2 text-text-faint text-[10px]">
                Run a script to see plot values here.
              </div>
            </Show>
          </Show>
        </div>
      </aside>
    </Show>
  );
};

const Section: Component<{ label: string; children: any }> = (props) => (
  <div class="border-b border-border-soft last:border-0">
    <div class="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-text-faint font-semibold">
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
