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
 * Dev-only reference readout for the mock-walk venue.
 *
 * Shows reference TA values (SMA/EMA/RMA/RSI/Donchian) computed independently
 * of the engine in {@link ../dev/ta-reference} for the visible replay prefix,
 * so indicator output can be eyeballed against a known-good series while
 * walking the synthetic 10s venue. Rendered only when debug mode is on AND
 * the mock-walk venue is active; updates on mount and on every replay
 * transition (step / walk / play tick / scrub).
 *
 * @module ui/MockWalkPanel
 */

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { Bar } from '../store/types';
import { isAxisDebug } from '../debug';
import { barPlane } from '../stores/bars';
import { getVisibleBars, subscribeReplay } from '../chart/bar-replay';
import { getMockWalkReference, mockWalkActive, type MockWalkReference } from '../dev/mock-walk';

const ROWS: ReadonlyArray<{ label: string; key: keyof MockWalkReference }> = [
  { label: 'RSI(14)', key: 'rsi14' },
  { label: 'EMA(20)', key: 'ema20' },
  { label: 'RMA(14)', key: 'rma14' },
  { label: 'SMA(20)', key: 'sma20' },
  { label: 'Donch U (20)', key: 'donchUpper' },
  { label: 'Donch M (20)', key: 'donchMid' },
  { label: 'Donch L (20)', key: 'donchLower' },
  { label: 'Close', key: 'close' },
];

function fmt(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '–';
}

export const MockWalkPanel: Component = () => {
  const [ref, setRef] = createSignal<MockWalkReference | null>(null);
  const [visibleCount, setVisibleCount] = createSignal(0);

  const refresh = () => {
    const vis = getVisibleBars(barPlane.bars as Bar[]);
    setVisibleCount(vis.length);
    setRef(getMockWalkReference(vis));
  };

  onMount(() => {
    const unsub = subscribeReplay(refresh);
    onCleanup(unsub);
    refresh();
  });

  return (
    <Show when={isAxisDebug() && mockWalkActive()}>
      <div
        class="fixed bottom-12 right-3 z-40 pointer-events-auto select-none rounded-[var(--radius-panel)] border border-border bg-bg-panel/95 px-2 py-1.5 font-mono text-[10px] leading-4 text-text-dim shadow-lg tabular-nums"
        data-testid="axis-mock-walk-panel"
        role="status"
      >
        <div class="flex items-center justify-between gap-3 border-b border-border pb-1 mb-1">
          <span class="uppercase tracking-wider text-text-faint">MOCK WALK (dev)</span>
          <span class="text-text-faint">ref</span>
        </div>
        <For each={ROWS}>
          {(row) => (
            <div class="flex items-center justify-between gap-4">
              <span class="text-text-faint">{row.label}</span>
              <span>{fmt(ref()?.[row.key])}</span>
            </div>
          )}
        </For>
        <div class="flex items-center justify-between gap-4 border-t border-border mt-1 pt-1">
          <span class="text-text-faint">bar</span>
          <span data-testid="axis-mock-walk-barpos">
            {visibleCount()}/{barPlane.length}
          </span>
        </div>
      </div>
    </Show>
  );
};
