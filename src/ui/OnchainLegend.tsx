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
 * Corner legend for series already attached on the chart.
 *
 * Reads {@link onchainManagerState}. Does not fetch and does not paint.
 *
 * @module ui/OnchainLegend
 */

import { type Component, For, Show, createMemo } from 'solid-js';
import { onchainLegendEntries } from '../onchain/legend';
import { onchainManagerState } from '../onchain/manager';

const ONCHAIN_LEGEND_LIMIT = 6;

/** Compact USD. Tiers use two decimals; smaller values are whole dollars. */
function formatLegendUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Up to six visible on-chain series in the chart's top-left corner. */
export const OnchainLegend: Component = () => {
  const entries = createMemo(() => onchainLegendEntries(onchainManagerState.series));
  return (
    <Show when={entries().length > 0}>
      <div
        class="absolute top-2 left-12 z-[12] pointer-events-none flex flex-col gap-0.5 max-w-[14rem] text-[10px] leading-tight font-mono"
        data-testid="axis-onchain-legend"
      >
        <For each={entries().slice(0, ONCHAIN_LEGEND_LIMIT)}>
          {(row) => (
            <div
              class="flex min-w-0 items-center gap-1"
              data-testid={`axis-onchain-legend-${row.id}`}
            >
              <span
                class="shrink-0"
                style={{
                  width: '8px',
                  height: '8px',
                  background: row.color || 'var(--color-text-faint)',
                }}
              />
              <span class="min-w-0 truncate">{row.label}</span>
              <span class="shrink-0 tabular-nums">{formatLegendUsd(row.value)}</span>
            </div>
          )}
        </For>
        <Show when={entries().length > ONCHAIN_LEGEND_LIMIT}>
          <div class="text-text-faint" data-testid="axis-onchain-legend-more">
            +{entries().length - ONCHAIN_LEGEND_LIMIT}
          </div>
        </Show>
      </div>
    </Show>
  );
};
